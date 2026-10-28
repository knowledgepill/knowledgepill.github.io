---
title: "Type Erasure"
excerpt: "Explain type erasure and its practical consequences (generics + arrays, catching checked exceptions inside generic methods, instanceof with generics). Listen for: bridges/synthetic casts, why you can't do new T[]. Make explanation in the context of Java 9+ / 21."
preview: true
date: "2026-10-28T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Generics
  - Screening questions
---

# Type Erasure in Java 9+ / 21

## What Type Erasure Is

Generics in Java are **compile-time only**. The compiler applies *type erasure* to produce bytecode that contains only
ordinary (non-generic) classes, interfaces, and methods. Concretely, the compiler:

1. **Replaces** all type parameters with their erasure — the first bound if bounded, `Object` otherwise.
2. **Inserts synthetic casts** where necessary to preserve type safety at call sites.
3. **Generates bridge methods** to preserve polymorphism in extended generic types.

No new classes are created for parameterized types (unlike C# reified generics). This means `ArrayList<String>` and
`ArrayList<Integer>` are the *same* class at runtime — `java.util.ArrayList`.

> **Key invariant:** The JVM never sees a type argument. All generic information is gone by the time bytecode runs.

---

## 1. Why You Cannot Do `new T[]`

```java
public static <T> T[] makeArray(int size) {
    return new T[size]; // ❌ compile-time error
}
```

### Root cause

Arrays in Java are **reified**: they carry their component type at runtime and perform an `instanceof`-like check on
every store (this is what throws `ArrayStoreException`). The JVM instruction `newarray` / `anewarray` requires a
*concrete* class token in the constant pool.

After erasure, `T` becomes `Object` (or its bound). The compiler *could* generate `new Object[size]`, but that would be
**unsound**:

```java
String[] arr = (String[]) makeArray(5); // unchecked cast, compiles with warning
arr[0]=42; // ArrayStoreException? No — the array is actually Object[], so no check fires.
// Silent corruption.
```

The JVM's array store-check relies on the *declared* component type matching the *actual* one. If we silently created
`Object[]` and handed it back as `String[]`, the invariant breaks.

### What you *can* do

| Workaround                                                                                                  | Trade-off                                                    |
|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| `new T[size]` via reflection: `(T[]) Array.newInstance(cls, size)`                                          | Requires a `Class<T>` token; unchecked cast at the call site |
| Return `List<T>` instead of `T[]`                                                                           | Idiomatic; no runtime component-type check needed            |
| Use a raw array with a suppress warning: `@SuppressWarnings("unchecked") T[] arr = (T[]) new Object[size];` | Unsafe — only valid if you control all writes                |

The restriction is codified in JLS §15.10.2 (Array Creation): the element type of an array creation expression must be a
*reifiable* type, and a type parameter is not reifiable.

---

## 2. `instanceof` with Parameterized Types

```java
public static <E> void rtti(List<E> list) {
    if (list instanceof ArrayList<Integer>) { // ❌ compile-time error
        ...
    }
}
```

### Root cause

`instanceof` requires its right-hand operand to be a **reifiable type** (JLS §15.20.2). A parameterized type like
`ArrayList<Integer>` is *non-reifiable* because after erasure it is indistinguishable from `ArrayList<String>`. The JVM
has no way to verify the type argument — the information simply doesn't exist in the object header or class metadata.

### What you *can* do

```java
if(list instanceof ArrayList<?>){ // ✅ reifiable (unbounded wildcard)
        ...
        }
```

The unbounded wildcard `?` erases to nothing, so `ArrayList<?>` is reifiable — it's just `ArrayList` at runtime.

### Practical pattern: type token

If you truly need runtime type checking on the *element* type, pass a `Class<T>` token:

```java
public static <T> boolean isListOf(List<?> list, Class<T> elemClass) {
    return !list.isEmpty() && elemClass.isInstance(list.get(0));
}
```

This is the same pattern used by Jackson (`ObjectMapper.readValue(json, new TypeReference<List<String>>() {})`) and
Guava's `TypeToken`.

---

## 3. Catching Checked Exceptions Inside Generic Methods

```java
public static <T extends Exception, J> void execute(List<J> jobs) {
    try {
        for (J job : jobs) { /* ... */ }
    } catch (T e) { // ❌ compile-time error
        // ...
    }
}
```

### Root cause

The `catch` clause requires a **reifiable type** — the JVM must be able to match the thrown exception's class against
the catch parameter at runtime. A type parameter `T` erases to its bound (`Exception` here), so the compiler cannot
generate a meaningful `instanceof` check for `T`. If it did, it would catch *all* `Exception`s, not just the specific
subtype the caller intended.

### What you *can* do

You **can** use a type parameter in a `throws` clause because that's purely compile-time:

```java
class Parser<T extends Exception> {
    public void parse(File file) throws T { // ✅ OK — checked at compile time only
        ...
    }
}
```

The caller must handle (or re-declare) the specific exception type. No runtime check is needed.

### Practical workaround

If you need to catch a *specific* exception type that's parameterized, accept a `Class<T>` and use it for
logging/rethrowing:

```java
public static <T extends Exception> void run(Runnable r, Class<T> logType) throws T {
    try {
        r.run();
    } catch (Exception e) {
        if (logType.isInstance(e)) {
            throw logType.cast(e); // rethrow as T
        }
        throw new RuntimeException(e);
    }
}
```

---

## 4. Bridge Methods and Synthetic Casts

### The problem they solve

After erasure, a subclass method's signature may no longer *override* the superclass method:

```java
public class Node<T> {
    public void setData(T data) { ...}   // erases to: setData(Object)
}

public class MyNode extends Node<Integer> {
    public void setData(Integer data) { ...}  // erases to: setData(Integer) — NOT an override!
}
```

The JVM needs `MyNode` to actually override `Node.setData(Object)` for polymorphic dispatch to work.

### What the compiler generates

The compiler inserts a **synthetic bridge method** (marked with the `ACC_BRIDGE | ACC_SYNTHETIC` flags in the class
file):

```java
// Generated by javac — NOT written by the programmer:
public void setData(Object data) {
    this.setData((Integer) data);  // synthetic cast inserted here
}
```

This bridge method:

- Has the **erased signature** of the superclass method (`setData(Object)`).
- Performs a **synthetic cast** to the actual parameter type (`Integer`).
- Delegates to the real, user-written method.

### Observable consequences

1. **`Class.getDeclaredMethods()`** returns both the bridge and the real method. You must filter with
   `Modifier.isBridge(m)`.
2. **Stack traces** may show the synthetic method frame.
3. **Reflection-based frameworks** (Spring, Jackson, JUnit) must handle bridges explicitly or they'll see
   duplicate/phantom methods.
4. The synthetic cast is where a `ClassCastException` can surface at an unexpected call site:

```java
MyNode mn = new MyNode(5);
Node raw = mn;          // raw type — unchecked warning
raw.

setData("hello");   // dispatches to bridge → (Integer)"hello" → ClassCastException
```

### JLS reference

The formal rules are in **JLS §4.10.4** (*Erased Signatures*) and **§18.2** (*Erasure*). The JVM Specification (§4.9.2)
defines the `ACC_BRIDGE` and `ACC_SYNTHETIC` access flags.

---

## 5. Summary Table of Restrictions

| Operation                                            | Allowed?       | Why                                                                                      |
|------------------------------------------------------|----------------|------------------------------------------------------------------------------------------|
| `new T()`                                            | ❌             | Type parameter is not a class; no constructor to invoke at runtime                       |
| `new T[]`                                            | ❌             | Array component type must be reifiable; erasure would produce unsound `Object[]`         |
| `x instanceof List<String>`                          | ❌             | Right side of `instanceof` must be reifiable                                             |
| `(List<String>) x`                                   | ✅ (unchecked) | Cast to parameterized type is allowed but unchecked — compiler can't verify the type arg |
| `catch (T e)` where `T extends Exception`            | ❌             | Catch parameter must be reifiable                                                        |
| `throws T` where `T extends Exception`               | ✅             | Purely compile-time; no runtime check needed                                             |
| Overloading `f(List<String>)` and `f(List<Integer>)` | ❌             | Both erase to `f(List)` — same JVM signature                                             |

---

## Why Java Chose Erasure (Design Rationale)

- **Binary compatibility with pre-generics code** (Java 1.0–1.4). A generic `List` and a raw `List` are the same
  `.class` file. This was a hard requirement for adoption.
- **Zero runtime overhead.** No new class objects, no type-argument metadata in the heap.
- **Simplicity of the JVM.** The HotSpot JIT doesn't need to specialize on type arguments (unlike C# / .NET which does
  aggressive generic method specialization).

The cost is the restrictions above. In Java 21, there are no plans to change this — the JMM (Java Memory Model) and JVMS
(Java Virtual Machine Specification) make no provision for reified generics, and the JSR-334 follow-ups never
materialized.

---

## Sources

| Source                                                | URL                                                                        |
|-------------------------------------------------------|----------------------------------------------------------------------------|
| Oracle Tutorial – Type Erasure                        | https://docs.oracle.com/javase/tutorial/java/generics/erasure.html         |
| Oracle Tutorial – Restrictions on Generics            | https://docs.oracle.com/javase/tutorial/java/generics/restrictions.html    |
| Oracle Tutorial – Bridge Methods                      | https://docs.oracle.com/javase/tutorial/java/generics/bridgeMethods.html   |
| JLS Java SE 17, §4.10.4 (Erased Signatures)           | https://docs.oracle.com/javase/specs/jls/se17/html/jls-4.html#jls-4.10.4   |
| JLS Java SE 17, §18.2 (Erasure)                       | https://docs.oracle.com/javase/specs/jls/se17/html/jls-18.html#jls-18.2    |
| JVMS Java SE 17, §4.9.2 (Access and Visibility Flags) | https://docs.oracle.com/javase/specs/jvms/se17/html/jvms-4.html#jvms-4.9.2 |

> **Note:** The Oracle Tutorials are written for JDK 8 but the erasure rules have been unchanged since Java 5 and remain
> identical in Java 21. The JLS (Java Language Specification) is the normative reference — §18 ("Generics") defines
> erasure formally, and these rules carry forward into every subsequent release including SE 21.

