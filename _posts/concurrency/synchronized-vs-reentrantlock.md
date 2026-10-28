---
title: "Synchronized vs ReentrantLock"
excerpt: "Compare synchronized vs ReentrantLock: monitor semantics, reentrancy, fairness, tryLock, condition variables. When do you reach for the lock object over synchronized? Listen for: timed/interruptible locks, multiple conditions, fairness."
preview: false
date: "2026-10-28T10:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
ogImage:
  url: "/assets/blog/hello-world/cover.jpg"
tags:
  - Java
  - Locks
  - Concurrency
  - Screening questions
---

## TL;DR

| Capability                                        | `synchronized`                                    | `ReentrantLock`                 |
|---------------------------------------------------|---------------------------------------------------|---------------------------------|
| Implementation                                    | intrinsic lock implemented for each obejct in JVM | `java.util.concurrent`          |
| Mutual exclusion + reentrancy                     | yes                                               | yes                             |
| JMM (Java Memory Model) happens-before guarantees | yes                                               | yes (equivalent)                |
| Non-blocking / timed acquisition (`tryLock`)      | no                                                | yes                             |
| Interruptible acquisition (`lockInterruptibly`)   | no                                                | yes                             |
| Fairness policy                                   | no (no guarantee, unspecified)                    | yes - `new ReentrantLock(true)` |
| Multiple wait sets (condition variables)          | no one per object                                 | yes - `newCondition()`          |
| Unlock from a different stack frame               | no (implicit, same scope)                         | yes - explicit `unlock()`       |
| Zero boilerplate / exception-safe by default      | yes                                               | no - needs `try/finally`        |
| Pinning of virtual threads on JDK 21              | yes, pins the carrier thread                      | yes, parks instead              |

Both give you *the same* memory-visibility semantics — the choice is about **control**, not correctness.

## Monitor semantics (`synchronized`)

Per JLS (Java Language Specification) §17.1, every object has an associated **intrinsic lock** ("monitor") with an owner
thread and a reentrancy count:

- A `synchronized` instance method locks the monitor of `this`; a static one locks the `Class` object's monitor; a block
  locks the expression's object.
- Entry blocks until the monitor is free; **exit happens implicitly** on normal completion *or* when an exception
  propagates out — you can't "forget" to release it. This is the main ergonomic win over lock objects.
- `Object.wait()`, `notify()`, `notifyAll()` operate on that object's single wait set and require holding its monitor
  (else `IllegalMonitorStateException`).
- JLS §17.4.5 (happens-before order): *"An unlock operation happens before every subsequent lock operation (on the same
  lock)."* So writes in one thread's critical section are visible to the next thread that acquires the same lock — no
  `volatile` needed inside.

Note for modern JDKs: biased locking is gone (removed in JDK 15, JEP 374), and intrinsic locks are heavily optimized
(thin-lock fast paths). The old "synchronized is slow" argument is obsolete — don't pick `ReentrantLock` for raw speed.

## Reentrancy — both have it, differently bounded

**Intrinsic**: a thread that already holds the monitor can re-acquire it without blocking (JLS §17.1); the count
decrements on each exit and releases at zero. No documented cap in the spec (in practice you run out of stack first).

**`ReentrantLock`**: same idea, tracked via `getHoldCount()`. The implementation caps recursion at **2³⁰ − 1 =
1,073,741,823** acquisitions (the top bit of the AQS — AbstractQueuedSynchronizer — sync state is reserved), after
which an `Error` ("Maximum lock count exceeded") is thrown.
Calling `lock()` while *another* thread holds it blocks as usual; calling `unlock()` without holding it throws
`IllegalMonitorStateException`.

## Fairness

**Intrinsic locks have no fairness guarantee.** The spec says nothing about acquisition order; HotSpot (the JVM — Java
Virtual Machine — implementation) is roughly FIFO under contention, but that's an implementation detail, not a
contract.

**`ReentrantLock(true)`** gives you a documented first-come-first-served policy: the longest-waiting thread in the AQS
queue gets priority. Javadoc warns fair locks can have lower overall throughput and are vulnerable to starvation if a
lock is held for long periods.
Subtlety: `tryLock()` **does not honor** the fairness policy — a barging thread can skip the queue even on a fair lock
(explicitly documented).

## `tryLock`, timed and interruptible acquisition

This is the biggest functional gap. With `synchronized` you can only *block* (a waiting thread can be interrupted while
parked on monitor entry, per JLS §17.2.3, but you can't time-bound or test-and-acquire):

[//]: # (@formatter:off)
```java
// ReentrantLock: three extra acquisition modes
lock.lock();                // blocking, uninterruptible
lock.lockInterruptibly();   // throws InterruptedException

boolean got = lock.tryLock(500, TimeUnit.MILLISECONDS); // timed + interruptible
```
[//]: # (@formatter:on)

Typical uses: timeout-based fallback/degradation in services, avoiding unbounded waits at shutdown (pair with
`lockInterruptibly()` and an interrupt), or "take the fast path only if uncontended" patterns. Note the Javadoc: timed
`tryLock` may return `false` spuriously — treat it as *at most* the given bound, not a guarantee of waiting that long.

## Condition variables vs `wait`/`notify`

`synchronized` gives you **one wait set per object**. If your invariant has several independent conditions (e.g.,
"buffer not full" and "buffer not empty"), you either over-wake everyone (`notifyAll` on every change) or hack
multiple sentinel objects.

`ReentrantLock.newCondition()` creates as many named conditions as you want, each with its own wait set:

```java
final ReentrantLock lock = new ReentrantLock();
final Condition deposits = lock.newCondition();
final Condition withdrawals = lock.newCondition();

void withdraw(int amount) throws InterruptedException {
    lock.lock();
    try {
        while (balance < amount)          // "while" not "if" due to spurious wakeups
            withdrawals.await();
        balance -= amount;
        deposits.signal();                // wake exactly the depositors
    } finally {
        lock.unlock();                    // explicit, exception-safe via finally
    }
}
```

`Condition.await()` atomically releases the lock and waits (analogous to `Object.wait()`); `await(timeout, unit)` and
`awaitUntil(deadline)` add timeouts; `signal()`/`signalAll()` requeue one/all waiters from *that* condition only. This
is the textbook fix for the "condition splitting" problem — spurious wakeups become dramatically rarer because each
waiter is only signaled when *its* predicate might now hold.

## Memory model: equivalent

Both produce the same JMM (Java Memory Model) happens-before edges (lock release → subsequent acquisition on the same
lock, per JLS
§17.4.5), so visibility of shared state inside critical sections is identical. `ReentrantLock`'s javadoc explicitly
states it has "the same basic properties and semantics as the built-in Java monitor locks and methods."

## When to reach for the lock object

The classic three triggers, plus a fourth that matters specifically on Java 21:

1. **Timed/interruptible acquisition** — you need `tryLock(timeout)` or `lockInterruptibly()`; there is no intrinsic
   equivalent.
2. **Multiple condition variables** — more than one distinct wait predicate on the same resource (producer/consumer,
   request/response pools, read/write split queues). `newCondition()` per predicate.
3. **Fairness** — you need a *guaranteed* FIFO policy to prevent starvation of specific threads; intrinsic ordering is
   unspecified.
4. **Virtual threads (JEP 444, Java 21)** — a virtual thread executing a `synchronized` block or method **pins** its
   carrier thread: while blocked inside it, the platform thread can't run other virtual threads, defeating the
   scalability model. Blocking inside a held `ReentrantLock` parks the virtual thread instead, releasing the carrier. On
   JDK 21 (LTS) this is a real design constraint for high-concurrency server code; later releases (JDK 24+) have reduced
   pinning in some cases, but on 21 prefer lock objects in hot blocking paths.

Bonus reasons: unlocking from a different method/stack frame (e.g., a helper that performs cleanup and releases), and
the `Lock` family as an extension point — `ReadWriteLock`, `StampedLock` (not a `Lock`, no conditions, but optimistic
reads) only exist in lock-object form.

## When to stay with `synchronized`

Thi sis the simplest and easiest way to enforce mutual exclusion in Java. Therefore, this should be a **default
option**, which brins us:

- simple mutual exclusion where you don't need any of the above: less code, no `try/finally` discipline, can't
  accidentally leak the lock,
- locking a plain object (e.g., as a guard for a collection) since every object has a monitor; a `ReentrantLock`
  field is extra state to maintain,
- tooling/profiling ergonomics: intrinsic locks show up directly in thread dumps and profilers as
  "waiting to lock <0x...>".

The rule of thumb: **default to `synchronized`; reach for `ReentrantLock` when you hit one of the four triggers
described above** — and if you do, always pair `lock()` with `unlock()` in a `finally`.

## Sources an further reading

- [Java Language Specification (JLS) §17 *Threads and
  Locks* - monitors, wait sets, happens-before](https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html)
- [Java 21 SE:
  `java.util.concurrent.locks.ReentrantLock`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)

