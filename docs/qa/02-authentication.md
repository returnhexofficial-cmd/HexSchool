# QA — Module 02: Authentication

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/02-authentication.md`](../modules/02-authentication.md).

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M02-01 | `/login` renders all controls | ✅ | identifier, password, remember-me checkbox, "Forgot password?" link, Sign in |
| M02-02 | Empty submit → client validation, **no API call** | ✅ | "Enter your email or phone number" / "Enter your password"; zero `/auth/login` requests |
| M02-03 | Malformed identifier rejected client-side | ✅ | "Enter a valid email or BD phone number" |
| M02-04 | Anonymous `/admin` → login with `?next` | ✅ | `/login?next=%2Fadmin` |
| M02-05 | Anonymous `/admin/roles` → login with `?next` | ✅ | `/login?next=%2Fadmin%2Froles` |
| M02-06 | Anonymous `/account/sessions` → login with `?next` | ✅ | `/login?next=%2Faccount%2Fsessions` |
| M02-07 | Anonymous `/portal` → login with `?next` | ✅ | `/login?next=%2Fportal` |
| M02-08 | Lockout after repeated wrong passwords | ✅ | `POST /auth/login → 423 Locked`, toast **"Account temporarily locked. Try again later."** |
| M02-09 | Successful login honours `?next` | ✅ | `/login?next=%2Fadmin%2Froles` → landed `/admin/roles` |
| M02-10 | Refresh token is httpOnly (not JS-readable) | ✅ | `document.cookie` = `hs_session=SUPER_ADMIN` only; **no `hs_refresh`** |
| M02-11 | Forgot-password → generic response + OTP dispatched | ✅ | `POST /auth/forgot-password → 200`; email in Mailpit, subject "Your HexSchool verification code" |
| M02-12 | OTP page shows target + 60 s resend cooldown | ✅ | "Sent to admin@hexschool.local — valid for 5 minutes", "Resend code in 58s" |
| M02-13 | `verify-otp` issues reset token | ✅ | `POST /auth/verify-otp → 200`; `sessionStorage.hs_reset_token` set; → `/reset-password` |
| M02-14 | Reset-password policy + confirm match | ✅ | "At least 8 characters", "Passwords do not match" |
| M02-15 | Reset completes, token cleared, back to login | ✅ | `POST /auth/reset-password → 200`; sessionStorage cleared; → `/login` |
| M02-16 | Session manager lists devices + revoke controls | ✅ | "Desktop browser · This device · ::1 · signed in …", "Sign out everywhere" + per-row "Sign out" |
| M02-17 | change-password rejects wrong current password | ✅ | Toast **"Current password is incorrect"** |
| M02-18 | change-password succeeds, warns about other devices | ✅ | `POST /auth/change-password → 200`; page copy "Other devices will be signed out." |
| M02-19 | Sign out clears session + hint cookie | ✅ | → `/login`, `document.cookie` empty |
| M02-20 | Protected route after logout | ✅ | `/admin/roles` → `/login?next=%2Fadmin%2Froles` |
| M02-21 | Single-flight refresh retries a 401'd request | ✅ | `GET /roles → 401` → `POST /auth/refresh → 200` → `GET /roles → 200` |
| M02-22 | OTP attempt limit (3) / expiry rejection | ⬜ not run | Would consume the live OTP; covered by backend e2e |
| M02-23 | Two-tab concurrent refresh race | ⬜ not run | Needs a dual-tab harness; see finding **F2** |

> **Closes a documented gap.** `docs/modules/02-authentication.md` listed
> "in-browser click-through QA … full reset-password journey via Mailpit" as an
> open TODO. The whole journey (request → Mailpit email → OTP verify → reset →
> sign in with the new password) now passes in a real browser.

---
