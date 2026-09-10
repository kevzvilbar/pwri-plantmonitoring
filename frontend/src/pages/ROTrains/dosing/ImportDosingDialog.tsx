import React from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { CsvImportDialog } from '@/components/import';
import { validateDosingRow } from './validateDosingRow';

const DOSING_CSV_SCHEMA =
  'plant_name*, log_datetime (YYYY-MM-DDTHH:mm), chlorine_kg, smbs_kg, anti_scalant_l, ' +
  'soda_ash_kg, free_chlorine_reagent_pcs, remarks';

const DOSING_TEMPLATE_ROW: Record<string, string> = {
  plant_name: 'Umapad',
  log_datetime: '2024-06-15T08:30',
  chlorine_kg: '1.5',
  smbs_kg: '',
  anti_scalant_l: '2.0',
  soda_ash_kg: '',
  free_chlorine_reagent_pcs: '2',
  remarks: '',
};

export function ImportDosingDialog({
  plantId,
  userId,
  onClose,
  onImported,
}: {
  plantId: string;
  userId: string | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const { data: plants } = usePlants();

  return (
    <CsvImportDialog
      title="Import Chemical Dosing Log from CSV"
      module="chemical_dosing"
      plantId={plantId}
      userId={userId}
      schemaHint={DOSING_CSV_SCHEMA}
      templateFilename="dosing_log_template.csv"
      templateRow={DOSING_TEMPLATE_ROW}
      validateRow={(r, i) => validateDosingRow(r, i)}
      insertRows={async (rows, defaultPlantId, options) => {
        let count = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const r of rows) {
          const plant = plants?.find(
            (p) => p.name.toLowerCase() === r.plant_name?.trim().toLowerCase()
          );
          const pid = plant?.id || defaultPlantId;
          if (!pid) {
            errors.push(`Plant not found: "${r.plant_name}"`);
            continue;
          }

          const dt = r.log_datetime?.trim()
            ? new Date(r.log_datetime.replace(' ', 'T')).toISOString()
            : new Date().toISOString();
          const dtMin = dt.slice(0, 16);

          // Check existing record
          const { data: existing } = await supabase
            .from('chemical_dosing_logs')
            .select('id')
            .eq('plant_id', pid)
            .gte('log_datetime', `${dtMin}:00`)
            .lte('log_datetime', `${dtMin}:59`)
            .limit(1);

          const existingId = existing?.[0]?.id ?? null;
          if (existingId && options?.conflictMode === 'skip') {
            skipped++;
            continue;
          }

          const num = (k: string) => (r[k]?.trim() ? +r[k] : 0);
          const payload: Record<string, any> = {
            plant_id: pid,
            log_datetime: dt,
            chlorine_kg: num('chlorine_kg'),
            smbs_kg: num('smbs_kg'),
            anti_scalant_l: num('anti_scalant_l'),
            soda_ash_kg: num('soda_ash_kg'),
            free_chlorine_reagent_pcs: num('free_chlorine_reagent_pcs'),
            recorded_by: userId,
          };
          if (r.remarks?.trim()) payload.remarks = r.remarks.trim();

          if (existingId) {
            const { error } = await supabase
              .from('chemical_dosing_logs')
              .update(payload as any)
              .eq('id', existingId);
            if (error) errors.push(`Row update error: ${error.message}`);
            else count++;
          } else {
            const { error } = await supabase
              .from('chemical_dosing_logs')
              .insert(payload as any);
            if (error) errors.push(`Row insert error: ${error.message}`);
            else count++;
          }
        }

        return { count, skipped, errors };
      }}
      onClose={onClose}
      onImported={onImported}
    />
  );
}
