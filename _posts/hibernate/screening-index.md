---
title: "Hibernate ORM screening set for Java 17+ / Java 21"
excerpt: "20 refresh screening questions set for Senior Java developers"
preview: true
date: "2026-10-27T09:53:07.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Hibernate
  - Screening questions
---


Context: Hibernate ORM 7.x is the current line for Java 17+.
Hibernate 7.0 requires Java 17, Hibernate 7.4 is the latest stable.
It implements Jakarta Persistence API JPA, formerly Java Persistence API, specification 3.2 / 4.0.

Official references used:

* Hibernate ORM User Guide 7.4 : https://docs.hibernate.org/orm/7.4/userguide/html_single/
* Hibernate ORM Architecture Overview : https://docs.hibernate.org/orm/7.4/userguide/html_single/#architecture
* Jakarta Persistence 3.2 spec : https://jakarta.ee/specifications/persistence/3.2/
* System Requirements / Java 17 baseline : https://docs.hibernate.org/orm/7.4/userguide/html_single/#system-requirements

Acronyms expanded in the questions below: ORM Object-Relational Mapping, JPA Jakarta Persistence API, HQL Hibernate
Query Language, JPQL Java Persistence Query Language, SQL Structured Query Language, JDBC Java Database Connectivity,
JTA Java Transaction API, L1 first level cache, L2 second level cache.

### Core architecture & lifecycle

1. **SessionFactory vs Session**
   What is the difference between `SessionFactory` and `Session` in Hibernate, their lifecycle and thread-safety
   guarantees? Why is `SessionFactory` expensive to create and typically a singleton?

2. **Entity states**
   List and describe the four persistence context states of an entity in Hibernate: transient, persistent/managed,
   detached, removed. How does `PersistenceContext` track them and when does dirty checking run?

3. **First level vs second level cache**
   Explain Hibernate first level cache L1, Session-scoped, mandatory, and second level cache L2, SessionFactory-scoped,
   optional. What is the query cache and how is it related to L2?
   Source: User Guide §14 Caching.

4. **Flush modes and dirty checking**
   What is dirty checking and when is a flush triggered? Explain `FlushMode.AUTO`, `COMMIT`, `ALWAYS`, `MANUAL` and the
   effect on JPQL/HQL queries.
   Source: User Guide §7 Flushing.

### Mapping

5. **@Entity vs @MappedSuperclass**
   What is the difference between `@Entity` and `@MappedSuperclass`? Which one is inherited in the table and can it have
   an identifier?

6. **Association mapping choices**
   When would you choose `@OneToMany` with `@JoinColumn` vs `@OneToMany` with `@JoinTable`? Explain ownership, foreign
   key location and cascade behavior.

7. **@JoinColumn vs @JoinTable**
   Describe the semantics of `@JoinColumn` and `@JoinTable` for associations and collections. What SQL is generated in
   each case?

8. **Composite identifiers**
   How do you map a composite primary key in Hibernate 6/7? Compare `@EmbeddedId` vs `@IdClass`. What are the
   requirements for the embeddable key class in Java 17+?

9. **Inheritance mapping**
   Name the three JPA inheritance strategies supported by Hibernate: SINGLE_TABLE, JOINED, TABLE_PER_CLASS. What are the
   trade-offs for discriminator column and performance?

10. **Java 17 records and immutability**
    Can a Java 17 record be used as a JPA entity in Hibernate 7? What are the restrictions, and how does `@Immutable`
    and bytecode enhancement interact with records? How does Hibernate handle immutable entities and `@Mutability`?

### Fetching, queries & performance

11. **Lazy vs Eager fetching**
    Explain `FetchType.LAZY` and `FetchType.EAGER` for associations and collections. What is bytecode enhancement and
    how does it enable lazy attribute loading in Hibernate 6+?

12. **N+1 select problem**
    What is the N+1 select problem? How do you detect it and how do you prevent it with fetch joins, `@EntityGraph`,
    batch fetching `hibernate.default_batch_fetch_size`, or `@Fetch`?

13. **HQL vs JPQL vs native SQL**
    What is the difference between Hibernate Query Language HQL, JPQL Java Persistence Query Language, and native SQL?
    Which is portable and which allows database-specific functions?

14. **Fetch join vs EntityGraph**
    When would you use a JPQL `join fetch` versus a Jakarta Persistence EntityGraph for dynamic fetching? How does the
    Query Plan cache work for HQL/JPQL?

15. **Locking**
    Explain optimistic locking with `@Version` and pessimistic locking with `LockModeType.PESSIMISTIC_WRITE`. When would
    you prefer one over the other in a Java 21 virtual thread application?

### Caching, transactions & advanced

16. **Second level cache configuration**
    How do you enable second level cache in Hibernate 7? What is `RegionFactory`, and how do JCache and Infinispan
    integrate? Which entity and collection mappings are cacheable?

Source: User Guide §14.1 Configuring second-level caching.

17. **Cascade types**
    List the JPA `CascadeType` values: PERSIST, MERGE, REMOVE, REFRESH, DETACH, REPLICATE, LOCK. What is the risk of
    `CascadeType.ALL` on a `@OneToMany`?

18. **Identifier generation**
    Which identifier generation strategies does Hibernate support? Explain `SEQUENCE`, `IDENTITY`, `TABLE`, `UUID`,
    `AUTO`. What changed in Hibernate 6 regarding `GenerationType.AUTO` interpretation?

Source: User Guide §3.7 Identifiers.

19. **LazyInitializationException and Java 21**
    How does `LazyInitializationException` happen and what are the correct ways to avoid it without `OpenSessionInView`?
    How does this interact with virtual threads Project Loom in Java 21 and the Session-per-request pattern?

20. **Transaction and Session binding**
    Explain Hibernate transaction API vs JTA Java Transaction API integration. How is the current Session bound to the
    current transaction context, and what are the recommended patterns: Session-per-request vs Session-per-operation
    anti-pattern?
    Source: User Guide §9 Transactions.

These questions target conceptual understanding, Hibernate 6/7 mapping changes, Java 17+ record/immutability support,
and performance concerns relevant to modern Java applications.
