---
title: Hibernate Transactions Concurrency Pitfalls PostgreSQL
slug: hibernate-transactions-concurrency-pitfalls-postgresql
tags: ["hibernate", "postgresql", "transactions", "concurrency", "interview"]
preview: true
date: "2026-11-19T19:22:33.000Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
excerpt:  Hibernate Transactions, Concurrency and Pitfalls with PostgreSQL
---
# Hibernate Transactions, Concurrency and Pitfalls with PostgreSQL

## Overview

This article covers transaction management and concurrency control when using Hibernate ORM 7.4 with Jakarta Persistence 3.2 on PostgreSQL 18. The focus is on practical patterns, common pitfalls and interview-level understanding of how Hibernate interacts with PostgreSQL MVCC, locking and isolation.

Key references:
- Hibernate ORM 7.4 User Guide - Transactions [https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#transactions](https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#transactions)
- Hibernate ORM 7.4 User Guide - Locking [https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#locking](https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#locking)
- PostgreSQL 18 Concurrency Control Intro [https://www.postgresql.org/docs/18/mvcc-intro.html](https://www.postgresql.org/docs/18/mvcc-intro.html)
- PostgreSQL 18 Transaction Isolation [https://www.postgresql.org/docs/18/transaction-iso.html](https://www.postgresql.org/docs/18/transaction-iso.html)
- PostgreSQL 18 Explicit Locking [https://www.postgresql.org/docs/current/explicit-locking.html](https://www.postgresql.org/docs/current/explicit-locking.html)

## Transaction Boundaries with @Transactional

Spring @Transactional defines the physical transaction boundary. Hibernate binds a Session to the transaction and flushes on commit by default.

```java
@Service
@Transactional
public class AccountService {
    public void transfer(Long fromId, Long toId, BigDecimal amount) {
        Account from = em.find(Account.class, fromId);
        Account to = em.find(Account.class, toId);
        from.debit(amount);
        to.credit(amount);
    }
}
```

Pitfalls:
- Self-invocation bypasses proxy, no transaction started.
- Propagation REQUIRES_NEW creates nested physical transactions.
- Read-only transactions still flush unless `hibernate.transaction.flush_before_completion` is false.
- Long transactions hold PostgreSQL snapshots, increasing bloat.

Hibernate transactional patterns are described in [Transactional patterns](https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#_transactional_patterns_and_anti_patterns).

## Flush Modes

Flush mode controls when Hibernate synchronizes the persistence context with the database.

- AUTO: flush before queries that might need DB state, flush on commit.
- COMMIT: flush only on transaction commit.
- ALWAYS: flush before every query.
- MANUAL: application controls flush.

```java
entityManager.setFlushMode(FlushModeType.COMMIT);
```

Pitfall: AUTO flush can cause unexpected writes before a SELECT, leading to deadlocks or constraint violations. With PostgreSQL READ COMMITTED, each statement sees a new snapshot, so a flush inside a transaction can make later statements see different data.

See Flushing chapter [https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#flushing](https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#flushing).

## Optimistic Locking and Versioning

Optimistic locking uses a version column to detect lost updates.

```java
@Entity
public class Account {
    @Id Long id;
    BigDecimal balance;
    @Version Long version;
}
```

On update Hibernate emits `WHERE id = ? AND version = ?`. If zero rows updated, `OptimisticLockException` is thrown.

Trade-offs:
- Cheap, no DB locks, good for read-heavy workloads.
- Requires retry logic in application.
- Does not prevent write skew under REPEATABLE READ.

PostgreSQL MVCC allows concurrent readers without blocking writers. Optimistic version checks happen at flush time.

## Pessimistic Locking

Pessimistic locking acquires DB locks immediately.

```java
Account acc = em.find(Account.class, id, LockModeType.PESSIMISTIC_WRITE);
```

Or via JPQL hint:
```java
em.createQuery("select a from Account a where a.id = :id")
  .setParameter("id", id)
  .setHint("jakarta.persistence.lock.timeout", 2000)
  .setLockMode(LockModeType.PESSIMISTIC_WRITE)
  .getSingleResult();
```

Hibernate maps to `SELECT ... FOR UPDATE` or `FOR SHARE`. PostgreSQL row-level locks block writers and readers depending on lock mode.

Best practice: keep lock scope minimal, avoid holding locks across remote calls. Deadlock detection in PostgreSQL aborts one participant with SQLSTATE 40P01.

## Isolation Levels and PostgreSQL MVCC

PostgreSQL implements MVCC: each transaction sees a snapshot.

- READ COMMITTED: default. Each statement sees snapshot at statement start. Non-repeatable reads and phantoms possible. Updating statements can see updated versions of rows concurrently changed. [PostgreSQL 18 Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED)
- REPEATABLE READ: snapshot at transaction start. Prevents non-repeatable reads. Phantom reads are prevented in practice. Serialization failures possible with `could not serialize access due to concurrent update`. [PostgreSQL 18 Repeatable Read](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ)
- SERIALIZABLE: Serializable Snapshot Isolation with predicate locking. Guarantees serial execution. May abort with `could not serialize access due to read/write dependencies`. [PostgreSQL 18 Serializable](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-SERIALIZABLE)

PostgreSQL does not implement true Read Uncommitted; it behaves like Read Committed.

### Lost Updates

Under READ COMMITTED without versioning:
T1 reads balance=100, T2 reads balance=100, both write +50 → final 150 instead of 200.

Solution: @Version optimistic lock or PESSIMISTIC_WRITE.

### Phantom Reads

READ COMMITTED allows phantoms. REPEATABLE READ prevents phantoms in PostgreSQL, though SQL standard allows them.

### Write Skew

Classic example with two accounts and a transfer limit:
T1 reads A and B, T2 reads A and B, both decide sum is enough and update different rows. Under REPEATABLE READ, both commit, violating business invariant. This is write skew.

Mitigation: SERIALIZABLE isolation, application-level predicate locking, or advisory locks.

PostgreSQL MVCC intro explains snapshot semantics: [https://www.postgresql.org/docs/18/mvcc-intro.html](https://www.postgresql.org/docs/18/mvcc-intro.html)

## Deadlock Detection

PostgreSQL detects deadlocks and aborts one transaction. Hibernate should retry on `PessimisticLockException` or serialization failure.

Pattern:
```java
int retries = 3;
while (retries-- > 0) {
  try {
    tx.transfer(...);
    break;
  } catch (OptimisticLockException | PersistenceException e) {
    if (retries == 0) throw e;
  }
}
```

Avoid deadlocks by ordering locks consistently and keeping transactions short.

## Advisory Locks

PostgreSQL advisory locks are application-defined, not tied to rows.

```java
@Repository
public class LockRepo {
    @PersistenceContext EntityManager em;
    public void lockBusinessKey(Long key) {
        em.createNativeQuery("SELECT pg_advisory_xact_lock(:key)")
          .setParameter("key", key)
          .getSingleResult();
    }
}
```

Useful for serializing access to logical entities without DB locks. Released on transaction end.

PostgreSQL explicit locking docs: [https://www.postgresql.org/docs/current/explicit-locking.html](https://www.postgresql.org/docs/current/explicit-locking.html)

## Common Pitfalls Checklist

- Using default READ COMMITTED with complex multi-statement business rules → lost updates/write skew.
- Long @Transactional service methods holding DB snapshots → bloat and serialization failures.
- FlushMode AUTO causing extra SQL in read-only flows.
- Mixing optimistic versioning with bulk HQL updates → version not incremented.
- Pessimistic locks without timeout → indefinite wait.
- Ignoring serialization failures under SERIALIZABLE → silent data anomalies.
- Self-invocation bypassing @Transactional.
- Assuming SELECT FOR UPDATE prevents phantoms across multiple queries.

## Best Practices

- Prefer optimistic locking with @Version for most domains.
- Use PESSIMISTIC_WRITE only for short critical sections.
- Keep transactions short; session-per-request pattern.
- Use SERIALIZABLE for financial invariants where write skew matters, with retry.
- Set lock timeouts via `jakarta.persistence.lock.timeout`.
- Monitor `pg_stat_activity` and deadlock logs.
- Use advisory locks for cross-entity coordination.
- Align Hibernate flush mode with query expectations.

## Sources

- Hibernate ORM 7.4 User Guide, Transactions. https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#transactions
- Hibernate ORM 7.4 User Guide, Locking. https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#locking
- Hibernate ORM 7.4 User Guide, Flushing. https://docs.jboss.org/hibernate/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#flushing
- PostgreSQL 18 Documentation, 13.1 Introduction to MVCC. https://www.postgresql.org/docs/18/mvcc-intro.html
- PostgreSQL 18 Documentation, 13.2 Transaction Isolation. https://www.postgresql.org/docs/18/transaction-iso.html
- PostgreSQL 18 Documentation, 13.3 Explicit Locking. https://www.postgresql.org/docs/current/explicit-locking.html

