---
name: smis-module
description: Implement the next SMIS/HexSchool roadmap module end-to-end (M16 Fees, M17 Communication, M18 Portals, …), or resume/verify one in progress. Use when asked to "complete the next module", "implement module NN", "start M16", or when a task spans backend + frontend + migration + docs for a numbered roadmap module. Owns the full workflow: read the trackers, build to the roadmap spec, test, verify the migration, write the completion doc, update the trackers.
---

# Completing an SMIS module

This repo is built module by module against `SMIS_DEVELOPMENT_ROADMAP.md`.
Fifteen of thirty-two are done. The workflow below is not a suggestion —
it is what every completed module did, and the trackers are load-bearing
for the next one.

## 1. Orient before writing anything

Read, in this order:

| File | What you need from it |
|---|---|
| `PROJECT_PROGRESS.md` | the next incomplete module, current test counts, open high-priority tasks |
| `SMIS_DEVELOPMENT_ROADMAP.md` → `# Module NN` | §1 goal, §3 DB design, §4 backend tasks + API list, §5 frontend tasks, §6 business rules, §7 validation, §8 edge cases, §9 testing, §10 completion checklist |
| `SMIS_DEVELOPMENT_ROADMAP.md` → "Global Conventions" | applies to EVERY module; never restated per module |
| `PROJECT_CONTEXT.md` | §5 shared services you must reuse, §8 entity spine, §11 global business rules, §16 decisions + rationale, §18 **open debts you may be expected to close** |
| `MODULE_DEPENDENCIES.md` | hard deps, and the "Notes" column listing hooks earlier modules left for you |
| `docs/modules/<NN-1>-*.md` | the immediately preceding module's completion doc — the closest model for tone and depth |

**The roadmap is a specification, not a wish list.** Where it conflicts
with `PROJECT_CONTEXT.md`, context wins (it records decisions that
*revised* the roadmap) — and say so explicitly in the completion doc, as
M14 did for exam sittings and M15 did for the grade-scale freeze.

## 2. Find the hooks left for you

Search before you design. Earlier modules deliberately leave typed slots:

```bash
grep -rn "Module NN\|MNN" hexschool-backend/src --include=*.ts | grep -i "await\|hook\|slot\|no-op"
grep -n "MNN" PROJECT_CONTEXT.md MODULE_DEPENDENCIES.md
```

Known live examples of the pattern:
- **DI-token gates** bound to no-ops (`EXAM_DUES_GATE` is the last one
  open — M16 binds it). See `src/modules/exam/services/exam.gates.ts`.
- **Guard slots** — a comment where a check belongs once a table exists
  (M06 subject removal, M11 rollback, M14 delete guards were all this).
- **Empty self-describing endpoints** (`{ available: false, reason }`)
  that a later module fills — M09 `attendance-history`/`performance-history`.

Closing these is part of the module, and each closed debt gets a line in
the completion doc and a strikethrough in `PROJECT_CONTEXT.md` §18.

## 3. Build order that works

1. **Schema + migration** → `smis-database` skill.
2. **Pure engines first** (`src/modules/<name>/calc/*.ts`) if the module
   has real business arithmetic — dependency-free, golden-tested, written
   before anything that could couple them to Prisma. M15's five engines
   passed 151 tests before a single service existed.
3. **Repositories** → **DTOs** → **services** → **controllers** →
   **module wiring**. See `smis-backend`.
4. **Permission codes + settings keys + role baselines** — three
   registries, all append-only, all covered by tests.
5. **Frontend** → `smis-frontend`.
6. **Tests** → `smis-testing`. Unit as you go; the e2e suite last.
7. **Verify the migration for real** → `smis-database` §verification.
8. **Docs** → `smis-docs`.

## 4. Definition of done

A module is not complete until all of this is true and *stated with
evidence* in the completion doc:

- [ ] `npx tsc --noEmit` clean in both repos
- [ ] `npx jest` (backend unit) green — report the new total and the delta
- [ ] `npx vitest run` (frontend) green — same
- [ ] **e2e suite green**, including a new `test/<module>.e2e-spec.ts`
- [ ] `npx eslint <new paths>` clean
- [ ] `npx next build` compiles and emits the new routes
- [ ] migration replays onto an **empty** database and `migrate diff`
      reports **no difference**
- [ ] migration + seed applied to the Neon dev DB
- [ ] `docs/modules/NN-name.md` written from `_TEMPLATE.md`
- [ ] `PROJECT_PROGRESS.md`, `PROJECT_CONTEXT.md`, `MODULE_DEPENDENCIES.md`
      updated; roadmap §10 checkboxes ticked

M14 shipped once with the e2e suite and migration unrun; both had to be
done later, and the e2e run then found a real bug that had been live the
whole time. Do not repeat that — **the e2e suite is where this project's
bugs are actually found.**

## 5. Do not commit

The owner commits each module manually. Leave the work in the tree and
summarise what changed. Never run `git commit` or `git push` here.

## Estimates are wrong on purpose

The roadmap's dev-day estimates were calibrated for a solo human; every
module so far has landed in 1 day. Don't pad scope to match the estimate,
and don't cut scope because the estimate looks small — build what §1–§8
specify.
