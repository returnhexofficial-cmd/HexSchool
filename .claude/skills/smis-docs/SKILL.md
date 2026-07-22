---
name: smis-docs
description: Write or update SMIS/HexSchool project documentation — module completion docs in docs/modules/NN-name.md, and the four living trackers (PROJECT_PROGRESS.md, PROJECT_CONTEXT.md, MODULE_DEPENDENCIES.md, SMIS_DEVELOPMENT_ROADMAP.md checkboxes). Use when finishing a module, recording an architectural decision, closing a technical debt, or when asked to document what changed.
---

# SMIS documentation

Four living documents plus one completion doc per module. They are read at
the start of every module, so drift is expensive — an inaccurate
`PROJECT_CONTEXT.md` sends the next module down the wrong path.

## The completion doc

`docs/modules/NN-name.md`, from `_TEMPLATE.md`. Read the previous
module's doc first for tone and depth.

Sections, in order: header table · Summary of Implemented Features ·
Database Changes · API Endpoints Added · Frontend Pages Created ·
Components Created · Business Rules Implemented · Known Limitations ·
Future Improvements · Breaking Changes · Migration Steps · Environment
Variable Changes · Manual Testing Results · Remaining TODOs · Links to
Related Modules.

Add sections when the module earns them — M14 added *Post-completion
verification* and *Note on line endings*; M15 added *Design Decisions*,
*Bugs found during verification* and *Cross-module debts closed*.

### What makes these docs good

**Explain why, not just what.** The reader is the next module's
implementer deciding whether they may change something.

> Per-component pass rules are nullable **thresholds**, not booleans — the
> roadmap says "flags", but a BD practical requires *a mark* to clear, not
> a yes/no; a threshold is strictly more expressive and non-NULL already
> means "must be passed separately".

**Name the failure the rule prevents.**

> Seating a whole class for an optional 4th-subject paper leaves
> two-thirds of the hall empty and the invigilator's register wrong.

**Record decisions that revise an earlier module,** with the hole they
close — M14 on `period_slots`, M15 on the grade-scale freeze.

**Report tests as a table with deltas**, and be honest about what was not
run. If a migration or an e2e suite is unrun, say so in bold in *Remaining
TODOs* — M14 did, and the follow-up run found a real bug.

**Write up bugs found during verification** — what it was, why the
existing tests missed it, the fix, and the generalisable lesson.

## PROJECT_PROGRESS.md

- Header: date + `Overall completion: NN % (N / 32 modules)`.
- Status table: completed list, **current module** = the *next* one,
  remaining count.
- *High-Priority Tasks (now)*: rewrite for the next module; strike through
  what is done.
- *Recently Completed*: **prepend** one dense paragraph. Read an existing
  entry first — these are long, specific, and lead with the decisions and
  the bugs, not a feature list.
- Tick the milestone table, mark the effort table (`~~15 Marks/Results~~ ✅ | 8 → **1**`),
  and append a Module Ledger row.

## PROJECT_CONTEXT.md

Only for things that **outlive the module**. Update:

- **§5 Shared Utilities** — a row per newly exported service/engine, with
  the "Since" column.
- **§8 Entity Spine** — a `**Live since MNN:**` clause describing the new
  tables *and their non-obvious constraints*.
- **§11 Global Business Rules** — rules other modules must honour.
- **§16 Technical Decisions** — a row per decision: `| decision | rationale | module |`.
  This is the most valuable section in the repo; be specific about the
  alternative rejected and why.
- **§18 Technical Debt** — add new debts; **strike through closed ones**
  (`- ~~**M06:** …~~ — **live since M15**`), keeping the original text
  visible so the history reads.
- The `> Last updated:` line.

## MODULE_DEPENDENCIES.md

Update the Mermaid graph if edges changed (including dotted `-. hook .->`
edges), and rewrite the module's row in the notes table: mark it ✅,
describe hooks it bound, hooks it left, and what it exports for later
modules.

## SMIS_DEVELOPMENT_ROADMAP.md

Tick the module's `- [ ]` → `- [x]` (all of §4, §5, §9, §10), and update
cross-references in *other* modules that mentioned yours as pending:

```bash
node -e "…"   # scripted find/replace is fine and was used for M15
sed -n '/^# Module 15/,/^# Module 16/p' SMIS_DEVELOPMENT_ROADMAP.md | grep -c '\- \[x\]'
```

Leave a later module's item unticked when it is genuinely theirs — M19
owns the public result *page*; M15 only shipped the API, so that line was
annotated rather than ticked.

## Style

- Markdown tables for anything enumerable.
- Backticks for every file path, code identifier, permission code and setting key.
- Em-dashes and `**bold**` for the load-bearing clause of a sentence.
- Cross-reference by module number (`the M08 precedent`, `roadmap M15 §6`).
- No invented numbers — quote the test counts and object counts you
  actually observed.
