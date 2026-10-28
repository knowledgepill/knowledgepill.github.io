---
title: "Hibernate / JPA Entity Lifecycle"
excerpt: "List and describe the four persistence context states of an entity in Hibernate: transient, persistent/managed, detached, removed. How does PersistenceContext track them and when does dirty checking run?"
date: "2026-10-27T14:14:02.322Z"
preview: true
author:
  name: Maciej Leśniak
  picture: "/assets/blog/authors/maciek1.png"
tags:
  - Java
  - Hibernate
  - Screening questions
---

The JPA specification defines the lifecycle of an entity object in relation to the **Persistence Context**.
The JPA specification defines it as:

> An `EntityManager` instance is associated with a persistence context. A persistence context is a set of entity
> instances in which for any persistent entity identity there is a unique entity instance. Within the persistence context,
> the entity instances and their lifecycle are managed.
>
> *`javax.persistence.EntityManager` Javadoc, Oracle Java EE
7* https://docs.oracle.com/javaee/7/api/javax/persistence/EntityManager.html

In Hibernate a `Session` / `EntityManager` is the implementation of the persistence context. It is the first-level
cache: an in-memory map `entity-key -> entity instance` that lives for the duration of the session / transaction and
guarantees identity uniqueness.

The four JPA lifecycle states are:

### 1. Transient / New

* **Definition:** A newly instantiated Java object with `@Entity`. It is not associated with any persistence context and
  has no persistent identity in the database.
* **Hibernate behaviour:** Hibernate does not know about it. No SQL is generated, no snapshot is taken, changes are not
  tracked.
* **Transitions to Managed:** `EntityManager.persist(entity)` or `Session.save(entity)`.
  After `persist` the provider assigns an identifier and the instance becomes managed.

> The lifecycle state of a newly instantiated entity object is called *transient*. The entity hasn’t been persisted yet,
> so it doesn’t represent any database record. Your persistence context doesn’t know about your newly instantiate object.
> *Thorben Janssen, Entity Lifecycle Model in JPA & Hibernate* https://thorben-janssen.com/entity-lifecycle-model/

### 2. Managed / Persistent

* **Definition:** The entity instance is in the current persistence context. For any persistent entity identity there is
  a unique instance in the context.
* **How it is entered:**
    1. `em.persist(newEntity)`
    2. `em.find()`, JPQL / Criteria / native query loading
    3. `em.merge(detachedEntity)` re-attaches
* **Hibernate behaviour:** The persistence context keeps a **snapshot** of the entity state taken at load / persist
  time. Hibernate tracks the instance and will generate SQL `INSERT` / `UPDATE` on flush.
  Dirty checking only applies to entities in a persistent state. In other words, it works only for entities that are
  associated with an active session. *Baeldung, How Hibernate Dirty Checking Mechanism
  Works* https://www.baeldung.com/java-hibernate-entity-dirty-check

* `EntityManager.contains(entity)` returns `true`.
* `EntityManager.detach(entity)` or closing the `EntityManager` / committing the transaction makes it detached.

### 3. Detached

* **Definition:** An entity that was previously managed but is no longer associated with an active persistence context.
* **How it is entered:**
    * Session / `EntityManager` closed, transaction committed/rolled back
    * `em.detach(entity)` or `session.evict(entity)`
    * `em.clear()` makes all managed entities detached
* **Hibernate behaviour:** The instance keeps its identifier and state, but the persistence context no longer tracks it.
  Changes made in memory are not synchronized with the database. No snapshot is compared.

> If a previously managed entity is no longer associated with an active persistence context, it has the lifecycle state
> detached. Changes to such an entity object will not be persisted in the database.
> *Thorben Janssen, Entity Lifecycle Model in JPA & Hibernate*

Re-attach with `merge` / `update`. `merge` returns a managed copy; the original remains detached.

### 4. Removed

* **Definition:** A managed entity scheduled for deletion.
* **How it is entered:** `em.remove(managedEntity)` or `session.delete(entity)`
* **Hibernate behaviour:** The entity remains in the persistence context with state *removed*. The actual `DELETE` SQL
  is generated on the next flush. The entity is still returned by `contains` until the flush/clear.

> When you call the remove method on your EntityManager, the mapped database record doesn’t get removed immediately. The
> entity object only changes its lifecycle state to *removed*. During the next flush operation, Hibernate will generate an
> SQL DELETE statement to remove the record from the database table.
> *Thorben Janssen, Entity Lifecycle Model in JPA & Hibernate*

After flush / commit the instance becomes effectively detached and will be garbage collected.

## How the PersistenceContext tracks the states

* **First-level cache = PersistenceContext.** Every `Session`/`EntityManager` holds one. It is a
  `Map<EntityKey, EntityEntry>`. `EntityEntry` holds the entity instance, its snapshot, status
  `MANAGED / REMOVED / READ_ONLY` and lock information.
* On load: Hibernate stores the entity in the context and takes a snapshot via the entity persister.
* On `persist`: the entity is added to the context with status `MANAGED` and a snapshot is created.
* On `detach/clear/close`: entries are removed from the map, instances become detached.
* `EntityManager.contains(entity)` checks map membership.

The persistence context is transaction-scoped by default.
> The persistence context is the first-level cache where all the entities are fetched from the database or saved to the
> database. It sits between our application and persistent storage.
> *Baeldung, JPA/Hibernate Persistence Context* https://www.baeldung.com/jpa-hibernate-persistence-context

## Dirty checking

Dirty checking is the automatic detection of changes to managed entities.

* **Snapshot:** At load / persist time Hibernate stores a copy of the entity state, the *snapshot*.
* **Flush time:** On `EntityManager.flush()`, before transaction commit, and before a query when `FlushModeType.AUTO`
  requires it, Hibernate iterates over managed entities, compares current property values with the stored snapshot and
  generates `UPDATE` for changed entities.

> The dirty checking mechanism takes a snapshot of the last known entity state. This typically occurs when a persistent
> object is first loaded from the database. During the session, if any property of the entity is modified, that entity
> becomes dirty. Later, while flushing the persistence context, Hibernate checks each dirty entity associated with the
> session against the snapshot created earlier and updates it in the database.
> *Baeldung, How Hibernate Dirty Checking Mechanism Works*

When dirty checking runs:

* Explicit `em.flush()` or `session.flush()`
* Implicit flush on `commit` / transaction completion
* Implicit flush before a JPQL / Criteria query if the flush mode is `AUTO` and the query could be affected by pending
  changes
* On `commit` the persistence context is synchronized to the database

Performance note: Hibernate 6 + Java 17/21 benefits from bytecode enhancement. With the Hibernate enhancer plugin, dirty
tracking can be attribute-level instead of full snapshot comparison:
> Enhanced dirty tracking is an optimization in which Hibernate uses bytecode enhancement to track entity changes at the
> attribute level instead of comparing entire objects during flush.
> *Baeldung, How Hibernate Dirty Checking Mechanism Works*

Dirty checking does **not** apply to:

* Transient entities – never in the context
* Detached entities – no snapshot comparison
* `@Immutable` entities or read-only transactions – snapshots are not taken

This model is unchanged between Java 17 and Java 21; the lifecycle is defined by JPA 2.2 / 3.1 and implemented by
Hibernate ORM 6.x.

**Key references**

* Oracle `EntityManager` definition of persistence
  context: https://docs.oracle.com/javaee/7/api/javax/persistence/EntityManager.html
* Thorben Janssen – Entity Lifecycle Model in JPA & Hibernate: https://thorben-janssen.com/entity-lifecycle-model/
* Baeldung – Hibernate Entity Lifecycle: https://www.baeldung.com/hibernate-entity-lifecycle
* Baeldung – JPA/Hibernate Persistence Context: https://www.baeldung.com/jpa-hibernate-persistence-context
* Baeldung – How Hibernate Dirty Checking Mechanism Works: https://www.baeldung.com/java-hibernate-entity-dirty-check

