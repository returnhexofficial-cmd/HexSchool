---
name: smis-backend
description: Write or refactor NestJS backend code in hexschool-backend — controllers, services, repositories, DTOs, pure calculation engines, module wiring, permission codes, settings keys, audit hooks, BullMQ jobs and cross-module DI hooks. Use for any backend endpoint, business rule, guard, or "where should this live" question in the SMIS/HexSchool API.
---

# SMIS backend conventions

NestJS 11 + Prisma 7 + Postgres 16 + Redis/BullMQ. `src/modules/<name>/`
with `{calc,controllers,dto,events,jobs,repositories,services,seed}`.

## The one rule that shapes everything

**Controller → Service → Repository, strictly one direction.**

- Controllers are thin: decorators, DTO binding, `@CurrentUser()`, delegate, return.
  They never touch a repository or Prisma.
- Services hold business rules. They **never** touch `PrismaService`,
  `prisma.$queryRaw`, or a Prisma delegate.
- Repositories own all data access, including transactions and raw SQL.

If a service needs data it cannot get, add a method to the repository —
never reach through.

## Repositories

Default: extend `BaseRepository` (`src/common/database/base.repository.ts`),
which supplies CRUD, `paginate()`, soft-delete scoping, `school_id`
scoping and `withTransaction`:

```ts
@Injectable()
export class SectionsRepository extends BaseRepository<
  Section,
  Prisma.SectionWhereInput,
  Prisma.SectionUncheckedCreateInput,
  Prisma.SectionUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.section, 'Section');
  }
}
```

**Opt out deliberately, and say why in the class doc**, when the base buys
nothing — a composite-identity child table with no soft delete
(`MarksRepository`), or a query spanning two models
(`EmployeeDirectoryRepository`). It is still a repository: narrow selects,
no business logic, services still never see Prisma.

Conventions inside a repository:
- A module-level `RELATIONS` object + `Prisma.XGetPayload<{ include: typeof RELATIONS }>`
  exported as `XWithRelations` — this is how typed joins travel to services.
- Every write method takes an optional `tx?: PrismaClientLike` last, and
  resolves `const client = (tx ?? this.prisma) as PrismaService`.

## DTOs

`class-validator` + `class-transformer`, in `dto/`, re-exported from
`dto/index.ts`. The global pipe is
`{ whitelist: true, forbidNonWhitelisted: true, transform: true }` — an
undeclared field is a 400, so declare everything.

Put **shape** in the DTO (type, decimals, absurd-value bounds) and
**relational rules** in an engine or service. A mark's ceiling is its
component's allocation on another table — that cannot be a decorator, so
`mark-entry.engine.ts` owns it and returns *every* violation at once.

## Pure calculation engines

Anything with real arithmetic goes in `src/modules/<name>/calc/*.ts`:
dependency-free, no Nest, no Prisma, golden-tested. Precedents:
`result/calc/gpa.engine.ts`, `timetable/calc/conflict.engine.ts`,
`exam/calc/exam-clash.engine.ts`, `attendance/calc/percentage.util.ts`.

They are importable from any module without importing that module — which
is exactly how M09 reuses the attendance percentage without a cycle.

## Guards, permissions and overrides

- Global guard chain is pinned in `AppModule` providers:
  Throttler → `JwtAuthGuard` → `PermissionsGuard`. **Never register an
  `APP_GUARD` from a feature module** — order follows registration order.
- Route-level: `@RequirePermissions('result.publish')` (AND) or
  `@RequireAnyPermission(...)` (OR). `@Public()` for open routes.
- **Override permissions are runtime checks in the service, not route
  decorators** — one route serves both the normal and the elevated case:

```ts
if (actor.userType === UserType.SUPER_ADMIN) return;
const codes = await this.permissions.getUserPermissionCodes(actor.sub);
if (!codes.includes('exam.schedule.override')) throw new ForbiddenException(...);
```

Precedents: `teacher.assign.override` (M08), `attendance.holiday.override`
(M12), `exam.schedule.override` (M14), `result.process.override` (M15).

## Audit

Every successful mutation writes an `audit_logs` row via the global
interceptor. Inference is a fallback — **services that change meaningful
state must set real diffs**:

```ts
this.auditContext.set({
  entityType: 'Result',
  entityId: id,
  oldValues: { status: before.status },
  newValues: { status: after.status, reason: dto.reason },
});
```

Audit writes are fire-and-forget by design (they must never delay or fail
the mutation) — which is why tests must poll for the row, never read once.

## Three append-only registries

| Registry | File | Notes |
|---|---|---|
| Permissions | `src/modules/rbac/registry/permission.registry.ts` | code format `<entity>.<action>`, dots may nest, kebab segments allowed (`exam.seat-plan.manage`); enforced by `permission.registry.spec.ts` |
| Role baselines | `src/modules/rbac/registry/system-roles.ts` | extend the arrays; the seeder grants new codes and never revokes admin-added extras |
| Settings | `src/modules/school/settings/settings.registry.ts` | key prefix matches its `SettingsGroup` (M15's result keys are `exam.*` because they live in the exam group) |

Read settings through a module-local typed `<X>SettingsService` that loads
the whole group once — never `SettingsService.getValue` scattered across
services. Malformed values fall back to the registry default; a safety
setting fails **closed** (`requireLockedMarks: requireLocked !== false`).

## Module wiring and the cycle problem

The module graph must stay acyclic. When module B needs one query from
module A, and A already imports B:

**Re-provision the stateless repository** rather than importing the
module. Repositories that hold only `PrismaService` are safe to
instantiate twice.

```ts
providers: [
  // Stateless re-provisions (only need PrismaService).
  MarksRepository,
]
```

Precedents: `UsersRepository` in RbacModule (M03), `TeachersRepository`
(M08), `EnrollmentsRepository` in AcademicModule (M11),
`TimetableEntriesRepository` in TeacherModule (M13), `MarksRepository` in
Academic/Enrollment/Exam modules (M15).

**Cross-module behaviour** uses a DI token bound to a no-op until the
owning module exists (`exam.gates.ts`). The real provider's *code* lives
in the later module but is **bound inside the earlier one** over
re-provisioned repositories — see `ResultReadinessGate`, bound in
`ExamModule`, and `RoutineConflictChecker`, bound in `TeacherModule`.

## Response envelope

`{ success, data, meta?, message? }` applied globally. Errors:
`{ success: false, error: { code, message, details? } }`.

- Rich refusals put structured data in `details` so the UI can paint it:
  `throw new BadRequestException({ message, details: { marks: errors } })`.
- Binary/streaming responses use `@SkipEnvelope()` + `StreamableFile`, and
  set `Content-Type` / `Content-Disposition` themselves.

## Queues

Register the queue name in `src/queues/queues.constants.ts` and in
`QueuesModule`, then `BullModule.registerQueue({ name })` in the consuming
module too. Enqueues are fire-and-forget (`.catch()` and log) because
BullMQ with Redis down buffers `await add()` forever — **except** where
losing the work is worse than blocking, in which case fall back to inline
execution (`ResultQueueService` does this for processing runs).

## Verify

```bash
cd hexschool-backend
npx tsc --noEmit
npx jest --silent
npx eslint src/modules/<name>
```
