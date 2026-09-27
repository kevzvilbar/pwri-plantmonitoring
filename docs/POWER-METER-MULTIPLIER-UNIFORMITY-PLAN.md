# Power Meter → Meter Multiplier Uniformity Plan

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` |
| Baseline | `6ef92f9a` (2026-09-27) — *"feat(plants): transfer power meter configuration to meter multiplier in plant config for uniformity"* |
| Scope | `MeterMultiplierSection.tsx`, `MeterMultiplierTableRow.tsx`, `MeterMultiplierHistoryDrawer.tsx`, `PowerMeterManageModal.tsx`, `PowerMeterMultiplierModal.tsx`, the `plant_power_config` / `power_meter_changes` tables — compared against the existing water-meter path (`MeterMultiplierWorkflowModal.tsx`, `submitMeterMultiplierWorkflow`, `meter_events`) |
| Target path | `docs/POWER-METER-MULTIPLIER-UNIFORMITY-PLAN.md` |
| Status | **Completed** |

---

## 1. Architectural Summary & Uniformity Model

For every row in the **Meter Multiplier Configuration** table under **Plant Config**, regardless of meter category (`product`, `well`, `locator`, `power`):

1. **Configure** opens a single-meter modal (`MeterMultiplierWorkflowModal` for water, `PowerMeterMultiplierModal` for power), pre-filled with that meter's current multiplier and enabled state. It records a structured `multiplier_cutover` audit event on submit and establishes a clean reset boundary.
2. **Replace** opens the same modal in `physical_replacement` mode, requiring new starting readings and logging a `physical_replacement` audit event.
3. **History Drawer** renders from structured event tables (`meter_events` for water, `power_meter_changes` for power) using unified badge styles (`Physical Replacement` in info-blue, `Multiplier Cutover` in primary-purple) while retaining domain-accurate units (m³ for water, kWh for power).
4. **Structural Asset Configuration** (meter counts and labels) is separated into dedicated management tools (`PowerMeterManageModal` via "Power Sources" button), exactly as water asset structure (wells/locators/RO trains) is managed independently from multiplier factors.
5. **Direct Database Persistence**: Reads and writes go directly to Supabase with friendly user toasts on errors; silent localStorage fallbacks are removed.
