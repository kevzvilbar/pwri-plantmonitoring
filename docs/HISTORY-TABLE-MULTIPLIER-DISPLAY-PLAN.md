# Reading History Table Multiplier Display Plan

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` |
| Baseline | `main` |
| Trigger | Identified in `docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md` §Phase 4 (P4-1, P4-4) |
| Scope | Surface `multiplier_at_reading` and multiply Δ volume in `ReadingHistoryTable` for locator, well, and product meters. |
| Status | **Scoped as follow-up roadmap item** |

---

## 1. Problem Statement

In `frontend/src/features/readings/components/readingHistory/ReadingHistoryTable/StandardRow.tsx` (and related reading history components):
- `rawDelta` is computed strictly as `current_reading - previous_reading` (with rollover compensation if applicable).
- The table does not display `multiplier_at_reading` and does not apply the multiplier factor to the displayed volume column for `locator`, `well`, and `product_meter` modules.
- In contrast, the database triggers (`trg_locator_readings_set_daily_volume`, `trg_well_readings_daily_volume`, `trg_product_meter_reading_integrity`) compute and store `daily_volume = Δraw × multiplier_at_reading`.
- Furthermore, dashboard aggregations (`get_dashboard_aggregates`) sum the stored `daily_volume`.

As a result:
1. The reading history table displays unmultiplied raw deltas instead of true effective daily volume ($\text{m}^3$).
2. Verification of multiplier backfills cannot be performed via the reading history dialog UI and must be done via SQL audit runbooks or dashboard aggregations.

---

## 2. Proposed Design & Changes

1. **Table Column Header**:
   - For modules where multiplier is active or entity has multiplier enabled:
     - Render `Multiplier` column (e.g. `×10`, `×1`) or display effective volume as `Δ (m³)` with multiplier indicator tag.
2. **Delta Calculation**:
   - Use `r.daily_volume` directly when available from the backend row, or compute effective volume as:
     $$\text{effectiveDelta} = \text{rawDelta} \times (\text{row.multiplier\_at\_reading} \mathbin{??} \text{entityMultiplier} \mathbin{??} 1)$$
3. **Edit / Inline Actions**:
   - Ensure editing a row in history allows reviewing/confirming the multiplier at reading.
4. **Consistency across Modules**:
   - Align `locator`, `well`, and `product` standard rows with the multiplier display patterns already present in `PowerRow.tsx` and `MeterReplacementDetailDialog.tsx`.

---

## 3. Implementation Checklist

- [ ] **H-1** Update `useReadingHistoryQuery.ts` to include `multiplier_at_reading` and `daily_volume` in select queries across `locator_readings`, `well_readings`, and `product_meter_readings`.
- [ ] **H-2** Update `TableHeader.tsx` to conditionally include the Multiplier header.
- [ ] **H-3** Update `StandardRow.tsx` to render `multiplier_at_reading` badge/text and multiply the delta or display `daily_volume`.
- [ ] **H-4** Update `ReadingHistoryEditForm.tsx` to preserve `multiplier_at_reading`.
- [ ] **H-5** Add unit tests in `frontend/src/features/readings/components/readingHistory/` verifying multiplier rendering and effective volume computation.
