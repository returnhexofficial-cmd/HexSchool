# Module 04 — School Setup & Settings · Completion Document

| | |
|---|---|
| **Module** | 04 — School Setup & Settings |
| **Completion date** | 2026-07-16 |
| **Actual effort** | 1 dev-day (est. was 3) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 04 |

## Summary of Implemented Features

**Backend (`hexschool-backend`)**
- **`schools` table is live** and the two deferred FKs finally exist: the migration inserts the bootstrap school row with the fixed `DEFAULT_SCHOOL_ID` (`00000000-0000-4000-8000-000000000001`, name "HexSchool", code `HEX`) **before** adding `fk_users_school` / `fk_roles_school`, so every M02/M03 row keeps its scope with zero data migration.
- **Settings registry as code** (`src/modules/school/settings/settings.registry.ts`, mirroring the M03 permission-registry pattern): every configurable key declares its group, type, default, and secrecy. 8 groups seeded with starter keys (`general|academic|sms|email|payment|attendance|exam|fees`); later modules extend their group with **no migration** (storage is generic key/JSONB rows).
- **`SettingsService`** (exported for DI — the service every later module consumes): typed `getValue<T>()` with registry defaults, per-group reads cached in Redis (60 s TTL + bust-on-every-write), registry validation on writes (unknown keys/type mismatches → 400), **AES-256-GCM encryption at rest** for secret keys (`SettingsCryptoService`, `iv.tag.cipher` base64url envelope, key = `SETTINGS_ENCRYPTION_KEY`). API reads mask secrets as `__SECRET__`; PUTting the mask back keeps the stored value (forms round-trip untouched). Audit diffs redact secrets on both sides.
- **`RedisCacheService`** (`src/database/redis`, global module): generic best-effort JSON cache — Redis down degrades every call to a miss/no-op (same containment pattern as the M03 permission cache).
- **School profile**: `GET /school` (auth-only — identity data for headers/portals, returns a fresh signed logo URL), `PUT /school` (`school.update`, partial update, audited with real old/new diffs), `POST /school/logo` (multipart; JPEG/PNG/WebP ≤2 MB; **sharp** resizes to ≤512px PNG, stripping EXIF; stored via StorageModule under the `branding` purpose; the stable S3 key is persisted and URLs are signed on read).
- **Grading systems**: full CRUD with the pure validator pair `findOverlapIssues`/`findCoverageIssues` (dependency-free, golden-tested against the NCTB scale) — overlap-free bands on every save, full 0–100 coverage required to become default, exactly one default per school (transactional demote/promote + hand-written partial unique index), default not deletable, default not directly demotable. Bands replaced wholesale in one transaction.
- **Test endpoints**: `POST /settings/test-email` builds a nodemailer transport from the **saved** (decrypted) settings and surfaces the provider error verbatim; `POST /settings/test-sms` is log-only until Module 17. Both `settings.test`-guarded.
- **Seeds**: NCTB Standard grading system (A+ 80–100/5.00 … F 0–32/0.00) as default, idempotent. Permission registry grew 8 codes (`school.update`, `settings.view|update|test`, `grading.view|create|update|delete`); Principal/Vice-Principal/Teacher core sets extended (extend-only re-run granted them automatically).

**Frontend (`hexschool-frontend`)**
- **Settings area** `/admin/settings` — route-based tab strip (School Profile / Academic / Grading Systems / SMS Gateway / Email / Payment Gateways / General), each tab a real URL.
- **Profile tab**: full RHF+Zod form (EIIN 6-digit, uppercase short code, website-with-protocol, year bounds), school-type select, logo card with preview + upload (client-side 2 MB pre-check).
- **Generic group form** (`[group]/page.tsx`): renders inputs from the API's registry metadata (string/number/boolean/json), **secret fields masked with a reveal toggle** and a "saved — leave untouched to keep" hint, **Send test SMS/email** buttons with result toasts, all gated by `<Can>`.
- **Grading editor**: card per system with inline-editable grade rows (add/remove), **live overlap errors (blocking) and coverage warnings** (block "make default" only) via a client-side mirror of the backend validator, make-default and guarded delete.
- Admin sidebar header now shows the school name + logo (signed URL) from `GET /school`.

## Database Changes
- Prisma migration `prisma/migrations/20260716022303_school_setup_settings/migration.sql`:
  - Enums `school_type_enum`, `school_status_enum`, `settings_group_enum`.
  - Tables `schools`, `school_settings` (`uq(school_id, key)`), `grading_systems`, `grade_points` (`uq(system, grade)`).
  - **Hand-written:** bootstrap school INSERT (before the FKs — see above), `fk_users_school`, `fk_roles_school`, partial unique `uq_schools_code` (soft-delete-aware), CHECK `chk_schools_eiin` (6 digits), partial unique `uq_grading_systems_default` (one default per school), CHECK `chk_grade_points_range` (0 ≤ min ≤ max ≤ 100).

## API Endpoints Added
```
GET  /api/v1/school                      auth-only (identity + signed logo URL)
PUT  /api/v1/school                      school.update
POST /api/v1/school/logo                 school.update (multipart, ≤2 MB, → 512px PNG)
GET  /api/v1/settings/:group             settings.view (defaults merged, secrets masked)
PUT  /api/v1/settings/:group             settings.update (registry-validated; __SECRET__ keeps stored)
POST /api/v1/settings/test-email         settings.test (uses SAVED config)
POST /api/v1/settings/test-sms           settings.test (log-only until M17)
GET/POST        /api/v1/grading-systems  grading.view / grading.create
PUT/DELETE      /api/v1/grading-systems/:id  grading.update / grading.delete
```

## Frontend Pages Created
- `/admin/settings` (redirect → profile), `/admin/settings/profile`, `/admin/settings/grading`, `/admin/settings/[group]` for `general|academic|sms|email|payment|attendance|exam|fees`.

## Components Created (new shared/reusable only)
- `RedisCacheService` (backend, global), `SettingsCryptoService`, grade-range validator pair (backend + frontend mirror in `src/lib/utils/grade-ranges.ts`), `schoolApi` client, school Zod schemas. (Secret-reveal input and the settings group form live in the settings route; extract if a second consumer appears.)

## Business Rules Implemented
- Exactly one default grading system per school (service transaction + DB partial unique index).
- Ranges must cover 0–100 with no gaps/overlaps before a system may become default; overlap-free is required for ANY save.
- The default system cannot be deleted or directly demoted — promote another system instead.
- Secrets never leave the API in plaintext; internal consumers get decrypted values via `SettingsService.getValue()` only.
- Invalid gateway credentials are saveable; test endpoints surface the provider error (roadmap M04 §8).
- Settings cache: bust on every write, 60 s TTL safety net for out-of-band edits.

## Known Limitations
- **No `verified_at` flag** on gateway config: test endpoints report success/failure but the "unverified" state isn't persisted/displayed (revisit with M16/M17 when gateways go live).
- Registry starter keys for `attendance|exam|fees` are minimal placeholders — the owning modules will extend them.
- Logo card uses plain `<img>` with the signed URL (1 h expiry) — a stale page older than an hour shows a broken logo until refetch.
- `settings_group_enum` is a PG enum: adding a NEW group needs a migration (keys within existing groups don't).
- Multi-school (M31) will need per-request school resolution; everything here already keys off `actor.schoolId`.

## Future Improvements
- Persist + display gateway verification state (`verified_at`, cleared on group update).
- Migrate the M03 `PermissionsCacheService` onto the generic `RedisCacheService` (one client instead of two).
- Image moderation/favicon variants for the logo; theme color settings (roadmap "Theme/Logo" tab currently covers logo only).

## Breaking Changes
- None for API consumers. Deployments: `users.school_id`/`roles.school_id` now have FK constraints — any environment with rows referencing a school other than `DEFAULT_SCHOOL_ID` must create that school row before migrating (dev/CI unaffected: the migration inserts the bootstrap row).
- New runtime dependency **sharp** (native binary — `npm ci` handles platform builds).

## Migration Steps
1. `cd hexschool-backend && npm ci` (installs sharp).
2. `npx prisma migrate deploy` — creates M04 tables, inserts the bootstrap school, adds the deferred FKs.
3. `npm run seed` — NCTB grading system + M04 permission codes/core grants.
4. Ensure `SETTINGS_ENCRYPTION_KEY` (exactly 32 chars) is set — it was already Joi-required since M01, now actually consumed. **Changing it orphans stored secrets** (they fail closed to defaults; re-enter them in the UI).
5. Frontend: `npm ci && npm run build` as usual.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| `SETTINGS_ENCRYPTION_KEY` | Now consumed | AES-256-GCM key for settings secrets at rest (Joi-validated since M01) |
| `S3_BUCKET_BRANDING` | New (optional) | Logo bucket; falls back to `S3_BUCKET_DEFAULT` |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Backend lint / typecheck / unit tests | ✅ | 91 tests (64 M01–03 + 27 new: crypto round-trip/tamper, overlap+coverage golden vs NCTB, settings registry validation/masking/sentinel, grading rules) |
| Backend e2e vs live DB+Redis+Mailpit | ✅ | 42 tests (15 new): profile update + audit diff, EIIN 400, settings defaults/save/mask/sentinel-keeps-ciphertext, **live test-email through saved config → Mailpit**, grading default-switch/delete guards, 403s for unprivileged users |
| Migration on dev DB (Neon) | ✅ | Bootstrap school INSERT ordered before FK adds; existing users/roles kept scope |
| Seed idempotency | ✅ | Second run: NCTB "already present", 17 registry codes stable |
| Frontend lint / typecheck / tests / build | ✅ | 46 tests (38 + 8 new: grade-range mirror, school schema); 19 routes compiled |

## Remaining TODOs
- [ ] Push both repos to GitHub and confirm CI green (M01–03 carry-over).
- [ ] In-browser click-through: upload a logo via `/admin/settings/profile` and confirm it renders in the admin sidebar header (API + resize + signed-URL layers verified individually; e2e covers the HTTP flows).

## Links to Related Modules
- Depends on: Modules 01 (StorageModule), 02 (auth/user scope), 03 (permission registry + guard + audit hooks).
- Unlocks / hooks completed for: Module 05 (weekly-holiday + session settings), 07 (school `code` in document numbers), 12/14/16 (attendance/exam/fees settings groups), 15 (grading systems consumed by results), 16/17 (gateway credentials via `SettingsService.getValue`), 31 (schools table is the tenant catalog).
- `PROJECT_CONTEXT.md` sections updated: §5, §14, §16, §18.
