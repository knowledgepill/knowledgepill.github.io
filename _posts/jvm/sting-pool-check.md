---
title: "Internalized Strings check"
excerpt: "Is it possible to check a list of interlalized Strings in JVM? (i.e. strings that are already cached)"
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

Short answer: **there's no public API to enumerate the pool**, but you *can* test individual strings, and you *can* see the whole table indirectly via heap analysis.

## 1. Checking a specific string — yes

```java
public static boolean isInterned(String s) {
    return s == s.intern();
}
```

If `s` is already the canonical pooled instance, `intern()` returns it unchanged, so identity holds. Caveats:

- **It's not read-only.** If the value isn't in the pool yet, this call *interns it* as a side effect. There is no membership-query method in the API — `String.intern()` (JLS 12.4.1) is the only door into the table, and it mutates state.
- Since 7u6, `s == s.intern()` answers "is *this object* the pooled instance?", not "does an equal value exist in the pool" — a heap-built `"ab"` returns `false` even when the literal `"ab"` is pooled, because the pool keeps its own copy.

## 2. Enumerating the whole table — no supported API

The intern table is a **JVM-internal structure** (a C++ hash table, `StringTable`, in HotSpot), not a Java object:

- It's not reachable via reflection on `java.lang.String` (the field backing it doesn't exist at the Java level).
- No JMX bean, no `jcmd`/Attach command, no JFR event exposes it. The spec only defines interning *semantics*, never enumeration — so this is legitimately VM-implementation territory.
- `jmap -histo` / plain heap inspection shows you all `String` objects but can't tell which are table entries.

## 3. Practical ways to actually see it

**Heap dump + Eclipse MAT (the real answer).** The string table holds references that heap-dump formats record as **GC roots of type "VM Interned Strings"**. So:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Open in MAT → *Histogram* → `java.lang.String` → *List objects → with incoming references*, or use *Path to GC Roots* on a String — interned ones show the "VM Interned Strings" root. That gives you the exact list of currently pooled strings (including everything the JDK itself interned, since the table is global across class loaders).

**`javap -v` for your own literals.** Every literal in a loaded class's constant pool gets interned at class initialization, so:

```bash
javap -v YourClass   # "Constant pool:" section lists the String entries
```

That tells you which of *your* literals are guaranteed to be in the pool.

**Diagnostics (size only, not contents).** `-XX:StringTableSize` sizes the table; recent HotSpot fatal-error logs (`hs_err_pid*.log`) print a "String Table" section with entry counts — useful for spotting runaway interning, not for listing values.

## 4. Why people ask — and the trap

Usually this question comes from memory debugging. Two things to keep in mind:

- HotSpot's table holds **strong references**, so interning high-churn unique strings (e.g., per-request IDs) pins them forever — a classic leak. That's why "don't intern dynamic strings" is standard advice, and why you'd want to *see* the table when it bites.
- The pool accumulates across the whole JVM lifetime: all literals of every loaded class plus anything explicitly interned. A large but *stable* count is normal; a *growing* count means something is calling `intern()` on fresh values.

