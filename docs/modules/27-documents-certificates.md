# Module 27 — Document Management & Certificates · Completion Document

| | |
|---|---|
| **Module** | 27 — Document Management & Certificates |
| **Completion date** | 2026-08-06 |
| **Actual effort** | 1 dev-day (est. was 5) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 27 |

## Summary of Implemented Features

The school's paperwork: the layouts a certificate is printed from, the
register of every one ever issued, the public page anybody can check one
on, and the filing cabinet for everything else.

**The module turns on one fact, and almost everything follows: an issued
certificate is a physical object in somebody else's possession.** Nothing
in this module edits one. Its number, its verification code, the data it
prints and the markup it was rendered through are written in a single
transaction and never touched again — so a wrong name is a *revoke plus a
correction*, a lost original is a *duplicate*, and both stay in the
register, linked. That is the M15 re-issue rule and the M20 reversal rule
arriving in a third ledger, and it is why `data_snapshot` and `body_html`
are frozen onto the row rather than joined at read time: re-printing a
2024 testimonial in 2027 has to produce the same page after the template
was redesigned and the student's name was corrected.

Delivered:

- **Certificate templates** — HTML body with a variable palette, an
  optional stationery scan, a signatory block, and a live preview that
  renders against a real student or a specimen.
- **Issuance** — draft or issue-in-one-step, per-type/per-year gap-free
  numbering, a random Crockford-Base32 verification code, a QR-carrying A4
  PDF, and roadmap §4's TC rule (issuing a transfer certificate marks the
  student TRANSFERRED, behind an explicit confirm flag).
- **The aggregated clearance check** — the thing three earlier modules
  have been pointing at since M16. Fee dues, library loans and fines, and
  a hostel bed still held arrive as **one verdict**.
- **Revoke, duplicate and correct** — each producing a new record rather
  than changing one.
- **Roadmap §8's legacy backfill** — a pre-system certificate entered with
  its own number, behind its own permission.
- **The bulk prize wizard** — top-N-per-class from an exam, cutting on
  *position* rather than count.
- **Public verification** — `GET /public/verify/certificate`, replacing
  the `{ available: false }` stub M19 shipped, plus the polished page.
- **The archive** — a folder tree, tagged files, tag search over a GIN
  index, and a polymorphic optional link to a student, teacher, staff
  member or certificate.
- **The portal panel** — "my certificates", student and parent.

### Decisions worth recording

**A certificate keys on `student_id`, not `enrollment_id`.** This is the
one deliberate exception to the spine PROJECT_CONTEXT §8 sets out, and the
reason is that a certificate is about a *person and their whole time at
the school* rather than about one year of it. `enrollment_id` and
`session_id` sit beside it as *where the snapshot was taken from*, which
is what the register filters and reports on.

**The clearance gate applies to the TC and, by default, only the TC**
(`documents.clearance_required_types`). A transfer certificate is the
document that ends the relationship and the last moment the school has any
leverage to get its textbooks and its fees back. A character certificate
is a reference; refusing to say a child is of good character because their
family owes two months' tuition is a different, meaner act, and a system
that made it the default would be deciding something that is not the
system's to decide. An ungated type still **reports** what is owed — the
office sees it on the panel where it does not stop them.

**A source that could not be read never reports the student as clear.**
This was found while writing the service and is the module's sharpest
defect-in-waiting: a failed read returns no amount and no items, which is
indistinguishable from "nothing owed" — so a library that is down would
have read as a student who had returned every book, and the verdict would
have said CLEARED. `ClearanceSourceInput.incomplete` makes the difference
explicit; it warns loudly and sets `complete: false` rather than refusing,
because a school must still be able to issue a character certificate while
another module is misbehaving (the M25 "nothing in the fee source ever
throws" rule, one level up).

**`certificate_no` is unique ignoring `deleted_at`.** The M07 employee-ID
/ M09 student-UID / M23 accession / M24 asset-tag rule, and the strongest
case of it in the codebase: this number is printed on a document that has
left the building and may be quoted back at the school by a university, an
employer or a court ten years from now.

**A DUPLICATE and a CORRECTION have opposite preconditions**, which is
exactly why they are different enum values rather than one "reissue" flag.
A duplicate reprints a certificate that is *still valid* (the family lost
their copy); a correction replaces one that is *not* (it was revoked).
Getting either backwards produces two documents that both verify VALID and
say different things — the failure the verification page exists to prevent.

**REVOKED is not NOT_FOUND on the public page.** Saying "no such
certificate" about a revoked one would make a forger's document and a
genuinely cancelled one look identical to whoever is checking, and the
school's own reason is the useful half of the answer. A DRAFT, by
contrast, *is* NOT_FOUND — the M15 public-result-search / M19 draft-preview
rule that a public endpoint never confirms what it cannot show.

**The verification code is Crockford Base32, and the fold is the point.**
`I`, `L`, `O` and `U` are absent and the first three fold onto `1`, `1`
and `0` when somebody types what they read off a laser print. A
verification page that answers "not found" to a correctly-read certificate
is worse than having no verification page — it tells the holder of a
genuine document that it is a forgery. 32 divides 256 exactly, so the
modulo is unbiased and rejection sampling would add a loop with nothing to
test.

**The prize wizard cuts on position, not on count.** M15 ranks 1, 2, 2, 4;
"top 3" with a shared second place is four students, and truncating the
list at three would hand one of two tied children a prize on no basis
anybody could explain to their parents. The wizard reports the difference
and always previews first — a run that raised two hundred certificates
before showing anybody the list would be corrected by *revoking* two
hundred certificates, each a permanent register row with a number that can
never be reused.

**The PDF body is rendered as text, not as laid-out HTML.** pdfkit has no
HTML engine, and the honest options were a headless-browser dependency (a
Chromium per print, on a school's VPS) or a converter that silently drops
half of what an editor wrote. M19's own `htmlToText` gives a faithful,
predictable page — paragraphs survive, tables and floats do not — and the
limitation is stated on the screen where a template is written rather than
discovered on a printed certificate. The same trade M09 made for ID cards.

**The background and signatories are read LIVE; the body is frozen.** A
school that rescans its letterhead at a higher resolution, or whose head
changes, wants the new stationery and the new signature on the next
re-print. The *wording* is the promise; the paper it is printed on is not.

**The archive soft-deletes and keeps the S3 object** — the opposite of
M07/M09's document tables, which hard-delete the object with the row.
Those are a person's paperwork and a deletion means "wrong file"; an
archive is the school's record, `archive.delete` is a permission the
office does not hold, and a restore has to be possible from the row alone.

## Database Changes

Migration `20260806120000_documents_certificates`.

**4 enums:** `certificate_type_enum` (TRANSFER, CHARACTER, TESTIMONIAL,
PRIZE, PARTICIPATION, CUSTOM), `certificate_status_enum` (DRAFT, ISSUED,
REVOKED), `certificate_issue_kind_enum` (ORIGINAL, DUPLICATE, CORRECTION),
`archive_link_type_enum` (STUDENT, TEACHER, STAFF, CERTIFICATE). Plus
`settings_group_enum += 'documents'`.

**4 tables:**

| Table | Notes |
|---|---|
| `certificate_templates` | body HTML, stationery scan, signatories JSONB, `is_active` |
| `certificates` | the register; `data_snapshot` + `body_html` frozen at issue, self-FK for the re-issue chain, clearance snapshot and waiver |
| `archive_folders` | self-referencing tree |
| `archive_files` | `tags TEXT[]` with a GIN index, optional FK-less link |

**Hand-written indexes** (partial or expression-based, so migration-only —
the M24 rule):

- `uq_certificate_templates_name` — per school, per **type**, live rows,
  case- and space-insensitive.
- `uq_certificates_no` — **ignores `deleted_at`**; tolerates the NULL a
  draft carries.
- `uq_certificates_verify_code` — globally scoped, because the public
  endpoint is reached without a school context; also ignores `deleted_at`.
- `uq_archive_folders_identity` — COALESCE over the nullable parent (the
  M06 `uq_sections_identity` trick), so two root folders cannot share a
  name.

**Plain indexes** are declared in `schema.prisma` as well as the
migration, including the GIN index on `tags` — the M24 rule that only an
index Prisma *cannot* express is migration-only.

**5 CHECK constraints:**

- `chk_certificate_templates_shape` — non-blank name and body, signatories
  is a JSON array.
- `chk_certificates_status_evidence` — an ISSUED row carries a number, a
  code, a date and a non-empty snapshot; a DRAFT carries none of the first
  three; a REVOKED one carries a date and a reason.
- `chk_certificates_issue_kind` — `(kind = ORIGINAL) = (original IS NULL)`,
  and no row points at itself.
- `chk_certificates_provenance` — a legacy row has no template and is
  never a DRAFT; a waiver carries a note.
- `chk_archive_folders_shape` / `chk_archive_files_link` — non-blank
  names, no one-step parent cycle, both link columns set or neither, and a
  non-zero file size.

## API Endpoints Added

```
GET    /api/v1/certificate-templates/variables
CRUD   /api/v1/certificate-templates
POST   /api/v1/certificate-templates/preview
POST   /api/v1/certificate-templates/:id/preview

GET    /api/v1/certificates                       (the register)
GET    /api/v1/certificates/:id
GET    /api/v1/certificates/:id/pdf
GET    /api/v1/certificates/clearance?studentId&type
POST   /api/v1/certificates                       (draft, or issue in one step)
POST   /api/v1/certificates/:id/issue
POST   /api/v1/certificates/:id/reissue           (DUPLICATE | CORRECTION)
POST   /api/v1/certificates/:id/revoke
POST   /api/v1/certificates/legacy
POST   /api/v1/certificates/bulk-prize
DELETE /api/v1/certificates/:id                   (drafts only)

GET    /api/v1/certificates/reports/register  (+ /export, /pdf)
GET    /api/v1/certificates/reports/summary   (+ /export)

CRUD   /api/v1/archive/folders
CRUD   /api/v1/archive/files  (+ /:id/download, GET /archive/tags)

GET    /api/v1/public/verify/certificate?code=    @Public — M19 stub replaced
GET    /api/v1/portal/certificates
GET    /api/v1/portal/parent/child/:childId/certificates
```

## Frontend Pages Created

- `/admin/certificates` — five tabs (Register, Issue, Templates, Archive,
  Reports) with a "drafts not yet issued" header badge.
- `/verify/certificate` — the public page, now real. A scanned QR arrives
  with `?code=` and the lookup runs on arrival.
- `/portal` — a "Certificates" panel, student and parent.

## Components Created (new shared/reusable only)

None. The workspace is built from the existing shared components
(`PageHeader`, `Can`, `EmptyState`, `ErrorState`, `LoadingBlock`, dialogs).

## Business Rules Implemented

- Certificate numbers are **sequential per type, per year, and never
  reused**; the number is claimed inside the issuing transaction, so a
  rolled-back issue returns it.
- Data is **immutable post-issue**. A correction is a revoke plus a new
  certificate; a duplicate is a new certificate referencing the original.
- **A TC requires full clearance**, overridable with a mandatory reason by
  `certificate.clearance.override` and recorded against a name. A waiver
  is *not* recorded where none was needed.
- Issuing a TC marks the student **TRANSFERRED** when
  `documents.tc_sets_transferred` is on and the caller confirms; the
  status change is attempted after the certificate commits, and its
  failure is a warning rather than a rollback.
- **Only ISSUED certificates verify VALID.** Drafts are invisible
  publicly; revoked ones report REVOKED with the school's reason.
- Template variables must exist in the palette — refused on save, not
  silently blanked.
- Author markup is **sanitized on write** through M19's allow-list.
- A folder cannot be deleted while anything is in it; a folder cannot be
  moved inside its own subtree.
- **The Office Staff issues certificates and may neither revoke one,
  waive clearance, backfill the register, nor delete from the archive** —
  the M16/M20/M21/M23/M24/M25/M26 separation of duties, continued into the
  counter.

## Known Limitations

- **The PDF renders the body as text, not as laid-out HTML** (see the
  decision above). Tables, columns and floats in a template do not survive
  to the printed page; paragraphs and line breaks do.
- The certificate PDF **cannot set Bangla** — the M09 pdfkit-font
  limitation, carried by every PDF in the system since.
- A **legacy backfill has no stored layout**, so it cannot be re-printed
  from here. It has a verify code and a register entry, which is what it
  was entered for.
- `background_url` and a signatory's `image_url` are **pasted references**
  — the media-library gap M19/M20/M21/M23/M25/M26 all carry.
- The template editor is an **HTML textarea with a preview pane**, not a
  WYSIWYG — the same gap M19, M20 and M22 carry.
- The **register and archive tables are not virtualized**.
- The M20 ledger is **not touched**: a certificate fee is not a thing this
  module charges for, so there is no posting path. A school that charges
  for a TC raises an ad-hoc M16 invoice.

## Future Improvements

- A real HTML layout engine for the PDF (a headless browser in a worker,
  or a template DSL that maps to pdfkit primitives).
- Bulk issue beyond prizes — a whole graduating class's testimonials.
- Certificate fees, if a school wants them billed rather than collected at
  the counter.
- Reading history / analytics on the register for M29.

## Breaking Changes

**`GET /api/v1/public/verify/certificate` changed shape.** It answered
`{ available: false, code, reason }` from M19 and now answers
`{ available: true, code, outcome, message, certificate? }`. Any caller
that branched on `available === false` to show a placeholder must be
updated; the frontend page and the M19 e2e assertion were updated here.

## Migration Steps

1. `npx prisma migrate deploy` — adds four tables, four enums and the
   `documents` settings group.
2. `npx prisma db seed` — syncs the 11 new permission codes into
   `permissions` (261 total), refreshes the system-role baselines, and
   seeds the two new notification templates.
3. Optionally set `documents.verify_url_base`; it falls back to
   `website.site_url`, which most schools have already configured.
4. Create at least one template per certificate type the school issues.
   Issuing works without one — it prints a plain wording.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| `SHADOW_DATABASE_URL` | New (dev/CI only, optional) | Required by `prisma migrate diff --from-migrations`, the zero-drift check. `prisma.config.ts` spreads it in **only when set**, so ordinary CLI calls are unaffected. |

No application environment variables were added — every knob is a
`documents.*` settings key.

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (backend) | ✅ clean | |
| `npx tsc --noEmit` (frontend) | ✅ clean | |
| `npx jest` (backend unit) | ✅ **2116 / 140 suites** | from 1960 / 137 (**+156**) |
| e2e full suite | ✅ **913 / 913, 27 suites** | from 844 / 26 (**+69, +1 suite**) |
| `certificate.e2e-spec.ts` re-run | ✅ 69 / 69 twice | the M26 "passes exactly once" check |
| `npx vitest run` (frontend) | ✅ **560 / 560** | from 524 (**+36**) |
| `npx eslint` (new paths) | ✅ clean | both repos |
| `npx next build` | ✅ compiles | emits `/admin/certificates` and `ƒ /verify/certificate` |
| Migration replay onto empty PG 16 | ✅ 28 migrations applied | `smis_verify` database |
| `prisma migrate diff` (local) | ✅ **No difference detected** | |
| Constraint probes | ✅ **20 / 20 rejected**, 3 / 3 legal cases accepted | each CHECK, unique and FK probed individually |
| Migration applied to Neon | ✅ | `migrate diff` → **No difference detected** |
| Neon seed | ✅ | 261 permission codes, 4 templates created |
| In-browser click-throughs | ⏳ pending | see Remaining TODOs |

### What the verification found

1. **A source that fails is indistinguishable from a source that says
   "nothing owed"** — caught while writing `ClearanceService`, before the
   e2e suite existed. Both return no amount and no items, so a library
   that was down would have produced `cleared: true` and let a transfer
   certificate out over an unreturned textbook with nobody told. The
   engine gained an explicit `incomplete` flag and a `complete` field on
   the verdict; five engine tests and four service tests pin it.

2. **`@IsArray()` alone 400s on `?tags=board`** — found by the e2e suite.
   A single query parameter is a *string*, and the bracket form that would
   parse as an array depends on the Express query-parser mode, which is
   not something a caller can see. The DTO now normalizes all three shapes
   a client will plausibly send (one value, a comma-separated list, a
   repeated parameter) at the point where the ambiguity actually is.

3. **`String(unknown)` prints `[object Object]`** — caught by
   `@typescript-eslint/no-base-to-string` on the snapshot builder's `text`
   helper. On a certificate that string would have been **frozen there
   forever**. It now coerces only scalars, matching M17's `template.engine`
   `coerce`, and a non-scalar renders blank where `missingFields` reports
   it on the review step.

4. **`eslint --fix` removed every `as CertificateTypeCode` assertion as
   unnecessary** — the M24/M26 lesson arriving as a confirmation rather
   than a defect: the hand-written unions in `calc/types.ts` match the PG
   enums exactly.

5. **The default register window is twelve months, so a 2011 legacy
   backfill is correctly outside it.** The first draft of the e2e
   assertion did not know that and read as a bug; it is the design (a
   register is a window), and the test now widens the window explicitly.

## Remaining TODOs

- [ ] In-browser click-throughs: the template designer's preview pane, the
      issue wizard's clearance panel on a phone, an A4 print of a
      certificate with a real stationery scan behind it, the archive tree
      on a narrow screen, and a QR scanned off a printed page into
      `/verify/certificate`.
- [ ] Roadmap §9's manual item: **print fidelity on A4 with a background**.
- [ ] A media library so `background_url` and signature images stop being
      pasted references (shared with M19/M20/M21/M23/M25/M26).

## Links to Related Modules

- **Depends on:** Module 09 (the person being certified, and the status
  machine the TC drives), Module 15 (the GPA and merit position a
  testimonial quotes, and the merit list the prize wizard reads), Module 16
  (`LedgerService.outstandingFor` — the single dues source), Module 19 (the
  public site the verification page lives on). Also Module 11
  (enrollments), Module 12 (the attendance percentage), Module 07's
  `SequenceService`, Module 17's `NotificationService`.
- **Hooks completed for earlier modules:**
  - **M19's `GET /public/verify/certificate` stub is replaced** —
    `CertificateVerifierService` is bound inside `WebsiteModule` behind
    `CERTIFICATE_VERIFIER`, exactly as M19's own module doc predicted.
  - **M16/M23/M26's clearance aggregate exists** — `LedgerService`,
    `LibraryClearanceService.clearanceForPerson` and the new
    `HostelClearanceService.clearanceForStudent` fold into one verdict.
- **Leaves no no-op hooks.**
- **For M28:** the archive's `(linked_type, linked_id)` shape is the
  template for attaching a document to a complaint or a visitor pass.
- **For M29:** issuance-rate analytics and the register as a dated series.
- `PROJECT_CONTEXT.md` sections updated: §3 (numbering), §5 (shared
  services), §8 (entity spine), §11 (global business rules), §16
  (decisions).

### Graph note

`DocumentModule` is a **near-leaf**, like `PortalModule` (M18) and
`WebsiteModule` (M19), and that is what licenses its ten imports: nothing
imports it except the leaf `PortalModule`, so the graph stays acyclic.

What it deliberately does **not** import is `LibraryModule` or
`HostelModule`. Each owns one third of the clearance aggregate and each
exposes it through a service that depends on **PrismaService alone**, so
both are provided a second time inside `DocumentModule` — the M13
`RoutineConflictChecker` / M23 `LIBRARY_CLEARANCE` shape. Importing either
would drag Accounting, Fee, Communication and Enrollment in behind it and
would overstate what M27 depends on, which is those two modules'
**answers**, not library circulation or hostel management. `M26` gained
`HostelClearanceService` for exactly this, mirroring M23's shape down to
the result type.

The outbound edge is the same trick in reverse: `WebsiteModule` provides
`CertificateVerifierService` (PrismaService only) behind
`CERTIFICATE_VERIFIER` rather than importing `DocumentModule`, which would
pull this whole graph into the public site's and reverse an edge
`PortalModule` already relies on.
