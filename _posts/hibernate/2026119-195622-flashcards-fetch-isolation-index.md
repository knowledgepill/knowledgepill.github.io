---
title: Flash Cards Fetch Strategies Isolation Index Types
slug: flashcards-fetch-isolation-index
tags: ["hibernate", "postgresql", "interview", "flashcards"]
preview: true
date: "2026-11-19T19:56:22.000Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
excerpt: Flash Cards Fetch Strategies Isolation Index Types
---
# Flash Cards Fetch Strategies Isolation Index Types

Flash-cards for Java Senior Developer interview preparation covering Hibernate 7.4 fetching strategies, PostgreSQL 18 transaction isolation phenomena and index types.

## Fetch Strategies Trade-offs

**Q: What is the N+1 select problem?**
**A:** Loading a root entity with a lazy collection triggers one query for the root + N additional queries for each collection element. Trade-off: avoids loading unnecessary data but explodes queries under iteration. Rule of thumb: enable batch fetching or use `JOIN FETCH`/`EntityGraph` for known access patterns. [Hibernate User Guide Fetching](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: FetchMode.SELECT vs default lazy loading?**
**A:** `SELECT` issues a separate SQL per association when accessed. Pros: avoids Cartesian product, memory efficient. Cons: N+1 risk. Best practice: keep associations lazy and use batch size. [Hibernate User Guide 12.10](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: FetchMode.JOIN trade-offs?**
**A:** Loads association in same SQL with JOIN. Pros: single round-trip, eliminates N+1. Cons: Cartesian product for collections, duplicate root rows, large result set, can cause `MultipleBagFetchException`. Use for single-valued associations, avoid for multiple collections. [Hibernate User Guide 12.12](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: FetchMode.SUBSELECT?**
**A:** Loads collection for multiple owners with one additional SELECT using subselect of IDs. Pros: reduces N+1 to 2 queries. Cons: still loads entire collection even if only partially needed, less efficient than JOIN for small sets. Good for batch loading of collections. [Hibernate User Guide 12.11](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: Batch fetching with @BatchSize?**
**A:** Hibernate loads associations in batches of size N instead of one-by-one. Pros: mitigates N+1 without JOIN complexity. Cons: may over-fetch. Rule of thumb: `@BatchSize(size=20)` on entity/collection, tune based on data volume. [Hibernate User Guide 12.8](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: Entity Graph vs static mapping?**
**A:** JPA Entity Graph defines fetch plan per query dynamically. Pros: fine-grained control, avoids global eager mapping. Cons: more verbose, must be applied explicitly. Prefer over `FetchType.EAGER`. [Hibernate User Guide 12.6](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: Eager vs Lazy mapping?**
**A:** EAGER loads association immediately; LAZY defers until accessed. Trade-off: EAGER hides performance costs, leads to over-fetch; LAZY requires open session. Best practice: map everything LAZY, override with fetch plans. [Hibernate Best Practices Fetching](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: Join fetch collections cause Cartesian product?**
**A:** Yes. `JOIN FETCH` on multiple collections multiplies rows, can exhaust memory and cause wrong results. Rule: fetch at most one collection per query, use separate queries or DTOs. [Hibernate User Guide Fetching](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: DTO projection vs entity fetching?**
**A:** Projection selects only needed columns into DTO. Pros: less data transfer, no persistence context overhead, avoids lazy issues. Cons: manual mapping. Use for read-only reporting. [Hibernate User Guide](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

**Q: When to use @Fetch(SELECT) with batch size?**
**A:** For associations accessed rarely but in bulk. Batch size reduces queries while keeping result sets small. Avoid for deep object graphs where JOIN FETCH is clearer. [Hibernate User Guide 12.9](https://docs.hibernate.org/orm/7.0/userguide/html_single/)

## Isolation Phenomena

**Q: What is a dirty read?**
**A:** Reading uncommitted data from another transaction. Not possible in PostgreSQL; Read Committed and above prevent it via MVCC. [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: What is a non-repeatable read?**
**A:** Transaction reads same row twice and gets different committed values. Allowed in Read Committed, prohibited in Repeatable Read and Serializable. Example: concurrent UPDATE between two SELECTs. [PostgreSQL 13.2](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: What is a phantom read?**
**A:** Re-executing a query returns additional/deleted rows due to concurrent INSERT/DELETE. PostgreSQL Repeatable Read prevents phantoms via Snapshot Isolation. [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: What is a serialization anomaly?**
**A:** Set of transactions commit with effects inconsistent with any serial order. Only prevented at Serializable level. PostgreSQL detects via predicate locking and raises SQLSTATE 40001. [PostgreSQL 13.2.3](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: How does PostgreSQL Read Committed work?**
**A:** Each statement sees snapshot as of statement start, includes own uncommitted changes. Other statements in same transaction see newer snapshots. Fast, but allows non-repeatable reads. [PostgreSQL 13.2.1](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: PostgreSQL Repeatable Read = Snapshot Isolation?**
**A:** Yes. Transaction sees snapshot as of first statement, never sees later commits. Prevents dirty read and non-repeatable read, phantoms also prevented. May abort on serialization conflict on write. [PostgreSQL 13.2.2](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: Serializable isolation in PostgreSQL?**
**A:** Same as Repeatable Read plus predicate locking to detect serialization anomalies. No blocking, may abort with `could not serialize access due to read/write dependencies`. Must retry. [PostgreSQL 13.2.3](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: Lost update phenomenon?**
**A:** Two transactions read same value, both update, second overwrites first. Prevented by Repeatable Read/Serializable or explicit `SELECT FOR UPDATE`. Read Committed allows it. [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: Write skew?**
**A:** Two transactions read overlapping data and write to disjoint rows based on read, resulting in invalid combined state. Only prevented at Serializable. Example with predicate checks. [PostgreSQL Serializable](https://www.postgresql.org/docs/18/transaction-iso.html)

**Q: Why is Read Uncommitted not available?**
**A:** PostgreSQL's MVCC makes Read Uncommitted equivalent to Read Committed; dirty reads are impossible. Table 13.1 shows Read Uncommitted allowed but not in PG. [PostgreSQL 13.2](https://www.postgresql.org/docs/18/transaction-iso.html)

## Index Types

**Q: Default PostgreSQL index type and use case?**
**A:** B-Tree. Supports `= < <= > >=`, `BETWEEN`, `IN`, `IS NULL`, prefix `LIKE 'foo%'`. Good for range scans and ordering. Default for `CREATE INDEX`. [PostgreSQL 11.2.1](https://www.postgresql.org/docs/18/indexes-types.html)

**Q: Hash index trade-offs?**
**A:** Stores 32-bit hash, only equality `=`. Fast lookups, no range support. Less used now due to B-tree improvements and crash safety. [PostgreSQL 11.2.2](https://www.postgresql.org/docs/18/indexes-types.html)

**Q: When to use GiST?**
**A:** Generalized Search Tree for complex types: geometries, ranges, full-text. Supports nearest-neighbor searches. Example operators `<->` for distance. Requires operator class. [PostgreSQL 11.2.3](https://www.postgresql.org/docs/18/indexes-types.html)

**Q: SP-GiST use case?**
**A:** Space-Partitioned GiST for k-d trees, quadtrees, tries. Good for point data and prefix searches. Supports nearest-neighbor. [PostgreSQL 11.2.4](https://www.postgresql.org/docs/18/indexes-types.html)

**Q: GIN index purpose?**
**A:** Generalized Inverted Index for multi-valued data: arrays, JSONB, full-text. Efficient `&&`, `@>`, `<@` containment queries. Higher write cost. [PostgreSQL 11.2.5](https://www.postgresql.org/docs/18/indexes-types.html)

**Q: BRIN index trade-offs?**
**A:** Block Range Index stores min/max per block range. Very small size, great for large, naturally ordered tables e.g., time-series. Low write overhead, may need heap scan. Supports range ops. [PostgreSQL 11.2.6](https://www.postgresql.org/docs/18/indexes-types.html)

**Q: Partial index?**
**A:** Index built on subset via `WHERE` clause. Reduces size and maintenance cost. Example: `CREATE INDEX ON orders(status) WHERE status='open'`. Use for hot queries. [PostgreSQL Indexes](https://www.postgresql.org/docs/18/indexes.html)

**Q: Covering index / index-only scan?**
**A:** Include extra columns via `INCLUDE` or index all needed columns. Allows index-only scans avoiding heap access. Trade-off: larger index, better read speed. Check `pg_stat_user_indexes`. [PostgreSQL 11.9](https://www.postgresql.org/docs/18/indexes.html)

**Q: Multicolumn index leftmost prefix rule?**
**A:** Index on `(a,b,c)` can be used for queries filtering on `a`, `a,b`, `a,b,c` but not `b,c` alone. Order matters: put high-cardinality, equality columns first. [PostgreSQL 11.3](https://www.postgresql.org/docs/18/indexes.html)

**Q: Index overhead trade-offs?**
**A:** Indexes speed reads but slow writes, consume storage, need maintenance. Rule of thumb: index columns used in WHERE/JOIN/ORDER BY with high selectivity, avoid indexes on low-cardinality or write-heavy columns. Monitor usage with `pg_stat_user_indexes`. [PostgreSQL 11.1](https://www.postgresql.org/docs/18/indexes.html)

## References

- Hibernate ORM 7.0 User Guide, Fetching chapter. https://docs.hibernate.org/orm/7.0/userguide/html_single/
- Hibernate ORM 7.0 Documentation overview. https://hibernate.org/orm/documentation/7.0/
- PostgreSQL 18 Documentation, Chapter 11 Indexes. https://www.postgresql.org/docs/18/indexes.html
- PostgreSQL 18 Documentation, 11.2 Index Types. https://www.postgresql.org/docs/18/indexes-types.html
- PostgreSQL 18 Documentation, Chapter 13 Concurrency Control. https://www.postgresql.org/docs/18/mvcc.html
- PostgreSQL 18 Documentation, 13.2 Transaction Isolation. https://www.postgresql.org/docs/18/transaction-iso.html

