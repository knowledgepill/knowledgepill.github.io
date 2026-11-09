---
title: N+1 Queries and Fetching Strategies in Hibernate 6.x/7.x
slug: hibernate-nplusone-fetching-strategies
tags: ["hibernate", "orm", "n+1", "fetching", "performance"]
preview: true
date: "2026-11-19T15:36:42.000Z"
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
excerpt: "N+1 is the most common performance pitfall in Hibernate-based applications at scale. It occurs when a query loads N root entities and then triggers one additional query per entity to load a lazy association. In Hibernate 6.x/7.x the fetching model is largely JPA-compliant but with important Hibernate extensions for batching, entity graphs, fetch profiles and join elimination introduced in 7.x."
---
# N+1 Queries and Fetching Strategies in Hibernate 6.x/7.x

## Overview

N+1 is the most common performance pitfall in Hibernate-based applications at scale. It occurs when a query loads N root entities and then triggers one additional query per entity to load a lazy association. In Hibernate 6.x/7.x the fetching model is largely JPA-compliant but with important Hibernate extensions for batching, entity graphs, fetch profiles and join elimination introduced in 7.x.

This article focuses on patterns and techniques to detect, prevent and mitigate N+1 for Spring Data JPA and pure JPA usage with Hibernate 6.x/7.x.

## The N+1 problem

```java
@Entity
public class Order {
    @Id Long id;
    @ManyToOne(fetch = FetchType.LAZY)
    Customer customer;
}

List<Order> orders = em.createQuery("select o from Order o", Order.class).getResultList();
orders.forEach(o -> System.out.println(o.getCustomer().getName()));
```

With default lazy loading this executes:
1. `select * from orders`
2. N times `select * from customer where id = ?`

In production this explodes with list pages, reports and DTO projections.

Official reference: Hibernate User Guide, Fetching basics [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching-basics]

## How Hibernate loads associations in 6.x/7.x

* **Lazy** – proxy initialized on first access. Requires open persistence context.
* **Eager** – loaded with root via join or separate select.
* **Batch** – groups multiple lazy loads into one `IN` query.
* **Subselect** – loads all associations for the whole root set in one extra query.
* **Join fetch** – loads association in same query as root using `JOIN FETCH`.

Hibernate 6 improved type handling and SQM parsing, and Hibernate 7 adds join elimination for repeated joins.

## Fetching strategies and patterns

### 1. JOIN FETCH – explicit eager loading per query

Use for read-only use cases where the association is always needed.

Pure JPA:
```java
List<Order> orders = em.createQuery(
    "select distinct o from Order o join fetch o.customer join fetch o.items", Order.class)
    .getResultList();
```

Spring Data JPA:
```java
@Query("select distinct o from Order o join fetch o.customer join fetch o.items")
List<Order> findAllWithCustomerAndItems();
```

Trade-offs: Cartesian product risk for collections, duplicates require `distinct`, cannot combine with pagination on collection fetch.

Best practice: Use for single-level associations, avoid multiple collection joins.

### 2. Entity Graphs – dynamic fetch plans

JPA standard, fully supported in Hibernate 6.x/7.x.

```java
@EntityGraph(attributePaths = {"customer","items"})
@Query("select o from Order o where o.id in :ids")
List<Order> findWithGraph(@Param("ids") List<Long> ids);
```

Dynamic creation:
```java
EntityGraph<Order> graph = em.createEntityGraph(Order.class);
graph.addAttributeNodes("customer");
graph.addSubgraph("items").addAttributeNodes("product");

TypedQuery<Order> q = em.createQuery("select o from Order o", Order.class);
q.setHint("jakarta.persistence.fetchgraph", graph);
```

Pros: reusable, declarative, works with Spring Data. Cons: cannot fetch with conditions on association.

Reference: Hibernate User Guide, Dynamic fetching via JPA entity graph [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching-strategies-dynamic-fetching-entity-graph]

### 3. Batch fetching – the default mitigation for lazy

Configure at mapping level:

```java
@ManyToOne(fetch = FetchType.LAZY)
@BatchSize(size = 50)
@JoinColumn(name = "customer_id")
private Customer customer;
```

Global setting:
```properties
hibernate.default_batch_fetch_size=25
```

When a proxy is first accessed Hibernate loads up to 25 ids in one `IN` query:
`select ... from customer where id in (?, ?, ...)`

Best practice: Set `hibernate.default_batch_fetch_size` for all entities and fine-tune with `@BatchSize` on hot associations. Avoid huge batch sizes that increase result set size.

Reference: Hibernate User Guide, Batch fetching [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching-batch]

### 4. Subselect fetching

Loads all associations for the whole root collection in one additional query.

```java
@OneToMany(mappedBy = "order")
@Fetch(FetchMode.SUBSELECT)
private List<OrderItem> items;
```

Useful when you know you will access the association for all roots after initial load. Avoids N+1 but can load unnecessary data.

### 5. @Fetch and FetchMode

Hibernate specific:

```java
@ManyToOne
@Fetch(FetchMode.JOIN)
private Customer customer; // JOIN fetch always

@OneToMany
@Fetch(FetchMode.SELECT) // default
private List<Item> items;
```

In 6.x, `@Fetch` only affects the default fetch plan; queries can override it with `JOIN FETCH` or entity graph.

Reference: Hibernate User Guide, The @Fetch annotation mapping [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching-fetch-annotation]

### 6. Fetch Profiles – named fetch plans

For complex read scenarios.

```java
@Entity
@FetchProfile(name = "order-with-details",
    fetchOverrides = {
        @FetchProfile.FetchOverride(entity = Order.class, association = "customer", mode = FetchMode.JOIN),
        @FetchProfile.FetchOverride(entity = Order.class, association = "items", mode = FetchMode.JOIN)
    })
public class Order { ... }
```

Enable per session:
```java
session.enableFetchProfile("order-with-details");
```

Good for reporting use cases where the same entity needs different fetch shapes.

Reference: Hibernate User Guide, Dynamic fetching via Hibernate profiles [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching-strategies-dynamic-fetching-profile]

### 7. Hibernate 7 join elimination

Hibernate 7 can eliminate duplicate joins in complex queries with multiple `JOIN FETCH` paths. This reduces SQL size and DB work.

If you have:
```java
select o from Order o join fetch o.customer join fetch o.items join fetch o.items.product
```
Hibernate 7 will generate one join to product instead of repeated joins.

Reference: Hibernate 7 User Guide, Fetching basics.

## Common pitfalls at scale

* **LazyInitializationException in Spring MVC** – accessing lazy association after transaction closed. Solutions: fetch within transaction via entity graph, DTO projection, or Open Session in View anti-pattern avoidance.
* **Pagination with JOIN FETCH on collection** – causes duplicate rows and wrong limit. Use `SELECT DISTINCT` + separate count query or fetch via batch.
* **Eager by default on `@ManyToOne`** – JPA default is EAGER for `@ManyToOne` in older specs? Actually default is EAGER. Hibernate recommends `FetchType.LAZY` explicitly.
* **Mixing entity graph with `@EntityGraph` on Spring Data and adding additional WHERE on association** – entity graph does not filter.
* **Cartesian product** – fetching multiple collections with `JOIN FETCH` blows up result set. Mitigate with separate queries or batch fetching.
* **Batch size too high** – `IN` list too large for DB optimizer. Keep 20-50.

## Recommended patterns for Spring + pure JPA

1. **Default lazy + global batch size**
   ```properties
   spring.jpa.properties.hibernate.default_batch_fetch_size=32
   spring.jpa.open-in-view=false
   ```

2. **Read models with DTO projections**
   ```java
   @Query("select new com.example.OrderDto(o.id, c.name, sum(i.amount)) from Order o join o.customer c join o.items i group by o.id, c.name")
   List<OrderDto> findOrderSummaries();
   ```
   Avoids entity graph complexity for reporting.

3. **Entity graph for service layer reads**
   Use `@EntityGraph` on repository methods that need specific associations.

4. **Separate queries for collections**
   Load root entities, then load collections in second batch query using `IN`. Controlled by application.

5. **Enable statistics in dev**
   ```properties
   spring.jpa.properties.hibernate.generate_statistics=true
   logging.level.org.hibernate.stat=DEBUG
   ```
   Detect N+1 via `Statistics` API.

## Detection

Enable SQL logging and count queries:
```java
Statistics stats = sessionFactory.getStatistics();
stats.setStatisticsEnabled(true);
long queryCount = stats.getQueryExecutionCount();
```

Tools: Hibernate Slow Query Log `hibernate.log_slow_query`, Micrometer metrics.

## Summary

* Never rely on default eager mapping.
* Prefer lazy + batch fetching as baseline.
* Use `JOIN FETCH` or entity graphs for specific use cases.
* Avoid `JOIN FETCH` on multiple collections.
* Use DTO projections for read-only reports.
* Monitor query count with statistics.

## Sources

* Hibernate ORM User Guide 6.6, Fetching [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching]
* Hibernate ORM User Guide 6.6, Batch fetching [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching-batch]
* Hibernate ORM User Guide 6.6, Dynamic fetching via JPA entity graph [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching-strategies-dynamic-fetching-entity-graph]
* Hibernate ORM User Guide 6.6, Performance Tuning and Best Practices, Fetching associations [https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#best-practices-fetching]
* Hibernate ORM 7.4 User Guide [https://docs.hibernate.org/orm/7.4/userguide/html_single/Hibernate_User_Guide.html]

