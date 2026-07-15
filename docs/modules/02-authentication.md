# Module 02 — Authentication · Completion Document

| | |
|---|---|
| **Module** | 02 — Authentication |
| **Completion date** | 2026-07-15 |
| **Actual effort** | 1 dev-day (est. was 5) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 02 |

> **Two owner-directed stack changes landed inside this module** (both
> recorded in `PROJECT_CONTEXT.md` §16):
> 1. **ORM switched from TypeORM to Prisma 7** — TypeORM fully removed;
>    schema now lives in `prisma/schema.prisma`, migrations run via
>    `npx prisma migrate dev` / `migrate deploy`, CLI config in
>    `prisma.config.ts` (Prisma 7 style), runtime via `@prisma/adapter-pg`.
>    `BaseRepository`, the health DB probe, and the seed runner were
>    rebuilt on Prisma with the same public contracts.
> 2. **Frontend global state uses Redux Toolkit** (not Zustand as the
>    roadmap originally listed): `src/lib/store` with a per-tab store
>    (`StoreProvider`), typed hooks, and an `auth` slice.

## Summary of Implemented Features

**Backend (`hexschool-backend`)**
- `users`, `refresh_tokens`, `otp_codes`, `login_activities` tables + 4 PG enums (Prisma migration `20260714233144_authentication`, incl. hand-written partial unique indexes `uq_users_email/phone` scoped by `deleted_at IS NULL` and `chk_users_contact`).
- `AuthService`: login (argon2id verify), access JWT (15 min) + opaque rotating refresh token (SHA-256 stored; 7 d / 30 d remember-me) in an httpOnly `hs_refresh` cookie (path-scoped to `/api/v1/auth`), **rotation with reuse detection** (reuse outside a 5 s two-tab grace ⇒ whole chain + all sessions revoked + SMS alert), lockout (5 fails → 15 min, 423), logout this-device/all-devices, generic error messages (no account enumeration).
- `OtpService`: 6-digit hashed codes, 5 min TTL, 3 attempts, 60 s resend cooldown; delivery via the new `notifications` BullMQ queue (email → SMTP/Mailpit now, SMS → log until Module 17).
- `PasswordService`: argon2id hashing, complexity policy in DTOs, common-password blocklist (>1000 entries incl. BD-specific), new ≠ current.
- `TokenService`: JWT sign/verify (30 s clock tolerance), reset tokens (10 min, signed with the refresh secret) bridging verify-otp → reset-password.
- Global `JwtAuthGuard` (APP_GUARD) + `@Public()` decorator (+ `@CurrentUser()`); health/version marked public. Throttle overrides: 5/min per IP on credential routes, 30/min on refresh; throttling skipped under `NODE_ENV=test`.
- Events (`user.logged_in|login_failed|locked|token_reuse|logged_out|refreshed`, `password.changed`) → `AuthListener` writes append-only `login_activities` and enqueues lock/theft alert SMS.
- `AuthCleanupJob` (@nestjs/schedule, 03:00 daily): purges refresh tokens/OTPs older than 30 days past expiry.
- Seeder: Super Admin `admin@hexschool.local` (`SEED_SUPER_ADMIN_PASSWORD` or `ChangeMe123!`), `must_change_password=true`.

**Frontend (`hexschool-frontend`)**
- Redux Toolkit auth slice (`user`, `permissions`, `status`) + `bootstrapSession`/`logout` thunks; `AuthProvider` bootstraps the session per tab (refresh cookie → access token → `/auth/me`) and enforces the forced-password-change interstitial.
- Pages: `/login` (remember-me, `?next=` redirect, generic errors), `/forgot-password`, `/verify-otp` (60 s resend cooldown; reset token kept in sessionStorage), `/reset-password`, `/change-password` (forced + voluntary), `/account/sessions` (device list, revoke one, sign out everywhere) — all RHF + Zod (`src/lib/validations/auth.ts`).
- `src/proxy.ts` (Next 16 renamed middleware → proxy): optimistic guards for `/admin`, `/portal`, `/account` using the non-sensitive `hs_session` hint cookie (userType) set by the auth slice; redirects by user type after login (`homePathFor`).
- Access token lives in memory only; the existing single-flight axios refresh interceptor now hits the real `/auth/refresh`.
- `UserMenu` strip on the admin/portal placeholders (signed-in identity, Devices, Password, Sign out).

## Database Changes
- Prisma migration `prisma/migrations/20260714233144_authentication/migration.sql`:
  - Extensions `citext`, `pgcrypto` (moved from the removed TypeORM base migration).
  - Enums `user_type_enum`, `user_status_enum`, `otp_purpose_enum`, `login_event_enum` (incl. `TOKEN_REUSE`, an addition over the spec).
  - Tables `users` (audit + soft delete + `school_id`, **no FK to schools until Module 04**), `refresh_tokens`, `otp_codes`, `login_activities` with `fk_/uq_/idx_/chk_`-prefixed constraints.

## API Endpoints Added
```
POST   /api/v1/auth/login              @Public, 5/min
POST   /api/v1/auth/refresh            @Public, 30/min (cookie or body token)
POST   /api/v1/auth/logout
POST   /api/v1/auth/forgot-password    @Public, 5/min (never reveals existence)
POST   /api/v1/auth/verify-otp         @Public, 5/min → { resetToken }
POST   /api/v1/auth/reset-password     @Public, 5/min
POST   /api/v1/auth/change-password    5/min (revokes other sessions)
GET    /api/v1/auth/me                 → { user, permissions: [] until M03 }
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:id
```

## Frontend Pages Created
- `/login`, `/forgot-password`, `/verify-otp`, `/reset-password`, `/change-password` (in `(auth)` group with a shared centered-card layout), `/account/sessions`.

## Components Created (new shared/reusable only)
- `StoreProvider` (Redux per-tab store), `AuthProvider`, `UserMenu`.
- `useAppDispatch`/`useAppSelector`/`useAuth` typed hooks; `authApi` client; `homePathFor()`; session-hint cookie utils; auth Zod schemas.

## Business Rules Implemented
- Refresh-token reuse ⇒ theft: revoke all sessions + SMS alert (5 s grace for the two-tab race; grace re-issue does not re-chain).
- Suspended/inactive users can authenticate nothing, including refresh (checked after password verify so status is not probeable).
- Lockout 5 fails / 15 min (423); counters reset on success.
- OTP: single active code per identifier+purpose; consumed on success or 3rd failure.
- Password reset revokes every session; change-password revokes every *other* session.
- Login/refresh re-issue keeps the original session window (rotation never extends expiry).

## Known Limitations
- Permissions are `[]` until Module 03 (RBAC); `PermissionsGuard` not yet present.
- SMS is log-only (real BD gateway adapter lands in Module 17); OTP email works via SMTP/Mailpit.
- `users` uniqueness is `(school_id, email|phone)`; Module 09 will widen phone uniqueness to `(school_id, user_type, phone)` for the guardian-is-staff case (roadmap M09 note).
- `users.school_id` has no FK until Module 04 creates `schools`; seed uses the fixed `DEFAULT_SCHOOL_ID` (`00000000-0000-4000-8000-000000000001`) that Module 04 must reuse.
- Throttling disabled wholesale under `NODE_ENV=test` (e2e hammers auth routes).
- Session manager lists device info from user-agent/ip only (no geo lookup).

## Future Improvements
- Optional LOGIN_2FA flow (enum + OtpService already support it).
- Device fingerprinting beyond user-agent; session naming.
- Move rotation (issue + markReplaced) into a single DB transaction if refresh volume ever makes the two-step visible.

## Breaking Changes
- **TypeORM removed.** Any local checkout must `npm ci` (postinstall runs `prisma generate`) and use `npx prisma migrate dev` — the old `npm run migration:*` scripts are gone (`migrate:dev|deploy|status` replace them). The old `migrations` table is obsolete (dropped).
- **Every API route now requires a Bearer token** unless `@Public()` — future modules must annotate public endpoints explicitly.

## Migration Steps
1. `cd hexschool-backend && npm ci` (regenerates the Prisma client).
2. Ensure `DATABASE_URL` points at your Postgres (the team dev DB currently targets Neon; local compose postgres on 5433 also works).
3. `npx prisma migrate dev` (dev) or `npx prisma migrate deploy` (CI/prod).
4. `npm run seed` → creates the Super Admin (set `SEED_SUPER_ADMIN_PASSWORD` to avoid the default).
5. `cd hexschool-frontend && npm ci && npm run dev`; sign in at `/login`.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Now consumed | Access JWTs / refresh-adjacent tokens (reset token) |
| `SEED_SUPER_ADMIN_PASSWORD` | New (optional) | Seed password for the bootstrap Super Admin |
| `DATABASE_URL` | Behavior note | Read by `prisma.config.ts` (CLI) and PrismaService (runtime, via `@prisma/adapter-pg`) |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| Backend lint / typecheck / unit tests | ✅ | 32 tests (11 M01 + 21 new: rotation, reuse, lockout, OTP, password policy) |
| Backend e2e vs live DB+Redis | ✅ | 11 tests: login happy, identical 401s, refresh rotation, logout-all, 5×wrong→423, sessions+revoke, validation envelope |
| Live curl flow (dev server, Neon DB) | ✅ | login → me → sessions → refresh → reuse-in-grace 200 → reuse-after-grace 401 + full chain revoked |
| Seed idempotency | ✅ | Second run skips existing Super Admin |
| Frontend lint / typecheck / tests / build | ✅ | 25 tests (incl. proxy redirects, auth slice, schemas); 11 routes + proxy compiled |
| Live proxy guards (both dev servers up) | ✅ | `/admin` anon → 307 `/login?next=/admin`; ADMIN hint → 200; STUDENT hint → 307 `/portal`; `/account/sessions` anon → 307 |

## Remaining TODOs
- [ ] Push both repos to GitHub and confirm CI green (M01 carry-over; CI now runs `prisma migrate deploy`).
- [ ] In-browser click-through QA: login as seeded Super Admin → forced change-password interstitial → land on /admin; full reset-password journey via Mailpit (API + schema + redirect layers verified individually).

## Links to Related Modules
- Depends on: Module 01 (BaseRepository foundation — now Prisma-based, envelope/throttler/queue wiring, axios interceptor slot).
- Unlocks / hooks completed for: Module 03 (global guard + `@Public()` registry, `/auth/me` permissions slot, `UsersRepository` exported), Module 07 (user-creation pattern + `must_change_password` flow), Module 10 (OTP `ADMISSION` purpose), Module 17 (`notifications` queue contract).
- `PROJECT_CONTEXT.md` sections updated: §1, §4, §5, §9, §13, §14, §16, §18.
