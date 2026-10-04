# ADR: Python regression service retired (2026-07-21)

> Archived from `memory/PRD.md` section 5. Describes the pre-2026-08-03 FastAPI backend, kept for history.

### Architecture decision — 2026-07-21: Python regression service retired (§4 item 1)

**Decision:** Retire `regression_service.py` and all seven `/api/data-analysis/`
routes. The frontend's TypeScript implementation in `DataAnalysis.tsx` is the
single authoritative copy of regression logic going forward.

**Rationale:**

| Dimension | Python (`regression_service.py`) | TypeScript (`DataAnalysis.tsx`) |
|---|---|---|
| Frontend usage | Zero calls — never invoked | Live path for all regression work |
| Algorithm | Single-pass OLS on raw values | Two-pass: reset detection → OLS on cleaned values |
| Z-threshold | Fixed `2.5` regardless of n | Dynamic `getZThreshold(n)` — widens for small n |
| Race condition | None — concurrent apply/retract could double-write | Compare-and-swap claim before any writes (D6 fix) |
| Meter delta cascade | Not present | `recalculateTrainDeltas()` after permeate_meter apply |
| `norm_status` handling | Uniform for all tables | `TABLES_WITHOUT_NORM_STATUS` guard |
| Gap detection | Not present | `detectGaps()` with linear interpolation |

The duplication caused real harm: bug D2 (retract left corrected values in place)
was verified "fixed" on the Python side while the live TypeScript path still had
the identical defect. Maintaining two copies of the same business logic is the
exact failure mode §4 item 1 was flagging.

**What was removed:**
- `backend/regression_service.py` → renamed `_retired_regression_service.py` (kept for archaeology)
- `server.py` import: `from regression_service import ...`
- `server.py` models: `RegressionRunRequest`, `RawEditRequest`, `ApplyRegressionRequest`, `RetractRegressionRequest`
- `server.py` routes: `GET /tables`, `POST /run-regression`, `POST /apply-regression`, `POST /retract-regression`, `GET /results`, `POST /edit-raw`, `GET /raw-edit-log`

**What owns it now:**
- Regression run: `runOLS()` in `DataAnalysis.tsx`
- Apply: `handleApply()` — compare-and-swap + train cascade
- Retract: `handleRetract()` — compare-and-swap + original-value restore
- Raw edits: `EditRawDialog` → direct Supabase upsert + `raw_edit_log` insert
- Audit log: `AuditLogTab` → direct Supabase read of `raw_edit_log`
