---
title: Senior Java Developer Interview Question Bank PostgreSQL Hibernate
slug: senior-java-interview-questions-postgres-hibernate
tags: ["java", "hibernate", "postgresql", "interview", "senior"]
preview: true
date: "2026-11-19T19:58:53.000Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
excerpt: Senior Java Developer Interview Question Bank PostgreSQL Hibernate
---
# Senior Java Developer Interview Question Bank PostgreSQL Hibernate

Target stack: Hibernate ORM 7.4 / Jakarta Persistence 3.2 and PostgreSQL 18. Questions are extracted from the themes:
* Hibernate Fetching and Performance N+1 pitfalls
* PostgreSQL Performance Tuning for Hibernate Applications
* PostgreSQL Hibernate Integration Production Pitfalls
* Hibernate Transactions Concurrency Pitfalls PostgreSQL

Each question includes a model answer with patterns, pitfalls, trade-offs and best practices.

## 1. Hibernate Fetching and Performance N+1 pitfalls

### Q1. What is the N+1 Selects problem and how do you detect it in Hibernate 7.4?
**Answer:** N+1 occurs when a query loads N root entities and then lazily triggers one SELECT per association. Detection: enable SQL logging, use `org.hibernate.stat.Statistics` or Hypersistence Optimizer. In Hibernate 7.4 the query plan cache and statistics expose `sessionFactory.getStatistics().getPrepareStatementCount()`.

Example:
```java
List<Order> orders = session.createQuery("from Order", Order.class).list();
orders.forEach(o -> o.getItems().size()); // triggers N selects
```
Mitigation: JOIN FETCH, EntityGraph, batch fetching. See Hibernate User Guide §12 Fetching https://docs.hibernate.org/orm/7.4/userguide/html_single/#fetching

### Q2. Why is FetchType.EAGER considered an anti-pattern?
**Answer:** EAGER forces loading regardless of use, leads to Cartesian products with multiple collections and cannot be overridden per query. Hibernate 7.4 defaults to LAZY for associations; JPA 3.2 spec recommends LAZY. Use dynamic fetching instead.

### Q3. JOIN FETCH vs EntityGraph vs batch size – when to use each?
**Answer:**
* `JOIN FETCH` – single use, query-specific, good for one-to-many where you know you need the association. Avoid multiple collection fetches.
* EntityGraph – declarative, reusable, JPA 3.2 standard. `@NamedEntityGraph` or programmatic.
* Batch fetching – `@BatchSize(size=20)` reduces N+1 to N/batch. Hibernate User Guide §12.8 Batch fetching https://docs.hibernate.org/orm/7.4/userguide/html_single/#fetching-batch

Trade-off: JOIN FETCH reduces round trips but risks duplication; batch size keeps queries simple.

### Q4. How does Hibernate 7.4 handle the multiple bag fetching problem?
**Answer:** Fetching two `@OneToMany` bags with JOIN FETCH throws `MultipleBagFetchException`. Workarounds: change one to `Set`, use `SELECT DISTINCT` with separate queries, or use `@Fetch(FetchMode.SUBSELECT)`. Hibernate 7.4 keeps the restriction; best practice is to avoid bags.

### Q5. How to configure batch fetching for @ManyToOne and @OneToMany?
**Answer:**
```java
@Entity
class Order {
  @ManyToOne(fetch = FetchType.LAZY)
  @BatchSize(size = 50)
  Customer customer;
}
```
Properties: `hibernate.default_batch_fetch_size=16`. Batch fetching works with bytecode-enhanced lazy attributes. See §12.8.

### Q6. How to avoid Cartesian product with multiple collection fetches?
**Answer:** Never JOIN FETCH two collections in one query. Use separate SELECTs, EntityGraph with `loadgraph`/`fetchgraph`, or DTO projection. Hibernate 7.4 warns about duplicate rows; use `DISTINCT` but prefer splitting.

### Q7. What changes does bytecode enhancement bring to lazy loading?
**Answer:** Hibernate 7.4 bytecode enhancement enables true lazy attribute loading for basic attributes, not just associations. `@LazyGroup` and `@LazyToOne` allow fine-grained lazy loading without proxies. See User Guide §6.2 BytecodeEnhancement https://docs.hibernate.org/orm/7.4/userguide/html_single/#BytecodeEnhancement

## 2. PostgreSQL Performance Tuning for Hibernate Applications

### Q1. How should the PostgreSQL dialect be configured for PostgreSQL 18 with Hibernate 7.4?
**Answer:** Use `org.hibernate.dialect.PostgreSQLDialect`. Hibernate 7.4 auto-detects version via JDBC metadata. Enable `hibernate.jdbc.time_zone=UTC`. For identity columns, PostgreSQL 18 supports `GENERATED ALWAYS AS IDENTITY`. Prefer sequence with pooled optimizer for batch inserts. User Guide §8.11 Database Dialect.

### Q2. JDBC batching with PostgreSQL – what properties matter?
**Answer:**
```
hibernate.jdbc.batch_size=50
hibernate.order_inserts=true
hibernate.order_updates=true
hibernate.jdbc.batch_versioned_data=true
```
PostgreSQL driver property `reWriteBatchedInserts=true` rewrites multi-row INSERTs. Batching is incompatible with IDENTITY unless `hibernate.id.optimizer.pooled.preferred=false`. See §13.1 JDBC batching https://docs.hibernate.org/orm/7.4/userguide/html_single/#batch-jdbcbatch

### Q3. How to map PostgreSQL JSONB efficiently in Hibernate 7.4?
**Answer:** Use `JsonType` from `org.hibernate.type.json.JsonType` or `@JdbcTypeCode(SqlTypes.JSON)`. Hibernate 7.4 supports native JSON binding with `hibernate.type.json_format_mapper`. Map as `@Type(JsonType.class)`. Avoid fetching large JSONB unless needed; use `@Basic(fetch = LAZY)` with bytecode enhancement.

### Q4. PostgreSQL work_mem and Hibernate fetch size interaction?
**Answer:** `hibernate.jdbc.fetch_size=200` controls cursor fetch size. Too large increases `work_mem` usage per backend. For streaming use `ScrollableResults` with `setFetchSize`. PostgreSQL 18 documentation on Performance Tips https://www.postgresql.org/docs/current/performance-tips.html

### Q5. When to use PostgreSQL UNLOGGED tables with Hibernate?
**Answer:** For temporary bulk loads / ETL where durability is not required. Map with `@Table` and DDL `UNLOGGED`. Hibernate does not know logging semantics; risk data loss on crash. Trade-off: faster writes, no WAL.

### Q6. How to avoid deadlocks with PostgreSQL and Hibernate bulk updates?
**Answer:** Use `hibernate.order_updates=true`, keep transactions short, avoid interleaving updates of same tables in different order. Use `SELECT ... FOR UPDATE SKIP LOCKED` via `LockModeType.PESSIMISTIC_WRITE`. Monitor `pg_stat_activity` and `pg_locks`.

### Q7. Indexing strategy for Hibernate generated queries?
**Answer:** Ensure FK columns are indexed. Use `@Index` or `CREATE INDEX CONCURRENTLY`. PostgreSQL 18 improves `CREATE INDEX CONCURRENTLY` performance. Avoid functional indexes unless needed. Use `EXPLAIN (ANALYZE, BUFFERS)` to validate.

## 3. PostgreSQL Hibernate Integration Production Pitfalls

### Q1. Time zone handling pitfalls between Hibernate and PostgreSQL 18?
**Answer:** PostgreSQL stores timestamps without time zone as literal. Hibernate 7.4 uses `hibernate.jdbc.time_zone`. Best practice: store `TIMESTAMPTZ` and set JVM default to UTC. Use `@Column(columnDefinition = "TIMESTAMPTZ")`. Mismatch causes off-by-hour bugs. See User Guide §3.2.26 OffsetDateTime.

### Q2. IDENTITY vs SEQUENCE for primary keys in PostgreSQL?
**Answer:** `GenerationType.IDENTITY` disables JDBC batching and forces one round trip per insert. Prefer `GenerationType.SEQUENCE` with `@SequenceGenerator(allocationSize = 50)` and pooled optimizer. PostgreSQL 18 `GENERATED ALWAYS AS IDENTITY` is still IDENTITY to Hibernate. Pitfall: `allocationSize=1` kills performance.

### Q3. Handling PostgreSQL citext and case-insensitive queries?
**Answer:** Use custom type or `org.hibernate.dialect.PostgreSQLDialect` register `citext` mapping. Queries with `lower()` prevent index use; `citext` provides functional index. Trade-off: `citext` is extension.

### Q4. Why do `NULL` vs empty string mismatches occur?
**Answer:** PostgreSQL treats empty string as non-NULL for `text/varchar`. Hibernate `String` maps to `VARCHAR`. Use `@Column(nullable = false, columnDefinition = "text check (char_length(value)>0)")` or AttributeConverter to normalize.

### Q5. Mapping PostgreSQL INET/CIDR types?
**Answer:** Hibernate 7.4 provides `org.hibernate.type.InetAddressType`. Use `@Type(InetAddressType.class)` for `inet`. For CIDR use `java.net.InetAddress` with custom dialect.

### Q6. Connection pool and PostgreSQL `idle_in_transaction_session_timeout`?
**Answer:** Long Hibernate sessions hold connections. Set `idle_in_transaction_session_timeout` in PostgreSQL 18 to avoid stuck transactions. Use session-per-request pattern, close EntityManager promptly. User Guide §9.5 Transactional patterns.

### Q7. Production pitfall with `hibernate.hbm2ddl.auto` on PostgreSQL?
**Answer:** Never use `update/create-drop` in production. Use Flyway/Liquibase. `hbm2ddl` cannot handle complex migrations, `ALTER` locks tables. PostgreSQL 18 docs on Routine Maintenance https://www.postgresql.org/docs/current/maintenance.html

## 4. Hibernate Transactions Concurrency Pitfalls PostgreSQL

### Q1. REPEATABLE READ vs SERIALIZABLE in PostgreSQL with Hibernate?
**Answer:** PostgreSQL default is READ COMMITTED. REPEATABLE READ provides snapshot isolation; SERIALIZABLE may abort with `SerializationFailure`. Hibernate optimistic locking with `@Version` works with READ COMMITTED. For SERIALIZABLE, catch `OptimisticLockException` and retry. MVCC details https://www.postgresql.org/docs/current/mvcc.html

### Q2. How does FlushMode affect concurrency?
**Answer:** `FlushMode.AUTO` flushes before query. `COMMIT` flushes only on commit. With PostgreSQL, flushing order respects FK constraints. Changing FlushMode can cause stale reads or unexpected writes. Best practice: keep AUTO, keep transactions short.

### Q3. Optimistic locking with `@Version` vs PostgreSQL advisory locks?
**Answer:** `@Version` uses column check `WHERE version = ?`. Advisory locks `pg_advisory_xact_lock` provide application-level locking. Use advisory locks for business-level mutual exclusion, not for row locking. Hibernate `LockModeType.PESSIMISTIC_WRITE` maps to `SELECT ... FOR UPDATE`.

### Q4. Pessimistic locking pitfalls with NOWAIT / SKIP LOCKED?
**Answer:** `LockModeType.PESSIMISTIC_WRITE` can be customized via `@Lock` hint. Use `setLockOptions(new LockOptions(LockMode.PESSIMISTIC_WRITE).setTimeOut(-1))`. PostgreSQL 18 supports `FOR UPDATE NOWAIT` and `SKIP LOCKED`. Pitfall: lock escalation, deadlocks.

### Q5. Session-per-request vs conversation pattern with PostgreSQL connection pool?
**Answer:** Session-per-request binds EntityManager to HTTP request, releases connection back to HikariCP promptly. Long conversations hold DB connection, exhaust pool. Hibernate User Guide §9.5.2 Session-per-request.

### Q6. Lost updates with `@OptimisticLocking` and `@OptimisticLock(excluded = ...)`?
**Answer:** Hibernate 7.4 allows `@OptimisticLock(excluded = true)` to exclude collections from version check. Pitfall: partial updates may lose changes. Use `@OptimisticLocking(type = OptimisticLockType.DIRTY)` for finer control.

### Q7. Spring `@Transactional(propagation = REQUIRES_NEW)` pitfalls with PostgreSQL?
**Answer:** REQUIRES_NEW suspends outer transaction, commits inner independently. If outer rolls back, inner changes remain. With PostgreSQL, two connections used, risking inconsistent state. Prefer `REQUIRED`. Also causes connection pool churn.

## Sources

* Hibernate ORM 7.4 User Guide https://docs.hibernate.org/orm/7.4/userguide/html_single/
* Hibernate ORM 7.4 Releases https://hibernate.org/orm/releases/
* Jakarta Persistence 3.2 Specification https://jakarta.ee/specifications/persistence/3.2/
* PostgreSQL 18 Documentation https://www.postgresql.org/docs/current/
* PostgreSQL 18 Performance Tips https://www.postgresql.org/docs/current/performance-tips.html
* PostgreSQL 18 MVCC https://www.postgresql.org/docs/current/mvcc.html

