# Module 09 — Student & Guardian Management · Completion Document

> Note: this document was reconstructed on 2026-07-18 (during Module 10 wrap-up)
> from PROJECT_PROGRESS/PROJECT_CONTEXT records — the original file was never
> committed with the M09 work.

| | |
|---|---|
| **Module** | 09 — Student & Guardian Management |
| **Completion date** | 2026-07-18 |
| **Actual effort** | 1 dev-day (est. was 6) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 09 |

## Summary of Implemented Features
- Student master record with permanent `student_uid` (SequenceService pattern `general.student_id_pattern`, default `{SCHOOL_CODE}-{YYYY}{SEQ5}`, counter `student:{YEAR}`; unique index deliberately ignores `deleted_at` — UIDs never reused).
- One-call registration: personal data + guardian entries (link existing by id, or inline create deduped by phone) in a single transaction; warn-only duplicate report (name+dob / guardian-phone+dob) and age-vs-class sanity warnings.
- Shared guardians across siblings (phone dedup); one primary per student enforced by a partial unique index with transactional promote/demote; per-link relation/emergency flags.
- Status lifecycle with append-only `student_status_history`; exit statuses (TRANSFERRED/GRADUATED/DROPPED) deactivate the portal account via event listener; dues check is a soft warning until M16.
- Permission-gated medical record (`student.medical.view`/`.update`), audit records THAT it changed, never the contents.
- Student documents (S3, hard-deleted with object) and photo upload (EXIF-normalized 512px PNG).
- Lazy portal accounts for students and guardians (`POST /:id/create-account`, phone-based, temp password via queue).
- CR80 ID-card PDFs (pdfkit + qrcode): single + batch by `studentIds[]`, QR encodes the rotatable `qr_token`, missing photo → placeholder + `X-Cards-Incomplete` header.
- XLSX bulk import: template download, dry-run + commit modes, row-level error report, UTF-8 Bangla names; rows go through `StudentsService.create` (same UID/dedup path).
- **M02 constraint adjustment:** user contact uniqueness moved to `(school_id, user_type, contact)` so a guardian can also be staff; login now verifies the password against every candidate account.

## Database Changes
Migration `20260717090000_student_guardian_management`:
- Enums: `religion_enum`, `student_status_enum`, `guardian_relation_enum`, `student_document_type_enum`.
- Tables: `students`, `guardians`, `student_guardians` (composite PK), `student_medical_info` (1:1), `student_documents`, `student_status_history` (append-only).
- Hand-written: partial unique `uq_students_birth_certificate` (soft-scoped), `uq_student_guardians_primary` (`WHERE is_primary`), CHECKs (`dob < admission_date`, positive measurements/sizes/income); `uq_users_email`/`uq_users_phone` rebuilt as `(school_id, user_type, contact)`.

## API Endpoints Added
```
CRUD /api/v1/students                GET /api/v1/students/:id/full
POST /api/v1/students/check-duplicates
PUT  /api/v1/students/:id/status     POST /api/v1/students/:id/photo
POST /api/v1/students/:id/rotate-qr
POST/PUT/DELETE /api/v1/students/:id/guardians[/:guardianId]
GET/PUT /api/v1/students/:id/medical
GET/POST/DELETE /api/v1/students/:id/documents[/:docId]
POST /api/v1/students/:id/create-account
POST /api/v1/students/:id/id-card    POST /api/v1/students/id-cards
GET  /api/v1/students/import-template  POST /api/v1/students/import
GET  /api/v1/students/:id/attendance-history | performance-history   (empty until M12/M15)
CRUD /api/v1/guardians               POST /api/v1/guardians/:id/create-account
```

## Frontend Pages Created
- `/admin/students` (list, filters, page-batch ID cards), `/admin/students/new` (6-step wizard), `/admin/students/[id]` (7-tab detail), `/admin/students/import` (wizard).
- `/admin/guardians` (list), `/admin/guardians/[id]` (detail with children).

## Components Created (new shared/reusable only)
- shadcn `checkbox`, `textarea` added to `src/components/ui`.

## Business Rules Implemented
- Permanent UID never changes/reused; rolls are enrollment-scoped (M11).
- Exactly one primary guardian; primary guardian phone = default SMS target.
- Exit status → portal deactivation; medical data excluded from exports/default reads.
- Duplicate detection warns, never blocks (twins/siblings).

## Known Limitations
- Batch ID cards take explicit `studentIds[]`; section-scoped batches wait for M11 rosters.
- One built-in CR80 template ("template configurable" deferred).
- History endpoints return empty self-describing shapes until M12/M15.
- Multi-account holders reset passwords via the OLDEST account until username login (M18).

## Future Improvements
- Configurable ID-card templates; section-batch cards (M11); real history tabs (M12/M15).

## Breaking Changes
- User uniqueness is now per `(school_id, user_type, contact)` — login flows check multiple candidate accounts. No API contract change.

## Migration Steps
1. `npx prisma migrate deploy`
2. Restart backend (permission seeder syncs 14 new codes; roles extended).

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | none |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Batch ID-card PDF prints (CR80) | ✅ | generation + storage e2e-tested |
| In-browser photo/document upload, print preview | ⏳ | pending click-through (see TODOs) |

## Remaining TODOs
- [ ] In-browser click-through: student photo/document upload, ID-card print preview.

## Links to Related Modules
- Depends on: Modules 06, 07.
- Unlocks / hooks completed for: Module 10 (conversion reuses `StudentsService.create`), Module 11 (enrollment), Module 16 (dues hard-block slot).
- `PROJECT_CONTEXT.md` sections updated: §5, §8, §9, §16, §18.
