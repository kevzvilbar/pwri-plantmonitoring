import type React from 'react';

export interface CsvColumnDef {
  key: string;
  label: string;
  required?: boolean;
  type?: 'string' | 'number' | 'date' | 'select';
  hint?: string;
  selectOptions?: string[];
}

export interface CsvScopedMeta {
  trainId?: string;
  trainLabel?: string;
  dateRange?: { start: string; end: string };
}

export interface CsvImportDialogProps {
  title: string;
  module?: string;
  plantId: string;
  userId?: string | null;
  /** Text shown in expected schema box */
  schemaHint?: string;
  /** Column definitions or list of column header names */
  columns?: (string | CsvColumnDef)[];
  templateFilename: string;
  templateRow?: Record<string, string>;
  templateRows?: Record<string, string>[];
  helpText?: React.ReactNode;
  /** Optional custom parser, defaults to standard CSV text parser */
  parseCSV?: (text: string) => Record<string, string>[];
  /** Custom row validator returning array of error strings (empty if valid) */
  validateRow?: (row: Record<string, string>, index: number) => string[];
  /** Execution callback for inserting rows */
  insertRows: (
    rows: Record<string, string>[],
    plantId: string,
    options?: {
      conflictMode?: 'overwrite' | 'skip';
      scopedMeta?: CsvScopedMeta;
    }
  ) => Promise<{
    count: number;
    skipped?: number;
    errors: string[];
    affectedIds?: string[];
  }>;
  scopedMeta?: CsvScopedMeta;
  conflictMode?: 'prompt' | 'overwrite' | 'skip' | 'none';
  showPreviewTable?: boolean;
  onClose: () => void;
  onImported: () => void;
}
