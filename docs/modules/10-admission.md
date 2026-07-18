# Module 10 — Admission Management · Completion Document

| | |
|---|---|
| **Module** | 10 — Admission Management |
| **Completion date** | 2026-07-18 |
| **Actual effort** | 1 dev-day (est. was 6) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 10 |

## Summary of Implemented Features
- **Admission cycles** (session-scoped, DRAFT → OPEN → CLOSED → COMPLETED) with a per-class child table (`admission_cycle_classes`: seats + application fee). Open requires ≥1 class and a live window; close auto-CANCELs unpaid PAYMENT_PENDING applications with SMS (M10 §8); delete blocked once applications exist.
- **Public online application** (`(public)` portal, unauthenticated API under `/public/admissions`):
  - reCAPTCHA (v3, disabled when keys are empty) + **OTP phone verification** (reuses M02 `OtpService`, purpose `ADMISSION`; verify-otp mints a 30-min signed phone token consumed by photo-upload/apply).
  - Applicant + guardian **snapshots** stored on the application (master rows created only at conversion); optional photo (≤1 MB jpg/png → 512px PNG on S3).
  - Application numbers from `SequenceService` (`general.application_no_pattern`, default `ADM-{YY}-{SEQ6}`, counter `admission:{YY}`, gap-free in-transaction).
  - Duplicate rule: one live application per (cycle, class, phone, dob) — friendly 409 + DB partial unique (terminal statuses excluded so cancelled applicants can reapply); optional multi-class block via setting.
  - **Age hard-check** (M10 §7): expected class age = numeric level + 5, tolerance from `academic.admission_age_tolerance_years`.
  - Tracking (`app no + phone` must both match — no enumeration) and public **admit-card PDF** download.
- **Payments**: offline recording now (CASH/BANK/BKASH/…, defaults amount to the class fee; PAYMENT_PENDING → SUBMITTED), waive/refund behind a separate permission. Online gateway wiring arrives with M16 (`payment_ref/method/paid_at` columns are the callback slot).
- **Admission tests**: per-class slots (date/venue/total/pass, upserted wholesale); scheduling moves paid applications to TEST_SCHEDULED (+SMS); **bulk mark entry** grades PASSED/FAILED against the slot's pass mark (marks capped at total; re-entry allowed until merit).
- **Merit & waiting lists**: generation per (cycle, class) on a CLOSED cycle only ("marks locked"); ordering **test marks desc → previous GPA desc → dob asc** (pure `compareForMerit`, golden-tested); SELECTED up to remaining seats (ADMITTED keep consuming seats) with an admission deadline from `academic.admission_selection_deadline_days`; the rest WAITLISTED with merit positions. **Regeneration voids the previous list** (SELECTED/WAITLISTED fold back into the pool; audited).
- **Waitlist promotion**: automatic when a SELECTED application is cancelled or expires; manual `promote-waitlist {classId, count}` for seat increases (M10 §8).
- **Expiry job** (hourly cron): overdue SELECTED → EXPIRED + per-class waitlist promotion, one candidate per freed seat.
- **Conversion** (`POST /:id/admit`, SELECTED only): reuses `StudentsService.create` — same gap-free UID, guardian phone dedup, warn-only duplicate report; applicant photo key becomes the student photo; **idempotent** (re-admitting an ADMITTED app returns the existing student). Enrollment backfilled by M11 (run M11 before the first real cycle — roadmap note honored).
- **Notifications at every status change** (roadmap M10 §4): event listener enqueues applicant SMS (fire-and-forget, log-only until M17). Exception by design: raw PASSED/FAILED mark entry does not SMS (corrections are common); merit results are the authoritative announcement.
- **Reports**: funnel summary (applied/processed/selected/admitted/waitlisted) + per-class breakdown with seats and fees collected.
- 8 permission codes (`admission.*`); Admission Officer core set extended to the full pipeline, Principal gets view/merit/admit/waive.

## Database Changes
Migration `20260717224953_admission_management`:
- Enums: `admission_cycle_status_enum`, `admission_application_status_enum` (13 states), `admission_payment_status_enum`.
- Tables: `admission_cycles`, `admission_cycle_classes` (uq cycle+class), `admission_applications` (applicant/guardian snapshots, payment fields, `test_marks`, `merit_position`, `admission_deadline`, `student_id` FK), `admission_tests` (uq cycle+class).
- Hand-written: partial uniques `uq_admission_cycles_name` (soft-scoped) and `uq_admission_applications_applicant` (`WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED','REJECTED','EXPIRED')`); CHECKs (window order, seats > 0, fee ≥ 0, pass ≤ total, non-negative marks/amounts).
- `uq_admission_applications_no` deliberately NOT soft-scoped (numbers never reused).

## API Endpoints Added
```
CRUD /api/v1/admission-cycles            POST /:id/open | close | complete
PUT  /api/v1/admission-cycles/:id/tests  POST /:id/test-marks
POST /api/v1/admission-cycles/:id/generate-merit-list | promote-waitlist
GET  /api/v1/admission-cycles/:id/merit-list | waiting-list   (?classId=)
GET  /api/v1/admission-applications (filters) | /:id | /:id/admit-card
PUT  /api/v1/admission-applications/:id/status | payment-status
POST /api/v1/admission-applications/:id/payment | admit
GET  /api/v1/admission-reports/summary?cycleId=
# public (@Public, throttled 5–10/min, reCAPTCHA where marked)
GET  /api/v1/public/admissions/cycles
POST /api/v1/public/admissions/request-otp (captcha) | verify-otp | photo | apply (captcha)
GET  /api/v1/public/admissions/track | admit-card   (?appNo=&phone=)
```

## Frontend Pages Created
- Public: `/admission` (landing, open cycles + fees/seats/test info), `/admission/apply` (4-step mobile-first wizard: OTP verify → applicant → guardian+photo → review; localStorage draft resume), `/admission/track` (status card, hints, admit-card download).
- Admin: `/admin/admissions` (cycle list + create/edit dialog with per-class seat/fee rows), `/admin/admissions/[id]` (tabs: Applications — status pipeline filters, review drawer actions, payment record/waive, admit confirm; Tests & Marks — slot editor + bulk marks grid; Merit — generate/regenerate, merit + waiting lists, promote; Reports — funnel + per-class table).
- New menu entry "Admissions" behind `admission.view`.

## Components Created (new shared/reusable only)
- `src/lib/utils/recaptcha.ts` (lazy v3 loader, no-op when unset).

## Business Rules Implemented
- One live application per (cycle, class, phone+dob); friendly message + DB unique.
- Merit only after close; regeneration voids previous list (audited).
- SELECTED get a deadline (default 7 days) → auto-EXPIRE + waitlist promotion.
- Fee non-refundable by default; WAIVED/REFUNDED behind `admission.payment.waive`.
- Conversion idempotent; ADMITTED seats persist through regeneration.

## Known Limitations
- Server-side draft save/resume (phone+OTP) not implemented — the public wizard keeps a localStorage draft instead; snapshots are immutable after submit.
- Online payment is stubbed (offline recording only) until M16 wires SSLCommerz/bKash/Nagad through `PaymentGatewayService`.
- PASSED/FAILED mark entry intentionally does not SMS (see summary); listener templates exist for both if that decision is reversed.
- Reconciliation-by-txn-id endpoint deferred to M16 with the gateways.
- Conversion runs `StudentsService.create` in its own transaction, then links the application; a crash between the two leaves an ADMITTED-pending app still SELECTED with a created student (re-admit reconciles manually) — acceptable until a cross-module unit-of-work exists.

## Future Improvements
- Publish merit list to the public website (M19 hook).
- Per-application timeline/history table if the audit log proves too coarse.

## Breaking Changes
- None to existing APIs. `AuthModule` now exports `OtpService`; `StudentModule` now exports `StudentsService` (additive).

## Migration Steps
1. `npx prisma migrate deploy`
2. Restart backend (seeder syncs 8 new `admission.*` codes; Admission Officer/Principal roles extended).
3. Optional: set `RECAPTCHA_SECRET_KEY` (backend) + `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` (frontend) to enable captcha in production.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| `RECAPTCHA_SECRET_KEY` | New (optional, default empty = disabled) | Server-side reCAPTCHA verification on public admission endpoints |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | New (optional, frontend) | Loads the v3 widget on the public forms |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Full funnel via e2e (apply → pay → test → marks → merit → cancel-promote → admit → report) | ✅ | 21 e2e assertions green against dev infra |
| Admit-card PDF bytes served publicly | ✅ | `%PDF-` verified in e2e |
| In-browser public wizard click-through (OTP SMS, photo upload) | ⏳ | pending — OTP is log-only until M17; layers individually e2e-tested |

## Remaining TODOs
- [ ] In-browser click-through of the public wizard once SMS delivery is real (M17).
- [ ] Wire online payment callbacks + reconciliation (M16) — `AdmissionApplicationsService.recordPayment` is the slot.

## Links to Related Modules
- Depends on: Modules 06, 09 (M11 note: enrollment backfilled — run Module 11 before the first real admission cycle).
- Unlocks / hooks completed for: M16 (gateway wiring slot), M19 (public merit publish).
- `PROJECT_CONTEXT.md` sections updated: §5, §8, §14, §16, §18.
