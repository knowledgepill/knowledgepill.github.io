---
title: "Explain the string pool and why String is immutable"
excerpt: "Explain the string pool and why String is immutable. Difference between \"x\", new String(\"x\"), and .intern()? How does == vs .equals() behave for Integer (and the −128…127 cache)? Listen for: cache range, immutability as a design choice, not just \"strings are final.\""
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - JVM
  - Strings
  - Screening questions
---

## The String pool

The **string pool** (intern table) is a JVM-managed structure holding one canonical `String` object per distinct value. It's *global* across class loaders, which distinguishes it from the per-class constant pool in each `.class` file (literals referenced there get placed into the shared pool at class initialization).

Location history matters: pre–Java 7 literals lived in permgen; since Java 7 they're ordinary heap objects. The key semantic change was **7u6**: before it, `intern()` could store *your object's reference* in the pool; after it, the pool stores its own copy (sharing the same internal byte array).

## Why String is immutable — a design choice, not just `final`

- **Safe sharing / pooling.** The whole pool idea only works if one object can be referenced from anywhere without risk. Note that `new String("x")` actually *shares the literal's internal byte[]* in modern JDKs — safe precisely because neither side can mutate it.
- **Cached hash codes.** `String.hashCode()` is computed once and stored. A mutable string could change value while its stale hash sits in a `HashMap` bucket, silently breaking lookups. Same reason strings are safe as map keys: the key you inserted is the key that's found.
- **Security boundary.** The platform passes strings across trust boundaries — class names for loading/reflection, file paths, URLs, security-manager checks. A mutable string enables check-then-use attacks (pass a check with a benign value, mutate before use). `final` on the *class* is a separate, smaller point: it blocks subclassing/masquerading.
- **Free thread safety.** Immutable objects need no synchronization and are safe to publish — critical for something as ubiquitous as strings.
- **Interning semantics.** `intern()`'s contract ("equal value ⇒ same canonical reference") is only coherent if values never change.

## `"x"` vs `new String("x")` vs `.intern()`

```java
String a = "x";              // literal → pool; one instance per value (per class loader)
String b = new String("x");  // always a fresh heap object (shares the literal's byte[] internally)
String c = b.intern();       // canonical pooled instance for "x"

a == b        // false
b == c        // false   (since 7u6, the pool keeps its own copy; on JDK 6 this could be true)
a == c        // true
a.equals(b)   // true
```

The classic version-sensitive example:

```java
String s = new String("a") + new String("b");  // runtime-built "ab", not folded
s == s.intern();  // false on JDK 7u6+; true on JDK 6
```

(`"a" + "b"` with pure literals *is* compile-time folded to the literal `"ab"` — only runtime construction escapes the pool.) Use `intern()` when you have many equal heap-built strings and want deduplication or identity comparison; it's a synchronized table lookup, so don't intern high-churn garbage strings. And generally: `==` on strings is an anti-pattern outside literals/constants.

## Integer: `==` vs `.equals()`, and the cache

Autoboxing goes through `Integer.valueOf(int)`, which uses a static cache of **−128…127 by default** (HotSpot's `IntegerCache`). The JLS only says valueOf *may* cache, so portable code shouldn't depend on it — but in practice:

```java
Integer a = 127, b = 127;   // both hit the cache → same object
a == b                       // true

Integer c = 128, d = 128;   // separate objects
c == d                       // false
c.equals(d)                  // true (compares intValue)
```

Key facts:

- **Cache range:** −128…127. The upper bound is tunable via `-XX:AutoBoxCacheMax=n` (n ≥ 127); the lower bound stays at −128.
- **Same cache** for `Byte`, `Short`, `Character`, `Long`, and `Double` (−128…127). `Float` has none.
- **Why it exists:** autoboxing is everywhere (`Map<Integer, X>`, collections, APIs); avoiding allocation for the small values that dominate hot paths is a big win, and identity "just works" for the common case by convention.
- **Gotchas:**
    - `int i = 128; Integer j = 128; i == j` → **true** — mixed comparison unboxes `j`, so it's numeric.
    - Constant folding: `Integer x = 64 + 64;` compiles to `valueOf(128)` → *not* cached, even though the operands are small.
    - Rule of thumb: never use `==` on boxed types in general code — use `.equals()` (mind nulls) or compare as unboxed `int`.
    - HashMap correctness with `Integer` keys comes from consistent `equals`/`hashCode`, *not* from the cache.

**In one breath:** the pool exists because strings are immutable; immutability is a design choice that buys safe sharing, cached hashes, trustworthy map keys, security at trust boundaries, and free thread safety — and boxed types get identity semantics only inside the −128…127 default cache (tunable via `-XX:AutoBoxCacheMax`, spec'd as "may"), which is exactly why `==` on boxes is a trap outside that range.
