import React from 'react';
import { CsvImportDialog } from '@/components/import';
import {
  parsePretreatCSVText, validatePretreatRow,
  PRETREAT_SCHEMA, PRETREAT_TEMPLATE_ROW,
} from './pretreat-csv';
import { insertPretreatReadings, type PretreatConflictMode } from './submitPretreatReadings';
import { logReadingEdit } from './helpers';

interface ImportPretreatReadingsDialogProps {
  plantId: string;
  userId: string | null;
  trainId?: string;
  trainLabel?: string;
  dateRange?: { start: string; end: string };
  onClose: () => void;
  onImported: () => void;
}

export function ImportPretreatReadingsDialog({
  plantId,
  userId,
  trainId,
  trainLabel,
  dateRange,
  onClose,
  onImported,
}: ImportPretreatReadingsDialogProps) {
  const isScoped = !!trainId;

  return (
    <CsvImportDialog
      title="Import Pre-Treatment Readings from CSV"
      module="ro_pretreatment"
      plantId={plantId}
      userId={userId}
      schemaHint={PRETREAT_SCHEMA}
      templateFilename="pretreat_readings_template.csv"
      templateRow={PRETREAT_TEMPLATE_ROW}
      parseCSV={parsePretreatCSVText}
      scopedMeta={trainId ? { trainId, trainLabel, dateRange } : undefined}
      validateRow={(r, i) => {
        const rowErrors = validatePretreatRow(r, i);
        return rowErrors.filter((e) => (isScoped ? !e.includes('train_number') : true));
      }}
      insertRows={async (rows, pId, options) => {
        const mode: PretreatConflictMode = options?.conflictMode ?? 'skip';
        const { count, skipped, errors, affectedTrainIds } = await insertPretreatReadings(
          rows,
          pId,
          userId,
          {
            conflictMode: mode,
            trainIdOverride: trainId,
            dateRange,
          }
        );

        if (count > 0) {
          logReadingEdit({
            table_name: 'ro_pretreatment_readings',
            record_id: null,
            plant_id: pId,
            train_id: trainId ?? (affectedTrainIds[0] ?? null),
            action: 'import',
            actor_user_id: userId,
            actor_label: null,
            changes: {
              source: 'csv_import',
              row_count: count,
              conflict_mode: mode,
              ...(trainId ? { train_id_override: trainId } : {}),
              ...(dateRange ? { gap_window: dateRange } : {}),
            },
          });
        }

        return { count, skipped, errors, affectedIds: affectedTrainIds };
      }}
      onClose={onClose}
      onImported={onImported}
    />
  );
}
