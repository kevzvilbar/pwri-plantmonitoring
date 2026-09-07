import { Building2, MapPin, Waves, FlaskConical, Zap, Wrench, BarChart2 } from 'lucide-react';
import { format, subDays } from 'date-fns';

export interface ExportTable {
  id: string;
  label: string;
  description: string;
  dateCol?: string;
  noPlantFilter?: boolean;
}

export interface ExportCategory {
  label: string;
  icon: React.ElementType;
  color: string;
  accent: string;
  tables: ExportTable[];
}

export const EXPORT_CATEGORIES: ExportCategory[] = [
  {
    label: 'Plant Overview',
    icon: Building2,
    color: 'text-primary',
    accent: 'bg-primary-soft',
    tables: [
      { id: 'daily_plant_summary',   label: 'Daily Plant Summary',     description: 'Aggregated daily production, NRW and consumption totals', dateCol: 'summary_date' },
      { id: 'production_costs',      label: 'Production Costs',         description: 'Per-m³ cost records: energy, chemical, labour, other',    dateCol: 'cost_date' },
    ],
  },
  {
    label: 'Operations',
    icon: MapPin,
    color: 'text-info',
    accent: 'bg-info-soft',
    tables: [
      { id: 'locator_readings',      label: 'Locator Readings',         description: 'Water supply locator / meter daily cumulative readings',   dateCol: 'reading_datetime' },
      { id: 'well_readings',         label: 'Well Readings',             description: 'Groundwater well meter readings with power/solar data',    dateCol: 'reading_datetime' },
      { id: 'product_meter_readings',label: 'Product Meter Readings',   description: 'Distribution output meter readings per product meter',     dateCol: 'reading_datetime' },
      { id: 'blending_events',       label: 'Blending Events',          description: 'Well blending volume events and audit records',            dateCol: 'event_date' },
    ],
  },
  {
    label: 'RO Trains',
    icon: Waves,
    color: 'text-highlight',
    accent: 'bg-highlight-soft',
    tables: [
      { id: 'ro_train_readings',        label: 'RO Train Readings',      description: 'TDS, pH, flow, pressure and quality readings per train', dateCol: 'reading_datetime' },
      { id: 'ro_pretreatment_readings', label: 'Pre-Treatment Readings', description: 'AFM/MMF pre-treatment sensor and flow data',             dateCol: 'reading_datetime' },
      { id: 'pump_readings',            label: 'Pump Readings',          description: 'HPP / booster pump amps, voltage and pressure',          dateCol: 'reading_datetime' },
      { id: 'afm_readings',             label: 'AFM / MMF Readings',     description: 'Backwash meter, ΔP and inlet/outlet pressure per unit',  dateCol: 'reading_datetime' },
      { id: 'cip_logs',                 label: 'CIP Logs',               description: 'Clean-in-place run records per train',                    dateCol: 'start_datetime' },
    ],
  },
  {
    label: 'Chemical',
    icon: FlaskConical,
    color: 'text-accent',
    accent: 'bg-accent-soft',
    tables: [
      { id: 'chemical_dosing_logs',      label: 'Chemical Dosing Logs',     description: 'Chlorine, SMBS, anti-scalant, soda ash daily dosing',    dateCol: 'log_datetime' },
      { id: 'chemical_deliveries',       label: 'Chemical Deliveries',      description: 'Bulk delivery records with supplier, quantity and cost',  dateCol: 'delivery_date' },
      { id: 'chemical_prices',           label: 'Chemical Prices',          description: 'Unit price history per chemical type',                    dateCol: 'effective_date', noPlantFilter: true },
      { id: 'chemical_inventory',        label: 'Chemical Inventory',       description: 'Current stock levels and low-stock thresholds',           dateCol: undefined },
      { id: 'chemical_residual_samples', label: 'Chemical Residual Samples',description: 'Free chlorine and residual sample readings',             dateCol: 'sampled_at' },
    ],
  },
  {
    label: 'Power',
    icon: Zap,
    color: 'text-warn',
    accent: 'bg-warn-soft',
    tables: [
      { id: 'power_readings',  label: 'Power Readings',  description: 'kWh meter readings and daily consumption logs',           dateCol: 'reading_datetime' },
      { id: 'electric_bills',  label: 'Electric Bills',  description: 'Monthly electricity billing records',                      dateCol: 'billing_month' },
      { id: 'power_tariffs',   label: 'Power Tariffs',   description: 'Tariff rate history with effective dates',                  dateCol: 'effective_date', noPlantFilter: true },
    ],
  },
  {
    label: 'Maintenance',
    icon: Wrench,
    color: 'text-kpi-solar',
    accent: 'bg-kpi-solar/15',
    tables: [
      { id: 'incidents',            label: 'Incidents',              description: 'Incident reports with severity, status and resolution',  dateCol: 'when_datetime' },
      { id: 'checklist_executions', label: 'PM Checklist Executions',description: 'Preventive maintenance checklist run records',          dateCol: 'executed_at' },
      { id: 'well_pms_records',     label: 'Well PM Records',        description: 'Well preventive maintenance inspection data',           dateCol: 'date_gathered' },
    ],
  },
  {
    label: 'Analysis & Audit',
    icon: BarChart2,
    color: 'text-kpi-ro',
    accent: 'bg-kpi-ro/15',
    tables: [
      { id: 'reading_normalizations', label: 'Reading Normalizations', description: 'Anomaly flags, corrections and retraction audit log',   dateCol: 'performed_at',  noPlantFilter: true },
      { id: 'regression_results',     label: 'Regression Results',     description: 'AI/ML regression model outputs per reading table',      dateCol: 'computed_at',   noPlantFilter: true },
    ],
  },
];

export const ALL_TABLES = EXPORT_CATEGORIES.flatMap(c => c.tables);

export const PRESETS = [
  { label: '7D',  days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y',  days: 365 },
] as const;

export function applyPreset(days: number, setFrom: (s: string) => void, setTo: (s: string) => void) {
  setFrom(format(subDays(new Date(), days), 'yyyy-MM-dd'));
  setTo(format(new Date(), 'yyyy-MM-dd'));
}
