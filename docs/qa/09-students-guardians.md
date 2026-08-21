# QA — Module 09: Student & Guardian Management

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc
[`docs/modules/09-students-guardians.md`](../modules/09-students-guardians.md).

Run 2026-08-19 as `admin@qa.hexschool.local`, with the permission boundary driven as
`admissions@qa.hexschool.local`.

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M09-01 | List renders the seeded cohort | ✅ | 12 rows; UID, name, class, gender, DOB — `01/01/2014`, correctly localised (the F9 column) |
| M09-02 | **Photo upload** *(owed click-through)* | ✅ | Toast "Photo updated"; `<img>` resolves to a school-scoped MinIO key and loads at 512×512, HTTP 200 `image/png` — not just a URL that renders broken |
| M09-03 | **Document upload with a Bangla title** *(owed click-through)* | ✅ | Pick-file-then-describe dialog; `জন্ম নিবন্ধন সনদ` round-trips to the table; row reads `1 KB · 19/08/2026` |
| M09-04 | Uploaded document is actually retrievable | ✅ | "View" href → MinIO, HTTP 200, `application/pdf`, **555 bytes** — byte-identical to the fixture |
| M09-05 | Empty state before any upload | ✅ | "No documents uploaded yet (birth certificate, transfer certificate, previous marksheet…)" |
| M09-06 | **ID card PDF** *(owed click-through)* | ✅ | Downloads `id-card-QA-2026-0001.pdf`, 13 KB, `%PDF-1.3`. Content decoded — see below |
| M09-07 | Medical tab hidden without the permission | ✅ | As Admission Officer the Medical tab, Delete and Change status are all absent; ID card remains |
| M09-08 | …and the API refuses it too | ✅ | `GET`/`PUT /students/:id/medical` → **403** with the standard envelope; `DELETE /students/:id` → 403 |
| M09-09 | **XLSX import — template** *(owed click-through)* | ✅ | 19 columns, sample row already in Bangla (`রহিম উদ্দিন`) |
| M09-10 | **Import dry run reports per row** | ✅ | Total 4 / Valid 2 / Errors 2, numbered by *spreadsheet* row (2–5). Row 4 lists **both** its faults, not just the first |
| M09-11 | **Dry run leaves no trace** | ✅ | `students=12`, `guardians=11` — unchanged after validating |
| M09-12 | **Commit imports only the valid rows** | ✅ | `HEX-202600002`, `HEX-202600003`; the two bad rows stay errors. Partial commit is the design |
| M09-13 | **Siblings sharing a phone collapse to one guardian** | ✅ | Two students, **one** `guardians` row for `01811110001`, each primary for their own child |
| M09-14 | Bangla survives XLSX → DB | ✅ | `ইমরান চৌধুরী` / `ইশরাত চৌধুরী` / `মোঃ সেলিম চৌধুরী` intact in Postgres |

**Closes this module's owed click-through** — *"In-browser upload / ID-card print
click-throughs"* — for photos, documents and the ID card alike.

## What the ID card actually says

The click-through is only worth something if the *artifact* is checked, not the fact that
a file arrived. Decoding the content stream (the text is hex-encoded against subset
fonts, so it is invisible to a plain string search):

```
HexSchool · STUDENT IDENTITY CARD
Ayesha Rahman
ID            QA-2026-0001
Class         QA Class 6
Date of Birth 01/01/2014
Blood Group
Guardian      QA Parent Guardian
If found, please return to the school office.
images drawn: I1 (logo) · I2 (photo) · I3 (QR)
```

Three images composite correctly, and the photo is the one uploaded in M09-02 — so the
upload and the print path agree about the storage key.

The date of birth read **`2014-01-01`** on the first run. That is finding
[**F24**](./FINDINGS.md), fixed here and re-verified against a freshly generated card.

**One cosmetic observation, not filed:** `Blood Group` prints its label with an empty
value when the student has none. On a card that gets laminated, an omitted row or an
em dash would read better. Left alone because it is a layout preference, not a defect.

## What this pass found

Three findings, and the first one is the interesting one:

- [**F24**](./FINDINGS.md) — raw ISO dates interpolated into prose, in 14 places
  including onto the printed ID card. This is **F9 for the third time**; it recurred
  because the F18 source guard only knew about `toLocaleDateString()`, a call these sites
  never make. Both source guards were widened rather than just the sites fixed.
- [**F25**](./FINDINGS.md) — found *because of* F24: an admission cycle's window was
  stored as a UTC day, so it closed six hours late in Dhaka. Formatting the date
  correctly is what made the off-by-one visible.
- [**F26**](./FINDINGS.md) — found by counting rows after the import: the QA seed leaked
  a **guardian** per application-created record, because the F23 fix converted the
  student purge and left the guardian one matching a name prefix.

## Not run here

- **Duplicate-warning probe on the 6-step wizard** — the warn-only detector is e2e-covered
  and journey **J1** exercised the wizard's create path end to end. Worth a browser pass
  when M09 gets a scenario spec of its own.
- **Guardian primary/unlink invariants** — enforced by a partial unique index and covered
  by e2e (409 on unlinking a primary, 400 on a direct demote). The browser surface is a
  confirm dialog over the same endpoint.
- **`rotate-qr` invalidating a printed card** — needs a scanner to be meaningful, and the
  M12 QR check-in pass is where that belongs.
