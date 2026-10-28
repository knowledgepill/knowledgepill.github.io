---
title: "Use or not to use `var`"
excerpt: "var / local‑variable type inference — where is it good and where does it reduce clarity? Red flag: blanket "always use var" or "never." Want a judgment‑based stance."
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Type inference
  - Screening questions
---

# `var` in Java 10+/21: a judgment-based take

## What `var` actually is (and isn't)

First, pin down the semantics, because most of the "clarity" debate hinges on it:

- **It's compile-time only.** `var` doesn't make Java dynamically typed. The compiler infers a *fixed* static type from
  the initializer; there's no runtime cost and nothing changes in your bytecode behavior
  ([JEP 286](https://openjdk.org/jeps/286), Local-Variable Type Inference, delivered in **Java 10** — note it's not a
  Java 9 feature).
- **`var` is a reserved type name, not a keyword**, so `var` as a variable/method/package name still compiles
  ([JLS SE 21 §3.9](https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.9)).
- **It's deliberately narrow.** Per
  the [JLS SE 21 §14.4 grammar](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.4),
  `LocalVariableType` may be `var`, and local variable declarations only appear in blocks, basic/enhanced `for` headers,
  and try-with-resources resource specs (plus lambda parameters since JDK 11, [JEP 323](https://openjdk.org/jeps/323)).
  **No fields, no method/constructor parameters, no return types, no catch clauses.** This was a conscious design
  decision in JEP 286 — your public API (Application Programming Interface) surface always keeps explicit types.
- **It has no target type.** The initializer is typed *without* the LHS, so poly expressions fail: `var f = () -> {};`,
  `var g = null;`, `var k = {1, 2};` are all compile errors (JEP 286). And per JEP 286's corpus scan of OpenJDK, ~13% of
  local declarations simply *can't* be written with `var`.
- **It doesn't imply `final`.** `var x = ...; x = ...;` is fine.

## Where it earns its keep

1. **When the initializer self-documents.** Constructors and well-named factories where the LHS would just repeat the
   RHS:

```java
var outputStream = new ByteArrayOutputStream();          // type adds nothing
var reader = Files.newBufferedReader(path);              // factory name encodes the type
var stringList = List.of("a", "b", "c");
```

2. **Long generic types that are pure noise.** The RHS already states the type; the LHS is redundancy:

```java
// before
Map<String, List<PurchaseOrder>> openOrders = orderService.findOpen(customerId);
// after — the name `openOrders` carries the meaning, the RHS carries the type
var openOrders = orderService.findOpen(customerId);
```

3. **Breaking long chains into named steps.** This is arguably the best use in modern Java. Without `var`, you either
   write one intimidating 8-line pipeline or pay a heavy typing tax for intermediate names
   ([Amber style guide, G4](https://openjdk.org/projects/amber/guides/lvti-style-guide)):

```java
var freqMap = strings.stream()
        .collect(groupingBy(s -> s, counting()));
var maxEntryOpt = freqMap.entrySet().stream()
        .max(Map.Entry.comparingByValue());
return maxEntryOpt.

map(Map.Entry::getKey);
```

4. **Loop variables and try-with-resources**, where the type is almost always obvious from context:
   `for (var line : lines)`, `try (var in = Files.newInputStream(path))`.

## Where it costs clarity (or worse, correctness-adjacent traps)

1. **Opaque initializers.** When the RHS doesn't reveal the type, you've deleted the one place a reader gets it:

```java
var result = service.process(input);   // What is Result? Hover. Scroll. Ctrl+click.
var data = (Object) jsonNode.get("payload"); // the cast *hides* the real type
```

The test, straight from
the [Oracle language guide](https://docs.oracle.com/en/java/javase/21/language/local-variable-type-inference.html): *"
use this feature with judgment; no strict rule exists"* — and in practice: **the LHS must be at least as informative as
the RHS.** If the name + initializer don't convey the type, write the type.

2. **Large scope.** The [Amber style guide (G2)](https://openjdk.org/projects/amber/guides/lvti-style-guide) makes the
   strongest case: an explicit type is a *guard*. If `items` is declared 100 lines above its use, changing
   `new ArrayList<>()` to `new HashSet<>()` silently changes iteration-order semantics across a wide blast radius — with
   an explicit `List<String>` declaration you'd at least be forced to touch the declaration and notice. Small scope →
   `var` is safe; big scope → shrink the scope first, then use `var`.

3. **The diamond/generic-method trap (G6).** This is where `var` can quietly change your *type*, not just your style:

```java
// DANGEROUS: infers PriorityQueue<Object> — compile-time surprise
var itemQueue = new PriorityQueue<>();
// DANGEROUS: infers List<Object>
var list = List.of();
```

With an explicit LHS (`PriorityQueue<Item> q = new PriorityQueue<>();`) the diamond gets a target type and does the
right thing for free. `var` *removes* the target type, so inference falls back to the broadest applicable type.

4. **Concrete-type leakage (G5).** `var list = new ArrayList<>()` infers `ArrayList<String>`, not `List<String>` — so
   later code can call `ensureCapacity()` and couple to the implementation. For locals with tiny scope this is usually
   harmless; for anything that outlives a few lines, prefer the interface type if you intend it as a contract.

5. **Reading outside an IDE (P3).** Code lives in diffs, docs, chat snippets, and web-based code review where no hover
   popup exists. If understanding your declaration requires tooling, it's not self-revealing.

## My stance: a decision procedure, not a religion

Reject both blanket rules — "always `var`" deletes contracts and invites the G6 traps; "never `var`" throws away real
readability wins in chains and loops. Instead, per declaration, three quick questions:

1. **Does the initializer (or the name) tell me the type without looking elsewhere?** → If no, explicit type.
2. **Is the scope small — used within a few lines of the declaration?** → If no, explicit type (or restructure to shrink
   scope first).
3. **Would an explicit type act as a useful assertion** (interface over implementation, generic arguments the RHS can't
   infer)? → If yes, explicit type.

If all three say "safe," use `var` — and per G1, *improve the variable name at the same time*, since the name now
carries more of the informational load (`List<Customer> x = ...` → `var custList = ...`).

**Java 21 context:** records (JEP 395) and pattern matching for `instanceof`/`switch` (JEP 406, JEP 441) push method
bodies toward *names over types* — `if (obj instanceof Point(int x, int y))` already gives you inferred, well-named
locals with no `var` keyword involved. In that style, `var` for short-lived, well-named locals fits the grain of modern
Java; it doesn't change the three questions above.

**Team level:** whatever you decide, make it consistent per codebase and enforceable (checkstyle/IDE templates).
Consistency beats per-line optimization — a codebase where `var` means "type is obvious from context" is far more
readable than one where each author judges independently.

## Sources

- [JEP 286: Local-Variable Type Inference](https://openjdk.org/jeps/286) (Java 10; Oracle
  mirror: [docs.oracle.com/javase/10/docs/jep/286](https://docs.oracle.com/javase/10/docs/jep/286)) — design rationale,
  scope limits, error cases, corpus statistics
- [Oracle, Java Language Updates: Local Variable Type Inference (SE 21)](https://docs.oracle.com/en/java/javase/21/language/local-variable-type-inference.html) —
  official usage guidance and the "use with judgment" statement
- [Java Language Specification, SE 21, §14.4 Local Variable Declarations](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.4)
  (incl. §14.4.1) — the normative grammar: `LocalVariableType: UnannType | var`
- [Amber Project: Local Variable Type Inference Style Guidelines](https://openjdk.org/projects/amber/guides/lvti-style-guide)
  (Stuart W. Marks, 2018) — principles P1–P4 and guidelines G1–G6 cited above
- [JEP 323: Local-Variable Syntax for Lambda Parameters](https://openjdk.org/jeps/323) (Java 11)
- [JLS SE 21 §3.9 Keywords](https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.9) — `var` as a reserved
  type name
-
Context: [JEP 395: Records](https://openjdk.org/jeps/395), [JEP 406: Pattern Matching for instanceof](https://openjdk.org/jeps/406), [JEP 441: Pattern Matching for switch](https://openjdk.org/jeps/441)
