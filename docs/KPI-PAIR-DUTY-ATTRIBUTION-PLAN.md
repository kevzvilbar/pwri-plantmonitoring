# KPI pair-duty attribution fairness plan

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` |
| Baseline | `90b07d2` (2026-09-26) |
| Scope | Employees → KPI tab appraisal scoring; shift/operator attribution (`recorded_by`, `activeOperatorId`, Shift Handover, Operator Switcher) |
| Target path | `docs/KPI-PAIR-DUTY-ATTRIBUTION-PLAN.md` |
| Status | Implemented |

---

## 1. The problem, grounded in the actual code

Operators share a login/terminal and normally go on duty **in pairs**. By convention, only one operator in the pair is actually tasked with typing that shift's readings into the app. The KPI tab computes a per-operator **Overall KPI Score** — exported literally as `operator_annual_appraisal_kpi_*.csv` — and previously the operator who wasn't the one typing got nothing credited for those shift-days, however genuinely on-duty they were.

- `useKpiData.ts`'s `buildIndividualMatrix()` decided whether an operator was **"on duty"** for a given plant-day (`opDutySet`) purely from whether at least one reading row had `recorded_by === op.id`.
- The 60% **Individual Activity** component of the score (RO Train diligence) was scoped the same way: `roMap` only counted rows keyed by `recorded_by`.
- Net effect: pair goes on duty → one operator does the typing under whichever identity is active → the co-operator's `recorded_by` never appears for that plant-day → `isOnDuty` is false for them → every category (including Shared Duties) went `null` for that day.

---

## 2. Decisions Resolved

| ID | Question | Status | Decision |
|---|---|---|---|
| D1 | Credit policy: what does a properly declared, non-typing partner actually earn? | **Resolved** | Both operators get the **same (pooled) RO-diligence score** for that shift — not split, not N/A. |
| D2 | Does a real duty roster already exist outside the app? | **Resolved** | In-app declaration on shift handover/login/switcher. |
| D3 | What does an operator get if they're plausibly on duty but *no* partner was declared for them that day? | **Resolved** | **Attendance credit only** — RO cell stays N/A/excluded, never full or pooled. RO credit follows an explicit, auditable declaration. |
| D4 | Who declares a pairing, and when? | **Resolved** | The operator establishing their own active identity declares a structured `partnerOperatorId`. |
| D5 | Recompute past appraisal periods once this ships, or forward-only? | **Resolved** | Forward-only with CSV export audit disclaimer note (P4-2). |
| D6 | How should a partner leaving mid-shift affect that day's pooled credit? | **Resolved** | **No automatic proration.** `ended_at` is recorded for audit/manual review. |
| D7 | Anti-abuse and audit transparency | **Resolved** | Pairing pattern reporting utility. |

---

## 3. Implementation Checklist

### Phase 0 — Diagnostic Visibility
- [x] **P0-1** Add diagnostic indicators and tooltips distinguishing "on duty (data entry)", "on duty (dual-duty partner — pooled RO credit)", "on duty (attendance only — no declared partner)", and "off duty".
- [x] **P0-2** Diagnostic pairing query / analysis utility.

### Phase 1 — Partner Declaration & Duty Log
- [x] **P1-1** Migration `20260926000003_shift_duty_log.sql` creating `shift_duty_log` with indexes and RLS policies.
- [x] **P1-2** Extend `ShiftHandoverModal.tsx`, `OperatorSwitcher.tsx`, and `LoginForm.tsx` with partner picker.
- [x] **P1-3** Add "end partnership" affordance in `OperatorSwitcher` and `ShiftHandoverModal`.
- [x] **P1-4** Wire `useKpiData.ts` to consume `shift_duty_log` into `opDutySet` and build dual-duty pairings.

### Phase 2 — Pooled Scoring with Abuse-Resistant Fallback
- [x] **P2-1** Mirror typing operator's RO diligence score onto `partner_operator_id` (pooled score).
- [x] **P2-2** Attendance-only fallback when no partner is declared (RO stays N/A, Shared duties credited).
- [x] **P2-3** Updated appraisal export and tooltip copy.

### Phase 3 & 4 — Visibility & Export Audit
- [x] **P3-1** Pairing pattern analysis utility.
- [x] **P4-2** Added forward-only disclaimer note to KPI CSV export.
