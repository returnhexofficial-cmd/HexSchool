# QA — Module 01: Project Setup & Core Infrastructure

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/01-project-setup.md`](../modules/01-project-setup.md).

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M01-01 | `GET /api/v1/health` → 200, all four indicators up | ✅ | `{"status":"ok"}` with `database`, `redis`, `memory_heap`, `memory_rss` all `up` |
| M01-02 | `GET /api/v1/version` → enveloped git/build metadata | ✅ | `{"success":true,"data":{"sha":"dev","buildTime":"…","env":"development"}}` |
| M01-03 | Unknown API route → standard error envelope | ✅ | 404 + `{"success":false,"error":{"code":"NOT_FOUND","message":"Cannot GET /api/v1/does-not-exist"}}` |
| M01-04 | Swagger live at `/api/docs` | ✅ | Swagger UI renders, **946 operations**, 40+ tags (`health` … `marks`) |
| M01-05 | Public home renders with nav | ✅ | Title `HexSchool · HexSchool SMIS`; nav → `/notices /news /teachers /gallery /admission /results /contact /login` |
| M01-06 | `/maintenance` page | ✅ | "We'll be right back … undergoing scheduled maintenance" |
| M01-07 | Unknown frontend route → 404 boundary | ✅ | 404 status + "We could not find that page" (public `not-found.tsx`) |
| M01-08 | Theme tokens + Bangla-friendly font stack | ✅ | `Inter, "Inter Fallback", "Noto Sans Bengali", …` on `<body>` |
| M01-09 | Console clean on boot | ✅ | Only React DevTools notice + HMR log; no errors |
| M01-10 | Bull Board `/admin/queues` basic auth | ⬜ not run | Backend-side surface; not exercised this round |

**Degraded-health edge case incidentally confirmed:** with Redis stopped,
`/health` returned **503** with `redis: {status:"down", message:"Connection is
closed."}` while the rest of the API kept serving — exactly the documented
behaviour (roadmap M01 §8).

---
