// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { ReasonField } from './LocatorDialogs/ReasonField';
import { EditLocatorDialog } from './LocatorDialogs/EditLocatorDialog';
import { AddLocatorDialog } from './LocatorDialogs/AddLocatorDialog';
import { ReplaceMeterDialog } from './LocatorDialogs/ReplaceMeterDialog';
import { LocatorCsvImportDialog, LOCATOR_CSV_HEADERS } from './LocatorDialogs/LocatorCsvImportDialog';

export { ReasonField, EditLocatorDialog, AddLocatorDialog, ReplaceMeterDialog, LocatorCsvImportDialog, LOCATOR_CSV_HEADERS };
