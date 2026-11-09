---
title: Hibernate Transactions Concurrency Initial Research
slug: hibernate-transactions-concurrency-initial-research
tags: ["hibernate", "postgresql", "transactions", "concurrency", "interview"]
preview: true
date: "2026-11-19T16:33:15.000Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
excerpt: This research prepares a senior Java developer interview guide on Hibernate 7.4 / Jakarta Persistence 3.2 transactions and concurrency pitfalls with PostgreSQL 18. Focus is on application development at scale, MVCC semantics, isolation levels, locking strategies, flush behavior, and common production pitfalls such as lost updates, phantom reads, write skew, deadlocks, and advisory locks.
---
# Hibernate Transactions Concurrency Initial Research

## Subject Overview

This research prepares a senior Java developer interview guide on Hibernate 7.4 / Jakarta Persistence 3.2 transactions and concurrency pitfalls with PostgreSQL 18. Focus is on application development at scale, MVCC semantics, isolation levels, locking strategies, flush behavior, and common production pitfalls such as lost updates, phantom reads, write skew, deadlocks, and advisory locks.

## Drill-down Subjects

### Transaction Boundaries and @Transactional
Description of Spring @Transactional propagation, readOnly flag, transaction synchronization with Hibernate Session, commit/rollback behavior, physical vs logical transactions.

### Flush Modes and Timing
AUTO, COMMIT, ALWAYS, MANUAL flush modes, interaction with JPQL/HQL queries, flush before query, dirty checking, performance implications, and pitfalls with bulk operations.

### Optimistic Locking and Versioning
@Version mapping, optimistic lock exception handling, Hibernate LockModeType.OPTIMISTIC, lost updates prevention, retry strategies, interaction with PostgreSQL MVCC.

### Pessimistic Locking
LockModeType.PESSIMISTIC_READ, PESSIMISTIC_WRITE, PESSIMISTIC_FORCE_INCREMENT, SELECT FOR UPDATE/SHARE, timeouts, deadlock risk, and PostgreSQL row-level locks.

### Isolation Levels with PostgreSQL MVCC
READ COMMITTED default behavior, REPEATABLE READ snapshot semantics, SERIALIZABLE predicate locking, phenomena: dirty read, non-repeatable read, phantom read, serialization anomaly, write skew.

### Deadlock Detection and Handling
PostgreSQL deadlock detection, lock wait timeout, Hibernate deadlock scenarios with FK checks, ordering of updates, retry logic.

### Lost Updates and Phantom Reads
Examples with code, how optimistic versioning prevents lost updates, why READ COMMITTED allows non-repeatable reads, phantom read prevention at REPEATABLE READ.

### JPA LockModeType Mapping
Mapping of JPA LockModeType to Hibernate LockOptions, differences between JPA and native locking, follow-on locking.

### PostgreSQL Advisory Locks
Explicit advisory locks for application-level coordination, integration with Hibernate via native queries, use cases for distributed locks and write skew prevention.

### Write Skew and Serialization Failures
Definition of write skew, example with two transactions reading different rows and updating overlapping data, SERIALIZABLE detection, SQLState 40001 handling.

## Suggested Sources

- Hibernate ORM 7.4 User Guide, chapters 9 Transactions, 7 Flushing, 11 Locking. https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html
- Jakarta Persistence 3.2 Specification, locking and transaction sections.
- PostgreSQL 18 Documentation, Chapter 13 Concurrency Control: MVCC, Transaction Isolation, Explicit Locking, Advisory Locks. https://www.postgresql.org/docs/18/mvcc.html https://www.postgresql.org/docs/18/transaction-iso.html https://www.postgresql.org/docs/18/explicit-locking.html
- PostgreSQL 18 Documentation, 13.2 Transaction Isolation. https://www.postgresql.org/docs/18/transaction-iso.html

## Learning Plan

1. Review Hibernate transaction API and Spring @Transactional integration.
2. Map flush modes to query execution scenarios.
3. Implement optimistic locking with @Version and test lost update.
4. Implement pessimistic locking with LockModeType and measure deadlock risk.
5. Test each isolation level on PostgreSQL with concurrent sessions reproducing phantom read and write skew.
6. Practice handling serialization failures and implementing retry with exponential backoff.
7. Explore advisory locks for application-level consistency.
8. Consolidate best-practices checklist for production.


