---
title: "Hibernate `SessionFactory` vs `Session` — Java 17 / 21"
excerpt: "What is the difference between SessionFactory and Session in Hibernate, their lifecycle and thread-safety guarantees? Why is SessionFactory expensive to create and typically a singleton?"
preview: true
date: "2026-10-27T10:09:07.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Hibernate
  - Screening questions
---

The two central contracts in Hibernate ORM are described in the Hibernate User Guide Architecture Overview.

### SessionFactory `org.hibernate.SessionFactory`

> *SessionFactory (`org.hibernate.SessionFactory`)*
>
> *A thread-safe (and immutable) representation of the mapping of the application domain model to a database. Acts as a
factory for `org.hibernate.Session` instances. The `EntityManagerFactory` is the Jakarta Persistence equivalent of a
`SessionFactory` and basically, those two converge into the same `SessionFactory` implementation.*
>
> *A `SessionFactory` is very expensive to create, so, for any given database, the application should have only one
associated `SessionFactory`. The `SessionFactory` maintains services that Hibernate uses across all `Session(s)` such as
second level caches, connection pools, transaction system integrations, etc.*

* **Role:** application-level factory and container for all immutable metadata and shared services.
    * Parses mapping metadata – annotations / XML / programmatic – builds the Hibernate metamodel.
    * Builds the `SessionFactory` service registry: `ConnectionProvider`, `TransactionCoordinator`,
      `SecondLevelCacheRegionFactory`, `QueryPlanCache`, `TypeResolver`, `Dialect`, etc.
    * Compiles named HQL/JPQL queries, builds entity persisters, collection persisters, custom types.
    * `EntityManagerFactory` in Jakarta Persistence is the JPA equivalent and in Hibernate it is the same
      implementation.
* **Lifecycle:**
    * Created once at application bootstrap via native bootstrapping
      ```
      StandardServiceRegistry registry = new StandardServiceRegistryBuilder()
          .applySettings(settings).build();
      MetadataSources sources = new MetadataSources(registry);
      SessionFactory sf = sources.buildMetadata().buildSessionFactory();
      ```
      or JPA compliant bootstrapping `Persistence.createEntityManagerFactory(puName)`.
    * Lives for the whole application lifetime. Closed on graceful shutdown `sessionFactory.close()`.
* **Thread-safety:** thread-safe and immutable after build. It can be shared by all threads. The Javadoc and the User
  Guide explicitly call it *thread-safe (and immutable)*.
* **Why expensive / singleton:**  
  Building a `SessionFactory` is expensive because it involves:
    * Scanning classpath for entity classes, reading annotations / XML, validating mappings.
    * Building the internal metamodel, entity / collection / type descriptors.
    * Initializing the service registry and second-level cache regions.
    * Parsing and pre-compiling HQL/JPQL query plans, creating `Dialect` specific SQL generators.
    * Opening connection pool resources.

  This cost is paid once. Creating a new `SessionFactory` per request would mean re-parsing metadata and re-allocating
  shared caches – unacceptable latency and memory churn. Hence the recommendation: one `SessionFactory` per
  `PersistenceUnit` / database, typically a singleton in the application.

Official reference: Hibernate ORM User Guide 6.5 – 2.1 Overview – SessionFactory.  
https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#architecture-overview

Hibernate 6.5 requires at least Java 11 and JDBC 4.2 and is compatible with Java 17 and 21.  
https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#system-requirements

### Session `org.hibernate.Session`

> *Session (`org.hibernate.Session`)*
>
> *A single-threaded, short-lived object conceptually modeling a “Unit of Work” [PoEAA]. In Jakarta Persistence
nomenclature, the `Session` is represented by an `EntityManager`.*
>
> *Behind the scenes, the Hibernate `Session` wraps a JDBC `java.sql.Connection` and acts as a factory for
`org.hibernate.Transaction` instances. It maintains a generally “repeatable read” persistence context (first level
cache) of the application domain model.*

* **Role:** per-unit-of-work object. It is the persistence context / first-level cache for one logical transaction.
    * Wraps a JDBC `Connection`, creates `Transaction` instances.
    * Tracks entity state: managed, detached, removed.
    * Performs dirty checking, flush ordering, cascade.
* **Lifecycle:**
    * Obtained from the shared `SessionFactory`: `Session session = sessionFactory.openSession();` or
      `sessionFactory.getCurrentSession()`.
    * Short-lived: opened for one request / one unit of work, then closed. Pattern `Session-per-request` is recommended;
      `Session-per-operation` and `Session-per-application` are anti-patterns.
    * In JPA: `EntityManager` has the same lifecycle and is not thread-safe.
* **Thread-safety:** **not thread-safe**. A `Session` must not be shared across threads. It contains mutable state – the
  first-level cache, JDBC connection, transaction, flush mode – and is designed for single-threaded use. The User Guide
  states *single-threaded, short-lived object*.
* **Typical usage with Java 17+ / 21:**

```java
  try (Session s = sessionFactory.openSession()) {
    Transaction tx = s.beginTransaction();
// work
    tx.commit();
  } // close releases JDBC connection back to pool
```

With virtual threads in Java 21 the same rule holds: one `Session` per virtual thread / task, `SessionFactory` shared.

Official reference: Hibernate ORM User Guide 6.5 – 2.1 Overview – Session.  
https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#architecture-overview

Transactional patterns and Session scope are detailed in:

* 9.4 Contextual sessions – `architecture-current-session`
* 9.5 Transactional patterns – `Session-per-request` vs anti-patterns.  
  https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#architecture-current-session

### Summary table

|                     | SessionFactory                                                | Session                                           |
|---------------------|---------------------------------------------------------------|---------------------------------------------------|
| Purpose             | Build-time metadata + shared services, factory for Sessions   | Unit of Work, persistence context                 |
| Thread-safety       | Thread-safe, immutable after build                            | Not thread-safe, single-threaded                  |
| Lifecycle           | Application startup → shutdown, singleton                     | Open → work → close per request / transaction     |
| Expensive to create | Yes – metadata parsing, metamodel, query plan cache, services | Cheap – just allocate context & borrow connection |
| JPA equivalent      | `EntityManagerFactory`                                        | `EntityManager`                                   |

**Recruitment take-away:** In production code you keep a single, application-wide `SessionFactory` – often via CDI /
Spring singleton – and you create a new `Session` / `EntityManager` per request/transaction and never share it. This
separation gives you safe sharing of expensive metadata while keeping the mutable persistence context isolated per
thread.
