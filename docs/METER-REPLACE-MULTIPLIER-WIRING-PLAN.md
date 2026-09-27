# Meter Replace × Multiplier Wiring Plan

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` |
| Baseline | `eec32d7` (2026-09-26) |
| Scope | Everyday "Replace meter" dialog (`ReplaceMeterDialog.tsx`) for locators/wells/product meters; "Multiplier Cutover" branch of `MeterMultiplierWorkflowModal.tsx`; the shared replacement-history detail popover |
| Target path | `docs/METER-REPLACE-MULTIPLIER-WIRING-PLAN.md` |
| Status | **Implemented** |

> **Update (2026-09-27):** Resolved the two "worth a second look" items from the first draft — P1-1's snapshot-ownership question (see D5) and P2-3's popover wording (see D7) — and surfaced one behavior change (D6) that falls out of D5 but wasn't in the original draft.

---

## 1. The problem, grounded in the actual code

Two different "replace a meter" surfaces exist in this app and they've diverged:

- **`MeterMultiplierWorkflowModal.tsx`** — opened only from `MeterMultiplierSection.tsx`'s "Meter Multiplier Configuration" table (`MeterConfig.tsx`, gated by `canEdit = isManager || isAdmin || isDataAnalyst`, line 105). Already multiplier-aware for both its `physical_replacement` and `multiplier_cutover` event types. Writes an audit row to `meter_events` (migration `20260926000001_meter_multiplier_feature.sql`) and patches `meter_multiplier`/`multiplier_enabled` on the entity.
- **`ReplaceMeterDialog.tsx`** — the dialog used from ~10 call sites across everyday Operations: `LocatorRow.tsx`, `WellRow/WellRowDialogs.tsx`, `ProductMeterRow.tsx`, `WellDetail.tsx`, `LocatorDetail.tsx`, the "Repl." checkbox in `ReadingHistoryTable/TableDialogs.tsx`, `ProductMeterHistoryDialog.tsx`, `LocatorsList.tsx`, and the `ProductMeters.tsx` config page. It only writes to `locator_meter_replacements` / `well_meter_replacements` / `product_meter_replacements`. **It has no multiplier fields and never touches `meter_multiplier`/`multiplier_enabled`.**

---

## 2. Decisions Resolved

| ID | Question | Decision |
|---|---|---|
| D1 | Who can change the multiplier from the everyday Replace Meter form, and where does that change get logged? | Any operator who can already open Replace Meter. Logged to that meter's own replacement history (`*_meter_replacements`) — **not** `meter_events`. No new role gate, no RLS changes. |
| D2 | Should "New Starting Raw Reading" stay required on a Multiplier Cutover? | No. Submitting blank is allowed; it skips the reset-boundary reading row (`newReadingValue: null`, already handled by `submitMeterMultiplierWorkflow`). |
| D3 | What should the form do when it's left blank? | Show a **persistent inline warning** under the field (not just a submit-time toast) explaining the next real reading may show a one-time volume spike. |
| D4 | "Enhance them" — how far? | Add multiplier fields to Replace Meter and wire per D1; unrequire per D2/D3; **and** surface the recorded multiplier on the replacement-history detail popover (`MeterReplacementDetailDialog.tsx`) so past swaps show what was applied. |
| D5 | *(P1-1 resolved)* Where does the `oldMultiplier`/`oldMultiplierEnabled` snapshot come from, create vs. edit? | **Create**: live fetch of the entity's current `meter_multiplier`/`multiplier_enabled` — the only source available, since no replacement record exists yet. **Edit**: prefer the existing record's own `old_multiplier`/`old_multiplier_enabled` over a fresh live fetch — the live entity value may have moved on since (e.g. a later cutover), and re-editing an old swap shouldn't let today's settings silently overwrite yesterday's audit trail. |
| D6 | *(resolved)* Should the "read from the record, not a live fetch" rule in edit mode also cover `newMultiplier`/`newMultiplierEnabled`, not just the old side? | **Confirmed — yes.** Both `old_*` and `new_*` are treated as immutable snapshots of the state *at the time of that specific replacement*, not the entity's live settings. `replacementToInitial()` (P1-6) was already scoped to carry all four fields, so this needed no new plumbing — it just closes a gap in the original P1-1 wording, which only called out the override for `old_*`. |
| D7 | *(P2-3 resolved)* Exact format/copy for the multiplier line in `MeterReplacementDetailDialog.tsx` | Keep the **old → new transition**, not a single "applied" value — for a Multiplier Cutover the transition *is* the event. Show both sides' enabled state, not just the new one (the toggle can flip with the number unchanged): `Multiplier: ×{old ?? '—'} ({oldEnabled ? 'Active' : 'Off'}) → ×{new} ({newEnabled ? 'Active' : 'Off'})`, plus a `ⓘ` tooltip. Drop any wording like "from current meter settings" — it's a frozen snapshot, not a live value. |
| D8 | *(new — confirmed this round)* Tag styling for the dual enabled-state display, and final tooltip copy | **Styling:** render the old-side tag in muted/secondary text and the new-side tag in the default/emphasized style, so the two don't visually compete. **Tooltip:** *"Multiplier recorded at this replacement. Future readings use this value until it's changed again — readings already logged aren't affected."* |

---

## 3. Implementation Checklist

### Phase 0 — Migration
- [x] **P0-1** New migration `supabase/migrations/20260927000001_replace_meter_multiplier_fields.sql`:
  Columns `old_multiplier numeric`, `old_multiplier_enabled boolean`, `new_multiplier numeric`, `new_multiplier_enabled boolean` added to `locator_meter_replacements`, `well_meter_replacements`, `product_meter_replacements`.
- [x] **P0-2** Update typescript definitions and validate sync.

### Phase 1 — `ReplaceMeterDialog.tsx`: capture and apply the multiplier
- [x] **P1-1** On open, source multiplier fields differently for create vs. edit (D5/D6).
- [x] **P1-2** Add compact "Multiplier Factor" number input + "Enable Multiplier Calculation" switch.
- [x] **P1-3** In `submit()`: Add `meter_multiplier`, `multiplier_enabled` to both existing `assetTable` update calls and `old_multiplier`/`old_multiplier_enabled`/`new_multiplier`/`new_multiplier_enabled` to replacement payloads. Explicitly set `multiplier_at_reading` on reading rows.
- [x] **P1-4** Add `oldMultiplier`/`oldMultiplierEnabled`/`newMultiplier`/`newMultiplierEnabled` to the dialog's `initial` prop type.
- [x] **P1-5** No new required-field validation for multiplier.
- [x] **P1-6** Extend `ReplacementInitial` (`replacementEdit.ts`) and `replacementToInitial()`.

### Phase 2 — Surface it on the replacement-history detail view
- [x] **P2-1** `replacementTypes.ts`: add `oldMultiplierEnabled`/`newMultiplierEnabled` to `NormalizedReplacement`.
- [x] **P2-2** `replacementLookup.ts`'s `normalize()`: map the new multiplier fields for well, locator, and product.
- [x] **P2-3** `MeterReplacementDetailDialog.tsx`: add multiplier transition line with dual enabled states and tooltip.

### Phase 3 — `MeterMultiplierWorkflowModal.tsx`: unrequire the cutover starting reading
- [x] **P3-1** Only require starting reading when `isPhysical`.
- [x] **P3-2** Drop `required` / `*` for `new_reading` when `!isPhysical`.
- [x] **P3-3** Add inline warning text under field when `!isPhysical && newReading === ''`.
- [x] **P3-4** Pass `newReadingValue: newReading !== '' ? Number(newReading) : null`.

### Phase 4 — Tests & gates
- [x] **P4-1** Tests for `ReplaceMeterDialog`.
- [x] **P4-2** Tests for `normalize()` and `MeterReplacementDetailDialog`.
- [x] **P4-3** Tests for `MeterMultiplierWorkflowModal`.
- [x] **P4-4** Full test & type check suite passing.
