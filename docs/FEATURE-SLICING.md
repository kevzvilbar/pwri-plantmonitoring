# Feature-Slice Reorganization — Roadmap

> Status: **proposal** (2026-09-19). No code moved yet. This documents the
> target structure and the rules for getting there incrementally, one slice
> per PR, so the domain boundaries become visible in the file tree instead of
> only in this document.

## Why

The whole app lives in `frontend/src/` with a layout that doesn't reflect the
product domain (wells, RO trains, chemical dosing, downtime, compliance
reporting — see `memory/PRD.md`):

| Directory | Size today | Problem |
|---|---|---|
| `src/pages/` | 405 files | ~25 flat page files *plus* 17 same-named folders; three casing conventions collide (`admin/`, `Alerts/`, `ro-trains/`), including a genuine duplicate pair: **both `ro-trains/` and `ROTrains/` exist** |
| `src/components/` | 369 files | 16 top-level dirs mixing product features (`costs`, `dashboard`, `import`, `operations`) with shared widgets (`OdometerRollerInput`, `DeleteEntityMenu`, `ui`, `icons`) |
| `src/lib/` | 77 files | cross-cutting utils and domain queries indistinguishable |
| `src/hooks/`, `src/data/`, `src/store/` | 32 / 36 / 10 | same-blend of shared and domain-specific code |

Nothing is broken — imports all go through the `@/` alias, so files can be
moved mechanically. The goal is discoverability and enforced boundaries, not a
rewrite.

## Target structure

```
src/
  features/
    wells/            # well readings, meter replacements, depth history, rollover
    ro-trains/        # RO train readings, uptime, EM meters, offline status/log
    operations/       # operator log, downtime, blending, chemicals (Chemicals.tsx,
                      #   DowntimeEventsModal, components/operations)
    readings/         # import & normalization: smart-import, ReadingImportDialog,
                      #   components/import, data-corrections, dataAnalysis
    compliance/       # thresholds, snapshots, reporting
    costs/            # OPEX, tariffs, production costs (pages/costs + components/costs)
    plants/           # plants + topology (plantTopology, topology config)
    admin/            # admin console, users, migrations panel, audit log,
                      #   employees, PmsCalendar
    notifications/    # alerts page + components/notifications + push UI
    auth/             # Auth, Onboarding, Profile
  shared/             # ui/, icons/, TopBar, manual/, OdometerRollerInput,
                      #   DeleteEntityMenu, and the cross-cutting parts of lib/
```

Each feature folder owns its `components/`, `queries/`, `hooks/`, and
co-located `*.test.ts` files. Anything imported by three or more features
belongs in `shared/`.

## Migration rules

1. **One slice per PR.** Never a big-bang move; reviewability and revert
   safety come from small diffs.
2. Moves are mechanical because everything imports via `@/…` — update import
   paths only, no logic edits in the same commit.
3. After each slice PR, all three gates must pass:
   `npx tsc --noEmit -p tsconfig.app.json`, `npm test`, `npm run build`
   (plus `node ../scripts/check-types-sync.mjs`, which CI runs anyway).
4. Do not restructure `store/` (zustand facades), change the router table, or
   touch SQL/RLS in slice PRs.
5. The duplicate pair `pages/ro-trains/` + `pages/ROTrains/` gets resolved
   **during** the ro-trains slice (merge into one folder; case-only directory
   renames need a two-step move on Windows/macOS checkouts).

## Suggested order (smallest blast radius first)

1. `ro-trains` — pilot slice; also eliminates the `ROTrains/` duplicate.
2. `costs` — already has its own `components/costs/`.
3. `notifications` + `auth`.
4. `readings` (import/normalization) — biggest cluster, do after two successful pilots.
5. `wells`, `operations`, `plants`, `compliance`, `admin`.
6. Final PR: move remaining cross-cutting `lib/` files to `shared/` and delete
   this document.

## Out of scope / non-goals

- No bundler or alias changes (`@/` stays pointed at `src/`).
- No new state management or data-layer patterns — slices are folders, not
  new architecture.
- No dependency additions.
