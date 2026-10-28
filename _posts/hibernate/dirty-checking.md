---
title: "Dirty checking and flushing database."
excerpt: "What is dirty checking and when is a flush triggered? Explain `FlushMode.AUTO`, `COMMIT`, `ALWAYS`, `MANUAL` and the effect on JPQL/HQL queries."
preview: true
date: "2026-10-27T14:40:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Hibernate
  - Screening questions
---

Dirty checking and flushing are two sides of the same Hibernate / JPA mechanism that keeps the **first-level cache /
persistence context** consistent with the database.

### Dirty checking

* **What it is:** Automatic detection of changes to entities that are in a *managed / persistent* state.
* **How it works:** When an entity is loaded or becomes persistent Hibernate stores a snapshot of its property values in
  the persistence context. The instance is kept in an identity map. While the session is open application code mutates
  the entity through normal setters. No explicit `update()` is required.
  On flush Hibernate compares the current state with the stored snapshot and generates the necessary
  `INSERT / UPDATE / DELETE` SQL only for dirty attributes. With bytecode enhancement Hibernate can track changes at
  attribute level instead of comparing whole snapshots.
* **When it applies:** Only to entities attached to an active `Session / EntityManager`. Detached entities, entities in
  a read-only transaction, or entities annotated `@Immutable` are not snapshotted and therefore are not dirty checked.
* **Performance note:** Dirty checking is executed during flush. Enhanced dirty tracking via the Hibernate enhancer
  plugin avoids full snapshot comparison.

Sources: How Hibernate Dirty Checking Mechanism Works, Baeldung; Hibernate User Guide BytecodeEnhancement.

### Flush

A flush synchronises the persistence context with the database. It is *not* the same as commit. SQL is executed on
flush, the transaction is committed afterwards.

Flush is triggered:

* **Always** before `EntityTransaction.commit()` / `Session.close()` if a transaction is active.
* **Before query execution** depending on the configured `FlushMode`.
* **Explicitly** by calling `EntityManager.flush()` / `Session.flush()`.
* Before JPA bulk `UPDATE / DELETE` and before certain DDL operations.

The flush mode controls the automatic part. JPA defines `jakarta.persistence.FlushModeType` and Hibernate adds its own
`org.hibernate.FlushMode`.

#### JPA `FlushModeType` / Hibernate `FlushMode`

`org.hibernate.FlushMode` is set at session / entity manager level and competes with the JPA `FlushModeType`. The
mapping is provided by `FlushMode.fromJpaFlushMode` / `toJpaFlushMode`.

* **AUTO** - `FlushModeType.AUTO` / `FlushMode.AUTO`
  Default. The Session is flushed on commit and *sometimes* before query execution in order to ensure that queries never
  return stale state.
  Hibernate implements an optimisation based on query space: for a JPQL / Criteria query Hibernate knows which tables
  are referenced. It dirty checks only entities mapped to those tables and flushes only if necessary. For native SQL
  without a registered synchronized entity class Hibernate cannot know the query space and will flush conservatively.
  Effect on JPQL/HQL: queries see the pending in-memory changes when they could affect the result. This is the
  recommended mode.

  >
  `The Session is flushed when EntityTransaction.commit() is called, and is sometimes flushed before query execution in order to ensure that queries never return stale state. This is the default flush mode.`
  > Hibernate FlushMode javadoc

* **COMMIT** - `FlushModeType.COMMIT` / `FlushMode.COMMIT`
  The Session is flushed only when `EntityTransaction.commit()` is called. It is never automatically flushed before
  query execution.
  Effect on JPQL/HQL: queries are executed against the database state only. Changes made to managed entities in the
  current persistence context are invisible to the query until commit / explicit flush. This can lead to stale reads
  inside the same transaction.
  >
  `The Session is flushed when EntityTransaction.commit() is called. It is never automatically flushed before query execution.`
  > Hibernate FlushMode javadoc
  >
  `If FlushModeType.COMMIT is set, the effect of updates made to entities in the persistence context upon queries is unspecified.`
  > Jakarta Persistence API

* **ALWAYS** - Hibernate specific `FlushMode.ALWAYS`
  The Session is flushed on commit *and* before every query. Hibernate does not check the query space, it always
  flushes.
  Effect on JPQL/HQL: guarantees that the query sees the latest pending changes, but at a performance cost because a
  flush is forced even when the query touches unrelated tables.

  >
  `The Session is flushed when EntityTransaction.commit() is called and before every query. This is usually unnecessary and inefficient.`
  > Hibernate FlushMode javadoc

* **MANUAL** - Hibernate specific `FlushMode.MANUAL`
  The Session is only flushed when `Session.flush()` is called explicitly. All automatic flushes are deactivated.
  Effect on JPQL/HQL: queries never see pending in-memory changes unless the application flushes first. Very efficient
  for read-only work but high risk of missing flushes and stale data. Not recommended for general use.

  >
  `The Session is only flushed when Session.flush() is called explicitly. This mode is very efficient for read-only transactions.`
  > Hibernate FlushMode javadoc

Configuration example:

```xml
<property name="org.hibernate.flushMode" value="COMMIT"/>
```

Query specific override:

```java
// JPA
Query q = em.createQuery("SELECT p FROM Product p");
q.setFlushMode(FlushModeType.COMMIT);

// Hibernate specific
q.unwrap(org.hibernate.query.Query.class)
  .setHibernateFlushMode(FlushMode.ALWAYS);
```

### Practical impact on JPQL / HQL

* **AUTO**: `em.persist(newEntity)` then `SELECT ... FROM OtherEntity` → no flush if `OtherEntity` is unrelated.
  `SELECT ... FROM SameEntity` → flush of the dirty `SameEntity` first. Native queries without synchronized entity
  classes always trigger a flush in AUTO.
* **COMMIT**: `persist` + `SELECT FROM SameEntity` → query does **not** return the newly persisted instance because it
  is still only in the persistence context. The insert is executed on commit.
* **ALWAYS**: any query forces a flush first, even for unrelated tables.
* **MANUAL**: any query runs against the database as-is. You must call `em.flush()` yourself before you expect the query
  to see your changes.

Recommended practice for Java 17+ / Jakarta Persistence 3.x and Hibernate 6.x / 7.x is to keep the default `AUTO` and
flush programmatically only when you need the database identity / generated values before a query, e.g. in tests.

Sources:

* Hibernate FlushMode javadoc:
  `org.hibernate.FlushMode` https://docs.hibernate.org/stable/orm/javadocs/org/hibernate/FlushMode.html
* Jakarta Persistence API
  `FlushModeType` https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/FlushModeType.html
* FlushMode in JPA and Hibernate – What it is and how to change it, Thorben Janssen
* How Hibernate Dirty Checking Mechanism Works, Baeldung