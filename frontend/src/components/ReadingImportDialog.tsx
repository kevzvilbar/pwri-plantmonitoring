import React from 'react';
import { CsvImportDialog } from '@/components/import';
import {
  parseCSVLine,
  parseCSVText,
  triggerTemplateDownload,
  normalizeDatetime,
  computeIntraFileDuplicateIndices,
  clearDupDecisions,
  clearBulkDupDecision,
  setBulkDupDecision,
  resolveDupPrompt,
  resolveImportDuplicate,
  setDupShowPrompt,
  clearDupShowPrompt,
  logReadingImport,
} from '@/components/ReadingImportDialog/utils';

export {
  parseCSVLine,
  parseCSVText,
  triggerTemplateDownload,
  normalizeDatetime,
  computeIntraFileDuplicateIndices,
  clearDupDecisions,
  clearBulkDupDecision,
  setBulkDupDecision,
  resolveDupPrompt,
  resolveImportDuplicate,
  setDupShowPrompt,
  clearDupShowPrompt,
  logReadingImport,
};

export interface ImportDialogProps {
  title: string;
  module: string;
  plantId: string;
  userId: string | null;
  schemaHint: string;
  templateFilename: string;
  templateRow: Record<string, string>;
  templateRows?: Record<string, string>[];
  helpText?: React.ReactNode;
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
        return { count: res.count, errors: res.errors };
      }}
    />
  );
}
