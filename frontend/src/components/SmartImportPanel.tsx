import { useCallback, useRef, useState } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  Droplet, Zap, FlaskConical, Gauge, Waves, Thermometer,
  ChevronRight, Download, RefreshCw, X, Info, CircleDot, Menu,
  MapPin, Activity, Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ImportType =
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

type ParseStatus = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error';

interface ColumnDef {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  type: 'date' | 'number' | 'string' | 'select';
  selectOptions?: string[];
}

interface ImportTypeConfig {
  id: ImportType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  accent: string;
  table: string;
  columns: ColumnDef[];
  csvTemplate: string;
  category: string;
  // Optional entity-name resolution (locator/well/product_meter)
  entityTable?: string;        // DB table to look up entity by name
  entityNameKey?: string;      // CSV column that holds the entity name
  entityIdKey?: string;        // FK column to write resolved entity UUID into
  computeDailyVolume?: boolean;// Compute & insert daily_volume = max(0, cur - prev)
  skipColumns?: string[];      // Columns to omit from INSERT (e.g. GENERATED ALWAYS)
  extraInsertFields?: Record<string, unknown>;
}

interface ParsedRow {
  rowIndex: number;
  data: Record<string, string>;
  errors: string[];
  valid: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category groups for sidebar
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_GROUPS: { label: string; types: ImportType[] }[] = [
  {
    label: 'Operations',
    types: ['locator_readings', 'well_readings', 'product_meter_readings'],
  },
  {
    label: 'RO Trains',
    types: ['tds_readings', 'water_quality', 'pump_readings', 'afm_readings'],
  },
  {
    label: 'Chemical',
    types: ['chemical_dosing', 'chemical_deliveries'],
  },
  {
    label: 'Power',
    types: ['power_readings'],
  },
  {
    label: 'Finance',
    types: ['production_costs'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Import type registry
// ─────────────────────────────────────────────────────────────────────────────

const IMPORT_CONFIGS: ImportTypeConfig[] = [
  // ── Operations ──────────────────────────────────────────────────────────────
  {
    id: 'locator_readings',
    label: 'Locator Readings',
    description: 'Water supply locator/meter daily readings (raw or direct m³)',
    icon: MapPin,
    color: 'text-sky-700 dark:text-sky-300',
    accent: 'bg-sky-100 dark:bg-sky-900/40',
    table: 'locator_readings',
    category: 'Operations',
    entityTable: 'locators',
    entityNameKey: 'locator_name',
    entityIdKey: 'locator_id',
    skipColumns: ['daily_volume'], // GENERATED ALWAYS AS (current - previous)
    extraInsertFields: { is_estimated: false },
    csvTemplate: 'locator_name,current_reading,reading_datetime,previous_reading,input_mode,daily_volume',
    columns: [
      { key: 'locator_name',    label: 'Locator Name',        required: true,  type: 'string', hint: 'e.g. MCWD - M1' },
      { key: 'current_reading', label: 'Current Reading (m³)',required: false, type: 'number', hint: 'Required if mode=raw' },
      { key: 'reading_datetime',label: 'Date/Time',           required: false, type: 'date',   hint: 'YYYY-MM-DDTHH:mm' },
      { key: 'previous_reading',label: 'Previous Reading',    required: false, type: 'number' },
      { key: 'input_mode',      label: 'Input Mode',          required: false, type: 'select', selectOptions: ['raw', 'direct'], hint: 'Default: raw' },
      { key: 'daily_volume',    label: 'Daily Volume (m³)',   required: false, type: 'number', hint: 'Required if mode=direct' },
    ],
  },
  {
    id: 'well_readings',
    label: 'Well Readings',
    description: 'Groundwater well meter readings with optional power/solar data',
    icon: Activity,
    color: 'text-teal-700 dark:text-teal-300',
    accent: 'bg-teal-100 dark:bg-teal-900/40',
    table: 'well_readings',
    category: 'Operations',
    entityTable: 'wells',
    entityNameKey: 'well_name',
    entityIdKey: 'well_id',
    computeDailyVolume: true,
    csvTemplate: 'well_name,current_reading,reading_datetime,previous_reading,power_meter_reading,solar_meter_reading',
    columns: [
      { key: 'well_name',           label: 'Well Name',              required: true,  type: 'string', hint: 'e.g. Well #1' },
      { key: 'current_reading',     label: 'Current Reading (m³)',   required: true,  type: 'number' },
      { key: 'reading_datetime',    label: 'Date/Time',              required: false, type: 'date',   hint: 'YYYY-MM-DDTHH:mm' },
      { key: 'previous_reading',    label: 'Previous Reading',       required: false, type: 'number' },
      { key: 'power_meter_reading', label: 'Power Meter Reading',    required: false, type: 'number' },
      { key: 'solar_meter_reading', label: 'Solar Meter Reading',    required: false, type: 'number' },
    ],
  },
  {
    id: 'product_meter_readings',
    label: 'Product Meter Readings',
    description: 'Distribution output meter readings per product meter',
    icon: Building2,
    color: 'text-indigo-700 dark:text-indigo-300',
    accent: 'bg-indigo-100 dark:bg-indigo-900/40',
    table: 'product_meter_readings',
    category: 'Operations',
    entityTable: 'product_meters',
    entityNameKey: 'meter_name',
    entityIdKey: 'meter_id',
    computeDailyVolume: true,
    csvTemplate: 'meter_name,current_reading,reading_datetime,previous_reading',
    columns: [
      { key: 'meter_name',       label: 'Meter Name',            required: true,  type: 'string', hint: 'e.g. Zone A Meter' },
      { key: 'current_reading',  label: 'Current Reading (m³)',  required: true,  type: 'number' },
      { key: 'reading_datetime', label: 'Date/Time',             required: false, type: 'date',   hint: 'YYYY-MM-DDTHH:mm' },
      { key: 'previous_reading', label: 'Previous Reading',      required: false, type: 'number' },
    ],
  },
  // ── RO Trains ───────────────────────────────────────────────────────────────
  {
    id: 'tds_readings',
    label: 'TDS Readings',
    description: 'Feed, permeate, product & reject TDS/pH per RO train',
    icon: Waves,
    color: 'text-cyan-700 dark:text-cyan-300',
    accent: 'bg-cyan-100 dark:bg-cyan-900/40',
    table: 'ro_train_readings',
    category: 'RO Trains',
    csvTemplate: 'reading_datetime,train_id,feed_tds,permeate_tds,product_tds,reject_tds,feed_ph,permeate_ph,reject_ph,temperature_c',
    columns: [
      { key: 'reading_datetime', label: 'Reading Date/Time',  required: true,  type: 'date',   hint: 'YYYY-MM-DD HH:mm' },
      { key: 'train_id',         label: 'Train ID (UUID)',     required: true,  type: 'string', hint: 'RO Train UUID' },
      { key: 'feed_tds',         label: 'Feed TDS (ppm)',      required: false, type: 'number' },
      { key: 'permeate_tds',     label: 'Permeate TDS',        required: false, type: 'number' },
      { key: 'product_tds',      label: 'Product TDS',         required: false, type: 'number' },
      { key: 'reject_tds',       label: 'Reject TDS',          required: false, type: 'number' },
      { key: 'feed_ph',          label: 'Feed pH',             required: false, type: 'number' },
      { key: 'permeate_ph',      label: 'Permeate pH',         required: false, type: 'number' },
      { key: 'reject_ph',        label: 'Reject pH',           required: false, type: 'number' },
      { key: 'temperature_c',    label: 'Temperature (°C)',    required: false, type: 'number' },
    ],
  },
  {
    id: 'water_quality',
    label: 'Water Quality',
    description: 'Turbidity, conductivity, recovery %, salt passage & pressure',
    icon: Droplet,
    color: 'text-blue-700 dark:text-blue-300',
    accent: 'bg-blue-100 dark:bg-blue-900/40',
    table: 'ro_train_readings',
    category: 'RO Trains',
    csvTemplate: 'reading_datetime,train_id,turbidity_ntu,recovery_pct,rejection_pct,salt_passage_pct,feed_pressure_psi,reject_pressure_psi,dp_psi,feed_flow,permeate_flow,reject_flow',
    columns: [
      { key: 'reading_datetime',    label: 'Date/Time',           required: true,  type: 'date' },
      { key: 'train_id',            label: 'Train ID (UUID)',      required: true,  type: 'string', hint: 'RO Train UUID' },
      { key: 'turbidity_ntu',       label: 'Turbidity (NTU)',      required: false, type: 'number' },
      { key: 'recovery_pct',        label: 'Recovery %',           required: false, type: 'number' },
      { key: 'rejection_pct',       label: 'Rejection %',          required: false, type: 'number' },
      { key: 'salt_passage_pct',    label: 'Salt Passage %',       required: false, type: 'number' },
      { key: 'feed_pressure_psi',   label: 'Feed Pressure (psi)',  required: false, type: 'number' },
      { key: 'reject_pressure_psi', label: 'Reject Pressure',      required: false, type: 'number' },
      { key: 'dp_psi',              label: 'ΔP (psi)',             required: false, type: 'number' },
      { key: 'feed_flow',           label: 'Feed Flow',            required: false, type: 'number' },
      { key: 'permeate_flow',       label: 'Permeate Flow',        required: false, type: 'number' },
      { key: 'reject_flow',         label: 'Reject Flow',          required: false, type: 'number' },
    ],
  },
  {
    id: 'pump_readings',
    label: 'Pump Readings',
    description: 'HPP / booster pump amps, voltage & pressure per train',
    icon: Gauge,
    color: 'text-orange-700 dark:text-orange-300',
    accent: 'bg-orange-100 dark:bg-orange-900/40',
    table: 'pump_readings',
    category: 'RO Trains',
    csvTemplate: 'reading_datetime,train_id,pump_number,pump_type,l1_amp,l2_amp,l3_amp,voltage,target_pressure_psi',
    columns: [
      { key: 'reading_datetime',    label: 'Date/Time',          required: true,  type: 'date' },
      { key: 'train_id',            label: 'Train ID (UUID)',     required: true,  type: 'string', hint: 'RO Train UUID' },
      { key: 'pump_number',         label: 'Pump Number',         required: true,  type: 'number' },
      { key: 'pump_type',           label: 'Pump Type',           required: true,  type: 'select', selectOptions: ['HPP','booster','feed','dosing'] },
      { key: 'l1_amp',              label: 'L1 Ampere',           required: false, type: 'number' },
      { key: 'l2_amp',              label: 'L2 Ampere',           required: false, type: 'number' },
      { key: 'l3_amp',              label: 'L3 Ampere',           required: false, type: 'number' },
      { key: 'voltage',             label: 'Voltage (V)',         required: false, type: 'number' },
      { key: 'target_pressure_psi', label: 'Target Pressure',     required: false, type: 'number' },
    ],
  },
  {
    id: 'afm_readings',
    label: 'AFM / MMF Readings',
    description: 'Backwash meter, ΔP, inlet/outlet pressure per AFM unit',
    icon: Thermometer,
    color: 'text-rose-700 dark:text-rose-300',
    accent: 'bg-rose-100 dark:bg-rose-900/40',
    table: 'afm_readings',
    category: 'RO Trains',
    csvTemplate: 'reading_datetime,train_id,afm_unit_number,mode,meter_initial,meter_final,backwash_volume,dp_psi,inlet_pressure_psi,outlet_pressure_psi,backwash_start,backwash_end',
    columns: [
      { key: 'reading_datetime',    label: 'Date/Time',            required: true,  type: 'date' },
      { key: 'train_id',            label: 'Train ID (UUID)',       required: true,  type: 'string', hint: 'RO Train UUID' },
      { key: 'afm_unit_number',     label: 'AFM Unit #',           required: true,  type: 'number' },
      { key: 'mode',                label: 'Mode',                  required: true,  type: 'select', selectOptions: ['normal','backwash','bypass','offline'] },
      { key: 'meter_initial',       label: 'Meter Initial',         required: false, type: 'number' },
      { key: 'meter_final',         label: 'Meter Final',           required: false, type: 'number' },
      { key: 'backwash_volume',     label: 'Backwash Vol (m³)',     required: false, type: 'number' },
      { key: 'dp_psi',              label: 'ΔP (psi)',              required: false, type: 'number' },
      { key: 'inlet_pressure_psi',  label: 'Inlet Pressure',        required: false, type: 'number' },
      { key: 'outlet_pressure_psi', label: 'Outlet Pressure',       required: false, type: 'number' },
      { key: 'backwash_start',      label: 'Backwash Start',        required: false, type: 'date' },
      { key: 'backwash_end',        label: 'Backwash End',          required: false, type: 'date' },
    ],
  },
  // ── Chemical ──────────────────────────────────────────────────────────────
  {
    id: 'chemical_dosing',
    label: 'Chemical Dosing',
    description: 'Chlorine, SMBS, anti-scalant, soda ash dosing logs',
    icon: FlaskConical,
    color: 'text-emerald-700 dark:text-emerald-300',
    accent: 'bg-emerald-100 dark:bg-emerald-900/40',
    table: 'chemical_dosing_logs',
    category: 'Chemical',
    csvTemplate: 'log_datetime,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg,free_chlorine_reagent_pcs,product_water_free_cl_ppm',
    columns: [
      { key: 'log_datetime',               label: 'Date/Time',              required: true,  type: 'date' },
      { key: 'chlorine_kg',                label: 'Chlorine (kg)',           required: false, type: 'number' },
      { key: 'smbs_kg',                    label: 'SMBS (kg)',               required: false, type: 'number' },
      { key: 'anti_scalant_l',             label: 'Anti-Scalant (L)',        required: false, type: 'number' },
      { key: 'soda_ash_kg',                label: 'Soda Ash (kg)',           required: false, type: 'number' },
      { key: 'free_chlorine_reagent_pcs',  label: 'Free Cl Reagent (pcs)',  required: false, type: 'number' },
      { key: 'product_water_free_cl_ppm',  label: 'Free Cl (ppm)',          required: false, type: 'number' },
    ],
  },
  {
    id: 'chemical_deliveries',
    label: 'Chemical Deliveries',
    description: 'Bulk chemical delivery records with supplier & cost',
    icon: FlaskConical,
    color: 'text-violet-700 dark:text-violet-300',
    accent: 'bg-violet-100 dark:bg-violet-900/40',
    table: 'chemical_deliveries',
    category: 'Chemical',
    csvTemplate: 'delivery_date,chemical_name,quantity,unit,unit_cost,supplier,remarks',
    columns: [
      { key: 'delivery_date',  label: 'Delivery Date',   required: true,  type: 'date' },
      { key: 'chemical_name',  label: 'Chemical Name',   required: true,  type: 'string', hint: 'e.g. Chlorine, SMBS' },
      { key: 'quantity',       label: 'Quantity',        required: true,  type: 'number' },
      { key: 'unit',           label: 'Unit',            required: true,  type: 'select', selectOptions: ['kg','g','L','mL','pcs','gal'] },
      { key: 'unit_cost',      label: 'Unit Cost',       required: false, type: 'number' },
      { key: 'supplier',       label: 'Supplier',        required: false, type: 'string' },
      { key: 'remarks',        label: 'Remarks',         required: false, type: 'string' },
    ],
  },
  // ── Power ──────────────────────────────────────────────────────────────────
  {
    id: 'power_readings',
    label: 'Power Readings',
    description: 'kWh meter readings and daily consumption',
    icon: Zap,
    color: 'text-amber-700 dark:text-amber-300',
    accent: 'bg-amber-100 dark:bg-amber-900/40',
    table: 'power_readings',
    category: 'Power',
    csvTemplate: 'reading_datetime,meter_reading_kwh,daily_consumption_kwh',
    columns: [
      { key: 'reading_datetime',      label: 'Date/Time',               required: true,  type: 'date' },
      { key: 'meter_reading_kwh',     label: 'Meter Reading (kWh)',     required: true,  type: 'number' },
      { key: 'daily_consumption_kwh', label: 'Daily Consumption (kWh)', required: false, type: 'number' },
    ],
  },
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    id: 'production_costs',
    label: 'Production Costs',
    description: 'Per-m³ production cost records (energy, chemical, labour)',
    icon: CircleDot,
    color: 'text-slate-700 dark:text-slate-300',
    accent: 'bg-slate-100 dark:bg-slate-900/40',
    table: 'production_costs',
    category: 'Finance',
    csvTemplate: 'cost_date,volume_m3,energy_cost,chemical_cost,labour_cost,other_cost,total_cost',
    columns: [
      { key: 'cost_date',     label: 'Date',           required: true,  type: 'date' },
      { key: 'volume_m3',     label: 'Volume (m³)',    required: true,  type: 'number' },
      { key: 'energy_cost',   label: 'Energy Cost',    required: false, type: 'number' },
      { key: 'chemical_cost', label: 'Chemical Cost',  required: false, type: 'number' },
      { key: 'labour_cost',   label: 'Labour Cost',    required: false, type: 'number' },
      { key: 'other_cost',    label: 'Other Cost',     required: false, type: 'number' },
      { key: 'total_cost',    label: 'Total Cost',     required: false, type: 'number' },
    ],
  },
];

// Build a quick lookup map
const CONFIG_MAP = Object.fromEntries(IMPORT_CONFIGS.map(c => [c.id, c])) as Record<ImportType, ImportTypeConfig>;

// ─────────────────────────────────────────────────────────────────────────────
// CSV parser
// ─────────────────────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    // Handle quoted CSV values with commas inside
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cells.push(cur.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function autoMapHeaders(
  headers: string[],
  columns: ColumnDef[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of columns) {
    const exact = headers.find(h => h === col.key);
    if (exact) { map[col.key] = exact; continue; }
    // Fuzzy: first word of col.key in header
    const fuzzy = headers.find(h => h.includes(col.key.split('_')[0]));
    if (fuzzy) map[col.key] = fuzzy;
  }
  return map;
}

// Remap row keys using headerMap so the rest of the code can always use col.key
function remapRow(
  row: Record<string, string>,
  headerMap: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...row };
  for (const [colKey, csvKey] of Object.entries(headerMap)) {
    if (csvKey !== colKey && csvKey in row) {
      out[colKey] = row[csvKey];
    }
  }
  return out;
}

function validateRow(
  row: Record<string, string>,
  config: ImportTypeConfig,
  rowIndex: number,
): ParsedRow {
  const errors: string[] = [];
  for (const col of config.columns) {
    // Skip the entity name column — validated at import time after lookup
    if (col.key === config.entityNameKey) continue;
    // Skip skipColumns
    if (config.skipColumns?.includes(col.key)) continue;
    const val = row[col.key];
    if (col.required && (!val || val.trim() === '')) {
      errors.push(`"${col.label}" is required`);
    }
    if (val && col.type === 'number' && isNaN(Number(val))) {
      errors.push(`"${col.label}" must be a number`);
    }
  }
  // Special cross-field validation for locator input mode
  if (config.id === 'locator_readings') {
    const isDirect = row['input_mode']?.trim().toLowerCase() === 'direct';
    if (isDirect) {
      if (!row['daily_volume']?.trim() || isNaN(Number(row['daily_volume'])) || Number(row['daily_volume']) <= 0) {
        errors.push('"Daily Volume" must be a positive number when input_mode=direct');
      }
    } else {
      if (!row['current_reading']?.trim() || isNaN(Number(row['current_reading']))) {
        errors.push('"Current Reading" is required when input_mode=raw');
      }
    }
  }
  return { rowIndex, data: row, errors, valid: errors.length === 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template download
// ─────────────────────────────────────────────────────────────────────────────

function downloadTemplate(config: ImportTypeConfig) {
  const example = config.columns.map(c => {
    if (c.type === 'date') return '2025-01-15T08:00';
    if (c.type === 'number') return '0';
    if (c.type === 'select') return c.selectOptions?.[0] ?? '';
    if (c.key.endsWith('_name')) return c.key === 'locator_name' ? 'MCWD - M1' : c.key === 'well_name' ? 'Well #1' : 'Meter A';
    if (c.key === 'train_id') return 'paste-ro-train-uuid-here';
    return '';
  });
  const blob = new Blob(
    [config.csvTemplate + '\n' + example.join(',')],
    { type: 'text/csv' },
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `template_${config.id}.csv`;
  a.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ImportTypeCard({
  config, selected, onClick,
}: {
  config: ImportTypeConfig;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = config.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-150 group',
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border hover:border-border/80 hover:bg-muted/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', config.accent)}>
          <Icon className={cn('h-3.5 w-3.5', config.color)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[13px] font-medium truncate leading-tight">{config.label}</span>
            <ChevronRight className={cn(
              'h-3 w-3 shrink-0 transition-transform',
              selected ? 'text-primary rotate-90' : 'text-muted-foreground/40 group-hover:translate-x-0.5',
            )} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">{config.description}</p>
        </div>
      </div>
    </button>
  );
}

function SidebarContent({
  selected, onSelect,
}: {
  selected: ImportType;
  onSelect: (t: ImportType) => void;
}) {
  return (
    <div className="space-y-0.5">
      {CATEGORY_GROUPS.map((group, gi) => {
        const configs = group.types.map(t => CONFIG_MAP[t]).filter(Boolean);
        return (
          <div key={group.label} className={cn(gi > 0 && 'pt-2')}>
            <p className={cn(
              'text-[9.5px] font-bold tracking-[0.12em] uppercase px-1 mb-1',
              gi > 0 && 'border-t border-border/50 pt-2',
              'text-muted-foreground/50',
            )}>
              {group.label}
            </p>
            <div className="space-y-1">
              {configs.map(c => (
                <ImportTypeCard
                  key={c.id}
                  config={c}
                  selected={selected === c.id}
                  onClick={() => onSelect(c.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DropZone({
  onFile, file, onClear,
}: {
  onFile: (f: File) => void;
  file: File | null;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      className={cn(
        'relative rounded-lg border-2 border-dashed transition-colors cursor-pointer',
        file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30',
      )}
      onClick={() => !file && ref.current?.click()}
    >
      <input
        ref={ref}
        type="file"
        accept=".csv,.txt"
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      {file ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onClear(); }}
            className="rounded p-1 hover:bg-muted transition-colors"
            aria-label="Remove file"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-7 text-center">
          <Upload className="h-5 w-5 text-muted-foreground/50" />
          <div>
            <p className="text-sm text-muted-foreground">
              Drop a <span className="font-medium text-foreground">.csv</span> or{' '}
              <span className="font-medium text-foreground">.txt</span> file here
            </p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">or click to browse</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnReference({ config }: { config: ImportTypeConfig }) {
  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <div className="px-3 py-1.5 border-b bg-muted/50 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Expected Columns
        </span>
        <button
          onClick={() => downloadTemplate(config)}
          className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
        >
          <Download className="h-3 w-3" /> CSV Template
        </button>
      </div>
      <div className="divide-y">
        {config.columns.map(col => (
          <div key={col.key} className="flex items-center gap-2 px-3 py-[5px]">
            <code className="text-[10px] font-mono bg-background border rounded px-1.5 py-px shrink-0 whitespace-nowrap leading-tight">
              {col.key}
            </code>
            <span className="text-[11px] font-medium flex-1 min-w-0 truncate leading-tight" title={col.label}>
              {col.label}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {col.required && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-rose-300 text-rose-600 dark:text-rose-400 leading-none">
                  req
                </Badge>
              )}
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-muted-foreground leading-none">
                {col.type}
              </Badge>
              {col.hint && (
                <span className="text-[9px] text-muted-foreground/50 italic hidden sm:inline max-w-[90px] truncate" title={col.hint}>
                  {col.hint}
                </span>
              )}
              {col.type === 'select' && col.selectOptions && (
                <span className="text-[9px] text-muted-foreground/50 italic hidden sm:inline max-w-[100px] truncate" title={col.selectOptions.join(', ')}>
                  {col.selectOptions.join('/')}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {/* Entity note */}
      {config.entityTable && (
        <div className="flex items-start gap-2 px-3 py-2 border-t bg-amber-50/60 dark:bg-amber-950/20">
          <Info className="h-3 w-3 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[10.5px] text-amber-700 dark:text-amber-300">
            <span className="font-medium">{config.entityNameKey?.replace(/_/g, ' ')}</span> is matched by name to existing{' '}
            {config.entityTable} in the selected plant — make sure names match exactly.
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewTable({ rows, config }: { rows: ParsedRow[]; config: ImportTypeConfig }) {
  const visibleCols = config.columns.slice(0, 6);
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="w-8 px-2 py-2 text-left text-muted-foreground font-medium">#</th>
              {visibleCols.map(c => (
                <th key={c.key} className="px-2.5 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              <th className="px-2.5 py-2 text-left font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, 50).map(row => (
              <tr
                key={row.rowIndex}
                className={cn(
                  'transition-colors',
                  row.valid ? 'hover:bg-muted/20' : 'bg-rose-50/50 dark:bg-rose-950/20',
                )}
              >
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{row.rowIndex + 1}</td>
                {visibleCols.map(c => (
                  <td key={c.key} className="px-2.5 py-1.5 max-w-[120px] truncate" title={row.data[c.key]}>
                    {row.data[c.key] || <span className="text-muted-foreground/40">—</span>}
                  </td>
                ))}
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  {row.valid ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> OK
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 cursor-help"
                      title={row.errors.join('; ')}
                    >
                      <XCircle className="h-3 w-3" />
                      {row.errors.length} error{row.errors.length > 1 ? 's' : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          Showing first 50 of {rows.length} rows
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function SmartImportPanel() {
  const { data: plants } = usePlants();

  const [selected, setSelected] = useState<ImportType>('locator_readings');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [plantId, setPlantId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ParseStatus>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [skipInvalid, setSkipInvalid] = useState(true);

  const config = CONFIG_MAP[selected];

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setStatus('parsing');
    setParsedRows([]);
    setImportLog([]);

    try {
      const text = await f.text();
      const { headers, rows } = parseCSV(text);

      if (!headers.length) {
        toast.error('Could not parse CSV — check format');
        setStatus('error');
        return;
      }

      const map = autoMapHeaders(headers, config.columns);
      setHeaderMap(map);

      // Remap rows so data is keyed by col.key not csv header
      const remapped = rows.map(r => remapRow(r, map));
      const parsed = remapped.map((row, i) => validateRow(row, config, i));
      setParsedRows(parsed);
      setStatus('preview');
    } catch {
      toast.error('Failed to read file');
      setStatus('error');
    }
  }, [config]);

  const handleClear = useCallback(() => {
    setFile(null);
    setParsedRows([]);
    setHeaderMap({});
    setStatus('idle');
    setImportProgress(0);
    setImportLog([]);
  }, []);

  const handleSelectType = useCallback((t: ImportType) => {
    setSelected(t);
    setSidebarOpen(false);
    handleClear();
  }, [handleClear]);

  // ── Import ─────────────────────────────────────────────────────────────────
  const runImport = useCallback(async () => {
    if (!plantId) { toast.error('Select a plant first'); return; }
    const rows = skipInvalid ? parsedRows.filter(r => r.valid) : parsedRows;
    if (!rows.length) { toast.error('No valid rows to import'); return; }

    setStatus('importing');
    setImportProgress(0);
    setImportLog([]);
    const log: string[] = [];

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;

    // ── Entity-based imports: resolve names → IDs ──────────────────────────
    let entityNameToId: Record<string, string> = {};
    if (config.entityTable && config.entityNameKey && config.entityIdKey) {
      const { data: entities, error: entErr } = await (supabase
        .from(config.entityTable as any) as any)
        .select('id, name')
        .eq('plant_id', plantId);

      if (entErr) {
        toast.error(`Failed to load ${config.entityTable}: ${entErr.message}`);
        setStatus('error');
        return;
      }
      (entities ?? []).forEach((e: any) => {
        entityNameToId[e.name.trim().toLowerCase()] = e.id;
      });
    }

    let done = 0;
    const batchSize = 50;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const insertBatch: Record<string, unknown>[] = [];
      const batchErrors: string[] = [];

      for (const r of batch) {
        const obj: Record<string, unknown> = {
          plant_id: plantId,
          recorded_by: userId,
          ...(config.extraInsertFields ?? {}),
        };

        // Resolve entity name → ID for entity-based imports
        if (config.entityTable && config.entityNameKey && config.entityIdKey) {
          const rawName = r.data[config.entityNameKey]?.trim() ?? '';
          const entityId = entityNameToId[rawName.toLowerCase()];
          if (!entityId) {
            batchErrors.push(`Row ${r.rowIndex + 1}: ${config.entityNameKey?.replace(/_/g, ' ')} "${rawName}" not found in plant — skipped`);
            continue;
          }
          obj[config.entityIdKey] = entityId;
        }

        // Map column values
        for (const col of config.columns) {
          if (col.key === config.entityNameKey) continue; // resolved above
          if (config.skipColumns?.includes(col.key)) continue;
          const raw = r.data[col.key] ?? '';
          if (!raw) continue;
          if (col.type === 'number') {
            const n = parseFloat(raw);
            if (!isNaN(n)) obj[col.key] = n;
          } else {
            obj[col.key] = raw;
          }
        }

        // Handle locator_readings input_mode=direct
        if (config.id === 'locator_readings') {
          const isDirect = (r.data['input_mode'] ?? '').toLowerCase() === 'direct';
          if (isDirect) {
            // direct mode: store previous_reading as current to preserve cumulative sequence
            const prev = r.data['previous_reading'] ? parseFloat(r.data['previous_reading']) : 0;
            obj['current_reading'] = prev;
            obj['previous_reading'] = prev || null;
            // daily_volume is GENERATED ALWAYS — skip (already in skipColumns)
          }
        }

        // Compute daily_volume for well/product_meter (not generated — we must insert)
        if (config.computeDailyVolume) {
          const cur = parseFloat(r.data['current_reading'] ?? '');
          const prev = r.data['previous_reading'] ? parseFloat(r.data['previous_reading']) : null;
          if (!isNaN(cur)) {
            const delta = prev != null && !isNaN(prev) ? Math.max(0, cur - prev) : null;
            if (delta != null) obj['daily_volume'] = delta;
          }
        }

        // solar_meter_reading: only include when non-empty (schema guard)
        if (config.id === 'well_readings' && !r.data['solar_meter_reading']?.trim()) {
          delete obj['solar_meter_reading'];
        }

        insertBatch.push(obj);
      }

      // Flush batch errors
      batchErrors.forEach(e => log.push(`⚠ ${e}`));

      if (insertBatch.length > 0) {
        const { error } = await (supabase.from(config.table as any) as any).insert(insertBatch);
        done += insertBatch.length;
        setImportProgress(Math.round((done / rows.length) * 100));

        if (error) {
          log.push(`❌ Batch ${Math.ceil(i / batchSize) + 1}: ${error.message}`);
        } else {
          log.push(`✓ Rows ${i + 1}–${Math.min(i + batchSize, rows.length)} inserted (${insertBatch.length})`);
        }
      }
      setImportLog([...log]);
    }

    setStatus('done');
    const errCount = log.filter(l => l.startsWith('❌')).length;
    const warnCount = log.filter(l => l.startsWith('⚠')).length;
    if (errCount === 0 && warnCount === 0) {
      toast.success(`${rows.length} row(s) imported to ${config.label}`);
    } else if (errCount > 0) {
      toast.warning(`Import done — ${errCount} batch error(s)`);
    } else {
      toast.warning(`Import done — ${warnCount} row(s) skipped (entity not found)`);
    }
  }, [plantId, parsedRows, skipInvalid, config]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const validCount = parsedRows.filter(r => r.valid).length;
  const invalidCount = parsedRows.length - validCount;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Smart Import</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Select a type, upload a CSV, review, then sync to the database.
          </p>
        </div>
        {/* Mobile: compact type button */}
        <button
          className="lg:hidden mt-1 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors shrink-0"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-3.5 w-3.5" />
          <span className={cn('flex h-4 w-4 items-center justify-center rounded-sm shrink-0', config.accent)}>
            <config.icon className={cn('h-2.5 w-2.5', config.color)} />
          </span>
          <span className="truncate max-w-[100px]">{config.label}</span>
        </button>
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-10 flex flex-col w-72 max-w-[85vw] h-full bg-background border-r shadow-xl animate-in slide-in-from-left-4 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Import Type</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded p-1 hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <SidebarContent selected={selected} onSelect={handleSelectType} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
        {/* Left: type selector (desktop) */}
        <Card className="p-3 hidden lg:block sticky top-20">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50 px-0.5 mb-2">
            Import Type
          </p>
          <SidebarContent selected={selected} onSelect={handleSelectType} />
        </Card>

        {/* Right: main panel */}
        <div className="space-y-3 min-w-0">
          {/* Config card */}
          <Card className="p-4 space-y-3">
            {/* Type header */}
            <div className="flex items-center gap-3">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', config.accent)}>
                <config.icon className={cn('h-4 w-4', config.color)} />
              </span>
              <div>
                <h2 className="text-sm font-semibold">{config.label}</h2>
                <p className="text-xs text-muted-foreground">{config.description}</p>
              </div>
              <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 h-5 text-muted-foreground shrink-0">
                {config.category}
              </Badge>
            </div>

            {/* Plant + skip-invalid row */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1 flex-1 min-w-[160px]">
                <Label className="text-xs">
                  Target Plant <span className="text-rose-500">*</span>
                </Label>
                <Select value={plantId} onValueChange={setPlantId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Pick a plant…" />
                  </SelectTrigger>
                  <SelectContent>
                    {plants?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pb-px shrink-0">
                <button
                  role="switch"
                  aria-checked={skipInvalid}
                  onClick={() => setSkipInvalid(v => !v)}
                  className={cn(
                    'relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    skipInvalid ? 'bg-primary' : 'bg-input',
                  )}
                >
                  <span className={cn(
                    'pointer-events-none block h-3 w-3 rounded-full bg-white shadow ring-0 transition-transform',
                    skipInvalid ? 'translate-x-4' : 'translate-x-0',
                  )} />
                </button>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">Skip invalid</span>
              </div>
            </div>

            {/* Drop zone */}
            <div className="space-y-1">
              <Label className="text-xs">CSV File</Label>
              <DropZone file={file} onFile={handleFile} onClear={handleClear} />
              {status === 'parsing' && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Parsing…
                </div>
              )}
            </div>
          </Card>

          {/* Column reference */}
          <ColumnReference config={config} />

          {/* Preview */}
          {status === 'preview' && parsedRows.length > 0 && (
            <Card className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Preview</span>
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 dark:text-emerald-400 gap-1 text-[11px] px-1.5 py-0">
                  <CheckCircle2 className="h-3 w-3" /> {validCount} valid
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="outline" className="text-rose-600 border-rose-300 dark:text-rose-400 gap-1 text-[11px] px-1.5 py-0">
                    <XCircle className="h-3 w-3" /> {invalidCount} invalid
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''} total
                </span>
              </div>

              {invalidCount > 0 && skipInvalid && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {invalidCount} row(s) will be skipped. Hover an error badge for details.
                </div>
              )}

              <PreviewTable rows={parsedRows} config={config} />

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleClear}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={runImport}
                  disabled={!plantId || (skipInvalid ? validCount === 0 : parsedRows.length === 0)}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Import {skipInvalid ? validCount : parsedRows.length} row{(skipInvalid ? validCount : parsedRows.length) !== 1 ? 's' : ''}
                </Button>
              </div>
            </Card>
          )}

          {/* Import progress */}
          {(status === 'importing' || status === 'done') && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {status === 'importing' ? 'Importing…' : 'Import Complete'}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{importProgress}%</span>
              </div>
              <Progress value={importProgress} className="h-1.5" />
              <div className="max-h-40 overflow-y-auto rounded-md bg-muted/40 p-2 space-y-0.5">
                {importLog.map((line, i) => (
                  <p key={i} className={cn(
                    'text-[11px] font-mono',
                    line.startsWith('❌') ? 'text-rose-600 dark:text-rose-400' :
                    line.startsWith('⚠') ? 'text-amber-600 dark:text-amber-400' :
                    'text-muted-foreground',
                  )}>
                    {line}
                  </p>
                ))}
              </div>
              {status === 'done' && (
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={handleClear}>Import Another File</Button>
                </div>
              )}
            </Card>
          )}

          {/* Error state */}
          {status === 'error' && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <XCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Parse failed — check file format</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Make sure it's a valid CSV with the expected headers.{' '}
                <button onClick={() => downloadTemplate(config)} className="text-primary underline underline-offset-2">
                  Download a template
                </button>{' '}
                to see the exact format.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleClear}>Try again</Button>
            </Card>
          )}

          {/* Idle / how-to */}
          {status === 'idle' && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Pick an import type, select a plant, then drop a CSV that matches the columns above.{' '}
                <button onClick={() => downloadTemplate(config)} className="text-primary underline underline-offset-2">
                  Download a template
                </button>{' '}
                for <span className="font-medium text-foreground">{config.label}</span>.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
