// Thin re-export — keeps lazy(() => import('./pages/Plants')) unchanged
// All logic now lives in ./plants/index.tsx
export { default } from './plants/index';

// Named exports consumed by other pages (e.g. ROTrains.tsx imports usePlantMeterConfig)
export { usePlantMeterConfig } from './plants/shared';
export type { PlantMeterConfig, PermeateProductionPeriod } from './plants/shared';
