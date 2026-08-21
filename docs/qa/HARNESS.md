# QA Harness Notes

Technique, gotchas and dead ends for driving this app through Playwright MCP.
Environment setup is in [`QA_RUNBOOK.md`](../../QA_RUNBOOK.md); this file is
about *how to drive the browser* once it is up.

- **`.mcp.json` is committed at project scope.** MCP servers load at session
  start, so the `mcp__playwright__*` tools become available in a **new** Claude
  Code session (project-scoped servers also need a one-time approval prompt).
  This round drove the same server directly over JSON-RPC stdio.
- **Use `--isolated`, one self-contained script per flow.** A persistent
  `--user-data-dir` profile made the MCP server reuse a live page across runs,
  which silently carried form state and network logs between stages and produced
  two false failures.
- **`target` takes a snapshot ref *or* a plain CSS selector — not Playwright's
  `:has-text()`.** `button:has-text('New role')` throws "does not match any
  elements". Prefer stable selectors (`input[name=…]`, `#role-name`), or click
  via `browser_evaluate` when matching on text.
- Assert with `browser_evaluate` returning structured JSON; it is far easier to
  diff between runs than a snapshot tree. Snapshots go to files under
  `--output-dir`, not into the tool result.
- Toasts are sonner, rendered **outside** `<form>` in the root layout — query
  `[data-sonner-toast]` and read it within ~4 s before it auto-dismisses.
- **Do not poll for a toast after the action — install a `MutationObserver`
  before it.** Reading `[data-sonner-toast]` in a follow-up call repeatedly came
  back empty on actions that *did* toast, and nearly produced a "refusal gives the
  user no feedback" finding against M06, which turned out to be false. The reliable
  shape, all inside one `browser_evaluate`:

  ```js
  const seen = [];
  const obs = new MutationObserver(() => document
    .querySelectorAll('[data-sonner-toast]')
    .forEach(t => { const s = t.textContent.trim(); if (s && !seen.includes(s)) seen.push(s); }));
  obs.observe(document.body, { childList: true, subtree: true });
  button.click();
  await new Promise(r => setTimeout(r, 3500));
  obs.disconnect();
  return seen;                      // ← caught "Section \"A\" already exists…"
  ```

---

| | |
|---|---|
| **Database** | Moved off Neon onto local Docker `postgres:5433`. QA is now destructive-safe. |
| **Seed** | New `npm run seed:qa` builds a demo school: **11 logins, one per system role**, 2 sessions (one current, one COMPLETED), 3 classes × 2 sections × 2 sessions, 4 subjects, 6 staff, 2 teachers, 12 students with Bangla names, guardians and enrollments. Destructive and re-runnable. |
| **Reset** | `npm run qa:reset` — guard → `migrate reset` → bootstrap seed → QA seed. Verified: all 27 migrations replay cleanly onto an empty database. |
| **Safety** | `src/database/seeds/qa/guard.ts` refuses any non-localhost `DATABASE_URL`, and runs **first** in the reset chain — before Prisma can drop anything. Verified against a Neon-style URL. |
| **Cleanup** | The seed also purges the leaked `@test.local` e2e users (**F7**). |
| **Docs** | `QA_RUNBOOK.md` (repo root) — cold start, logins, gotchas, known non-bugs. |

---

**Round 2 touched nothing on Neon.** The whole round ran against local Docker, which was
reset and reseeded. Reverting fixtures by hand is no longer part of the workflow — that
is the point of the move.

### Round 1 — on the Neon dev database, all reverted:

| Action | State |
|---|---|
| Super Admin password reset → `QaHexTemp#2026`, then changed back | **restored to `ChangeMe123!`** (verified by signing in) |
| Custom role `qa-playwright-probe` created | **soft-deleted** (roles list back to 11) |
| Audit rows for the above, `login_activities`, consumed OTP | left in place (append-only, immutable by design) |
| Super Admin lockout triggered during M02-08 | expired (15 min); sign-in verified working afterwards |

## Editing docs from a script on Windows

Python's `io.open(path, 'w')` is **text mode**, which translates `
` to `
` on
Windows — so a scripted doc edit silently reintroduces CRLF into a repo that
`.gitattributes` pins to LF. Pass `newline='
'` explicitly, or write bytes. This bit
once, immediately after the repo-wide conversion, and the only symptom was a single
file reappearing as `w/crlf` in `git ls-files --eol`.

## Where the MCP server writes its output

`--output-dir` in `.mcp.json` points at **`.playwright-mcp/`**, which is gitignored.
It is tempting to aim it at `docs/qa/screenshots/`, but the server writes a page
snapshot (`.yml`) **and** a console log per navigation, not only the screenshots you
ask for — one session left 18 snapshots and 9 logs beside 2 real images.

So: transient output is gitignored, and evidence is promoted by hand.

```bash
cp .playwright-mcp/<the-one-you-want>.png docs/qa/screenshots/f13-unnamed-select.png
```

Upload inputs live in **`docs/qa/fixtures/`** and are committed, so a later session does
not have to regenerate them. Note the MCP server sandboxes file access to the repo — an
absolute path under the system temp directory is refused with "outside allowed roots".

## Uploads are a two-step flow, and the ids differ per entity

Clicking "Upload document" opens the **OS file chooser first**; only after
`browser_file_upload` resolves does a dialog appear asking for Title and Type. So the
sequence is: click → `browser_file_upload` → fill the dialog → click its own
**Upload** submit. Checking the page between steps looks like "nothing happened" — and
the outer hidden `input[type=file]` reports `files.length === 0` even when the dialog
has the file, because the dialog owns its own input.

The title field id is **not shared**: staff uses `#doc-title`, teachers use
`#tdoc-title`. Read the dialog's fields rather than assuming.

Verify the result outside the DOM: the row's **View** link is a signed MinIO URL, so
`fetch(href)` should return 200 with the right `content-type` and a `content-length`
that matches the file you uploaded byte for byte. Fixtures for this live in
`docs/qa/fixtures/`.

## Radix menus and dialogs need real clicks, and leave an overlay behind

A synthetic `element.click()` inside `browser_evaluate` does **not** open a Radix
dropdown — it listens for pointer events. Use the `browser_click` tool with a CSS
selector for menu triggers, then read the items with `[role=menuitem]`.

Two follow-ons:

- An open menu's overlay **intercepts clicks elsewhere on the page**, and the next
  `browser_click` fails with *"…intercepts pointer events"*. Press **Escape** first.
- Checkboxes inside dialogs are `<button role="checkbox">`, and the submit button's
  label often changes with the selection (`Enroll` → `Enroll (1)`). Match with a prefix
  (`/^Enroll/`), not equality.

## Use a fresh phone number per admission run

Requesting several OTPs for one number exhausts its attempt/resend allowance and the
wizard simply stops advancing, with no error that says why. That is correct throttling;
it just looks like a broken step. Vary the number between runs.

## Fixture cleanup: delete by a key you control

Three findings (**F7**, **F12**, **F23**) share one root cause: cleanup matched a marker
the *application* never writes — an e2e prefix, a `remarks` string, a `QA-` uid — while
the rows under test were authored by the product with its own naming.

Delete by a foreign key you own instead: the school, the academic session, the staff
profile. `F23` is the sharpest illustration — the identifying reference (`admission_class_id`)
had already been nulled by an earlier step in the same purge, so *no* content-based match
could have worked.
