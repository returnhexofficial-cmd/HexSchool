# QA — Module 10: Admission Management

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc [`docs/modules/10-admission.md`](../modules/10-admission.md).

Run 2026-08-18. The public wizard ran anonymously; the admin half as
`admin@qa.hexschool.local`.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M10-01 | **Public wizard, phone-OTP step** *(owed click-through)* | ✅ | 4-step wizard (Verify phone → Applicant → Guardian → Review). Code read back from the new dev SMS outbox (**F19**); "Phone verified." |
| M10-02 | Cycle and class pickers driven by the cycle's own class list | ✅ | `QA Admission 2026 (QA 2026)` auto-selected (only one open); class options carry the fee — `QA Class 6 — fee BDT 500.00` |
| M10-03 | Applicant + guardian steps accept Bangla throughout | ✅ | `তাহমিদ রহমান`, address `১২৩ গ্রীন রোড, ঢাকা`, guardian `মোঃ ফরিদ রহমান` |
| M10-04 | Review step summarises before submit | ✅ | Cycle, class, applicant, guardian, contact phone, photo state, and "BDT 500.00 (pay at the school office after submitting)" |
| M10-05 | **Submit issues an application number** | ✅ | **`ADM-26-000001`** — matches the seeded `application_no_pattern` `ADM-{YY}-{SEQ6}`. The localStorage draft is cleared on success |
| M10-06 | Public tracking by number + phone | ✅ | `/admission/track` → "Payment Pending", applicant summary, "UNPAID (fee BDT 500.00)" |
| M10-07 | Admin sees the application under its cycle | ✅ | Row: `ADM-26-000001 · Tahmid Rahman · QA Class 6 · UNPAID · Payment Pending` |
| M10-08 | Row actions are **payment-gated** | ✅ | While UNPAID the only actions are Record payment / Waive fee / Mark Cancelled — no admit path is offered |
| M10-09 | Record payment advances the state | ✅ | Toast "Payment recorded."; row → `PAID · Submitted` |
| M10-10 | Status machine offers only legal transitions | ✅ | Submitted → {Under Review, Rejected, Cancelled}; Under Review → {Rejected, Cancelled} — selection is **not** a row action, it comes from the merit list |
| M10-11 | Closing the cycle warns what it will do | ✅ | "Unpaid PAYMENT_PENDING applications are cancelled (SMS queued). Merit lists are generated after closing." → "Cycle is now CLOSED." |
| M10-12 | Merit list explains its own preconditions | ✅ | Before closing: "No merit list yet — close the cycle, lock test marks, then generate." After: "Merit list generated: 1 selected, 0 waitlisted (SMS queued)" with a confirmation deadline |
| M10-13 | **Admit creates the student** | ✅ | See journey **J1** below — this is the seam `MODULE_DEPENDENCIES.md` flags as riskiest |
| M10-14 | Every transition queues an SMS | ✅ | The dev outbox captured the full trail to `01766554433`: submitted → under review → SELECTED → "Admission confirmed. Welcome to the school!" |

**Closes this module's owed click-through.** It had been deferred with "once SMS
delivery is real (M17)"; the real blocker was narrower — no way to *read* a sent
message — and is now solved by the dev outbox (**F19**) without needing a live gateway.

## Findings

- **F19** — SMS-gated flows were untestable. Fixed with a dev-only outbox.
- **F20** — the QA seed had no admission cycle.
- **F21** — a saved draft outliving its cycle dead-ended the wizard. **Product defect, fixed.**
- **F22** — the QA seed's cycle had no classes.

## Observations

- The review step and the merit list render dates as `2014-03-15` / `2026-08-25` —
  ISO rather than the DD/MM/YYYY the Global Conventions require. Not the **F18** call
  shape (these are raw values, not `toLocaleDateString()`), so the source guard does not
  catch them. Worth a follow-up sweep for raw date *values* rendered directly.
- Requesting several OTPs for one number exhausts its attempt/resend allowance and the
  step silently stops advancing. Expected throttling, not a defect — **use a fresh phone
  number per wizard run**.
