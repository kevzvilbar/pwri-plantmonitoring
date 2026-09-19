import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  MapPin, Activity, Building2, Waves, Droplet, Gauge,
  Thermometer, FlaskConical, Zap, CircleDot,
} from 'lucide-react';
import type { ImportType, ImportTypeConfig, ParsedRow, ColumnDef } from './types';

export const IMPORT_CONFIGS: ImportTypeConfig[] = [
  {
    id: 'locator_readings',
    label: 'Locator Readings',
    description: 'Water supply locator/meter daily readings (raw or direct m³)',
    icon: MapPin,
    color: 'text-info',
    accent: 'bg-info-soft',
    table: 'locator_readings',
    category: 'Operations',
    entityTable: 'locators',
    entityNameKey: 'locator_name',
    entityIdKey: 'locator_id',
    skipColumns: ['daily_volume'],
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
    color: 'text-primary',
    accent: 'bg-primary-soft',
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
    color: 'text-kpi-ro',
    accent: 'bg-kpi-ro/15',
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
  {
    id: 'tds_readings',
    label: 'TDS Readings',
    description: 'Feed, permeate, product & reject TDS/pH per RO train',
    icon: Waves,
    color: 'text-highlight',
    accent: 'bg-highlight-soft',
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
    color: 'text-info',
    accent: 'bg-info-soft',
    table: 'ro_train_readings',
    category: 'RO Trains',
    csvTemplate: 'reading_datetime,train_id,turbidity_ntu,recovery_pct,rejection_pct,salt_passage_pct,feed_pressure_psi,reject_pressure_psi,dp_psi,feed_flow,permeate_flow,reject_flow',
    columns: [
      { key: 'reading_datetime',    label: 'Date/Time',           required: true,  type: 'date' },
      { key: 'train_id',            label: 'Train ID (UUID)',      required: true,  type: 'string', hint: 'RO Train UUID' },
      { key: 'turbidity_ntu',       label: 'Turbidity (NTU)',      required: false, type: 'number' },
      { key: 'recovery_pct',        label: 'Recovery %',           required: false, type: 'number' },
      { key: 'rejection_pct',       label: 'Rejection %',           required: false, type: 'number' },
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
    color: 'text-kpi-solar',
    accent: 'bg-kpi-solar/15',
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
    color: 'text-danger',
    accent: 'bg-danger-soft',
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
  {
    id: 'chemical_dosing',
    label: 'Chemical Dosing',
    description: 'Chlorine, SMBS, anti-scalant, soda ash dosing logs',
    icon: FlaskConical,
    color: 'text-accent',
    accent: 'bg-accent-soft',
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
    color: 'text-kpi-ro',
    accent: 'bg-kpi-ro/15',
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
  {
    id: 'power_readings',
    label: 'Power Readings',
    description: 'kWh meter readings and daily consumption',
    icon: Zap,
    color: 'text-warn',
    accent: 'bg-warn-soft',
    table: 'power_readings',
    category: 'Power',
    csvTemplate: 'reading_datetime,meter_reading_kwh,daily_consumption_kwh',
    columns: [
      { key: 'reading_datetime',      label: 'Date/Time',               required: true,  type: 'date' },
      { key: 'meter_reading_kwh',     label: 'Meter Reading (kWh)',     required: true,  type: 'number' },
      { key: 'daily_consumption_kwh', label: 'Daily Consumption (kWh)', required: false, type: 'number' },
    ],
  },
  {
    id: 'production_costs',
    label: 'Production Costs',
    description: 'Per-m³ production cost records (energy, chemical, labour)',
    icon: CircleDot,
    color: 'text-kpi-grid',
    accent: 'bg-kpi-grid/15',
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

export const CONFIG_MAP = Object.fromEntries(IMPORT_CONFIGS.map(c => [c.id, c])) as Record<ImportType, ImportTypeConfig>;

export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
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

export function autoMapHeaders(
  headers: string[],
  columns: ColumnDef[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of columns) {
    const exact = headers.find(h => h === col.key);
    if (exact) { map[col.key] = exact; continue; }
    const fuzzy = headers.find(h => h.includes(col.key.split('_')[0]));
    if (fuzzy) map[col.key] = fuzzy;
  }
  return map;
}

export function remapRow(
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

export function validateRow(
  row: Record<string, string>,
  config: ImportTypeConfig,
  rowIndex: number,
): ParsedRow {
  const errors: string[] = [];
  for (const col of config.columns) {
    if (col.key === config.entityNameKey) continue;
    if (config.skipColumns?.includes(col.key)) continue;
    const val = row[col.key];
    if (col.required && (!val || val.trim() === '')) {
      errors.push(`"${col.label}" is required`);
    }
    if (val && col.type === 'number' && isNaN(Number(val))) {
      errors.push(`"${col.label}" must be a number`);
    }
  }
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

export async function downloadTemplate(
  config: ImportTypeConfig,
  plantId?: string,
  plants?: Array<{ id: string; name: string }>,
) {
  let sampleRows: string[][] = [];

  if (plantId && config.entityTable && config.entityNameKey) {
    try {
      const { data: entities } = await (supabase
        .from(config.entityTable as any) as any)
        .select('name')
        .eq('plant_id', plantId)
        .limit(5);

      if (entities && entities.length > 0) {
        sampleRows = entities.map((e: any, idx: number) => {
          return config.columns.map(c => {
            if (c.key === config.entityNameKey) return `"${e.name}"`;
            if (c.type === 'date') return `2025-01-15T08:00`;
            if (c.type === 'number') return `${100 + idx * 25}`;
            if (c.type === 'select') return c.selectOptions?.[0] ?? '';
            return '';
          });
        });
      }
    } catch {
      // fallback to generic
    }
  }

  if (sampleRows.length === 0) {
    const example = config.columns.map(c => {
      if (c.type === 'date') return '2025-01-15T08:00';
      if (c.type === 'number') return '100';
      if (c.type === 'select') return c.selectOptions?.[0] ?? '';
      if (c.key.endsWith('_name')) return c.key === 'locator_name' ? 'MCWD - M1' : c.key === 'well_name' ? 'Well #1' : 'Meter A';
      if (c.key === 'train_id') return 'paste-ro-train-uuid-here';
      return '';
    });
    sampleRows.push(example);
  }

  const csvContent = [config.csvTemplate, ...sampleRows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const plantSlug = plants?.find(p => p.id === plantId)?.name?.toLowerCase().replace(/\s+/g, '_') ?? 'general';
  a.download = `template_${config.id}_${plantSlug}.csv`;
  a.click();
}

export const CATEGORY_GROUPS: { label: string; types: ImportType[] }[] = [
  { label: 'Operations', types: ['locator_readings', 'well_readings', 'product_meter_readings'] },
  { label: 'RO Trains', types: ['tds_readings', 'water_quality', 'pump_readings', 'afm_readings'] },
  { label: 'Chemical', types: ['chemical_dosing', 'chemical_deliveries'] },
  { label: 'Power', types: ['power_readings'] },
  { label: 'Finance', types: ['production_costs'] },
];

export { type ImportType, type ImportTypeConfig, type ParsedRow, type ColumnDef };
