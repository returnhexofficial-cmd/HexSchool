# QA — Module 13: Timetable & Routine

In-browser QA results for this module. Environment, logins and gotchas live in
[`QA_RUNBOOK.md`](../../QA_RUNBOOK.md) at the repo root; defects live in
[`FINDINGS.md`](./FINDINGS.md); harness technique lives in
[`HARNESS.md`](./HARNESS.md).

Pairs with the completion doc
[`docs/modules/13-timetable.md`](../modules/13-timetable.md).

Run 2026-08-19 as `admin@qa.hexschool.local`.

**This module's owed click-through was the whole of its UI** — *"builder grid
interactions (cell popover, copy/clear day, red-cell tooltips), publish dialog, master
heat table, and the teacher Routine tab. Everything below the API is covered by tests;
the DOM interactions are not."* Driving them found **six** defects, two of which made the
module unusable.

## Period slots (the bell schedule)

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M13-01 | Empty state names the prerequisite | ✅ | "Add the first period of the day — routines cannot be built without a bell schedule." Exactly the pattern the builder was missing (**F32**) |
| M13-02 | Shift window stated up front | ✅ | "Working window 07:30–12:30. Periods must sit inside it and may not overlap." |
| M13-03 | Create a period | ✅ | Row shows `1 · Period 1 · 07:30 · 08:15 · 45 min · Class`, duration derived |
| M13-04 | Next period pre-fills from the last end | ✅ | Opened at `08:15` after a period ending 08:15 |
| M13-05 | **Overlap refused, specifically** | ✅ blocked | `Overlaps "Period 1" (07:30–08:15)` — names the conflicting period and its times, and the dialog stays open so the input is not lost |
| M13-06 | Refusal leaves no trace | ✅ | Still exactly one row in `period_slots` |

## The routine builder

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M13-07 | New-draft dialog is dependent | ✅ | Section select disabled until a class is chosen; offers "start from the published routine" |
| M13-08 | Day axis excludes the weekly holiday | ✅ | Sat–Thu; Friday absent, from `general.weekly_holidays` |
| M13-09 | **Period rows are legible** | ✅ **after F30** | `Period 1 · 07:30–08:15`. They read `1970-01-01T07:30:00.000Z–1970-01-01T08:15:00.000Z` before |
| M13-10 | Cell editor opens with slot context | ✅ | "Sat · Period 1 (07:30–08:15)", subject / teacher / room / combined-with |
| M13-11 | Subject list is the class-subject map | ✅ | Bangla, English, Mathematics, Science |
| M13-12 | **Teacher list marks the assigned one** | ✅ **after F32** | `★ Rahim Uddin`, `Nasrin Sultana` — the ★ owner plus substitutes. The list was **empty** before |
| M13-13 | Empty teacher list explains itself | ✅ **fixed here** | "No teacher holds a subject in this session yet. Assign teachers to sections and subjects first…" |
| M13-14 | "Combined with" picker populates | ✅ **after F31** | Its query 400'd on `limit=200`, so it had never worked |
| M13-15 | Apply → cell fills, grid goes dirty | ✅ | Cell reads `Mathematics / Rahim Uddin`; "Save grid" appears |
| M13-16 | Save persists | ✅ | "Saved 1 cell(s)." |

## Conflicts

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M13-17 | Drafts do not compete | ✅ | Two drafts held the same teacher in the same slot with no conflict — `LIVE_STATUSES` is `[PUBLISHED]` by design |
| M13-18 | **Publishing a competitor turns the other red** | ✅ | Section B was **never re-saved**; publishing section A made its cell `border-destructive` on the next load — the "recomputed on read" claim, confirmed |
| M13-19 | **Red-cell tooltip explains why** | ✅ **after F34** | *"Teacher clash: Rahim Uddin is busy in QA Class 6 — A (Period 1 07:30)"* — teacher, competing section and slot. It **crashed the entire page** before |

## Publish

| ID | Scenario | Result | Evidence |
|---|---|---|---|
| M13-20 | Publish disabled on an empty grid | ✅ | Nothing to publish, button disabled |
| M13-21 | Dialog states the consequence | ✅ | "…makes this the routine everyone sees and archives the version it replaces. The old version stays readable as history." |
| M13-22 | Free periods must be acknowledged | ✅ | "Filled slots 1 / 24", "23 free period(s) will print as blank cells", and Publish stays disabled until the acknowledgement box is ticked |
| M13-23 | **Publish succeeds** | ✅ **after F33** | "Routine published — the previous version is archived."; status → Published. The default path **always failed** before |
| M13-24 | Effective date defaults to today in Dhaka | ✅ **after F29** | Pre-fills `2026-08-19`; it defaulted to the **18th** while UTC was still the 18th |

## What this pass found

Six findings, and the two most serious were both invisible to every layer below the DOM:

- [**F34**](./FINDINGS.md) — the conflict tooltip crashed the page, and *only* when a
  cell actually conflicted. The module's headline feature died at the moment it had
  something to say. Unreachable until **F32** was fixed, because producing a real
  conflict needs two sections, a shared teacher, a bell schedule and a published
  competitor.
- [**F33**](./FINDINGS.md) — publishing always failed on its own pre-filled date, and the
  field rendered blank so nobody could see why. The toast said only "Validation failed".
- [**F30**](./FINDINGS.md) — the same `@db.Time` column served two shapes from two
  endpoints, so every row of the grid was labelled with a 1970 timestamp.
- [**F31**](./FINDINGS.md) — 14 pickers across the product asked for more rows than the
  API allows and silently rendered empty, including the **promotion wizard's** target
  sections.
- [**F32**](./FINDINGS.md) — the seed could not reach the builder at all.
- [**F29**](./FINDINGS.md) — "today" computed in UTC, so for six hours every night it was
  yesterday. Found here, but it dated certificates and admissions too.

**What this says about the test pyramid.** M13 ships 92 backend unit tests and full e2e
coverage of its API, all green throughout. Every one of these six lived above that line:
in a serialisation shape, a component's context, a query parameter, a fixture, and a form
default. This is the module that most justifies the campaign.

## Deferred

- **Copy/clear day, and the `•••` per-day menu** — the grid interactions not yet driven.
  Worth a pass with a fuller routine than the two cells this round needed.
- **Master grid and the teacher-load heat table** (`/admin/timetables/master`) — needs
  several published routines to band anything meaningfully.
- **The teacher Routine tab and its print view** — belongs with the M18 portal pass,
  where the same data is read as a teacher rather than an admin.
- **The routine PDF against a Bangla subject name** — pdfkit's known Bangla limitation
  (`PROJECT_CONTEXT.md` §18); the module doc already owes this check and it is a
  documented gap rather than a defect.
- **M12 period-mode marking** — now unblocked by the seeded bell schedule and a published
  routine. It is the natural first item of the next run.
