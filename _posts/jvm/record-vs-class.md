---
title: "Record vs. Class"
excerpt: "When would you use a record vs a class, and sealed classes vs enums? Where does pattern‑matching for switch improve domain modeling (e.g., trade states / order types)? Strong answer: exhaustive switch over sealed hierarchy = self‑documenting state machine."
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Classes
  - Records
  - Screening questions
---

# Records vs Classes, Sealed vs Enums, and Pattern‑Matching Switch as a State Machine (Java 17/21)

## 1. Record vs. Class

A **record class** (JEP 395, finalized in Java 16; JLS SE 21 §8.10) is an implicitly `final` class that models a *plain
data aggregate*: the header declares its state, and the compiler generates the canonical constructor, accessors
(`name()`), `equals()`, `hashCode()`, and `toString()` based on field identity.

**Use a record when:**

- The type is an **immutable value carrier** — DTOs, value objects (`Money`, `OrderRef`), config bundles, tuples, query
  parameters.
- Equality should be **structural** (field-by-field), not identity-based.
- You want validation via a **compact canonical constructor** without boilerplate:

```java
public record Money(long minorUnits, Currency currency) {
    public Money {                       // compact constructor = validation hook
        if (minorUnits < 0) throw new IllegalArgumentException("negative amount");
    }
}
```

**Use a normal class when:**

- You need **mutable state**, identity semantics, or a lifecycle (threads, resources, caching).
- The type must be **extended or embedded in an inheritance hierarchy** — records are final and can only *implement*
  interfaces.
- Behavior is the primary purpose of the type rather than data shape (records *can* have methods, but they're designed
  for data-first types).

Rule of thumb: *if you'd write a class whose entire body is fields + getters + `equals`/`hashCode`/`toString`, make it a
record.*

## 2. Sealed Classes vs. Enums

Both express a **closed world**, but at different levels (JEP 409, Java 17; JLS §8.1.1.2, §8.1.6):

|                        | `enum` (JLS §8.9)                                                                                                | `sealed` hierarchy (JLS §8.1.1.2)                                                      |
|------------------------|------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| Closes over…           | a fixed set of **singleton instances**                                                                           | a fixed set of **subtypes**                                                            |
| Instances              | one per constant, identity equality                                                                              | unlimited; each subtype is usually a stateful record                                   |
| Extension escape hatch | none (implicitly final)                                                                                          | leaf subtypes may be `non-sealed` → deliberate open extension point                    |
| Ergonomics             | `EnumMap`/`EnumSet`, `ordinal()`, per-constant class bodies, switch compiles to `tableswitch` on ordinals (O(1)) | pairs with exhaustive pattern‑matching `switch`; type dispatch via `instanceof` checks |
| Best for               | protocols, flags, states **without per-instance payload**                                                        | **algebraic data types / sum types**: closed family of data-carrying variants          |

The decisive question: *does each variant carry its own data?*

```java
// Enum: fixed singleton set — fine when states are payload-free
public enum TradeStatus {NEW, PENDING_RISK_CHECK, APPROVED, REJECTED, SETTLED}
```

If `REJECTED` needs a `reason` and `PENDING_RISK_CHECK` needs a `riskScore`, an enum forces you to stash heterogeneous
payloads in a side object (or give every constant every field — most unused). A **sealed interface + records** models it
natively:

```java
public sealed interface TradeState
        permits New, PendingRiskCheck, Approved, Rejected, Settled {
}

public record New(String orderId) implements TradeState {
}

public record PendingRiskCheck(String orderId, double riskScore) implements TradeState {
}

public record Approved(String orderId, String approvalRef) implements TradeState {
}

public record Rejected(String orderId, String reason) implements TradeState {
}

public record Settled(String orderId, Instant settledAt) implements TradeState {
}
```

This is the combination JEP 395 explicitly calls out as **algebraic data types**: each variant's *shape* is enforced at
construction time — you cannot build a `Rejected` without a `reason`. (Note: an enum can itself be a permitted subtype
of a sealed interface, so the two mechanisms compose when some variants are singletons and others carry data.)

## 3. Pattern‑Matching Switch: the Self‑Documenting State Machine

**Pattern matching for switch** (JEP 441, finalized in Java 21, with record patterns from JEP 440) lets you dispatch on
*type* — and crucially, when the selector's type is **sealed**, the compiler performs **exhaustiveness checking**: every
permitted subtype must be covered or it's a compile error. No `default` required.

```java
String describe(TradeState state) {
    return switch (state) {
        case New n -> "Order " + n.orderId() + " received, awaiting risk check";
        case PendingRiskCheck p when p.riskScore() < 0.25 ->
                "Low-risk order " + p.orderId() + " auto-approvable";   // guard clause
        case PendingRiskCheck p -> "High-risk order " + p.orderId() + " under manual review";
        case Approved a -> "Order " + a.orderId() + " approved (" + a.approvalRef() + ")";
        case Rejected r -> "Order " + r.orderId() + " rejected: " + r.reason();
        case Settled s -> "Order " + s.orderId() + " settled at " + s.settledAt();
    };   // no default — the compiler proves all states are handled
}
```

Why this is a *self‑documenting state machine*:

1. **Exhaustiveness = compile-time forward compatibility.** Add `PartiallyFilled` to the `permits` list and *every*
   switch over `TradeState` in the codebase fails to compile until a case is written. The compiler becomes your
   state-machine linter — no silent fallthrough, no "we forgot this state" production bug hiding behind a `default`.
2. **Each case reads as domain prose.** `case Rejected r -> …` says *when the trade is in state Rejected with payload
   r*… The set of cases *is* the specification of the state space; it can never drift from the type declaration because
   both live in the same closed hierarchy.
3. **Guards (`when`) express conditional transitions** without nested `if`/`else` — e.g., low-risk vs. high-risk paths
   out of `PENDING_RISK_CHECK`.
4. **Record patterns destructure payloads in-place**, so the case name and its data are one unit of documentation (JEP
   440).
5. For **event-driven transitions**, the idiomatic shape is an exhaustive switch where the legal states return a new
   state and everything else throws — making *illegal* transitions explicit:

```java
TradeState onRiskResult(TradeState state, RiskResult result) {
    return switch (state) {
        case PendingRiskCheck p -> result.passed()
                ? new Approved(p.orderId(), result.approvalRef())
                : new Rejected(p.orderId(), result.reason());
        default -> throw new IllegalStateException(
                "RISK_RESULT is not valid in state " + state);
    };
}
```

Here `default` doesn't weaken exhaustiveness — it documents that the event is only legal from one state, and the
compiler still guarantees you've considered *all* states.

**Where this pays off:** order lifecycles, trade/settlement states, payment results (`Succeeded(amount)` /
`Declined(code, reason)`), parser ASTs, rule/decision engines — anywhere a domain is a *closed set of variants with
heterogeneous data*. Before Java 16/21, the same model meant `instanceof` chains + casts or enum + side-payload objects;
before sealed classes (Java 17), an exhaustive switch over a hierarchy couldn't be proven by the compiler at all.

**Performance footnote:** a classic switch over an `enum` compiles to a `tableswitch` on ordinals (O (1) dispatch, no
type tests); a pattern-matching switch over reference types compiles to ordered `instanceof` checks. For domain logic
this difference is noise; in genuinely hot paths with many variants, prefer the enum (or an explicit dispatch table).

## Sources

- **JEP 395: Record Classes** (Java 16) — https://openjdk.org/jeps/395
- **JEP 409: Sealed Classes** (Java 17) — https://openjdk.org/jeps/409
- **JEP 441: Pattern Matching for switch** (Java 21; exhaustiveness, `when` guards, null
  pattern) — https://openjdk.org/jeps/441
- **JEP 440: Record Patterns** (Java 21) — https://openjdk.org/jeps/440
- **Oracle Java Documentation: Pattern Matching for Switch Expressions and
  Statements** — https://docs.oracle.com/en/java/javase/21/language/pattern-matching-switch-expressions-and-statements.html
- **Oracle Java Documentation: Record Classes** — https://docs.oracle.com/en/java/javase/21/language/records.html
- **Oracle Java Documentation: Sealed Classes and
  Interfaces** — https://docs.oracle.com/en/java/javase/21/language/sealed-classes-interfaces.html
- **JLS (Java Language Specification) SE 21, Chapter 8 — Classes**: §8.9 Enum Classes, §8.10 Record Classes, §8.1.1.2
  `sealed`/`non-sealed`/`final`, §8.1.6 Permitted Direct
  Subclasses — https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html
- **JLS SE 21, Chapter 14 — Statements** (switch statement,
  §14.11) — https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html

