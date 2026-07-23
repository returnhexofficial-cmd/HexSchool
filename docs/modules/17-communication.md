# Module 17 — Communication & Notifications · Completion Document

| | |
|---|---|
| **Module** | 17 — Communication & Notifications (SMS/Email) |
| **Completion date** | 2026-07-23 |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 17 |

## Summary of Implemented Features

- **`NotificationService.send()` — the single entry point** every module now calls (roadmap §6 "all module-originated messages must go through NotificationService — no direct gateway calls"). It resolves the template, renders it, applies quiet hours and dedupe, records a `notifications` row and enqueues the work; the queue worker does the delivery.
- **Templates** per `(code, channel, language)` with handlebars variables (`{{student_name}}`), an EN/BN pair, an active flag, and a **per-code variable allow-list** so a typo'd `{{studnet_name}}` is refused at save, not silently blanked on send. A **preview** renders sample data and reports the SMS part count.
- **The real SMS pipeline** — a configurable BD HTTP-gateway adapter (url/key/sender-id/masking are settings), with a **log-only fallback** when a school has not configured a gateway, so the pipeline always completes. Email via SMTP (school `email.*` settings, falling back to the boot `smtp.*`).
- **In-app notifications** — an IN_APP row *is* the message; a header **bell** polls the inbox and shows an unread badge (SSE/WebSocket deferred to Phase 3, per the roadmap).
- **The bulk composer** — an **audience resolver** (everyone / students / parents / teachers / staff / a class / a section / custom CSV numbers) → a **preview** with recipient count and SMS cost estimate → a **chunked, rate-spread** dispatch. A blast above the threshold needs `notification.bulk.large`; a repeat `batchKey` is refused (double-click idempotency).
- **Notices / circulars** with an audience, attachments, pin, website-visibility and a **scheduled publish** (`publish_at` flips live via a cron job); a portal/website feed.
- **SMS-credit accounting** — a running-balance ledger; the dispatcher **consumes one movement per sent part**, refuses a metered send it cannot cover (FAILED, never silently dropped), and fires an in-app **low-balance alert** to admins. A school that never bought credit is **unmetered** and never blocked.
- **Delivery tracking** — a full log with channel/status filters, a **DLR webhook** (secret-verified, `@Public`) that moves a message to DELIVERED/FAILED, and a **retry-failed** action. Failed sends auto-retry with the queue's backoff.
- **Quiet hours + dedupe + merge** — SMS is held out of quiet hours (EMERGENCY bypasses); a repeat `(destination, template)` inside a window is deduped by a DB partial unique; two absent siblings on one guardian's number are **merged into a single SMS** naming both children.
- **Scheduled jobs** — a daily **birthday-wish** SMS (opt-in) and the scheduled-notice publisher.
- **Four producers retro-wired** (M10 admission status, M12 absent alert, M15 result published, M16 fee receipt) — their SMS now flows through `NotificationService` with a template code, so every school message is real, templated, credit-accounted and logged.

## Database Changes

Migration `prisma/migrations/20260723160000_communication_notifications/migration.sql`.

**Enums**
- `notification_channel_enum` — `SMS | EMAIL | IN_APP`
- `notification_language_enum` — `EN | BN`
- `notification_recipient_type_enum` — `USER | GUARDIAN | STUDENT | STAFF | RAW`
- `notification_status_enum` — `QUEUED | SENT | DELIVERED | FAILED | CANCELLED`
- `notice_audience_enum` — `ALL | STUDENTS | PARENTS | TEACHERS | STAFF | CLASS | SECTION`
- `sms_credit_type_enum` — `PURCHASE | CONSUME | ADJUST`
- **`settings_group_enum` gained `communication`** (via `ALTER TYPE … ADD VALUE`, not used in the same migration so it is transaction-safe).

**Tables** — `notification_templates`, `notifications` (append-only log + in-app inbox), `notices`, `sms_credits` (append-only ledger).

**Hand-written constraints** (Prisma cannot express them)
- `uq_notification_templates_identity` — one live `(code, channel, language)` per school (partial, excludes soft-deleted).
- `uq_notifications_dedupe` — a partial unique over `(school_id, dedupe_key) WHERE dedupe_key IS NOT NULL` — the DB-level dedupe within the window (a NULL key opts out, e.g. OTP).
- `chk_notifications_status_evidence` — a `SENT`/`DELIVERED` message must carry `sent_at`, a `FAILED` one must carry `error`. The M16 "evidence, not a bare flag" rule applied to delivery.
- `chk_notifications_cost` — cost and segments are non-negative.
- `chk_sms_credits_balance` — the running `balance_after` never goes negative (an overdraw is refused in the service; this is the backstop).

Objects created: **4 tables, 6 enums, 3 CHECKs, 2 unique indexes** (+ the `communication` settings-group enum value) — asserted on both a clean local Postgres 16 and on Neon.

## API Endpoints Added

```
GET/POST/PUT/DELETE /api/v1/notification-templates      (+ GET /codes, POST /preview)

GET  /api/v1/notifications                (log, channel/status filters)  GET /:id
POST /api/v1/notifications/send                          POST /notifications/retry
POST /api/v1/notifications/bulk/preview   POST /api/v1/notifications/bulk
GET  /api/v1/notifications/me             PUT /api/v1/notifications/me/read

GET/POST/PUT/DELETE /api/v1/notices       (+ PUT /:id/publish, GET /feed)

GET  /api/v1/sms-credits/balance | ledger                POST /api/v1/sms-credits/adjust

POST /api/v1/webhooks/sms-dlr             (@Public — secret-verified)
```

**10 permission codes**: `notification.view`, `notification.template.manage`, `notification.send`, `notification.bulk`, `notification.bulk.large`, `notice.view`, `notice.manage`, `notice.publish`, `sms.credit.view`, `sms.credit.manage`. `GET/PUT /notifications/me` is auth-only (any user reads their own inbox). Baselines: **Principal** gets all ten; **Office Staff** gets the desk set (view/send/bulk + notice manage/publish + credit view); Admin/Super Admin inherit everything.

**14 `communication.*` settings**: `quiet_hours_enabled` / `quiet_hours_start` / `quiet_hours_end`, `sms_rate_per_part` / `sms_unicode_rate_per_part`, `dedupe_window_minutes`, `bulk_large_threshold` / `bulk_chunk_size`, `low_credit_threshold`, `default_language`, `sms_masking`, `birthday_wish_enabled` / `birthday_wish_time`, `dlr_webhook_secret` (secret). Gateway credentials themselves stay in the existing `sms.*` / `email.*` groups.

## Frontend Pages Created

- **`/admin/communication`** — a five-tab workspace:
  - **Compose** — channel + audience picker (roster audiences resolve in the header session; a RAW tab takes a custom-numbers CSV), a live SMS part counter, an emergency toggle, and a **preview → estimate → send** flow showing recipient count and BDT cost.
  - **Notices** — create / publish / unpublish / delete, with pin and website-visibility toggles and a board feed.
  - **Templates** — the seeded-defaults table plus a new-template dialog with the code catalog, a variable helper and a live preview (segment count + unknown-variable warning).
  - **Delivery log** — channel/status filters, per-row status tone, error text, and a retry-failed action.
  - **SMS credits** — balance + metering stat cards, a purchase form, and the ledger.
- **Header notification bell** (`components/shared/notification-bell.tsx`) — polls the in-app inbox every 30 s, shows an unread badge, marks read on open. Added to the admin header for every authenticated user.
- Sidebar entry (`anyOf: notification.view | notice.view`), between Fees and Teachers.

## Components Created (new shared/reusable only)

- **`NotificationBell`** (`components/shared/notification-bell.tsx`) — the header in-app inbox dropdown, reusable by the portals (M18).

## Business Rules Implemented

- **Every module-originated message goes through `NotificationService`** — no direct gateway calls anywhere (enforced by removing the raw-queue injection from the four producers).
- **EMERGENCY bypasses quiet hours and rate spreading**; otherwise SMS is delayed out of the quiet window.
- **A repeat `(destination, template)` inside the dedupe window is dropped** at the DB level; two absent siblings merge into one guardian SMS.
- **Bangla forces UCS-2 segmentation** (70/67 chars per part vs 160/153); the part count drives the cost estimate and the credit consumption.
- **A metered school's send is refused when its balance cannot cover the parts** (FAILED, with a low-balance alert), and consumption is recorded before the row is marked SENT — a SENT SMS is always a billed SMS.
- **A large bulk blast needs `notification.bulk.large`**; a repeat `batchKey` is refused.
- **The DLR webhook trusts nothing but its secret**; it is upsert-safe (a report for an unknown id is acknowledged and ignored so the provider does not loop).
- **A notice cannot be published with a future `publish_at`** (the scheduler owns that); the CHECK is enforced in the service because a time-relative CHECK would need a non-immutable function.

## Design Decisions

### The `notifications` row is the unit of work; the queue carries only its id
`send()` renders and records a `QUEUED` row, then enqueues `{ notificationId }`. The worker loads it, delivers it, and records the outcome — so the delivery log survives a Redis restart, a DLR that beats the send-ack still finds a row, and the send path and the reconcile/retry path are identical. The legacy raw `sms`/`email` jobs (OTP, welcome credentials) still work: the worker sends them for real and records a RAW delivery row, which is what finally makes **OTP-to-phone delivery real** (closing the M02 debt).

### The worker moved from QueuesModule to CommunicationModule
The M02 interim processor was log-only and lived in `QueuesModule`. The real worker needs the render/dispatch/credit services, so it moved into `CommunicationModule` (which registers the same queue). `QueuesModule` keeps only the root BullMQ wiring and the demo `system` queue.

### CommunicationModule is imported by its producers, never the reverse
Attendance/Result/Fee/Admission import `CommunicationModule` to send. It must therefore not import them — so the audience/school repositories it needs are **stateless re-provisions** (the M07/M16 convention), and audience resolution lives in a narrow self-contained `AudienceRepository` (the M12 `EmployeeDirectoryRepository` precedent). The module graph stays acyclic.

### Credit is consumed before the row is marked SENT
Consuming after marking SENT left a window where a message was sent but unbilled (and made the e2e balance assertion race the worker). Consuming first makes a SENT row a guarantee the ledger already moved.

### Unmetered until the first purchase
A school that never records a credit purchase is unmetered — sends are never blocked and no ledger row is written (small deployments on a flat provider plan). The first `PURCHASE` turns metering on.

## Known Limitations

- **Defaulter-list and other data-derived audiences** (roadmap §4 mentions defaulters) are not a bulk audience — that data lives in `FeeModule`, and resolving it here would import the fee module and cycle. Dues reminders are better driven *from* the fee module calling `NotificationService.send` per defaulter (the `FEE_DUES` template + `LedgerService` are already in place); left as an M18/portal follow-up.
- **The circuit-breaker** (roadmap §8 "provider down → pause queue, auto-resume") is approximated by BullMQ's retry/backoff rather than an explicit breaker; a sustained outage retries per-job instead of pausing the queue.
- The bulk cost estimate uses the authored body length (before per-recipient `{{name}}` substitution), so it is an estimate, as labelled.
- In-app inbox is keyed on the logged-in **user** id; mapping a guardian/student portal login to their profile inbox is an M18 concern.
- The DLR webhook resolves `DEFAULT_SCHOOL_ID`, like the other public endpoints — multi-tenant public routing is M31.
- Attachments on notices are stored as URLs; an upload flow is deferred (the same status as other document features pending the M18 report/upload polish).

## Future Improvements

- Portal in-app notifications for guardians/students (M18), reusing `NotificationBell`.
- A defaulter/dues-reminder blast driven from the fee module.
- An explicit provider circuit-breaker with an admin alert and auto-resume.
- Per-recipient cost in the bulk preview (render each body before counting).
- BN default templates seeded per school (only EN is seeded; the sender falls back to EN).

## Breaking Changes

**None to external callers.** All API changes are additive. Internally, the four producer modules (M10/12/15/16) changed how they send — the raw `notifications` queue job is replaced by `NotificationService.send()`:
- The `NotificationJob` union gained a `{ type: 'notification', notificationId, schoolId }` variant; the legacy `sms`/`email` variants still work.
- `AbsentSmsJob`, `ResultPublicationService`, `CollectionService` and `AdmissionListener` now inject `NotificationService` instead of the BullMQ queue; their unit specs were updated to match (`absent-sms.job.spec.ts`).
- `NotificationsProcessor` moved out of `QueuesModule` into `CommunicationModule`.

## Migration Steps

1. `npm run migrate:deploy` (applies `20260723160000_communication_notifications`).
2. **`npx prisma generate`** — the client must be regenerated after this schema change (new enums used as runtime values).
3. `npm run seed` — syncs the 10 new permission codes, extends the Principal/Office-Staff baselines, and seeds the 16 default EN templates (idempotent).
4. New `communication.*` settings appear in Settings → Communication with defaults. Review before going live: `communication.sms_rate_per_part`, `communication.quiet_hours_*`, `communication.bulk_large_threshold`, `communication.dlr_webhook_secret`.
5. Per-school SMS gateway credentials (`sms.enabled` / `sms.api_url` / `sms.api_key` / `sms.sender_id`) are set in Settings → SMS; SMS is log-only until they are present.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. Gateway credentials are per-school settings (M04), not env vars. |

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Backend unit suite | ✅ 924 passed | Was 883 — **41 new** (40 engine/golden + 1 sibling-merge) |
| **Backend e2e suite** | ✅ **343 passed (17 suites)** | Was 323/16 — includes the **20-case `communication.e2e-spec.ts`** |
| `communication.e2e-spec.ts` | ✅ 20 passed | Permission guards, template CRUD/validation/preview, send→worker→SENT, in-app inbox, notices lifecycle + feed, credit purchase/consume/insufficient, DLR webhook, bulk preview, raw DB CHECKs |
| Migration onto a clean Postgres 16 | ✅ full 17-migration chain applied in order | `migrate status` up to date, zero drift |
| `prisma migrate status` on **Neon** | ✅ up to date · schema in sync | 16 migrations applied |
| Objects created | ✅ 4 tables, 6 enums, 3 CHECKs, 2 unique indexes, +1 settings-group value | |
| Seed on Neon | ✅ 156 permission codes, 16 templates created | Idempotent |
| Frontend test suite (`vitest run`) | ✅ 214 passed (25 files) | Was 205 — **9 new** (`communication.test.ts`) |
| Frontend typecheck / lint | ✅ clean | |
| Frontend production build (`next build`) | ✅ compiled | `/admin/communication` emitted |

## Bugs found during verification

### The SMS-credit advisory lock crashed on a `void` result (found by the e2e suite)
`SmsCreditsRepository.append` serialized concurrent movements with `SELECT pg_advisory_xact_lock(...)` via `$queryRaw`, which Prisma cannot deserialize (the lock function returns `void`): `Failed to deserialize column of type 'void'`. Every credit `adjust`/`consume` 500'd. Fixed by using `$executeRaw` for the lock (it does not deserialize a result set). **Lesson:** a void-returning statement in Prisma must go through `$executeRaw`, not `$queryRaw`.

### The credit consume raced the worker (found by the e2e suite)
The e2e drove `dispatch()` by hand *and* the BullMQ worker processed the same job, so a metered SMS was billed twice (balance 98, not 99). The real fix was twofold: the tests now let the worker be the sole dispatcher and poll for the outcome (a single locked job never double-runs), and dispatch now **consumes before marking SENT** so a SENT row is a guarantee the ledger already moved. **Lesson:** an e2e that both drives a job manually and leaves the worker running will double-process — mirror production and let the worker own the job.

## Cross-module debts closed

| Debt | Where | Status |
|---|---|---|
| SMS is log-only until M17; OTP-to-phone not real (M02) | the notifications worker | **Live** — the real gateway adapter sends OTP/welcome/reset for real and logs a RAW delivery row |
| Absent SMS is queued-only, log-only (M12) | `AbsentSmsJob` | **Live** — sends `ABSENT_ALERT` through `NotificationService`, with the sibling merge |
| Result SMS "queued through the existing contract" (M15) | `ResultPublicationService` | **Live** — `RESULT_PUBLISHED` template |
| Receipt/dues SMS "wired here, real once M17 lands" (M16) | `CollectionService` | **Live** — `FEE_RECEIPT` template (dues reminder template `FEE_DUES` seeded, driven from the fee module later) |
| Admission status SMS is log-only (M10) | `AdmissionListener` | **Live** — `ADMISSION_STATUS` code |
| Settings SMS-config test half revisits with M17 (M04) | — | The SMS pipeline is now real; the settings *test-sms* endpoint remains log-only pending a per-call gateway probe |
| Temp-password-in-response revisit once SMS is real (M07) | — | SMS delivery is now real; config-gating the response field is a small follow-up left for a quiet module |

## Remaining TODOs

- [ ] In-browser click-throughs: the compose preview→send path, a real gateway sandbox send with a masked sender id, the bell polling, and a notice published to the board.
- [ ] Module 18 renders portal in-app notifications (guardian/student) and a dues-reminder blast from the fee module.
- [ ] An explicit provider circuit-breaker (roadmap §8), beyond BullMQ retry.
- [ ] Repo-level: still no `.gitattributes` (`* text=auto eol=lf`) — the CRLF/LF split continues to produce phantom prettier warnings.

## Links to Related Modules

- **Depends on:** Module 02 (the notifications queue + OTP producers), Module 04 (settings + encrypted gateway credentials), Module 09 (students/guardians for recipient resolution).
- **Unlocks / hooks completed for:**
  - **Modules 10 / 12 / 15 / 16** — their queued SMS events are retro-wired through `NotificationService`.
  - **Module 18** — `NotificationService` is exported for portal messages; `NotificationBell` is reusable; the in-app inbox is the portal notification surface.
- **`PROJECT_CONTEXT.md` sections updated:** §5 (shared services), §8 (entity spine), §11 (global business rules), §16 (technical decisions), §18 (technical debt).
