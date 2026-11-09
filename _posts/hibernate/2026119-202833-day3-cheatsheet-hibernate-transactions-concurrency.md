---
title: Day 3 Rapid Review Cheat Sheet - Hibernate Transactions and Concurrency with PostgreSQL
slug: day3-cheatsheet-hibernate-transactions-concurrency
tags: ["cheatsheet", "hibernate", "postgresql", "transactions", "interview"]
preview: true
date: "2026-11-19T20:28:33.000Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
excerpt: Day 3 Rapid Review Cheat Sheet - Hibernate Transactions and Concurrency with PostgreSQL
---
# Day 3 Rapid Review Cheat Sheet - Hibernate Transactions and Concurrency with PostgreSQL

**Scope:** Hibernate 7.4 / Jakarta Persistence 3.2 + PostgreSQL 18
**Focus:** Transaction boundaries, locking, isolation, MVCC pitfalls

## Transaction Basics

* **Boundary:** Use `@Transactional` at service layer, not repository. Propagation `REQUIRED` default, `REQUIRES_NEW` creates new physical transaction.
* **Flush Modes:** `AUTO` default – flush before query; `COMMIT` – flush only on commit; `MANUAL` – explicit `session.flush()`. Flush triggers SQL, can cause unexpected `OptimisticLockException`.
* **Session:** Session per request, never Open Session in View for writes. Close session to release JDBC connection.

## Optimistic Locking

* **Version field:** `@Version private Long version;` Hibernate adds `WHERE id=? AND version=?` on UPDATE.
* **Failure:** `OptimisticLockException` → retry with fresh read. Avoid long transactions.
* **Pitfall:** Updating unrelated columns still increments version → false conflicts.

## Pessimistic Locking

* `LockModeType.PESSIMISTIC_WRITE` → `SELECT ... FOR UPDATE`
* `PESSIMISTIC_READ` → `SELECT ... FOR SHARE`
* Options: `NOWAIT`, `SKIP LOCKED` for queue patterns.
* **PostgreSQL:** Lock held until transaction commit/rollback. Deadlock possible → SQLSTATE `40P01`.

## Isolation Levels PostgreSQL

* **READ COMMITTED** – default. Each statement sees snapshot at statement start. Non-repeatable reads allowed.
* **REPEATABLE READ** – snapshot at transaction start. Phantom reads prevented, serialization failures possible.
* **SERIALIZABLE** – Serializable Snapshot Isolation. Predicate locking, may throw `40001 serialization_failure`.
* **PostgreSQL note:** No READ UNCOMMITTED. `READ COMMITTED` is MVCC safe.

## MVCC Essentials

* Each transaction sees snapshot of data.
* Updates create new row version, old version kept for concurrent readers.
* `VACUUM` reclaims dead tuples. Long-running transactions block vacuum → bloat.

## Deadlocks & Write Skew

* **Deadlock:** Two transactions wait on each other's locks → PostgreSQL aborts one with `40P01`. Implement retry with exponential backoff.
* **Write skew:** Two transactions read same rows, write conflicting updates – allowed under REPEATABLE READ. Use SERIALIZABLE or explicit predicate locks.

## Advisory Locks

* Application-level coordination: `pg_advisory_xact_lock(key)` auto-released on commit.
* Use for distributed job locks, not row locks.

## Common Pitfalls Checklist

* [ ] `@Transactional` on private methods – proxy bypassed → no transaction
* [ ] Lazy loading outside transaction → `LazyInitializationException`
* [ ] `FlushMode.COMMIT` with JPQL query expecting pending changes → stale read
* [ ] Missing `@Version` on hot entities → lost updates
* [ ] Long transaction + large `work_mem` → bloat & lock escalation
* [ ] Catching `OptimisticLockException` and swallowing → silent data loss
* [ ] Using `SERIALIZABLE` without retry → high failure rate

## Quick Commands

```sql
-- Find blocking transactions
SELECT pid, wait_event_type, wait_event FROM pg_stat_activity WHERE wait_event IS NOT NULL;

-- Set isolation
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- Advisory lock
SELECT pg_advisory_xact_lock(123456);
```

## Best Practices

* Keep transactions short, read then write quickly.
* Use optimistic locking for high contention reads, pessimistic for critical sections.
* Retry on `40001` and `40P01` with jitter.
* Monitor `pg_stat_database_conflicts` and `pg_stat_activity`.

**Sources**
* Hibernate ORM 7.4 User Guide Transactions https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#transactions
* Hibernate ORM 7.4 User Guide Locking https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#locking
* PostgreSQL 18 MVCC Intro https://www.postgresql.org/docs/18/mvcc-intro.html
* PostgreSQL 18 Transaction Isolation https://www.postgresql.org/docs/18/transaction-iso.html
* PostgreSQL 18 Explicit Locking https://www.postgresql.org/docs/18/explicit-locking.html

