import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ImportReadingsDialog } from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { PowerMeterChangeDialog } from '@/pages/plants/config/PowerMeters/PowerMeters';
import { ReasonDialog } from '@/components/ReasonDialog';
import { friendlyError } from '@/lib/supabaseErrors';
import { invalidatePowerDash } from '../../shared';
import { validatePowerRow } from '@/lib/readingValidation';
import { insertPowerReadings } from '@/data/mutations/power';
import type { QueryClient } from '@tanstack/react-query';

const POWER_SCHEMA = 'plant_name*, meter_reading_kwh*, reading_datetime* (YYYY-MM-DDTHH:mm), meter_name (optional — for plants with more than one grid meter), solar_meter_reading (optional), solar_input_mode (raw|direct, optional), daily_solar_kwh (optional), daily_grid_kwh (optional)';
const POWER_TEMPLATE_ROW = {
  plant_name: 'Plant A',
  meter_reading_kwh: '12345.6',
  reading_datetime: '2024-06-15T08:30',
  meter_name: '',
  solar_meter_reading: '',
  solar_input_mode: '',
  daily_solar_kwh: '',
  daily_grid_kwh: '',
};
const POWER_TEMPLATE_ROWS = [
  POWER_TEMPLATE_ROW,
  { plant_name: 'Plant B', meter_reading_kwh: '597.18', reading_datetime: '2024-06-15T08:30', meter_name: 'Grid Meter 1', solar_meter_reading: '', solar_input_mode: '', daily_solar_kwh: '', daily_grid_kwh: '' },
  { plant_name: 'Plant B', meter_reading_kwh: '3120.00', reading_datetime: '2024-06-15T08:30', meter_name: 'Grid Meter 2', solar_meter_reading: '', solar_input_mode: '', daily_solar_kwh: '', daily_grid_kwh: '' },
  { plant_name: 'Plant B', meter_reading_kwh: '9110.80', reading_datetime: '2024-06-15T08:30', meter_name: 'Grid Meter 3', solar_meter_reading: '', solar_input_mode: '', daily_solar_kwh: '', daily_grid_kwh: '' },
];
const POWER_HELP_TEXT = 'For plants with more than one grid meter: add one row per meter using the same plant_name and reading_datetime, and set meter_name to that meter\u2019s exact name from Plants \u2192 Power (or its position, e.g. "2"). Leave meter_name blank for single-meter plants.';

interface PowerFormDialogsProps {
  importOpen: boolean;
  setImportOpen: (v: boolean) => void;
  powerHistoryOpen: { type: 'solar' | 'grid'; idx: number } | null;
  setPowerHistoryOpen: (v: { type: 'solar' | 'grid'; idx: number } | null) => void;
  replaceMeterIdx: number | null;
  setReplaceMeterIdx: (v: number | null) => void;
  gapDialogOpen: boolean;
  setGapDialogOpen: (v: boolean) => void;
  gapSaving: boolean;
  setGapSaving: (v: boolean) => void;
  plantId: string;
  plant: any;
  gridMeterCount: number;
  gridMeterNames: string[];
  configMultiplierArr: any;
  configLoading: boolean;
  effectiveMultiplier: number;
  solarInputMode: 'raw' | 'direct';
  powerConfig: any;
  plants: any[];
  todayDateStr: string;
  userId: string | null;
  qc: QueryClient;
}

export function PowerFormDialogs({
  importOpen,
  setImportOpen,
  powerHistoryOpen,
  setPowerHistoryOpen,
  replaceMeterIdx,
  setReplaceMeterIdx,
  gapDialogOpen,
  setGapDialogOpen,
  gapSaving,
  setGapSaving,
  plantId,
  plant,
  gridMeterCount,
  gridMeterNames,
  configMultiplierArr,
  configLoading,
  effectiveMultiplier,
  solarInputMode,
  plants,
  todayDateStr,
  userId,
  qc,
}: PowerFormDialogsProps) {
  const handleGapConfirm = async (category: string, detail: string) => {
    setGapSaving(true);
    const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
      [{
        entity_type: 'power',
        entity_id: plantId,
        plant_id: plantId,
        gap_date: todayDateStr,
        reason_category: category,
        reason_detail: detail || null,
        logged_by: userId,
      }] as any,
      { onConflict: 'entity_type,entity_id,gap_date' },
    );
    setGapSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Power: reason logged');
    setGapDialogOpen(false);
    qc.invalidateQueries({ queryKey: ['power-gap-reason-for-date', plantId, todayDateStr] });
    qc.invalidateQueries({ queryKey: ['pivot-gap-reasons'] });
  };

  return (
    <>
      {importOpen && (
        <ImportReadingsDialog
          title="Import Power Readings from CSV"
          module="power"
          plantId={plantId}
          userId={userId}
          schemaHint={POWER_SCHEMA}
          templateFilename="power_readings_template.csv"
          templateRow={POWER_TEMPLATE_ROW}
          templateRows={POWER_TEMPLATE_ROWS}
          helpText={POWER_HELP_TEXT}
          validateRow={validatePowerRow}
          insertRows={(rows, pid) => insertPowerReadings(rows, pid, userId)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); invalidatePowerDash(qc); }}
        />
      )}
      {powerHistoryOpen && plantId && (
        <ReadingHistoryDialog
          entityName={plants?.find((p: any) => p.id === plantId)?.name ?? 'Plant'}
          module="power"
          entityId={plantId}
          multiplier={effectiveMultiplier}
          gridMeterCount={gridMeterCount}
          gridMeterNames={gridMeterNames}
          gridMultipliers={Array.isArray(configMultiplierArr) ? (configMultiplierArr as any[]).map(Number) : []}
          meterFilter={powerHistoryOpen}
          solarInputMode={solarInputMode}
          onClose={() => setPowerHistoryOpen(null)}
        />
      )}
      {replaceMeterIdx != null && plantId && plant && (
        <PowerMeterChangeDialog
          plant={plant}
          gridMeterCount={gridMeterCount}
          gridMeterNames={gridMeterNames}
          currentMultipliers={Array.isArray(configMultiplierArr) ? (configMultiplierArr as any[]).map(Number) : []}
          initialMeterIndex={replaceMeterIdx}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] })}
          onClose={() => setReplaceMeterIdx(null)}
        />
      )}
      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title="No power reading today — why?"
        description="This explains the gap in Data Summary for today and exempts it from automated backfill. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={handleGapConfirm}
      />
    </>
  );
}

