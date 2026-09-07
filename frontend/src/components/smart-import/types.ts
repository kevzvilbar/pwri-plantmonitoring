import type { ComponentType } from 'react';

export type ImportType =
  | 'locator_readings'
  | 'well_readings'
  | 'product_meter_readings'
  | 'tds_readings'
  | 'water_quality'
  | 'pump_readings'
  | 'afm_readings'
  | 'chemical_dosing'
  | 'chemical_deliveries'
  | 'power_readings'
  | 'production_costs';

export type ParseStatus = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error';

export interface ColumnDef {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  type: 'date' | 'number' | 'string' | 'select';
  selectOptions?: string[];
}

export interface ImportTypeConfig {
  id: ImportType;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  accent: string;
  table: string;
  columns: ColumnDef[];
  csvTemplate: string;
  category: string;
  entityTable?: string;
  entityNameKey?: string;
  entityIdKey?: string;
  computeDailyVolume?: boolean;
  skipColumns?: string[];
  extraInsertFields?: Record<string, unknown>;
}

export interface ParsedRow {
  rowIndex: number;
  data: Record<string, string>;
  errors: string[];
  valid: boolean;
}
