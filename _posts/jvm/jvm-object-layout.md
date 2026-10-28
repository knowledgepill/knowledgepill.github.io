---
title: "JVM Objects Layout"
excerpt: "How does the JVM lay out an object in memory (header, alignment, compressed oops)? Reference vs value semantics, and the cost of autoboxing in a hot pricing path? ★ Red flag: no awareness that boxing in a tight loop creates garbage → GC pressure."
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - JVM
  - Internals
  - Screening questions
---

# JVM Object Layout, Reference vs Value Semantics, and the True Cost of Autoboxing in a Hot Pricing Path

> Scope: **Java 9+ / Java 21 (LTS)**, running on **HotSpot** (the reference **JVM**, Java Virtual Machine). A key
> framing point up front: *exact* byte‑level object layout is **not** mandated by the **JLS** (Java Language
> Specification) or the **JVMS** (Java Virtual Machine Specification). The specs define *representation requirements*
> (e.g. objects have fields, arrays have a length), but leave sizes, ordering, and alignment to the implementation. So
> everything below about "12‑byte headers" is a **HotSpot implementation detail**, not a language guarantee — code must
> never depend on it.

---

## 1. How HotSpot lays out an object in memory

On a **64‑bit** HotSpot JVM (the default for any serious server), a typical non‑array object looks like this:

```
+------------------------------------------------------+
| Object header                                        |
|   - Mark word            (8 bytes on 64-bit)        |
|   - Class pointer / "klass" (4 bytes w/ compression)|
+------------------------------------------------------+
| Instance fields (in a layout the VM chooses, not    |
|   necessarily source order; grouped by size & type) |
+------------------------------------------------------+
| Alignment padding (to next 8-byte boundary)         |
+------------------------------------------------------+
```

### 1.1 The header: mark word + class pointer

- **Mark word** — an 8‑byte word on 64‑bit HotSpot that multiplexes *identity* and *synchronization/GC* state: the
  identity hash code (lazily computed), lock status/owner, and GC metadata (e.g. age in generational collectors). Its
  size is a `uintptr_t`, so it is 4 bytes on 32‑bit VMs and 8 bytes on 64‑bit VMs.
- **Class pointer** — points to the `Klass` (the internal representation of the class). Normally 8 bytes, but with
  **compressed class pointers** (`-XX:+UseCompressedClassPointers`, default *on*) it is stored as a 4‑byte offset into a
  compressed class space.

So on a modern 64‑bit JVM the header is **12 bytes** (8 + 4). *(Note: "Compact Object Headers," which shrink this, are
an experimental feature from Java 24/25 onward and are **not** part of Java 21 — don't claim them for a 21 codebase.)*

### 1.2 Alignment and padding

HotSpot aligns objects to an **8‑byte boundary** (`AlignValue = 8`). This is what makes compressed references possible
(see §1.3) and keeps field loads efficient on aligned architectures. The consequence: total object size is rounded *up*
to a multiple of 8.

Worked examples (64‑bit, compressed class pointers):

| Type                      | Header | Fields      | Raw total | Allocated (padded) |
|---------------------------|--------|-------------|-----------|--------------------|
| `new Object()`            | 12     | 0           | 12        | **16**             |
| `Integer` (boxed `int`)   | 12     | 4 (`value`) | 16        | **16**             |
| `Double` (boxed `double`) | 12     | 8 (`value`) | 20        | **24**             |
| Two `int` fields          | 12     | 8           | 20        | **24**             |

A boxed `Double` — the natural type for a naive price field — costs **24 bytes per instance on the heap**, of which only
8 are your actual data. That ~3× overhead is the raw material of the GC problem in §3.

> You can verify this empirically with **JOL** (Java Object Layout, `org.openjdk.jol`) via
> `ClassLayout.parseInstance(obj).toPrintable()`, or from a heap dump / JFR (Java Flight Recorder) object‑size data.

### 1.3 Compressed OOPs (Ordinary Object Pointers)

A naive 64‑bit reference wastes 4 bytes per pointer, and references are *everywhere* (fields, array elements, thread
stacks). HotSpot's **compressed oops** (`-XX:+UseCompressedOops`, default *on*) store a **32‑bit encoded reference**
instead of a full 64‑bit one.

The trick exploits the 8‑byte alignment from §1.2: the low 3 bits of any object address are always zero, so they can be
dropped and restored by shifting. In "zero‑based" mode:

```
realAddress = heapBase + (encodedOop << 3)
```

- A 32‑bit code × 8 bytes of alignment = **2³⁵ ≈ 32 GiB** of addressable heap.
- Therefore compressed oops work while the heap (`-Xmx`) is **below ~32 GB**. If you request a larger heap, HotSpot
  **disables compressed oops by default**, and *every* reference doubles from 4 → 8 bytes — a sudden, large memory
  regression (a classic "we bumped the heap past 32 GB and RSS exploded" incident).
- For heaps **under ~4 GB** that can be placed in low virtual address space, the heap base is zero and no shift is
  needed at all.

Why this matters for a pricing service: your `Map<Symbol, Double>` or list of quote objects is dominated by 4‑byte
(compressed) references and 16–24‑byte boxed values. Compressed oops are quietly saving you hundreds of MB; crossing the
32 GB line silently removes that savings.

---

## 2. Reference semantics vs value semantics in Java

Java has **no user‑defined value types as of Java 21** (the "Valhalla" value types / hidden fields work is not shipped
in 21). The model is:

- **Primitives** (`int`, `double`, `long`, …) are *values* — copied by value, stored inline (in a register, on the
  stack, or packed into an object/array), with no identity.
- **Everything else** (classes, arrays, records) is a **reference type**: the variable holds a *handle/pointer* to an
  object in the heap; assignment and method‑passing copy the *reference*, not the object.

### 2.1 "Pass by value" — of the reference

Java is strictly **call‑by‑value**. For a reference, the *value being passed is the reference itself*. So:

```java
void bump(List<Quote> quotes) {
    quotes.add(new Quote(...)); // mutates the shared object
}

// but reassigning inside does NOT affect the caller:
void rebind(List<Quote> quotes) {
    quotes = new ArrayList<>(); // local copy only; caller unchanged
}
```

This is a frequent source of confusion: you *can* mutate the referent through the copied reference, but you *cannot*
rebind the caller's variable.

### 2.2 Identity vs value equality (and where records fit)

Two distinct notions coexist (JLS §5.2):

- **Identity equality** — `==` on references asks "same object in memory?" (`a == b`).
- **Value equality** — `.equals()` / `.hashCode()`, which you define (or inherit).

**Records** (standard since Java 16, mature in 21) give you *value‑based semantics for free* — the compiler generates
`equals`, `hashCode`, and `toString` from all components. But a record is **still a reference type**: two equal
`record Price(long minorUnits, Currency c)` instances are *distinct objects* that compare equal; they do not behave like
primitives. There is no "two records occupy the same stack slot" behavior in 21.

### 2.3 Why this matters for pricing

The language pushes you toward reference types for anything structured — which is exactly why a hot numeric path so
easily ends up full of boxed `Double`/`Integer` objects instead of `double`/`long`. That bridge between "value in my
head" and "reference on the heap" is what autoboxing silently crosses, at runtime cost.

---

## 3. The real cost of autoboxing in a hot pricing path

### 3.1 What autoboxing actually does

**Autoboxing** is an implicit **boxing conversion** (JLS §5.1.7): a primitive is wrapped into its wrapper object via
`Integer.valueOf(int)`, `Double.valueOf(double)`, etc. The reverse, **unboxing** (JLS §5.1.8), extracts the primitive.
These conversions are permitted in *loose invocation* and *assignment* contexts (§5.2, §5.3) — which is why they happen
"for free" syntactically:

```java
Map<String, Double> prices = new HashMap<>();
double d = 199.99;
prices.

put("AAPL",d);          // implicit boxing: Double.valueOf(d) → heap object

double back = prices.get("AAPL"); // implicit unboxing + NPE risk if absent
```

The compiler desugars the box into a call to `valueOf`. **Crucial detail:** `valueOf` consults a small cache. For
`Integer`, values in **−128 … 127** are returned from a pre‑allocated array (configurable via `-XX:AutoBoxCacheMax=`),
so boxing *those* small ints allocates nothing. Outside that range — i.e., for essentially all real prices and
quantities, and for **all** `Double`/`Long` values — a **fresh heap object is allocated every single time**.

### 3.2 The red flag: allocation in a tight loop = garbage = GC pressure

This is the failure mode to call out explicitly. Consider a naïve hot path that prices N instruments per tick:

```java
// ANTI-PATTERN: runs millions of times per second
for(Instrument i :universe){
Double mid = computeMid(i);            // boxed Double allocated every iteration
double spread = lastAsk.get(i.getId()) - lastBid.get(i.getId()); // unboxing, + Map lookups
    prices.

put(i.getSymbol(),mid);        // another boxed Double stored in the map
total +=mid *i.

getQty();             // unbox for arithmetic
}
```

Each iteration allocates a 24‑byte `Double` (plus possibly more if `computeMid` boxes intermediates). At, say, 10
million iterations/sec that is **~240 MB/s of allocation** — pure garbage that lives only until the next GC. The costs
compound:

1. **Allocation throughput / CPU.** Every box is a heap bump, an object header write, and (in generational collectors) a
   young‑gen placement. High bytes/sec directly taxes the allocator and can force more frequent safepoints.
2. **Young‑generation churn → GC frequency.** Short‑lived boxes fill the Eden space fast, triggering more frequent Young
   GCs. More GCs = more stop‑the‑world pauses (even with low‑pause collectors like **ZGC** or **Shenandoah**, you pay
   reclamation and memory‑barrier costs).
3. **Promotion / old‑gen pressure.** If a boxed value escapes (e.g., stored in the `Map` and outlives Eden), it gets
   promoted to old gen, causing slower Mixed/Full GCs later. A pricing service that *caches* boxed prices is building an
   old‑gen leak of short conceptual lifetime but long heap residence.
4. **JIT (Just‑In‑Time compiler) optimization loss.** Allocations and reference dereferences block key optimizations. In
   particular, **escape analysis** — which lets the JIT *scalar‑replace* an object that never escapes into plain
   registers/stack slots and skip its allocation entirely — is defeated once you store the boxed value in a `Map` or
   return it. Keep the primitive local and non‑escaping, and the JIT can often eliminate the box cost entirely; push it
   into a data structure and you've pinned it to the heap.

**Detection (don't guess, measure):**

- **JFR** (Java Flight Recorder): `jdk.ObjectAllocationInNewTLAB` / allocation events show *what* is being allocated and
  *where* (the pricing loop will light up).
- `-Xlog:gc*` to watch young‑gen frequency/correlation with throughput.
- **JOL** to confirm per‑object size; a profiler (async‑profiler "alloc" mode) to attribute bytes/sec to the exact line.

### 3.3 How to fix it in a pricing path

1. **Use primitives end‑to‑end.** Keep prices as `double`/`long` locals and in primitive arrays. Avoid
   `Map<String, Double>`; use parallel primitive arrays indexed by symbol ID, or a primitive map.
2. **Prefer `long` minor units over `double` for money** — this is both a *performance* and a *correctness* win: binary
   floating point can't represent most decimal prices exactly (`0.1 + 0.2 != 0.3`), so financial code should use integer
   cents/micros (or `BigDecimal` where exact decimal semantics are required, accepting its own object cost off the
   hottest path).
3. **Use primitive collections** to kill boxed keys/values: Eclipse Collections (`DoubleHashMap`, `IntLongMap`),
   Koloboke, or the incubating **Vector API** for SIMD‑friendly bulk numeric work. These store raw primitives in
   contiguous arrays — no per‑element object, better cache locality, and a shape the JIT loves.
4. **Reserve boxing for the API boundary.** Box only when you must cross into a reflection/`java.util`/serialization
   API; keep the inner loop primitive.
5. **Let the JIT do its job** — keep hot values local and non‑escaping so escape analysis can scalar‑replace them, and
   verify with JFR that allocation from the loop has dropped to ~0.

```java
// BETTER: primitive, cache‑friendly, no per‑iteration allocation
double[] mid = new double[universeSize];
long[] qty = new long[universeSize];
for(
int k = 0;
k<universeSize;k++){
mid[k]=

computeMidRaw(k);      // returns primitive double, no box

total +=mid[k]*qty[k];       // pure register/stack arithmetic
        }
```

---

## TL;DR for the interviewer

- **Layout (HotSpot 64‑bit, impl detail, not a spec guarantee):** 8‑byte mark word + 4‑byte compressed class pointer =
  12‑byte header, fields, then padding to an **8‑byte** boundary (e.g. `Integer`→16 B, `Double`→24 B).
- **Compressed oops:** 32‑bit encoded refs (`heapBase + (code << 3)`), default on, valid up to **~32 GB heap**; past
  that they switch off and every ref doubles.
- **Semantics:** Java is call‑by‑value; objects are reference types (no value types in 21). `==` = identity,
  `.equals()` = value; **records** give value‑based equality but remain references.
- **The red flag (name it explicitly):** autoboxing in a tight loop allocates a short‑lived heap object per iteration →
  high allocation rate → young‑gen churn and GC pressure, plus promotion/old‑gen load and JIT escape‑analysis defeat.
  `Integer`'s −128…127 cache does *not* save you on real prices or on `Double`. Fix: primitives end‑to‑end, `long` minor
  units for money, primitive collections, box only at the boundary — and prove it with JFR/JOL/GC logs.

---

## Sources & links (Oracle first)

**Official specifications / docs**

- **JLS 21**, Chapter 5 "Conversions and Contexts" — §5.1.7 *Boxing Conversion*, §5.1.8 *Unboxing Conversion*; §5.2/§5.3
  contexts where boxing is allowed: https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html
- **JLS 21** (PDF, full spec): https://docs.oracle.com/javase/specs/jls/se21/jls21.pdf
- **JVMS** (Java Virtual Machine Specification) — object/field representation requirements (layout left to
  implementation): https://docs.oracle.com/javase/specs/jvms/se21/
- `java.lang.Integer` Javadoc (SE 21) — `valueOf` caching
  behavior: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Integer.html
- `java.lang.Double` Javadoc (SE 21): https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Double.html
- **JMM** (Java Memory Model) — *JMM* note: the memory model defines *happens‑before* visibility, which is separate from
  physical layout; see JSR‑133 / JLS Chapter 17: https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html

**HotSpot implementation references (layout & compressed oops are HotSpot details)**

- OpenJDK Wiki — *Compressed OOPs* (`-XX:+UseCompressedOops`, zero‑based encoding, heap
  thresholds): https://wiki.openjdk.org/display/HotSpot/CompressedOops
- JEP 248 / JDK release notes on compressed oops & class pointers (context for the ~32 GB behavior and 64‑bit
  defaults) — search "JDK CompressedOops" in: https://openjdk.org/jeps/
- **JOL** (Java Object Layout, OpenJDK) — measure real object layout: https://github.com/openjdk/jol

**GC / measurement (to substantiate the "garbage → GC pressure" claim)**

- ZGC and Shenandoah low‑pause collectors (JEP 377, JEP
  389): https://openjdk.org/jeps/377 , https://openjdk.org/jeps/389
- JFR allocation events (`jdk.ObjectAllocationInNewTLAB`) — JDK docs: https://docs.oracle.com/en/java/javase/21/

*(Note on accuracy: the specific byte sizes in §1 are HotSpot behavior and can change between releases — e.g., Compact
Object Headers from Java 24+ will reduce the header. Treat them as "true on current 64‑bit HotSpot," never as a portable
contract.)*


