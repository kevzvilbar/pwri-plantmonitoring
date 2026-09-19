# PretreatmentAndROLog.tsx Decomposition - Integration Guide

## Summary

The monolithic `PretreatmentAndROLog.tsx` (1,243 lines, 61 KB) has been decomposed into focused, reusable modules.

## New Files Created

| File | Size | Purpose |
|------|------|---------|
| `hooks/usePretreatmentFormState.ts` | 9.3 KB | Manages all form state (offline status, RO values, AFM/MMF rows, boosters, housings, section gating, anomaly remarks, etc.) |
| `hooks/usePretreatmentData.ts` | 6.6 KB | Manages all data fetching (trains, previous readings, meter config, status log, average flow rates) |
| `hooks/usePretreatmentCalculations.ts` | 9.0 KB | Manages all derived calculations (flow rates, recovery, rejection, salt passage, power metrics, spike detection) |
| `components/PlantTrainSelector.tsx` | 2.8 KB | Plant/train selection UI with date/time picker |

## Integration Steps

### 1. Update Imports

Add these new imports:
```tsx
import { usePretreatmentFormState } from './hooks/usePretreatmentFormState';
import { usePretreatmentData } from './hooks/usePretreatmentData';
import { usePretreatmentCalculations } from './hooks/usePretreatmentCalculations';
import { PlantTrainSelector } from './components/PlantTrainSelector';
```

Remove unused imports: `useMemo`, `Input`, `Checkbox`, `Textarea`, `calc`, `ALERTS`, `evaluateROMeterSpike`, `computeROAverageFlowRate`, `getHourBucket`, `isOfflineRORecord`, `isAnomalyRemarkValid`, `toast`, `friendlyError`, `ComputedInput`, `DateTimePicker`, `AfmRow`.

### 2. Replace State Declarations with Hooks

Replace all individual `useState` calls with:
```tsx
const form = usePretreatmentFormState(trainId, null);
const data = usePretreatmentData(plantId, trainId, form.roValues, form.syncBwOn);
const calc = usePretreatmentCalculations(
  form.roValues, data.prevFeedMeter, data.prevPermMeter, data.prevRejMeter,
  data.prevPowerMeter, data.autoDurationMin, data.avgFeedFlowRate,
  data.avgPermFlowRate, data.avgRejFlowRate, form.anomalyRemarkFeed,
  form.anomalyRemarkPerm, form.anomalyRemarkRej, true,
);
const { syncBwOn, setSyncBwOn, /* ... */ } = form;
```

### 3. Remove Duplicate Data Fetching

Remove trains query, previous readings queries, and status log query (now in `usePretreatmentData`).

### 4. Remove Duplicate Calculations

Remove all inline calculation code (now in `usePretreatmentCalculations`).

### 5. Update Render Section

Replace plant/train selection JSX with `<PlantTrainSelector ... />`.

## Benefits

- **Smaller files**: Each new module is under 10 KB (vs. 61 KB original)
- **Reusability**: The hooks can be used by other components
- **Testability**: Each hook can be unit tested in isolation
- **Maintainability**: Changes are localized to specific modules
