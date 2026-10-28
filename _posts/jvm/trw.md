---
title: "Explain try-with-resources and AutoClosable"
excerpt: "Explain try‑with‑resources / AutoCloseable. What are the guarantees around ordering and suppressed exceptions? Listen for: primary exception + suppressed, deterministic close order."
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - TRW
  - Screening questions
---


I'll research the exact JLS (Java Language Specification) semantics and official documentation to give you accurate
citations on ordering and suppressed exceptions.

Let me fetch the authoritative JLS (Java Language Specification) section and the `AutoCloseable` API documentation
directly.

I have the `AutoCloseable` javadoc (with its key API note on suppression). Now let me pin down the exact JLS §14.20.3.1
wording on reverse-order closing and suppression, plus the Java 9 "effectively final" resource change.

I have strong confirmation of the core JLS wording. Let me get the complete §14.20.3.1 semantics (the "equivalent
formulation" and null-initialization detail) to be precise about deterministic ordering.

The first query returned noise. Let me confirm the `Throwable` suppression API signatures from Oracle's Java 21 docs and
nail down the exact §14.20.3.1 "equivalent formulation" text.

I have all the authoritative pieces confirmed (Oracle JLS suppression rule, `AutoCloseable` API note,
`Throwable.addSuppressed`/`getSuppressed`, and the Java 9 effectively-final extension). Let me do one final check on the
exact §14.20.3.1 "equivalent formulation" wording so I don't misquote it.

The Oracle try-with-resources tech note is a focused official page — let me fetch it for the exact desugaring and
ordering details.

I have everything I need from authoritative Oracle sources. Here's the explanation.

---

# `try`‑with‑resources and `AutoCloseable` (Java 9+/21)

## What it is

A **`try`‑with‑resources** statement lets you declare one or more *resources* in its header. Each resource must be a
type that implements [
`java.lang.AutoCloseable`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html)
(or its I/O sub‑interface [
`java.io.Closeable`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/Closeable.html), which adds
`flush()` and narrows `close()` to throw `IOException`). When control leaves the `try` block — **whether it completes
normally or abruptly (exception, `return`, `break`, etc.)** — the compiler guarantees that each resource's `close()` is
invoked.

- Introduced in **Java SE 7**.
- Extended in **Java SE 9**: you may now reference a `final`/effectively‑final variable declared *before* the statement
  as a resource, instead of redeclaring it
  (see [JLS §14.20.3](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3)).

```java
// Java 9+ : 'in' is effectively final, so no redundant re-declaration needed
InputStream in = Files.newInputStream(path);
try(
BufferedReader reader = new BufferedReader(new InputStreamReader(in))){
        return reader.

readLine();
}
```

The formal semantics live in **[JLS §14.20.3 *`try`
‑with‑resources*](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3)** —
specifically [§14.20.3.1 *Basic `try`
‑with‑resources*](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3.1) and [§14.20.3.2
*Extended `try`‑with‑resources*](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3.2).

---

## Guarantee #1 — Deterministic close order (reverse declaration order)

Resources are closed in **the reverse of the order they were declared** (LIFO: last‑declared is closed first). This
ordering is deterministic and holds in *every* exit path: normal completion, exception from the body, `return`, etc.

Three sub‑guarantees worth being precise about:

1. **All successfully‑created resources are always closed**, even if an earlier `close()` throws. A failing `close()`
   does *not* stop the remaining closes.
2. **`null` resources are skipped.** If a resource expression evaluates to `null`, no `close()` is attempted on it (the
   generated code guards with `if (r != null)`).
3. **Initializer failure:** if a resource's initializer throws, that resource and any *later* ones are never created;
   but every resource already created before the failure is still closed.

So for `try (A a = ea; B b = eb; C c = ec) { … }` the close order is always **`c`, then `b`, then `a`** — regardless of
how you exit.

> Note on ordering vs. an explicit `finally`: resources are closed **before** any enclosing `finally` block runs (this
> is specified in [JLS §14.20.3.2](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3.2)).

---

## Guarantee #2 — Primary exception + suppressed exceptions (no masking)

This is the part that makes `try`‑with‑resources strictly better than a hand‑written `finally`. In a plain `finally`, an
exception thrown by `close()` **replaces/masks** the original exception. `try`‑with‑resources avoids this using the
**suppressed‑exception** facility added to [
`Throwable`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html) in Java 7:

- The exception from the **body** is the **primary** exception.
- Any exception thrown by a `close()` during automatic closing is **suppressed**: it is attached to the primary via [
  `Throwable.addSuppressed(Throwable)`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html#addSuppressed(java.lang.Throwable)).
- You can retrieve them all with [
  `Throwable.getSuppressed()`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html#getSuppressed())
  (returns a `Throwable[]`).
- There is **no fixed cap** — every failing close is retained, and `printStackTrace()` prints each one indented under
  the primary as a `Suppressed:` entry.

The JLS states the rule directly
([§14.20.3.1](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3.1)):

> *"If the automatic closing of the resource completes abruptly because of a throw of a value V2, then the `try`
‑with‑resources statement completes abruptly because of a throw of value V with V2 added to the suppressed exception
list of V."*

In other words: **the body's exception always wins as the thing that propagates; close failures are folded in as
suppressed.** If the body does *not* throw but a `close()` does, then that `close()` exception becomes the primary
(there is no earlier exception to suppress it under).

### Worked example (demonstrates both guarantees at once)

```java
import java.io.IOException;

record Resource(String name) implements AutoCloseable {
    @Override
    public void close() throws IOException {
        System.out.println("closing " + name);
        if (name.equals("B")) throw new IOException("close failed on " + name);
    }
}

public class TwrDemo {
    public static void main(String[] args) {
        try (Resource a = new Resource("A");
             Resource b = new Resource("B")) {          // declared: A then B
            System.out.println("in try block");
            throw new IllegalStateException("primary failure in body");
        } catch (Exception e) {
            System.out.println("caught primary : " + e);
            for (Throwable s : e.getSuppressed()) {
                System.out.println("  suppressed   : " + s);
            }
        }
    }
}
```

Output:

```
in try block
closing B          // reverse order: B (declared 2nd) closed first
closing A          // A still closed even though B.close() threw
caught primary : java.lang.IllegalStateException: primary failure in body
  suppressed   : java.io.IOException: close failed on B
```

What this proves in one shot:

- **Reverse order** → `B` before `A`.
- **All resources attempted** → `A` closed despite `B.close()` throwing.
- **Primary + suppressed** → the body's `IllegalStateException` propagates; `B`'s `IOException` is attached, not thrown
  in place of it.

The default `printStackTrace()` rendering of the same object is:

```
java.lang.IllegalStateException: primary failure in body
    at TwrDemo.main(TwrDemo.java:...)
	Suppressed: java.io.IOException: close failed on B
	    at Resource.close(TwrDemo.java:...)
```

---

## The "desugaring" / mental model (and its one trap)

Conceptually, each resource's `close()` is invoked in a `finally`‑like manner in **reverse declaration order**, guarded
by a null check. The key difference from a naïve nested‑`finally` rewrite is that the compiler additionally wires up
`addSuppressed`, so close failures are *attached* rather than *masking*:

```java
// Conceptual (NOT verbatim JLS — shown to illustrate ordering + suppression):
ResourceA a = ea;
try{
ResourceB b = eb;
    try{
S;                                   // the body
    }finally{
            if(b !=null){
        try{b.

close(); }
        catch(
Throwable t){ /* suppress under current primary */ }
        }
        }
        }finally{
        if(a !=null){
        try{a.

close(); }
        catch(
Throwable t){ /* suppress under current primary */ }
        }
        }
```

⚠️ **The trap:** a *pure* nested‑`finally` translation (without the `addSuppressed` step) is **wrong** — in Java a
`finally` that throws replaces the in‑flight exception, which is exactly the masking bug `try`‑with‑resources was
designed to fix. The real generated code never lets a close failure swallow the primary.

---

## Java 9+ specifics

- **Effectively‑final resources** (Java SE 9): the resource list entry may be a plain identifier referring to an
  existing `final`/effectively‑final variable, so you don't have to redeclare it in the header. This is reflected in
  the [JLS §14.20.3](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3) grammar (a resource may
  be an `Identifier`). The close/suppression semantics are unchanged from Java 7.
- Nothing in Java 21 changes the *ordering* or *suppression* rules themselves; they remain exactly as specified above.

---

## Gotchas & best practices

1. **Don't let `close()` throw `InterruptedException`.** The [
   `AutoCloseable`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html) spec
   explicitly warns that a close failure is *suppressed*, and an `InterruptedException` interacting with the thread's
   interrupt status while suppressed "is likely to cause runtime misbehavior." If suppressing it would be problematic,
   don't throw it from `close()`.
2. **Make `close()` release resources before throwing.** The same API note advises relinquishing underlying resources
   and marking the resource closed *prior* to throwing, so a close failure still frees what it can (and because
   `close()` is unlikely to be retried).
3. **Inspect suppressed exceptions programmatically** with `getSuppressed()` in logging/monitoring — otherwise close
   failures are easy to miss if you only log `e.getMessage()`.
4. **Order your declarations by dependency.** Since closing is LIFO, declare a resource that *depends on* another first,
   so the dependent (declared later) is closed first.

---

## Sources

- **JLS §14.20.3 — `try`‑with‑resources**
  (incl. [§14.20.3.1 Basic](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3.1)
  and [§14.20.3.2 Extended](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20.3.2)) — the
  authoritative definition of close ordering and the suppression rule. (Oracle, Java SE 21.)
- **
  `java.lang.AutoCloseable`** — [Oracle API doc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html);
  note the *API Note* on `close()` and suppressed `InterruptedException`.
- **
  `java.io.Closeable`** — [Oracle API doc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/Closeable.html).
- **`java.lang.Throwable`** — [
  `addSuppressed`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html#addSuppressed(java.lang.Throwable)) / [
  `getSuppressed`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html#getSuppressed()).
- **Oracle, "The `try`‑with‑resources Statement" (language
  guide)** — [tech note](https://docs.oracle.com/javase/8/docs/technotes/guides/language/try-with-resources.html).
- **Java SE 9 release notes** (effectively‑final variables in `try`
  ‑with‑resources) — [Oracle JDK 9 release notes](https://www.oracle.com/java/technologies/javase/9-all-relnotes.html).
