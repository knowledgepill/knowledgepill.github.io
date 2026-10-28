---
title: "Hibernate Caching Architecture"
excerpt: "Explain Hibernate first level cache L1, Session-scoped, mandatory, and second level cache L2, SessionFactory-scoped, optional. What is the query cache and how is it related to L2?"
preview: true
date: "2026-10-27T14:30:02.322Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Jakarta Persistence 3.2
  - Hibernate
  - Screening questions
---

## Hibernate Caching Architecture – Java 17+ / Hibernate 6.x / Jakarta Persistence 3.2

Hibernate ORM implements a two-tier caching architecture on top of Jakarta Persistence API JPA. The tiers are defined in
the Hibernate `Cache` contract and the JPA persistence context model.

### First Level Cache L1 – Persistence Context

* **Scope:** `Session` / `EntityManager` scoped. One persistence context per open `Session`.  
  `SessionFactory` is a factory for `Session` objects, `EntityManager` is the JPA facade for the same persistence
  context.
* **Mandatory:** It cannot be disabled. Every `Session` has an internal identity map `EntityKey -> EntityInstance`.
* **Lifetime:** Lives as long as the `Session` / `EntityManager` is open and is cleared on `flush`, `clear` or `close`.
  With JPA it is usually transaction-scoped, i.e. extended persistence context is optional.
* **What it does:**
    * Guarantees identity: within one `Session` the same database row is represented by a single Java object instance.
    * Write-behind dirty checking: changes are tracked against the snapshot stored in the persistence context and
      flushed at commit.
    * First lookup place: `session.get() / entityManager.find()` checks the persistence context before issuing SQL.

> *The first-level cache is better known as the persistence context. It's the collection of managed entity instances
associated with an open Session.*
> `org.hibernate.Cache` Javadoc

The persistence context is defined by the Jakarta Persistence specification as the managed entity state for a given
`EntityManager`. The first-level cache is always enabled.

### Second Level Cache L2 – SessionFactory scoped, optional

* **Scope:** `SessionFactory` scoped, shared by all `Session`s created by the same `SessionFactory`. It is process-wide
  and can be distributed by a cache provider.
* **Optional:** Completely disabled by default. It is enabled with

  `hibernate.cache.use_second_level_cache=true` and a `RegionFactory` e.g. `hibernate.cache.region.factory_class`.
* **What it stores:** Dehydrated entity state, i.e. a tuple of persistent attribute values. Collections and associations
  are stored separately in their own regions. Entities are stored by primary key, transient properties are not stored.
* **Eligibility:** Only entities and collection roles explicitly marked cacheable are eligible.

    * JPA: `@jakarta.persistence.Cacheable`
    * Hibernate specific: `@org.hibernate.annotations.Cache` with a `CacheConcurrencyStrategy`

        * `READ_ONLY` – immutable reference data
        * `NONSTRICT_READ_WRITE` – relaxed consistency
        * `READ_WRITE` – soft lock
        * `TRANSACTIONAL` – JTA transaction aware

* **Access path:** `Session.get()` → L1 miss → L2 lookup → DB if miss. On load the entity is copied into L1.

> *The second-level cache is shared between all sessions belonging to a given SessionFactory. It stores the state of an
entity instance in a destructured format, as a tuple of persistent attribute values.*
> `org.hibernate.Cache` Javadoc

> *Each SessionFactory has its own isolated second-level cache, shared between the sessions it creates, and it exposes
the cache to clients as a stateful object with entries that may be queried and managed directly.*
> `SessionFactory` Javadoc

Second-level cache is segmented into named regions, one per entity hierarchy or collection role. Eviction and expiry are
delegated to the cache provider Ehcache, Infinispan, etc.

### Query Cache and its relation to L2

The query cache is **not a separate level**, it is part of the second-level cache infrastructure.

* **What it caches:** The result set of a JPQL / Criteria query, i.e. the list of entity identifiers and scalar values,
  **not** the entity instances themselves.
* **Enablement:**
    * Global: `hibernate.cache.use_query_cache=true`
    * Per query: `query.setCacheable(true)` or JPA hint `org.hibernate.cacheable=true`
    * Optional region: `query.setCacheRegion("myRegion")`
* **How it works:**
    1. On first execution the SQL is run, the IDs returned by the query are stored in the
       `org.hibernate.cache.internal.StandardQueryCache` region.
    2. On subsequent execution Hibernate checks the query cache for a cached ID list that matches the query string +
       parameter values + timestamp.
    3. For each ID Hibernate then tries to load the entity from L2. If the entity is in L2 it is materialised from
       there, otherwise a SELECT is issued.
* **Dependency on L2:**
  > *It's very important to understand that any entity instance in a query result set is cached by its id. If the entity
  itself is not cacheable, or if the instance is not available in the second-level cache at the time a result set is
  retrieved from the cache, then the state of the entity must be read from the database. This negates the benefits of
  caching the result set.*
  > `org.hibernate.Cache` Javadoc

  Therefore the query cache should always be used in conjunction with the second-level cache for entities expected to be
  part of query results.

* **Invalidation:** Hibernate maintains `org.hibernate.cache.spi.UpdateTimestampsCache` which stores the last update
  timestamp per entity/collection region. When an entity is updated, the timestamp changes and matching query cache
  entries are invalidated.

User Guide summary:

> *The query cache does not cache the state of the actual entities in the cache; it caches only identifier values and
results of value type. Just as with collection caching, the query cache should always be used in conjunction with the
second-level cache for those entities expected to be cached as part of a query result cache.*
> Hibernate ORM 5.1 User Guide – Caching

### Practical notes for Java 17+ / 21

* Hibernate 6.x requires Java 17+ and implements Jakarta Persistence 3.2. The caching contracts are unchanged
  conceptually.
* L1 is mandatory and per `EntityManager`. Do not try to disable it.
* Enable L2 only for read-mostly reference data or entities with high read/write ratio. Choose a concurrency strategy
  per entity, not globally.
* Enable query cache only for stable, parameterised queries where the returned entities are also L2 cacheable. Otherwise
  you pay invalidation overhead for no gain.
* Cache invalidation is not aware of external JDBC changes. Programmatic eviction via `SessionFactory.getCache()` may be
  required.

**Key sources**

* `org.hibernate.Cache` Javadoc – definition of first and second level cache and query cache relationship.
  https://docs.hibernate.org/stable/core/javadocs/org/hibernate/Cache.html
* `SessionFactory` Javadoc – SessionFactory isolated second-level cache.
  https://docs.hibernate.org/orm/8.0/javadocs/org/hibernate/SessionFactory.html
* Hibernate ORM User Guide – Caching chapter, first-level persistence context, second-level configuration, query cache
  regions.
  https://docs.hibernate.org/orm/5.1/userguide/html_single/chapters/caching/Caching.html
* Jakarta Persistence 3.2 specification – persistence context model.

These concepts are stable across Hibernate 5.x → 6.x and remain valid for Java 17 and Java 21 deployments.
