# Wiring Data Corrections to My Corrections

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` |
| Status | **Implemented & Verified** |
| Scope | The correction-request lifecycle: operator submits → supervisor reviews in Data Corrections → operator sees the outcome in My Corrections |
| Migration | `supabase/migrations/20260926000002_wire_correction_resolutions.sql` |

---

## 1. Summary of Changes Implemented

### Phase 0: Pre-treatment mistagging & schema constraint
- **P0-1**: In `frontend/src/features/ro-trains/components/PreTreatLogTable.tsx`, corrected `sourceTable` tag from `'ro_train_readings'` to `'ro_pretreatment_readings'`.
- **P0-2**:
  - Migration `20260926000002_wire_correction_resolutions.sql` updated `correction_requests_source_table_check` to allow `'ro_pretreatment_readings'`.
  - Updated `CorrectionTarget` in `CorrectionRequestDialog.tsx` to include `'ro_pretreatment_readings'` and guarded `norm_status` updates for tables without that column.
  - Updated `SourceTable` type and `tableLabel` in `features/readings/dataCorrections/types.ts` to map `'ro_pretreatment_readings'` to `'Pre-treatment'`.

### Phase 1: Atomic RPCs for Approve & Reject
- **P1-1 & P1-2**: Added `fn_approve_correction_request` and `fn_reject_correction_request` in PostgreSQL as `SECURITY DEFINER` functions:
  - Row-level `FOR UPDATE` lock on `correction_requests` ensuring request is `pending`.
  - On **Approve**: runs reading value update, daily volume calculation, `norm_status = 'normalized'`, down-chain previous reading cascade, and logs to `reading_normalizations`.
  - On **Reject**: resets `norm_status = 'normal'` on the reading without altering values.
  - Sets `correction_requests.status`, `resolved_by`, `resolved_at`, and `resolution_note`.
- **P1-3**: Refactored `approveCorrectionRequest` and `rejectCorrectionRequest` in `frontend/src/data/mutations/corrections.ts` to call the new RPCs.
- **P1-4**: In `usePendingReviewActions.ts`:
  - Optimistically removes resolved items from both `queryKeys.corrections.requests('pending')` and `queryKeys.corrections.pending()` (the Flagged Readings queue).
  - Uses the RPC `applied` result to display accurate toast feedback.

### Phase 2 & 3: Verification & Test Coverage
- Created `frontend/src/data/mutations/corrections.test.ts` testing mutation functions and RPC parameter passing.
- Created `supabase/tests/database/10_correction_request_resolution.sql` for pgTAP database verification.
