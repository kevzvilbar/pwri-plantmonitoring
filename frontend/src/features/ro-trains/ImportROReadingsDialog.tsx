import React from 'react';
import { CsvImportDialog } from '@/components/import';
import { parseROCSVText, validateROTrainRow, RO_TRAIN_SCHEMA, RO_TRAIN_TEMPLATE_ROW } from './csv';
import { insertROTrainReadings, type ConflictMode } from './submitROReadings';
import { logReadingEdit } from './helpers';

interface ImportROReadingsDialogProps {
  plantId: string;
  userId: string | null;
  meterConfig?: { permeateIsProduction: boolean };
  trainId?: string;
  trainLabel?: string;
  dateRange?: { start: string; end: string };
  onClose: () => void;
  onImported: () => void;
}

export function ImportROReadingsDialog({
  plantId,
  userId,
  meterConfig,
  trainId,
  trainLabel,
  dateRange,
  onClose,
  onImported,
}: ImportROReadingsDialogProps) {
  const permeateIsProduction = meterConfig?.permeateIsProduction ?? false;
  const isScoped = !!trainId;

  return (
    <CsvImportDialog
      title="Import RO Train Readings from CSV"
      module="ro_trains"
      plantId={plantId}
      userId={userId}
      schemaHint={RO_TRAIN_SCHEMA}
      templateFilename="ro_train_readings_template.csv"
      templateRow={RO_TRAIN_TEMPLATE_ROW}
      parseCSV={parseROCSVText}
      scopedMeta={trainId ? { trainId, trainLabel, dateRange } : undefined}
      validateRow={(r, i) => {
        const rowErrors = validateROTrainRow(r, i);
        return rowErrors.filter((e) => (isScoped ? !e.includes('train_number') : true));
      }}
      insertRows={async (rows, pId, options) => {
        const mode: ConflictMode = options?.conflictMode ?? 'skip';
        const { count, skipped, errors, affectedTrainIds } = await insertROTrainReadings(
          rows,
          pId,
          userId,
          {
            permeateIsProduction,
            conflictMode: mode,
            trainIdOverride: trainId,
            dateRange,
          }
        );

        if (count > 0) {
          logReadingEdit({
            table_name: 'ro_train_readings',
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
