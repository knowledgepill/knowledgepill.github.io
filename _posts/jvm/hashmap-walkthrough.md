---
title: "HashMap internals walkthrough"
excerpt: "Walk through HashMap internals: hashing, bucket array, treeification at 8, resize behavior. What goes wrong under concurrent modification without synchronization? ★ Red flag: can't explain resize rehashing or the old linked‑list cycle under concurrency. Make the explanation in the context of Java 9+  and 21."
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - HashMap
  - Collections
  - Screening questions
---


I've confirmed the Javadoc wording and source constants. Next, I'll verify the JDK bug regarding the Java 7 resize cycle, as well as the thread-safety documentation for `ConcurrentHashMap` in Java 21.



One more check for a canonical OpenJDK reference on the classic resize-cycle issue before I write this up.



# `HashMap` Internals in Java 9+/21 — and Why It Breaks Under Concurrency

**Framing first:** the JLS (Java Language Specification) says nothing about hash tables — all of this is *implementation detail*, not language spec. The only official contract is the Oracle javadoc, which states: *"Note that this implementation is not synchronized… it must be synchronized externally"* and warns that under concurrent modification you risk *"arbitrary, non-deterministic behavior."* Everything below describes the exact code running in JDK 21 (the OpenJDK `HashMap.java` has been structurally stable since the JDK 8 rewrite; Java 9 added the `newHashMap(int)` sizing helper, and nothing material changed through 21).

---

## 1. The data structures

```java
transient Node<K,V>[] table;      // bucket array (lazily allocated)
int size;                         // entry count
int modCount;                     // fail-fast counter for iterators
```

Key constants (verified in the OpenJDK source):

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_INITIAL_CAPACITY` | `1 << 4` = 16 | first table size |
| `MAXIMUM_CAPACITY` | `1 << 30` | cap on growth |
| `DEFAULT_LOAD_FACTOR` | `0.75f` | resize at `capacity × 0.75` entries |
| `TREEIFY_THRESHOLD` | **8** | list → red-black tree |
| `UNTREEIFY_THRESHOLD` | 6 | tree → list (on shrink/split) |
| `MIN_TREEIFY_CAPACITY` | 64 | below this, resize instead of treeify |

Each bucket holds a `Node<K,V>` — a singly linked list node with `final int hash`, `key`, `value`, `next`. Since JDK 8, the hash is **cached in the node**, so lookups never recompute `hashCode()`.

## 2. Hashing: spread + power-of-two masking

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
// index:
int i = (n - 1) & hash(key);
```

- Capacity is always a power of two, so `(n - 1)` is a mask and `&` replaces modulo.
- The XOR with the high 16 bits (`h >>> 16`) **spreads** the top bits into the low bits. Without it, in small tables only the lowest log₂(n) bits of `hashCode()` would matter, so keys whose hashes differ only in high bits would all collide (the source comment cites consecutive-integer `Float` keys as a real example).
- Contract dependency: per `Object.hashCode()` javadoc, equal keys *must* have equal hashes; that's what makes bucket lookup correct. The `null` key is legal and always lands in bucket 0.

## 3. `put` flow (JDK 9/21)

1. If `table == null`, allocate it via `resize()` (rounding the requested capacity up to a power of two with `tableSizeFor`).
2. Compute the bucket index; walk the chain/tree comparing `hash` then `equals`.
3. **Tail-insert** a new `Node` if absent (JDK 8+ deliberately appends at the tail — this matters for the concurrency story later).
4. `++size`; if `size > threshold`, call `resize()` again.

## 4. Treeification at 8

When inserting into a bin that already has **≥ 8 nodes**, `treeifyBin` converts the list to a red-black tree of `TreeNode`s (roughly twice the memory of plain nodes, hence the threshold). Why 8? The source comment cites the Poisson distribution: with load factor 0.75, expected bin occupancy is λ ≈ 0.5, and P(bin length ≥ 8) ≈ **0.00000006** — so a tree means something is *wrong* (hash collision or attack), and worst-case degrades from O(n) to O(log n).

Important details:
- Trees are ordered by hash; on ties, if keys are `Comparable`, `compareTo` breaks the tie (that's why the javadoc mentions `Comparable` ameliorating collisions).
- If the table is smaller than 64 bins, a long bin triggers **resize instead of treeify** — you can't fix a distribution problem by making one bucket fancier.
- On resize/split or removal, trees with ≤ 6 nodes are converted back to plain lists (`UNTREEIFY_THRESHOLD = 6` — the hysteresis gap between 6 and 8 prevents thrashing).

## 5. Resize: doubling + the single-bit "rehash"

Trigger: `size > threshold` (default: capacity × 0.75, so a fresh map resizes at 12 entries → 32 buckets, then 24 → 64, etc.). New capacity is `oldCap << 1`.

The elegant part of the JDK 8+ implementation: **no entry needs its index recomputed from scratch.** Because capacity doubles and indexing is `(n − 1) & hash`, an entry's new index is either:

```java
if ((e.hash & oldCap) == 0)   → stays at index j          (lo chain)
else                          → moves to index j + oldCap (hi chain)
```

Only the single bit of `hash` equal to `oldCap` decides. The resize loop walks each old bin once, splitting it into a `lo` and `hi` chain **in original order**, then assigns `newTab[j] = loHead; newTab[j + oldCap] = hiHead`. Tree bins use `TreeNode.split(...)`, which does the same bit-test partitioning and untreeifies small results.

**Contrast with JDK 7 (the "old" rehashing):** `transfer()` *rehashed* — it recomputed each entry's index into the new table and **head-inserted** (`e.next = newTable[i]; newTable[i] = e;`), which reversed every chain. That head insertion is precisely what enabled the cycle bug below.

## 6. What goes wrong under concurrent modification (no synchronization)

The javadoc is explicit that this is undefined behavior, and here's why, concretely:

### a) JMM (Java Memory Model) level: no happens-before, no atomicity
`table`, `size`, and node fields are plain (non-`volatile`) fields with no CAS (Compare-And-Swap) or locks. So two independent problems exist: **atomicity** (compound read-modify-write interleavings) and **visibility** (one thread's write to `this.table = newTab` may be invisible, or visible out of order, to another thread per JMM rules — see JLS §17 "Synchronization and Ordering").

### b) Lost update on an empty bin
Two threads `put` distinct keys into the same empty bucket: both read `table[i] == null`, both write their node. One entry vanishes — but `size` was incremented **twice**. The map now permanently believes it holds one more entry than it does (and resize thresholds are computed from that wrong `size`).

### c) Lost entries during a concurrent resize
Thread A allocates `newTab`, copies bins, then assigns `table = newTab`. Thread B concurrently `put`s into the *old* table (it may still hold a stale reference — there's no synchronization making the swap atomic w.r.t. readers). After A's swap, B's write lands in a dead array: **the entry is silently lost**. Similarly, two threads treeifying/splitting the same bin can leave a red-black tree with broken parent/child/color invariants → `NullPointerException` or wrong results on later `get`.

### d) The classic red flag: the JDK 7 linked-list cycle (and why 8+ fixed *that* symptom)

In JDK 7, two threads racing through `transfer()` on a bin `[A → B]` could interleave like this (both A and B land in the same new bucket):

```
T1: e = A; next = B        ← T1 preempts here
T2: runs to completion:
     processes A: A.next = null,  newTab[i] = A
     processes B: B.next = A,     newTab[i] = B     (head insertion → B → A)
T1: resumes: A.next = newTab[i] = B;  newTab[i] = A

Result:  A.next = B   and   B.next = A      ⇒  cycle  A ⇄ B
```

A later `get()` walks `while ((node = node.next) != null)` on that bin → **infinite loop, one core pinned at 100% CPU**. This is the famous pre-JDK 8 failure (widely analyzed, e.g. the long-running Stack Overflow thread "Hashmap concurrency issue").

**Why JDK 8+ removed this specific bug:** tail insertion + the `(e.hash & oldCap)` split only ever point a node's `next` at a node *later* in the original chain (or `null`) — a back-edge to an earlier node can't be created by that code, so no cycle. But — and this is the key interview point — **JDK 8/9/21 HashMap is still not thread-safe**: the cycle was one symptom of unsynchronized compound operations; lost updates, lost entries on resize, size drift, and tree corruption all remain fully possible in JDK 21. "No more infinite loop" ≠ "safe under concurrency."

### e) `ConcurrentModificationException` is a detector, not a guard
Iterators check `modCount` and throw CME (ConcurrentModificationException) on unexpected structural change — but the javadoc stresses this is **best-effort only** ("the fail-fast behavior of iterators should be used only to detect bugs"). It may fire after the data is already corrupted, or not at all.

## 7. What to use instead

- **`ConcurrentHashMap`** (Java 21): per its javadoc, "full concurrency of retrievals and high expected concurrency for updates" — lock-free reads, CAS + per-bin `synchronized` on writes, no null keys/values. Note the related trap: mutating the map *inside* a `computeIfAbsent` mapping function is co-modification (tracked as JDK-8071667); use `merge()`/`LongAdder` patterns instead.
- **`Collections.synchronizedMap(new HashMap<>(...))`** — coarse global lock; fine for low contention, but *compound* operations (`if (!m.containsKey(k)) m.put(...)`) still need explicit `synchronized` blocks even with the wrapper.

---

## Sources

- Oracle javadoc, Java 21 — `java.util.HashMap` (non-synchronization contract, fail-fast iterators, rehashing description): https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html
- Oracle javadoc, Java 21 — `java.util.concurrent.ConcurrentHashMap`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html
- OpenJDK source (official repo) — `HashMap.java` (`hash()`, `TREEIFY_THRESHOLD = 8`, Poisson comment, resize/split code): https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/HashMap.java
- Oracle javadoc — `Object.hashCode()` contract: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html#hashCode()
- JLS, Java SE 21 — §17 "Synchronization and Ordering" (JMM happens-before rules): https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html
- Oracle Java Tutorial — Concurrency (memory model overview): https://docs.oracle.com/javase/tutorial/essential/concurrency/
- Classic analysis of the JDK 7 resize cycle: Stack Overflow, "Hashmap concurrency issue": https://stackoverflow.com/questions/1003026/hashmap-concurrency-issue
- Related pitfall — co-modification in `HashMap.computeIfAbsent`: https://bugs.openjdk.org/browse/JDK-8071667

**One-line summary for the red flag:** resize "rehashing" in modern JDKs is a single-bit partition (`hash & oldCap`) into lo/hi chains without recomputing indices; and the infamous concurrent-resize infinite loop came from JDK 7's *head-insertion* transfer creating a two-node cycle — fixed by tail insertion in JDK 8, but `HashMap` remains unsafe under concurrency in Java 21, with lost updates, lost entries, size drift, and tree corruption still on the table.

