---
title: "Checked and unchecked exceptions"
excerpt: "Checked vs unchecked exceptions, and your philosophy on exception design in a financial system (fail‑fast vs recover, compensating actions). ★ Strong answer: fail fast on integrity, never swallow; distinguish expected control flow from errors."
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Exceptions
  - Screening questions
---

I'll verify the official Oracle documentation URLs so my sources are accurate, then build the explanation around Java
21.

Let me pull the exact JLS Chapter 11 (SE 21) structure and the Structured Concurrency doc so my section references and
fail-fast claims are precise.

# Checked vs Unchecked Exceptions & Exception Design in a Financial System

Below I ground the mechanics in the **JLS (Java Language Specification)** and Oracle's docs, then give my actual design
philosophy for money‑moving code. Everything is framed for **Java 21** (LTS).

---

## 1. The taxonomy — what "checked" vs "unchecked" actually means

The JLS draws the line in **§11.1.1 (The Kinds of Exceptions)**: every throwable is a `Throwable`; `Exception` and
`Error` are its two direct subclasses; `RuntimeException` extends `Exception`. From that hierarchy:

- **Checked exception classes** = all exception classes *other than* `RuntimeException`+subclasses and `Error`
  +subclasses. In practice, the things you extend from `Exception` directly (or a non‑runtime subclass).
- **Unchecked exception classes** = the run‑time exception classes (`RuntimeException` + subclasses) **and** the error
  classes (`Error` + subclasses).

> "The *unchecked exception classes* are the run‑time exception classes and the error classes. The *checked exception
classes* are all exception classes other than the unchecked exception classes." — JLS §11.1.1

The practical difference is **compile‑time enforcement**, defined in **§11.2 (Compile‑Time Checking of Exceptions)** and
what Oracle's tutorial calls the **"Catch or Specify Requirement"**: for every *checked* exception a method can throw,
you must either `catch` it or name it (or a superclass) in your `throws` clause. Unchecked exceptions are **exempt**
from this check.

The JLS is unusually explicit about *why* unchecked types are exempt — and it's the key to good design:

- **Errors** are exempt because "recovery from them is difficult or impossible" (e.g. `OutOfMemoryError`, a
  `VirtualMachineError`).
- **Run‑time exceptions** are exempt because "having to declare such exceptions would not aid significantly in
  establishing the correctness of programs … Requiring such exception classes to be declared would simply be an
  irritation." (§11.2)

So the language's own intent is: **checked = a condition the caller is *expected* to handle; unchecked = a bug or a
state from which you should not casually recover.** That single sentence is 80% of exception design.

Sources: [JLS §11 — Exceptions (SE 21)](https://docs.oracle.com/javase/specs/jls/se21/html/jls-11.html) · [
`Exception` API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Exception.html) · [Oracle Tutorial: Exceptions](https://docs.oracle.com/javase/tutorial/essential/exceptions/index.html) · [Catching and Handling Exceptions](https://docs.oracle.com/javase/tutorial/essential/exceptions/handling.html)

---

## 2. What changed in the Java 9+ / 21 era (and why it matters for design)

The *mechanics* of exceptions are stable, but the surrounding language gives you better tools to encode intent:

- **Records (JEP 395)** and **sealed classes/interfaces (JEP 409)** let you model *expected outcomes* as closed value
  types instead of abusing exceptions. This is the single biggest lever for "don't use exceptions as control flow."
- **`try`‑with‑resources** keeps resource cleanup deterministic even when an integrity error fires — critical when a DB
  transaction or file handle must be released on the abort path.
- **Virtual Threads (JEP 444, final in 21)** make it cheap to block on external calls; exceptions now propagate cleanly
  across many cheap threads instead of polluting a small pool.
- **Structured Concurrency (JEP 453, *preview* in 21)** — `StructuredTaskScope` treats a group of subtasks as one unit
  and gives you **fail‑fast shutdown policies** out of the box: `ShutdownOnFailure` cancels all siblings the moment one
  throws; `throwIfFailed()` rethrows at the join. This is exactly "abort the whole operation, don't leave partial
  state," expressed in the concurrency layer rather than hand‑rolled flags.

> Preview status matters: JEP 453 in Java 21 requires `--enable-preview`. Treat it as the direction of travel; the
> *pattern* (scope + fail‑fast policy) is what I'd adopt conceptually even on a stable JDK.

Sources: [JEP 453 — Structured Concurrency](https://openjdk.org/jeps/453) · [Oracle: Structured Concurrency (SE 21)](https://docs.oracle.com/en/java/javase/21/core/structured-concurrency.html) · [JEP 444 — Virtual Threads](https://openjdk.org/jeps/444)

---

## 3. My philosophy for a financial system

The one‑line version: **fail fast on integrity, never swallow, and keep "expected business outcome" out of the exception
type system entirely.** Here's how I operationalize it.

### Principle A — Expected control flow is not an error

In finance, things like *insufficient funds*, *limit exceeded*, or *account frozen* are **normal, anticipated outcomes**
of a transfer — not exceptional. Modeling them as exceptions forces every caller into `try/catch` for the hot path and
blurs "the world broke" with "the customer can't afford this." Model them as values:

```java
// Expected business outcomes → sealed value types, NOT exceptions.
public sealed interface TransferResult permits
        TransferResult.Approved,
        TransferResult.Declined {

    record Approved(BigDecimal amount, Currency ccy, String reference) implements TransferResult {
    }

    record Declined(Reason reason, String reference) implements TransferResult {
    }

    enum Reason {INSUFFICIENT_FUNDS, ACCOUNT_FROZEN, LIMIT_EXCEEDED}
}
```

Callers `switch` on the result (pattern matching for `switch` makes this pleasant in 21). No stack trace, no alarm, no
"error budget" consumed by a routine decline. **This is the cleanest expression of "distinguish expected control flow
from errors."**

### Principle B — Integrity violations fail fast, loud, and unchecked

A *violation of an invariant or a contract* — ledger out of balance, double‑entry mismatch, a `null`/negative amount
reaching a constructor, a detected double‑spend — is a **bug or corruption**. You do *not* want some layer three frames
up silently "handling" it by continuing. Make it unchecked so it propagates to a single terminal handler that aborts the
operation and pages someone:

```java
// Contract / invariant violation → fail fast, propagate, do NOT let callers continue.
public final class LedgerInvariantException extends RuntimeException {
    public LedgerInvariantException(String msg) {
        super(msg);
    }
}

public void debit(AccountId id, Money amt) {
    if (amt.isNegative()) throw new IllegalArgumentException("amount must be positive: " + amt);
    // ... apply double-entry; assert debits == credits ...
    if (!balanced()) throw new LedgerInvariantException("ledger not balanced for " + id);
}
```

Why unchecked here? Because the *correct* handling of a corrupt ledger is "stop, compensate/rollback, alert" — there's
no sensible per‑call-site business decision. Forcing a `catch` would just produce a pile of copy‑pasted handlers that
mostly do the wrong thing.

### Principle C — Use checked exceptions *sparingly*, at boundaries where recovery is a real decision

This is where I deliberately push back on "never use checked." At a **service boundary** where the caller genuinely has
a domain choice — *retry later? route to fallback? defer to a dead‑letter queue?* — a checked exception makes that
obligation part of the API contract via the `throws` clause. The compiler then guarantees nobody can ignore it:

```java
// Recoverable external fault at a boundary → checked, forces a decision.
public class PaymentGatewayUnavailableException extends Exception {
    public PaymentGatewayUnavailableException(String msg, Throwable cause) {
        super(msg, cause);
    }
}
```

Rule of thumb I use: **if the answer to "does the caller have a legitimate, different thing to do here?" is *yes*, it
can be checked; if the answer is "no, this always means abort," make it unchecked.** That keeps `throws` clauses
meaningful instead of noise.

### Principle D — Never swallow (the non‑negotiable)

- **No empty `catch`.** No `catch (Exception e) { /* nothing */ }`, no `printStackTrace()` as a terminal action.
- **Always preserve the cause chain.** Wrap with `new MyException(msg, original)` so the root is never lost.
- **Catch specific → compensate; catch broad → only to log + abort.** The broad catch is a *terminal* safety net, not a
  place to "handle" things.
- **Log with context**: correlation/transaction id, operation, key identifiers (redacted), and the full stack — so a 3
  a.m. page is diagnosable.

### Principle E — Compensating actions: fail fast *triggers* compensation, it doesn't suppress it

Within one database you get **ACID** (Atomicity, Consistency, Isolation, Durability) for free via transactions. The hard
part in finance is the **cross‑service** step that can't be in the same transaction. There I use a **SAGA‑style**
approach: each step has an idempotent *compensating* action, and on failure you unwind rather than half‑apply.

```java
public MoneyResult executeTransfer(Transfer t) {
    // Step 1: local ledger debit — ACID inside the DB transaction.
    DebitRecord debit = ledger.debit(t.source(), t.amount());   // may throw LedgerInvariantException (fail fast)

    try {
        // Step 2: credit destination — different service, NOT in the same tx.
        payments.credit(t.destination(), t.amount());           // throws PaymentGatewayUnavailableException
        audit.log(t, "COMMITTED");
        return MoneyResult.committed();
    } catch (PaymentGatewayUnavailableException e) {
        // COMPENSATE: reverse the debit so we never leave a half‑applied transfer.
        ledger.compensateDebit(debit);                          // idempotent, keyed by debit.id()
        audit.log(t, "COMPENSATED", e);
        throw e;                                                 // STILL fail fast to the caller — never swallow
    }
}
```

The supporting cast that makes this safe in production:

- **Idempotency keys** on every write and every compensation, so retries (and the compensating call itself) can't
  double‑apply.
- **Transaction outbox** for reliable messaging: the state change and the "tell the world" event commit atomically, so a
  crash can't lose the signal that triggers compensation downstream.
- **Reconciliation as the backstop**: even with perfect code, scheduled reconciliation (compare ledgers / statements) is
  the ultimate integrity check. Fail‑fast + compensation handles the *online* path; reconciliation catches the rare
  residual drift and pages a human.

### Principle F — One terminal handler per edge

Let exceptions run to a single, well‑understood boundary (a servlet filter, an `@ExceptionHandler`, a message‑consumer's
error handler). There you: map integrity errors → alert + abort; map recoverable faults → dead‑letter/retry with
backoff; attach the correlation id end‑to‑end. This centralizes "never swallow" so it can't be violated by 400 call
sites.

---

## 4. Fail‑fast across concurrent work (the Java 21 angle)

When a financial operation fans out (e.g., validate N accounts / run N risk checks in parallel), I want
**all‑or‑nothing**: if any integrity check fails, cancel the rest and leave no partial state. Structured concurrency
gives me that as a first‑class policy instead of hand‑rolled flags:

```java
// Java 21 (JEP 453 preview): fail fast — one failure cancels all sibling checks.
try(var scope = new StructuredTaskScope.ShutdownOnFailure()){
        for(
AccountId id :batch){
        scope.

fork(() ->riskEngine.

validate(id));   // throws on integrity violation
        }
        scope.

join().

throwIfFailed();                    // rethrows first failure; cancels the rest
}                                                    // scope closed → all subtasks guaranteed done/cancelled
```

`ShutdownOnFailure` "captures the first exception … invokes the `shutdown` method … interrupts all unfinished threads,"
which is precisely *fail fast on integrity, leave no partial state*. (Contrast `ShutdownOnSuccess` for "first good
result wins" fan‑outs.) This composes with virtual threads so the blocking validation calls are cheap.

---

## 5. Quick decision table

| Situation                                     | Type                                                    | Checked/Unchecked        | Why                                                       |
|-----------------------------------------------|---------------------------------------------------------|--------------------------|-----------------------------------------------------------|
| Insufficient funds / limit exceeded / frozen  | `TransferResult.Declined` (value)                       | *n/a — not an exception* | Expected business outcome = control flow                  |
| Amount negative, `null` id, ledger unbalanced | `IllegalArgumentException` / `LedgerInvariantException` | **Unchecked**            | Bug/corruption → fail fast, propagate to terminal handler |
| Gateway/DB unavailable at a boundary          | `PaymentGatewayUnavailableException`                    | **Checked**              | Caller has a real decision: retry / fallback / defer      |
| `OutOfMemoryError`, `StackOverflowError`      | `Error` subclasses                                      | Unchecked (exempt)       | Not recoverable; let it reach the top and abort           |

---

## Sources

- [JLS, Java SE 21 — Chapter 11: Exceptions (§11.1.1 kinds, §11.2 compile‑time checking)](https://docs.oracle.com/javase/specs/jls/se21/html/jls-11.html)
- [
  `java.lang.Exception` API (checked vs unchecked definition)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Exception.html)
- [`java.lang.Throwable` API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html)
- [The Java Tutorials — Exceptions (Catch or Specify Requirement)](https://docs.oracle.com/javase/tutorial/essential/exceptions/index.html)
- [The Java Tutorials — Catching and Handling Exceptions](https://docs.oracle.com/javase/tutorial/essential/exceptions/handling.html)
- [JEP 453 — Structured Concurrency (Preview, Java 21)](https://openjdk.org/jeps/453)
- [Oracle — Structured Concurrency (SE 21), `ShutdownOnFailure` /
  `throwIfFailed`](https://docs.oracle.com/en/java/javase/21/core/structured-concurrency.html)
- [JEP 444 — Virtual Threads (Java 21)](https://openjdk.org/jeps/444)
- [JEP 409 — Sealed Classes (Java 17)](https://openjdk.org/jeps/409) · [JEP 395 — Records (Java 16)](https://openjdk.org/jeps/395)

**Bottom line:** keep *expected outcomes* as values, reserve exceptions for *violations of invariants and contracts*,
fail fast on integrity at the point of detection, use checked exceptions only where recovery is a genuine caller
decision, and let fail‑fast **trigger** idempotent compensating actions (SAGA + outbox + reconciliation) rather than
being swallowed.
