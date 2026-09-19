import React from 'react';
import { CsvImportDialog } from '@/components/import';
import { logBillingImport } from './importHelpers';

export interface ImportDialogProps {
  title: string;
  module: string;
  plantId: string;
  userId: string | null;
  schemaHint: string;
  templateFilename: string;
  templateRow: Record<string, string>;
  validateRow: (r: Record<string, string>, i: number) => string[];
  insertRows: (rows: Record<string, string>[], plantId: string) => Promise<{ count: number; errors: string[] }>;
  onClose: () => void;
  onImported: () => void;
}

export function ImportReadingsDialog(props: ImportDialogProps) {
  return (
    <CsvImportDialog
      {...props}
      insertRows={async (rows, plantId) => {
        const res = await props.insertRows(rows, plantId);
        await logBillingImport({
          user_id: props.userId,
          plant_id: plantId,
          module: props.module,
          file_name: props.templateFilename,
          row_count: rows.length,
          schema_valid: res.errors.length === 0,
          schema_errors: res.errors,
          timestamp: new Date().toISOString(),
        });
        return { count: res.count, errors: res.errors };
      }}
    />
  );
}
