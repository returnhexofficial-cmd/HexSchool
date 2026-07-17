# Module 09 — Student & Guardian Management · Completion Document

| | |
|---|---|
| **Module** | 09 — Student & Guardian Management |
| **Completion date** | 2026-07-18 |
| **Actual effort** | 1 dev-day (est. was 6) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 09 |

## Summary of Implemented Features
- **Student master record** with a permanent `student_uid` (SequenceService, pattern `{SCHOOL_CODE}-{YYYY}{SEQ5}` from the new `general.student_id_pattern` setting; its unique index ignores `deleted_at` — UIDs are never reused, like employee IDs). Direct registration is supported now; Admission (M10) will flow into the same `StudentsService.create`.
- **Rich registration in one call**: personal profile + inline/existing guardians (deduped by phone) + a warn-only duplicate report, all in a single transaction.
- **Shared guardians** (siblings reuse one row). Phone is the dedup key; `guardians.create` refuses a second row for a used number. Link/update/unlink endpoints enforce **exactly one primary per student** (partial unique index + transactional promote/demote).
- **Warn-only duplicate detection** (roadmap M09 §8): same name+DOB, or same DOB + a shared guardian phone (twins/siblings). Never blocks; surfaced on create, on import, and via a pre-submit `POST /students/check-duplicates` probe.
- **Status lifecycle** with mandatory reason, an append-only `student_status_history` trail, and a portal-deactivation cascade for exit statuses (TRANSFERRED/GRADUATED/DROPPED/SUSPENDED). Dues clearance is a soft warning until Fees (M16) makes it a hard block.
- **Permission-gated medical record** (`student.medical.view` / `student.medical.update`) — 1:1, never included in exports, audited as "changed" not by content.
- **Documents** (birth certificate, transfer certificate, previous marksheet…) — the staff/teacher pattern (S3, hard-deleted with the object, ≤10 MB pdf/jpg/png).
- **Lazy portal accounts** for students and guardians (`POST /students/:id/create-account`, `POST /guardians/:id/create-account`) — temp password by SMS/email, phone-based login. Contact uniqueness is now **per user type**, so a guardian who is also staff can share a phone across their two accounts.
- **ID card PDFs** (pdfkit + qrcode): CR80 layout, school branding from the M04 profile, QR encoding the rotatable `qr_token`. Single (`/students/:id/id-card`) and batch (`/students/id-cards`); missing photo → placeholder + `X-Cards-Incomplete` header. `POST /students/:id/rotate-qr` invalidates lost/stolen cards.
- **XLSX bulk import** (exceljs): template download, two-phase dry-run → commit with a **row-level report**; valid rows go through the normal `create` path (gap-free UID, guardian dedup, duplicate warnings). Bangla names survive as UTF-8.
- **Aggregated history endpoints** (`attendance-history`, `performance-history`) return an empty, self-describing shape until Modules 12/15 land.

## Database Changes
Migration `prisma/migrations/20260717090000_student_guardian_management/`:
- **Enums**: `religion_enum`, `student_status_enum`, `guardian_relation_enum`, `student_document_type_enum`.
- **Tables**: `students`, `guardians`, `student_guardians` (composite PK), `student_medical_info` (1:1), `student_documents`, `student_status_history` (append-only, no soft delete).
- **Hand-written**:
  - `uq_students_uid (school_id, student_uid)` — deliberately **not** `deleted_at`-scoped (UIDs never reused).
  - `uq_students_qr_token`, and `uq_students_birth_certificate` as a **partial** unique (`WHERE deleted_at IS NULL AND birth_certificate_no IS NOT NULL`).
  - `uq_student_guardians_primary (student_id) WHERE is_primary` — one primary per student.
  - CHECKs: `chk_students_dates` (dob < admission), medical measurements > 0, document size > 0, guardian income ≥ 0.
  - **M02 constraint adjustment (roadmap M09 §8)**: `uq_users_email`/`uq_users_phone` moved from `(school_id, contact)` to `(school_id, user_type, contact)` — a guardian may also be staff. Still soft-delete-scoped.

## API Endpoints Added
```
GET    /api/v1/students                         (filter: class/status/gender/religion; search name/UID/guardian phone)
POST   /api/v1/students                          (returns { student, duplicateWarnings, warnings })
GET    /api/v1/students/:id
GET    /api/v1/students/:id/full                 (profile + guardians + documents + status trail)
PUT    /api/v1/students/:id
DELETE /api/v1/students/:id
PUT    /api/v1/students/:id/status
POST   /api/v1/students/:id/photo
POST   /api/v1/students/:id/rotate-qr
POST   /api/v1/students/check-duplicates         (warn-only probe)
POST   /api/v1/students/:id/guardians            PUT/DELETE /:id/guardians/:guardianId
GET/PUT /api/v1/students/:id/medical             (permission-gated)
GET    /api/v1/students/:id/documents            POST /:id/documents   DELETE /:id/documents/:docId
POST   /api/v1/students/:id/create-account
POST   /api/v1/students/:id/id-card              POST /api/v1/students/id-cards
GET    /api/v1/students/import-template          POST /api/v1/students/import  (commit=false|true)
GET    /api/v1/students/:id/attendance-history | performance-history
CRUD   /api/v1/guardians                          POST /api/v1/guardians/:id/create-account
```

## Frontend Pages Created
- `/admin/students` — list (filters, guardian-phone search, page-batch ID cards, import/new).
- `/admin/students/new` — 6-step registration wizard (Personal → Guardians search-or-create → Address → Medical → Documents → Review with live duplicate probe).
- `/admin/students/[id]` — detail with tabs: Profile (edit/photo/address/QR-rotate/delete), Guardians (link/primary/unlink), Medical (permission-gated), Documents, Attendance/Results (stubs), Timeline (status history). Header actions: ID card, create portal account, change status.
- `/admin/students/import` — template download + validate (dry-run) + commit with a row-level report table.
- `/admin/guardians` — list + create; `/admin/guardians/[id]` — detail (edit/delete/create-account, children linked).

## Components Created (new shared/reusable only)
- `components/ui/checkbox.tsx`, `components/ui/textarea.tsx` (shadcn-style, vendored — first module to need them).

## Business Rules Implemented
- `student_uid` permanent and never reused; roll numbers deferred to enrollment (M11).
- Exactly one primary guardian; primary phone is the default SMS target.
- Guardian dedup by phone (siblings share); a guardian linked to ≥1 student can't be deleted.
- Exit-status change deactivates the portal account (student only; guardians may have other children). Dues check soft until M16.
- Medical info permission-gated, never exported by default.
- Duplicate detector warns, never blocks. Age-vs-class-level sanity warning (± 3 yrs).
- Birth certificate 17 digits, soft-unique per school.

## Known Limitations
- Batch ID cards take an explicit `studentIds[]`; **section-scoped** batches (`POST /sections/:id/id-cards`) arrive with M11 rosters.
- `attendance-history` / `performance-history` return empty until M12 / M15.
- ID card layout is a single built-in template; "template configurable" (roadmap) is deferred — branding (name + logo + QR) is wired.
- Multi-account holders (same phone as e.g. both parent and staff) reset their password via the **oldest** account until username login lands; documented in `UsersRepository.findByIdentifier`.
- In-browser click-throughs pending for photo/document upload and ID-card print preview (API + generation layers e2e-tested; same status as M04/M07/M08 uploads).

## Future Improvements
- Configurable ID-card templates; QR verification page (M19/M27).
- Section-scoped ID-card batches and SMS-to-selection bulk actions once rosters (M11) and Communication (M17) land.

## Breaking Changes
- **User contact uniqueness moved to `(school_id, user_type, contact)`.** Login now verifies the password against **every** candidate account for an identifier (`AuthService.login` + `UsersRepository.findAllByIdentifier`); a failed attempt counts against every unlocked candidate. Existing single-account users are unaffected. Anyone relying on `(school_id, contact)` being globally unique must react — but no such caller exists (the constraint was only enforced in the DB and the auth lookup, both updated here).

## Migration Steps
1. `npx prisma migrate deploy` (applies `20260717090000_student_guardian_management`, including the users unique-index swap).
2. `npm run seed` — or let the idempotent RBAC seeder run on boot — to register the 14 new `student.*` / `guardian.*` permission codes and extend the Principal / Vice-Principal / Teacher / Admission Officer core sets.
3. No env changes. `general.student_id_pattern` is a settings-registry key with a default (`{SCHOOL_CODE}-{YYYY}{SEQ5}`); override per school if needed.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| _(none)_ | — | Student UID pattern lives in school settings, not env |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Full registration → UID + primary guardian | ✅ | e2e |
| Sibling reuses guardian by phone + duplicate warning | ✅ | e2e |
| Birth-certificate 409 + check-duplicates probe | ✅ | e2e |
| Guardian link/primary-promote/unlink invariants | ✅ | e2e (409 on unlinking primary, 400 on direct demote) |
| Medical permission gate + upsert | ✅ | e2e (403 for non-permitted role) |
| Student + guardian portal accounts sharing a phone | ✅ | e2e (per-user-type uniqueness) |
| Status change → history row + portal INACTIVE cascade | ✅ | e2e (polls user status) |
| QR rotate + single/batch ID card PDF (%PDF, incomplete flag) | ✅ | e2e |
| XLSX template + dry-run report + commit (Bangla names) | ✅ | e2e |
| Soft delete burns the UID | ✅ | e2e |

## Remaining TODOs
- [ ] Section-scoped ID-card batch endpoint (with M11).
- [ ] In-browser upload / ID-card print click-throughs.
- [ ] Configurable ID-card template.

## Links to Related Modules
- Depends on: Module 06 (classes), Module 07 (user/sequence pattern).
- Unlocks: Module 10 (Admission — converts applications into students via this service), Module 11 (Enrollment — `students` × session/section), Module 16/23/25/26 (fee/library/transport/hostel hang off students).
- Hooks completed for later: dues hard-block on status change (M16); history tabs fill as M12/M15 land.
- `PROJECT_CONTEXT.md` sections updated: §5 (StudentsRepository/GuardiansRepository exports), §8 (ER spine), §9 (multi-candidate login), §16 (decisions), §18 (debt).
