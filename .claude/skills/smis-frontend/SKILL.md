---
name: smis-frontend
description: Write or refactor Next.js 16 / React 19 code in hexschool-frontend — admin pages and tabs, API clients in lib/api, Zod validations mirroring backend DTOs, shared shadcn components, permission gating with Can, the academic-session switcher, and TanStack Query wiring. Use for any UI, form, table, dialog or client-side data-fetching work in SMIS/HexSchool.
---

# SMIS frontend conventions

Next.js **16.2** (App Router, Turbopack), React **19**, TanStack Query for
server state, Redux Toolkit for global client state, shadcn/ui on Tailwind
v4, RHF + Zod for forms.

## Read the bundled Next docs first

`AGENTS.md` in this repo says it and it is not boilerplate:

> This version has breaking changes — APIs, conventions, and file
> structure may all differ from your training data. Read the relevant
> guide in `node_modules/next/dist/docs/` before writing any code.

Things that actually differ here:
- Middleware is **`src/proxy.ts`**, not `middleware.ts`.
- `params` and `searchParams` are **Promises** — `const { id } = use(params)`
  in a client component, `await` in a server one.
- The React Compiler lint rules are **errors**, not warnings (see below).

## Layout

```
src/app/(admin)/admin/<area>/…   admin panel
src/app/(auth)/…                 login / reset flows
src/app/(portal)/portal/…        student / parent / teacher (M18)
src/app/(public)/…               website + public admission
src/components/shared/           Can, DataTable, FormDialog, ConfirmDialog,
                                 PageHeader, StatCard, EmptyState, ErrorState,
                                 Spinner/LoadingBlock, SessionSwitcher, JsonDiff
src/components/ui/               vendored shadcn primitives
src/lib/api/<domain>.ts          typed client + response interfaces
src/lib/validations/<domain>.ts  Zod schemas + label/variant maps + mirrored engines
src/lib/hooks/                   usePermissions, useAcademicSession, useDebounce, useAuth
```

A page-local helper that only one area uses stays in that area — e.g.
`MasterCrud` lives at `src/app/(admin)/admin/structure/master-crud.tsx`,
not in `components/shared`.

## Check the prop names — they are not what you'd guess

These have bitten before:

| Component | Props |
|---|---|
| `StatCard` | `title` (not `label`), `value`, `icon?`, `hint?`, `isLoading?` |
| `PageHeader` | `title`, `description?`, **actions go in `children`** |
| `LoadingBlock` | `className?` only — **no `label`** |
| `EmptyState` | `title?`, `description?`, `icon?`, `action?` |
| `ErrorState` | `error?`, `title?`, `onRetry?` — **no `description`** |

Open the file rather than assuming.

## API clients

One file per domain in `src/lib/api/`. Export the response interfaces
(mirroring backend shapes), a `params()` filter that strips
`undefined`/`""`, and a namespaced object of methods:

```ts
export const resultApi = {
  async list(examId: string, query = {}): Promise<{ results: ResultRow[] }> {
    const res = await api.get<ApiEnvelope<{ results: ResultRow[] }>>(
      `/exams/${examId}/results`, { params: params(query) },
    );
    return res.data.data;
  },
};
```

- Decimals arrive as **strings** from Prisma — type them `string` and
  `Number(...)` at the point of display.
- File downloads go through a local `download()` helper that reads
  `content-disposition` and clicks an object URL.
- Structured refusals get a typed extractor next to the client:
  `markErrorsFromError(err)`, `clashesFromError(err)`,
  `unlockedPapersFromError(err)` — reaching into
  `err.response.data.error.details` inline is not the convention.

## Validations mirror the backend

`src/lib/validations/<domain>.ts` holds Zod schemas that mirror the
backend DTOs, plus label/variant maps for enums, plus — where the backend
has a pure engine — **a client mirror of that engine** so a grid can turn
a cell red before a round-trip. The backend stays authoritative; the
mirror exists for latency, and its tests live beside it
(`result.test.ts`, `exam.test.ts`).

## Permission gating and session scoping

```tsx
<Can permission="result.publish"><Button>Publish</Button></Can>
<Can anyOf={["role.view", "permission.view"]}>…</Can>
```

UI-only — the API re-checks everything. Menu items carry a `permission`
in `src/lib/config/admin-menu.ts`.

**Every session-scoped page must read `useAcademicSession().selected`** —
never fetch "the current session" independently. The switcher lives in the
admin header, persists per user, and is the convention from M05 onward.

## React 19 / compiler rules (these are lint ERRORS)

- **No `setState` inside `useEffect`.** Two fixes, in order of preference:
  1. *Derive instead of store* — a default selection is
     `chosen || firstPending?.id || ""`, not an effect.
  2. *Adjust state during render* against an identity key, which React
     explicitly supports:
     ```tsx
     const key = data ? `${id}:${dataUpdatedAt}` : null;
     if (data && key !== loadedKey) { setLoadedKey(key); setDrafts(...); }
     ```
- Ref callbacks must not return a value — use a block body.
- Memoize a `?? []` fallback (`useMemo(() => data ?? [], [data])`) before
  using it as a hook dependency.

## Editable grids

The mark-entry and distribution grids share a shape worth copying:
local `drafts` keyed by row id, a mirrored validator producing per-row
errors, a sticky save bar reporting `filled / total` and invalid count,
all-or-nothing save, and server-returned cell errors merged into the same
red-row rendering. Set `refetchOnWindowFocus: false` on the grid query so
a background refetch cannot overwrite half-typed input.

## Verify

```bash
cd hexschool-frontend
npx tsc --noEmit
npx vitest run
npx eslint "src/app/(admin)/admin/<area>" src/lib/api/<domain>.ts
npx next build          # confirm the route is emitted
```
