---
title: Hibernate Fetching and Performance N+1 and Pitfalls
slug: hibernate-fetching-performance-n1-pitfalls
tags: ["hibernate", "performance", "jpa", "n+1", "fetching"]
preview: true
date: "2026-11-19T18:52:57.000Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
excerpt: Application development at scale with Hibernate ORM 7.4, Jakarta Persistence 3.2, PostgreSQL backend.
---
# Hibernate Fetching and Performance - N+1 Problem, Fetch Strategies, Pitfalls

**Context:** Application development at scale with Hibernate ORM 7.4, Jakarta Persistence 3.2, PostgreSQL backend.

## 1. The N+1 Problem

The N+1 problem occurs when an initial query loads N root entities and a subsequent query is executed for each entity to load an association. With PostgreSQL connection pooling, this creates latency spikes and exhausts connections.

Typical trigger:
```java
@Entity
public class Order {
    @Id Long id;
    @ManyToOne(fetch = FetchType.LAZY) Customer customer;
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY) List<LineItem> items;
}
```
```java
List<Order> orders = em.createQuery("select o from Order o", Order.class).getResultList();
orders.forEach(o -> o.getItems().size()); // triggers 1 query per order
```

Detection: enable SQL logging `org.hibernate.SQL` and `Statistics`. Hibernate User Guide §12 Fetching explains basics of fetching and N+1 detection [Hibernate User Guide Fetching](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#fetching-basics).

## 2. Lazy vs Eager

JPA defaults: `@ManyToOne` and `@OneToOne` default to `EAGER`, `@OneToMany` and `@ManyToMany` default to `LAZY`. Eager defaults cause over-fetching.

Hibernate 7 with bytecode enhancement enables true lazy attribute loading without proxies. User Guide §6.2 Bytecode Enhancement describes lazy attribute loading [Bytecode Enhancement](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#BytecodeEnhancement-lazy-loading).

Best practice: never use `FetchType.EAGER` on associations. Prefer lazy and explicit fetch plans.

Pitfall: accessing lazy association outside transaction causes `LazyInitializationException`. Use DTO or fetch plan within transaction.

## 3. Fetch Strategies

Hibernate applies fetch strategies per mapping and per query.

### 3.1 Fetch Join
```java
@Query("select distinct o from Order o join fetch o.customer join fetch o.items")
List<Order> findWithItems();
```
`JOIN FETCH` loads associations in same SQL. Limitations:
- Cannot fetch multiple `Bag` collections in one query – Hibernate throws `MultipleBagFetchException`.
- Pagination with `JOIN FETCH` on collection produces incorrect results.
- Duplicates require `DISTINCT`.

User Guide §17.8.4 `join fetch` for association fetching [HQL join fetch](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#hql-explicit-fetch-join).

### 3.2 Batch Fetching
Mitigates N+1 without cartesian product.

Mapping:
```java
@OneToMany(mappedBy = "order")
@BatchSize(size = 50)
private List<LineItem> items;
```
Or global:
```properties
hibernate.default_batch_fetch_size=50
```

Hibernate issues `where order_id in (?, ?, ...)` for up to batch size entities.

User Guide §12.8 Batch fetching [Batch fetching](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#fetching-batch).

Trade-off: increases single query size, reduces round trips. Good for read-heavy workloads.

`FetchMode.SUBSELECT` is alternative for collections:
```java
@Fetch(FetchMode.SUBSELECT)
```
Loads all collections with one subselect.

### 3.3 Entity Graphs
Jakarta Persistence 3.2 standardizes entity graphs for dynamic fetching.

Named graph:
```java
@NamedEntityGraph(name = "Order.withItems",
    attributeNodes = {
        @NamedAttributeNode("customer"),
        @NamedAttributeNode(value = "items", subgraph = "items")
    },
    subgraphs = {
        @NamedSubgraph(name = "items", attributeNodes = @NamedAttributeNode("product"))
    })
@Entity
public class Order { ... }
```

Usage:
```java
EntityGraph<Order> graph = em.getEntityGraph("Order.withItems");
TypedQuery<Order> q = em.createQuery("select o from Order o", Order.class);
q.setHint("jakarta.persistence.fetchgraph", graph);
```
`fetchgraph` overrides lazy to eager for specified nodes, others remain lazy. `loadgraph` keeps unspecified lazy.

User Guide §12.6 Dynamic fetching via Jakarta Persistence entity graph [Entity graph](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#fetching-strategies-dynamic-fetching-entity-graph).

Entity graphs avoid query duplication and keep mappings lazy by default.

## 4. DTO Projections

For read-only use cases, avoid entity management overhead.

JPQL constructor:
```java
public class OrderSummary {
    public OrderSummary(Long id, String customerName, BigDecimal total) { ... }
}
```
```java
List<OrderSummary> res = em.createQuery(
    "select new com.example.OrderSummary(o.id, c.name, sum(i.price)) from Order o join o.customer c join o.items i group by o.id, c.name", OrderSummary.class)
    .getResultList();
```

Criteria tuple:
```java
CriteriaQuery<Tuple> cq = cb.createTupleQuery();
Root<Order> o = cq.from(Order.class);
cq.multiselect(o.get("id"), o.get("total"));
```

Native SQL DTO mapping via `@SqlResultSetMapping`.

Benefit: no proxies, no N+1, smaller payload. Trade-off: not managed.

## 5. Query Hints and Profiles

Hints control execution without changing mapping.

```java
query.setHint("org.hibernate.fetchSize", 1000);
query.setHint("org.hibernate.readOnly", true);
query.setHint("jakarta.persistence.cacheable", true);
```

Hibernate Query Hints documented in User Guide §16.3.4 [Query hints](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#jpql-query-hints).

Fetch Profiles allow named sets of fetch overrides, useful for multiple read scenarios.

## 6. Second Level Cache Interactions

Second level cache caches entities and collections. Fetch strategy impacts cache hits.

- With `JOIN FETCH`, Hibernate may bypass collection cache and load from DB.
- Query cache requires cacheable entities and stable parameters. Invalidation on update.

Configuration:
```properties
hibernate.cache.use_second_level_cache=true
hibernate.cache.use_query_cache=true
```
Mapping:
```java
@Entity
@Cacheable
@org.hibernate.annotations.Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class Order { ... }
```

User Guide §14 Caching [Caching](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#caching).

Pitfall: caching collections with lazy loading can cause stale data. Use entity cache + query cache carefully with PostgreSQL.

## 7. Common Pitfalls at Scale

- **Multiple collection fetch joins**: causes cartesian product and memory blow up. Use batch fetching or separate queries.
- **Eager defaults**: `FetchType.EAGER` on `@ManyToOne` loads entire graph.
- **Pagination with fetch join**: `setFirstResult` with collection fetch join produces wrong limits. Use DTO or separate count query.
- **N+1 with `EntityManager.find` in loop**: use `findAllById` with batch size.
- **Lazy loading in serialization**: Jackson triggers lazy load. Use DTO or `@JsonIgnore`.
- **Over-fetching with entity graph**: loading too much data increases GC pressure.

Best practices from User Guide §31 Performance Tuning [Best practices](https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#best-practices-fetching).

## 8. Senior-Level Checklist

1. Keep all associations `LAZY`. Enable bytecode enhancement for lazy attributes.
2. Measure SQL with `Statistics` and PostgreSQL `pg_stat_statements`.
3. Prefer batch fetching for collections, entity graphs for query-specific shapes.
4. Use DTO projections for read-only APIs and reporting.
5. Avoid `JOIN FETCH` for multiple collections; split queries.
6. Configure `hibernate.default_batch_fetch_size` and `@BatchSize`.
7. Validate query plans with `EXPLAIN ANALYZE`.
8. Document fetch plans per use case; avoid mixing business model with view model.

## Sources

- Hibernate ORM 7.4 User Guide, Chapter 12 Fetching https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#fetching
- Hibernate ORM 7.4 User Guide, Chapter 14 Caching https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#caching
- Hibernate ORM 7.4 User Guide, Chapter 31 Performance Tuning and Best Practices https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#best-practices
- Hibernate ORM 7.4 User Guide, §17.8.4 join fetch https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html#hql-explicit-fetch-join
- Jakarta Persistence 3.2 Specification https://jakarta.ee/specifications/persistence/3.2/

