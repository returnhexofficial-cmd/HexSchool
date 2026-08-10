# Module 29 — Reports & Analytics v2 · Completion Document

| | |
|---|---|
| **Module** | 29 — Reports & Analytics v2 |
| **Completion date** | 2026-08-10 |
| **Actual effort** | 1 dev-day (est. was 7) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 29 |

## Summary of Implemented Features

The module every Phase 1–2 module has been leaving notes for. Eight of them
pointed here by name — submission rates (22), reading history (23),
consumption and depreciation (24), route-level cost (25), occupancy and
cost-per-bed (26), issuance rate (27), complaint volume, visitor footfall
and alumni giving (28) — and M18's code-only `report.registry.ts` is the
thing §3's `report_definitions` table replaces.

- **A report engine with one contract.** Every one of 55 registered reports
  is described by the same `ReportDefinition` and produced by an executor
  returning the same `ReportTable` — a title, typed columns, rows, notes.
  One renderer turns that into XLSX, CSV, PDF or JSON. Forty-odd
  hand-written export services would have been the obvious alternative and
  is exactly what makes §6's column stripping and §8's streaming
  impossible.
- **Async execution (§4).** `POST /reports/:code/run` validates, authorises
  and records a `report_runs` row, then returns; a BullMQ worker renders,
  uploads to S3 and stamps the row. The row — not the queue — is the system
  of record, so a Redis restart loses the job and not the history.
- **Column-level permissions (§6),** which *degrade* a report rather than
  refusing it, and say on the sheet which columns went.
- **Scheduling (§4/§7)** with a hand-written cron parser whose parse **is**
  the whitelist, fired in Asia/Dhaka, retried twice then switched off with
  a stated reason and the owner told.
- **Export centre (§4)** — the runs a user requested, their status, their
  files behind freshly-signed URLs, re-run, and a 30-day auto-purge that
  removes the row and the S3 object together.
- **Executive dashboard (§4/§5)** — enrollment year-on-year, the section ×
  month attendance heatmap, fee realization and dues aging, result trends,
  and an operations KPI row across library/transport/hostel/stores/
  complaints/messaging.
- **Three materialized views (§3)** refreshed nightly and on demand, each
  with the unique index `REFRESH … CONCURRENTLY` requires.
- **Website analytics (§3)** — a page-view beacon on the public site,
  counted into a Redis HyperLogLog that no visitor can be read back out of.

## Database Changes

`prisma/migrations/20260810120000_reports_analytics_v2/migration.sql`

**Enums:** `report_output_enum`, `report_format_enum`, `report_run_status_enum`,
`report_schedule_status_enum`; `settings_group_enum` += `analytics` (the
M20–M28 `ADD VALUE IF NOT EXISTS` precedent, ninth use).

**Tables:**

| Table | Notes |
|---|---|
| `report_definitions` | **A system catalog: no `school_id`, no soft delete, an `is_orphaned` flag** — the `permissions` arrangement verbatim. The code registry stays the source of truth and a seeder syncs it; the table buys a real FK for schedules/runs and a queryable `params_schema` the hub generates its form from. |
| `report_schedules` | `next_run_at` is stored rather than derived, so the sweep is an index scan over `(status, next_run_at)` instead of parsing every school's cron every minute — and a **missed** window becomes queryable. `owner_id` is deliberately **not** an FK with a cascade: deleting the user must stop the schedule, not delete the school's reporting arrangement. |
| `report_runs` | Not soft-deletable — a 30-day machine record whose row and S3 object are purged together. `file_key`/`file_bucket` sit beside `file_url` precisely so the purge can find the object: a signed URL expires and cannot be used to locate it again, so a system keeping only the URL leaks every file it ever made. |
| `site_analytics_daily` | One row per school per day. **No visitor table behind it** — see §"the privacy decision". |

**CHECK constraints** make the run status machine unrepresentable-when-wrong:
a `DONE` run must have a file and a finish time; a `FAILED` one must have a
message and **no** file. A "successful" run with nothing to download is the
failure mode that makes an export centre useless and it is cheap to forbid.
`chk_report_schedules_shape` demands a `disabled_reason` on a DISABLED row —
the whole point of separating DISABLED (the system's word) from PAUSED (the
owner's).

**Materialized views:** `mv_attendance_monthly`, `mv_collection_monthly`,
`mv_result_summary`, each with a UNIQUE index. That index is not for lookups:
`REFRESH MATERIALIZED VIEW CONCURRENTLY` requires one, and without
CONCURRENTLY the nightly rebuild takes an ACCESS EXCLUSIVE lock that blocks
every dashboard reading the view for its duration.

Two view decisions are worth stating:

- **`mv_collection_monthly` is a FULL OUTER JOIN of two independent
  aggregates, not one GROUP BY.** An invoice belongs to its billing month
  and a payment to the day the money arrived; a March invoice settled in May
  is normal. A single join would multiply the invoice total by its payment
  count — the classic fan-out — and would also drop a month that had
  payments but no invoices.
- **`mv_result_summary` filters on `published_at`, not on a status.**
  `result_status_enum` is PASSED/FAILED/INCOMPLETE/WITHHELD, which describes
  the candidate rather than the release. WITHHELD is excluded on top, because
  a trend line that moves when somebody's dues are cleared is not measuring
  what the reader thinks.

## API Endpoints Added

```
GET    /api/v1/reports                      (catalog, self-filtering)
GET    /api/v1/reports/:code
POST   /api/v1/reports/:code/run            → 202, a queued run
POST   /api/v1/reports/:code/preview        → the first 100 rows
POST   /api/v1/reports/:code/download       → the file, inline (small reports)

GET    /api/v1/report-runs (+ /:id)
GET    /api/v1/report-runs/:id/download     → a freshly signed URL
POST   /api/v1/report-runs/:id/rerun

GET    /api/v1/report-schedules (+ /:id, /presets)
POST   /api/v1/report-schedules
PUT    /api/v1/report-schedules/:id
DELETE /api/v1/report-schedules/:id
POST   /api/v1/report-schedules/:id/test-run

GET    /api/v1/analytics/executive | enrollment | attendance-heatmap
                        | finance | results | operations | website
POST   /api/v1/analytics/refresh-views

POST   /api/v1/public/analytics/collect     (public, throttled, no audit)
```

## Frontend Pages Created

- `/admin/reports` — rebuilt as three tabs: **Catalog** (search, run dialog),
  **Export centre**, **Schedules**.
- `/admin/analytics` — the executive dashboard.

## Components Created (new shared/reusable only)

- `ReportParamsForm` (`admin/reports/report-params.tsx`) — the
  auto-generated parameter form. **Forty-odd reports share it**, so a new
  report gets a working form the moment its schema lands in the registry;
  that is the whole point of the schema being data.
- `AttendanceHeatmap` (`admin/analytics/heatmap.tsx`).
- `PageViewBeacon` (`(public)/_components/page-view-beacon.tsx`).
- `lib/validations/analytics.ts` — including a **deliberate mirror** of the
  backend cron parser, so the dialog can refuse a sub-hourly expression
  while the user is typing rather than on submit. Same rule, never looser.

## Business Rules Implemented

- **§6, access is enforced at the engine and not just the UI.** A report's
  own permission is checked in `enqueue()` *and* again in `produce()`. That
  is not belt and braces: for a scheduled run the second check is the
  **only** authorisation that ever happens — no request, no guard, no route.
- **§6, sensitive columns are stripped, not refused.** The obvious
  implementation is a 403 and it is wrong: a payroll clerk who may see net
  pay but not tax details still needs the register. The cells are **deleted,
  not blanked** — a blanked column still discloses that the field exists and
  how many rows have one, which for a medical flag is most of the
  disclosure — and the report says which columns went, so a short sheet
  reads as a permissions boundary rather than a broken export.
- **§7, the cron whitelist is the parser.** The minute field must be a single
  literal 0–59: not `*`, not a list, range or step. That one rule makes
  sub-hourly unrepresentable rather than merely discouraged. Six-field
  (seconds) expressions are refused rather than silently reinterpreted.
  Vixie's day rule is honoured: when **both** day fields are restricted they
  are OR-ed, and getting that backwards turns a monthly schedule weekly.
- **§6, Asia/Dhaka.** Fixed +06:00, no DST, so a fire time cannot happen
  twice or not at all.
- **§6, retry ×2 then notify.** The third consecutive failure DISABLES the
  schedule **with a reason** and tells the owner. A schedule that silently
  stopped is worse than one that never existed — the school believes it is
  still being emailed.
- **§8, deleted owner.** Their schedules are disabled with a reason and left
  in place, not deleted: the school may still want the report and somebody
  has to be able to see what was being sent and to whom.
- **§8, staleness is printed.** Every panel and report served from a
  materialized view says it is up to 24 hours old, on its own face. A figure
  that quietly disagrees with the live screen beside it destroys confidence
  in both.
- **§4/§8, retention.** 30 days by default; the purge deletes the S3 object
  **first**, so a failure leaves the row for the next sweep rather than
  orphaning the file with no record it exists.
- **Ownership is the authorization in the export centre** (the M18 portal
  rule). A run belongs to whoever asked for it; the report's permission is
  re-checked on read, because a user whose role was narrowed last week must
  not still be able to fetch last week's file. `rerun` applies both — a run
  you may not open is not one you may clone from its stored parameters.
- **A re-run is authorised as whoever pressed it**, never as the original
  requester, so it can never inherit columns their permissions would strip.

## The privacy decision (roadmap §3 said "decide")

Two decisions, both away from the roadmap's default, both stated here
because they are the module's most consequential choices.

**Page views are counted by a beacon, not by API middleware.** §3's default
suggestion was a server-side counter on the public routes. It would give
wrong numbers: a Next-rendered marketing page makes between zero and five
`/public/*` calls depending on the route, so the notices page would report
five times the homepage's traffic while the homepage — which fetches
nothing — reported none. Every figure would be wrong in a way nobody could
see. The public layout fires one beacon per navigation instead. The price is
explicit: a reader with JavaScript off is not counted, which understates
traffic slightly and never distorts its shape.

**Unique visitors are counted in a HyperLogLog and no visitor identifier is
stored.** A visitors table keeps IP addresses; a Redis SET of fingerprints
keeps a reversible list of them. M28 already settled that an IP address is a
contact detail — it refused to rate-limit anonymous complaints by IP for
that reason — and a marketing-page counter is a far weaker justification
than a complaint box was. So the fingerprint is a salted SHA-256 of IP +
user agent fed straight into a fixed ~12 KB structure out of which no member
can be read, and the fingerprint itself is never written anywhere.
`analytics.website_visitor_salt` is a **secret** setting: with it readable,
anybody could compute the hash for a given IP and check whether that visitor
was in the day's set, which is precisely the linkability the HLL was chosen
to prevent. Rotating it resets uniqueness, which is the intended escape
hatch. The consequence the API states plainly: **daily unique counts cannot
be summed into a window total.**

## Architecture notes

**The second leaf aggregator.** M18's `PortalModule` established the shape —
a module that imports many feature modules and is imported by none is
cycle-free by construction. `AnalyticsModule` is the same argument from the
other end: eleven feature modules are imported purely for their **exported
report services**, so a spreadsheet prints the module's own numbers rather
than a second query that drifts (the M12 reports/export split, applied
across module boundaries). M24's completion doc predicted this exactly when
it exported `InventoryReportsService` although nothing imported
InventoryModule at the time — "the exports exist for M29 and M30 anyway."
They are all used now.

**Three services had to be exported to make that work**, all additively:
`FeeReportsService` (M16), `CommunityReportsService` (M28), and
`AttendanceSettingsService` was **re-provisioned** instead — it needs
`SettingsService` alone, and re-provisioning was cheaper than widening M12's
surface for one threshold (the M07/M19/M23/M27/M28 convention).

**`AnalyticsRepository` is the ninth use of the narrow-repository pattern**
(M12 `EmployeeDirectoryRepository` → M17 → M18 → M19 → M22 → M23 → M24 →
M28), and the use where it matters most: the alternative is importing twelve
modules to pull one number each. It also holds the three raw MV reads —
Prisma has no model for a materialized view, so `$queryRaw` with bound
tagged-template parameters is the honest tool rather than a shortcut.

**The registry is a file, projected into a table.** Roadmap §3 says the
table "replaces the code-only registry from Module 18". It replaces its
*storage*, not its authority: rows a developer inserts by hand have no code
review, no diff, and no way for `tsc` to notice a report pointing at a
permission nobody defines. `report.registry.spec.ts` enforces the two
invariants that matter — every `runnable: true` has a bound executor, and
every bound executor is declared — because the seeder runs standalone (no DI
container) and therefore trusts the file's claim.

## Known Limitations

- **`result.report-cards` is not runnable as a file.** It is a
  per-candidate PDF booklet, not a table, and forcing it through the tabular
  contract would hand the export centre a spreadsheet nobody wants. It keeps
  its deep link to M15's own endpoint and the hub hides its Run button — the
  M18 `{available:false}` honesty rule.
- **Report PDFs cannot set Bangla** (the M09 pdfkit-font limitation, carried
  by every PDF in this system); a Bangla name renders transliterated.
- **The param form gives real pickers only for session, class and section.**
  Exam, route, item, account, vehicle, hostel and supplier fall back to a
  text field — seven more list endpoints on a page that loads before you
  have chosen a report was the wrong trade, and those ids are copied from
  the module pages where the reader already is.
- **Window-level "top pages" is a merge of each day's top-N**, so a page
  that was 21st every day is genuinely absent. Stated on the report.
- **`analytics.*` settings are school-wide** (every module's convention
  since M24).
- **The executive dashboard's 5-minute cache is per panel**, so two panels
  read moments apart can carry `computedAt` stamps a few minutes apart.
- **Attachments are not yet attached.** `analytics.schedule_attach_files`
  and its size cap are read and honoured in the decision, but the delivery
  sends a **link** in every case — M17's `NotificationService.send()` has no
  attachment parameter, and adding one is an M17 change rather than an M29
  one. The link is signed for seven days so an email read the following week
  still works.
- The catalog, export-centre and schedule tables are not virtualized.
- **The `.gitattributes` CRLF debt bit again** — most of this module's first
  lint run was `Delete ␍`. Still worth doing centrally.

## Future Improvements

- Attachment delivery, once `NotificationService` grows an attachment path.
- A per-module id picker for the seven fall-back param types.
- Report definitions a school can *add* (a saved query builder) — the table
  is shaped for it; today it is append-only from code.
- `mv_*` per-school refresh, if one school's data ever makes a global
  refresh too slow to hide in the night.
- A load test of the executive dashboard against a seeded 5-year dataset —
  roadmap §9's "< 1 s" target is the one measured item not measured (see
  Remaining TODOs).

## Breaking Changes

**One, and it is the module's only one: `@Controller('reports')` moved from
`PortalModule` to `AnalyticsModule`.**

- `GET /api/v1/reports` answers at the **same URL** with a **superset** of
  its old payload — every field M18's hub read (`code`, `name`, `module`,
  `description`, `permission`, `endpoint`, `params`, `formats`) is still
  there, plus `output`, `runnable`, `columnsWillBeWithheld` and `freshness`.
  Any caller reading the old fields is unaffected; the portal e2e suite's
  assertions against it pass unchanged.
- `src/modules/portal/reports/report.registry.ts`,
  `portal/services/reports.service.ts` and
  `portal/controllers/reports.controller.ts` are **deleted**. Two
  controllers on one path would collide and two registries would be two
  sources of truth. Anything importing `REPORT_REGISTRY` from the portal
  path must import it from `modules/analytics/reports/report.registry`.
- **Who must react:** nobody at the HTTP layer. Only code importing the
  deleted TypeScript modules.

A second, smaller correction: the **admin menu's Reports entry named
`report.view`, a permission code that has never existed** in the registry,
so the item has been invisible to everybody but a super admin since M18. It
is now ungated, matching the backend route (the catalog self-filters).

## Migration Steps

1. `npx prisma migrate deploy` — creates four tables, four enums and three
   materialized views. Safe on a live database; the views are populated at
   creation.
2. `npm run seed` — syncs 55 report definitions into `report_definitions`
   and the four new permission codes into `permissions`. Idempotent.
3. Optionally set `S3_BUCKET_REPORTS`; without it report files land in
   `S3_BUCKET_DEFAULT` (the `bucketFor` convention).
4. Nothing to configure: every `analytics.*` setting has a working default.
   A school that does not want traffic counted sets
   `analytics.website_tracking_enabled` false.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| `S3_BUCKET_REPORTS` | New (optional) | Bucket for generated report files; falls back to `S3_BUCKET_DEFAULT`. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Migration replay onto an empty database | ✅ | All 27 migrations, `migrate diff` reports **no difference**. |
| Migration against the live local database | ✅ | Applied clean; zero drift. |
| Migration + seed against **Neon** | ✅ | 292 permission codes, 55 reports, 0 orphaned, zero drift. |
| `REFRESH MATERIALIZED VIEW CONCURRENTLY` × 3 | ✅ | Proves each view carries the unique index it needs. |
| Run → worker → S3 → signed URL → **bytes fetched** | ✅ | e2e asserts the CSV header of the actually-downloaded file. |
| Column stripping over the wire | ✅ | The file the auditor downloads has no money columns; the run row lists them. |
| Schedule fire (time-travel) | ✅ | `next_run_at` moved into the past, real sweep, run settled DONE, recipients notified. |
| Backend `npx tsc --noEmit` | ✅ | Clean. |
| Backend `npx jest` | ✅ | **2417 passed / 155 suites** (was 2257 / 147). **+163 new in 9 analytics suites**, −3 with M18's deleted `report.registry.spec.ts`. |
| Backend e2e | ✅ | **1033 passed / 29 suites** (was 989 / 28 — **+44 in the new `analytics.e2e-spec.ts`**). |
| Backend `npx eslint` on new + changed paths | ✅ | Clean. Two pre-existing errors elsewhere in `portal/services` are untouched by this module. |
| Frontend `npx tsc --noEmit` | ✅ | Clean. |
| Frontend `npx vitest run` | ✅ | **619 passed / 45 files** (was 592 / 43 — **+27 in 2 new files**). |
| Frontend `npx eslint` on new paths | ✅ | Clean. |
| `npx next build` | ✅ | Compiles; emits `/admin/reports` and `/admin/analytics`. |
| In-browser click-through | ⏳ | Not done — see Remaining TODOs. |

### The four defects the e2e run found

Every one was invisible to `tsc`, which is why the suite exists.

1. **The module did not boot.** `AttendanceSettingsService`,
   `FeeReportsService` and `CommunityReportsService` were injected but not
   exported by their modules. Nest DI is a *runtime* graph — the backend
   compiled cleanly and then every suite failed to start. The M18
   `NotificationsRepository` / M21 `HrSettingsService` lesson, third time.
2. **Every paginated export-centre request 400-ed.** Two `@Query()` DTOs on
   one handler means `forbidNonWhitelisted` validates each against the whole
   query string, so each rejects the other's keys. `PaginationQueryDto`'s
   own comment says "extend per module" for exactly this reason.
3. **Every payroll report failed with `"2026-08-01-01" is not a valid
   calendar date`.** M21's window is grained in **months**; the executor
   handed it dates and the service appended `-01`. Both are `string`, so the
   type system could not see it. Fixed with `defaultMonthWindow` and month
   params in the registry — *and* the assertion that missed it was
   strengthened: an empty `strippedColumns` is also what a FAILED run has,
   so asserting the stripping alone passed while the report was failing.
4. **`rerun` never applied the ownership check** `findOne` and `download`
   both apply — you could not open a colleague's export but could clone it
   from its stored parameters, which are themselves a disclosure.

## Remaining TODOs

- [ ] In-browser click-through: the run dialog's preview on a real report,
      a queued 10k-row export watched through the export centre, the
      schedule manager's preset picker, and the heatmap on a phone.
- [ ] Roadmap §9's **load test**: executive dashboard < 1 s on a seeded
      5-year dataset. The panels are cached and MV-backed by design, but the
      target is unmeasured.
- [ ] Scheduled-report **attachments** (see Known Limitations).
- [ ] Decide whether a school should be able to define its own report.

## Links to Related Modules

- **Depends on:** every Phase 1–2 module. Imports M04 School, M03 Rbac, M01
  Storage, M05 Academic, M17 Communication, and the eleven report sources —
  M12 Attendance, M15 Results, M16 Fees, M20 Accounting, M21 HR, M23
  Library, M25 Transport, M24 Inventory, M26 Hostel, M27 Documents, M28
  Community.
- **Closes:** M18's "no in-place param-form runner per report"; M01's
  "`DataTable` export is CSV-only; XLSX arrives with the report engine";
  M24's forward-looking `InventoryReportsService` export; the eight
  analytics notes M22–M28 left.
- **Replaces:** M18's `report.registry.ts` + `ReportsService` +
  `ReportsController` (see Breaking Changes).
- **Unlocks / hooks completed for:** Module 30 (SysAdmin) — `report_runs`
  and the MV refresh are the first entries its job log and system console
  will want; `AnalyticsModule` exports `ReportEngineService`,
  `ReportCatalogService`, `ExecutiveAnalyticsService`,
  `MaterializedViewService` and `AnalyticsSettingsService` for it, on the
  M21/M24 rule that a service a future consumer injects but the module does
  not export compiles cleanly and then fails to boot.
- **Leaves no no-op hooks.**
- `PROJECT_CONTEXT.md` sections updated: §5 (shared services), §16
  (decisions), §18 (debt).
