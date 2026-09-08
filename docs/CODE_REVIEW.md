# Code Review & Contribution Standards

**Roadmap Phase 5** — the rules that keep the debt fixed by Phases 0–4 from
re-accumulating. These are enforced by the CI gates (`ci.yml`) and by
reviewers. If a standard here and a CI gate can disagree, the CI gate is
authoritative and this doc is what should be updated.

---

## 0. The ground rule

> A PR that makes the *measurements* worse without a written reason is
> rejected. The measurements are: file size, lint warnings
> (`lint-ceiling.json`), strictNullChecks allowlist (`strict-null-checks.json`),
> bundle size (`bundle-size.json`), test count, and the pgTAP RLS suite.

---

## 1. File size ceiling (god-component rule)

- **No source file may exceed 500 lines (~15 KB).** This is a hard,
  review-blocking limit for *new/changed* files.
- Existing files above the limit (see Appendix of the 2026-09-06 critique)
  must shrink on their owner's next touch — see the decomposition targets in
  `docs/` (Phases 3): split each into a folder with a `types.ts`/`api.ts`
  module, one component per file, and an orchestrator/`index.tsx` that wires
  them.
- A file that only re-exports (an `index.ts`) is exempt.

## 2. Tests are required for new behavior

- **New pure logic** (guards, parsers, calculations, date logic, RBAC
  matrix changes) → vitest suite in `src/**/*.test.ts{,x}` next to the code.
  Use the shared mocks in `src/test/mocks/`.
- **New data-access code** (`src/data/**`) → test the query/mutation
  functions with `createSupabaseClientMock` (see `src/data/data.test.ts`).
- **New public workflows / critical flows** → Playwright spec under
  `frontend/e2e/` (the CI `e2e-smoke` job). Deep authenticated flows run
  against the staging project (`docs/STAGING.md`), never production.
- CI runs vitest + the strict ratchet + the lint ceiling + bundle ceiling +
  pgTAP RLS tests on every PR.

## 3. Migrations (database) — staging-first, RLS default-deny

- Every schema change lands as a **new** file in `supabase/migrations/`
  (timestamped), tested against the **staging** project first via
  `supabase db push` (see `docs/STAGING.md`) — never against production
  directly.
- **New tables**: RLS must be **enabled with NO policies** in the same
  migration, then explicit policies added. CI enforces RLS-on for every
  public table (`supabase/tests/database/06_rls_enabled_on_all_tables.sql`).
- **New functions**: set `search_path` (include `pg_temp` for SECURITY
  DEFINER), `REVOKE EXECUTE FROM PUBLIC` unless genuinely intended.
- **New triggers**: read `docs/TRIGGER-DEPENDENCY-GRAPH.md` first; add to
  the doc's inventory in the same PR; prefer consolidating into existing
  chain functions over adding a new trigger to a reading-chain table; avoid
  re-entrant cascades (no intra-chain UPDATE that re-fires the same trigger)
  unless a circuit breaker exists.
- **No out-of-band schema edits** (directly on the DB, outside a migration) —
  the 2026-07 filter-usage drift happened exactly that way.

## 4. The ratchets (never move these silently)

All three are "lock in the number, and any change is a reviewed decision":

| Ratchet | File | Rule |
|---|---|---|
| Lint warnings | `frontend/lint-ceiling.json` | CI fails if the count ≠ ceiling. `node scripts/check-lint-ceiling.mjs --update` + commit the new value **with a `reason`**. |
| strictNullChecks | `frontend/tsconfig.app.json` | **Global — ON for the whole project** since 2026-09-08 (previously an allowlist ratchet in `strict-null-checks.json`; the codebase reached the ratchet's target state of ZERO project-wide errors, so the ratchet retired and `strictNullChecks: true` is now enforced directly by the CI `Type-check` step). Keep it on. |
| Bundle size | `frontend/bundle-size.json` | CI fails if gzipped JS/CSS drifts >2 kB from baseline. `node scripts/check-bundle-size.mjs --update` + reason. |

## 5. TypeScript strictness & `as any`

- **No new `as any` casts.** Prefer the generated `Database` type from
  `src/integrations/supabase/types.ts` (regenerate via `npm run types:gen`
  when migrations change). Where a shape is genuinely dynamic (hand-written
  SQL views), type it as `unknown`/a record and narrow — see the existing
  `useReadingGaps.ts` precedent.
- **`strictNullChecks` is ON project-wide** (`tsconfig.app.json` sets
  `strictNullChecks: true` since 2026-09-08). New code must type-check with
  it on; the CI `Type-check (tsc --noEmit)` step enforces this for every
  file, not just an allowlist. The incremental allowlist ratchet
  (`scripts/check-strict-null-checks.mjs` + `strict-null-checks.json`) is
  retired — it reached its target state (ZERO project-wide errors, verified
  via `tsconfig.strict.json`).

## 6. Dead-config & dependency hygiene

- No new scaffold leftovers (the original Lovable scaffold stamp, e.g. the
  `lovable-tagger` devDependency, was removed 2026-09-06), no hardcoded
  project IDs, no environment-specific blocks. Env is `VITE_*` only
  (`frontend/.env.example` documents everything).
- Unused devDependencies (e.g. the removed `lovable-tagger`) are removed in
  the PR that would otherwise ship them; `npm audit` (CI) must stay at
  no high/critical for production deps.

## 7. Review checklist (summary)

- [ ] File ≤ 500 lines; split otherwise (with the split's own PR title).
- [ ] New logic has a test; new data-layer fn has a mock test.
- [ ] New table: RLS on, deny-all first.
- [ ] New function: search_path + REVOKE PUBLIC.
- [ ] New trigger: added to `TRIGGER-DEPENDENCY-GRAPH.md`, no unbounded
      re-entry.
- [ ] Lint/strict/bundle ceilings moved only with `--update` + reason.
- [ ] `tsc --noEmit`, vitest, build, Playwright (if touched), pgTAP all green.