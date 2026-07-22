---
name: smis-architecture
description: Architectural guidance and convention review for SMIS/HexSchool — decide where code belongs, whether a change fits the established patterns, how to integrate two modules without a cycle, or whether a proposed design contradicts a recorded decision. Use for "where should this live", "is this the right pattern", design trade-offs, cross-module integration, and reviewing a diff against the project's own rules.
---

# SMIS architecture

A single-school Bangladeshi school-management system built to become
multi-tenant (M31) without schema surgery. Two repos, 32 planned modules,
15 done, built strictly in dependency order.

`PROJECT_CONTEXT.md` is the authority — §16 records every decision *with
its rationale*, and it is where a proposed change must be checked before
it is written.

## The load-bearing decisions

Know these before proposing anything; contradicting one needs an explicit
argument and a new §16 row.

| Decision | Why it exists |
|---|---|
| **Repository pattern, one direction** | data access isolated from business logic, mockable in unit tests, one place to enforce soft-delete + tenant scoping |
| **`school_id` on every business table** | M31 multi-tenancy with no rewrite |
| **Attendance/marks/fees key on `enrollment_id`, never `student_id`** | correct history across mid-year transfers and promotions |
| **Pure engines in `calc/`, dependency-free** | golden-testable, and importable across modules without importing the module (M09 reuses M12's percentage engine this way) |
| **Permissions are NOT in the JWT** | instant revocation via a 5-min Redis cache with explicit invalidation |
| **All `APP_GUARD`s declared in `AppModule`** | global guard order = provider registration order |
| **Snapshots freeze what was applied** | grading scales, applicant data, exam-type weights — editing the source must never restate an issued document |
| **Published artifacts are immutable** | corrections are re-issues with an audit trail, never in-place edits |
| **Soft delete everywhere except append-only logs** | audit, ledger, login activity, notifications, and generated artifacts replaced wholesale |

## Where does this code belong?

| It is… | It goes… |
|---|---|
| arithmetic or a rule expressible over plain data | `src/modules/<name>/calc/*.ts`, dependency-free |
| a business rule needing other entities | a service |
| a query, transaction or raw SQL | a repository |
| shape/type/bounds of a request | a DTO |
| a rule expressible from columns on one row | a DB CHECK in the migration |
| a rule needing a join | an engine or service — with a comment in the migration saying so |
| configurable per school | the settings registry, read via a module-local typed settings service |
| a capability someone can be granted | the permission registry + role baselines |
| behaviour a *later* module owns | a DI token bound to a documented no-op |
| used by two modules that would cycle | a re-provisioned stateless repository |

## Integrating two modules without a cycle

The graph must stay acyclic. Three tools, in order of preference:

1. **Re-provision the stateless repository.** Repositories holding only
   `PrismaService` are safe to instantiate twice. Precedents: M03, M08,
   M11, M13, M15.
2. **Import a pure engine.** No module dependency at all.
3. **DI token + no-op provider.** For behaviour the later module owns.
   The interface, token and no-op live in the *earlier* module; the real
   provider's code lives in the later one but is **bound inside the
   earlier module** over re-provisioned repositories.
   - `TIMETABLE_CONFLICT_CHECKER` — declared M08, bound M13.
   - `EXAM_RESULT_GATE` — declared M14, bound M15.
   - `EXAM_DUES_GATE` — declared M14, **still open for M16**.

A no-op must be *usable*, not a hard refusal — the module has to work
before its counterpart exists, and the swap must need no caller change.

## Guard slots

When a check needs a table that does not exist yet, leave a **named
comment** where it belongs and a `PROJECT_CONTEXT.md` §18 entry. The
module that creates the table arms it. Four of these have now been armed
(M06 subject removal, M11 rollback, M14 delete guards ×2) — follow the
same shape rather than inventing a new one.

## Reviewing a change

Check, in this order:

1. **Direction** — does a controller touch a repository, or a service
   touch Prisma? Hard no.
2. **Scoping** — every query scoped by `school_id`; every default query
   excludes soft-deleted rows.
3. **Keying** — student-history data keyed on `enrollment_id`.
4. **Guards** — is the route permission-guarded? Is an override a runtime
   check rather than a second route?
5. **Audit** — do meaningful mutations call `auditContext.set()` with real
   diffs, rather than relying on inference?
6. **Registries** — new codes/keys appended, role baselines extended?
7. **Constraints** — is a row-local invariant a CHECK, and is a
   join-dependent one commented as service-enforced?
8. **Cycles** — new module imports, or a re-provision?
9. **Immutability** — can this path restate something already issued?
10. **Docs** — does it contradict a §16 decision without saying so?

## Known architectural debt

- `PermissionsCacheService` owns its own Redis client instead of using
  `RedisCacheService`.
- `BaseRepository` school scoping is an explicit parameter; request-scoped
  tenant injection is deferred to M31.
- `audit_logs` partitioning + retention deferred to M30.
- Jobs loop every school every 15 minutes — fine at one school, needs
  sharding for M31.
- PDFs are unbranded and pdfkit's default font cannot set Bangla; the
  styled report engine arrives with M18.

## What is coming

M16 Fees (binds `EXAM_DUES_GATE`) → M17 Communication (makes SMS real for
the queued events M10/M12/M15 already emit) → M18 Portals + report engine,
which closes out Phase 1. Design with those in mind: queue notifications
through the existing contract, export what portals will read, and keep
report *shapes* separate from their file renderers.
