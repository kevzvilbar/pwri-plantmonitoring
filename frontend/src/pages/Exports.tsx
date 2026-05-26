import { useState, useCallback } from 'react';
import {
  Download, Building2, Activity, Waves, FlaskConical,
  Zap, Wrench, ShieldCheck, MapPin, BarChart2, ChevronDown,
  CheckCircle2, Loader2, RefreshCw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/lib/csv';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// ─────────────────────────────────────────────────────────────────────────────
// Table registry
// ─────────────────────────────────────────────────────────────────────────────

interface ExportTable {
  id: string;
  label: string;
  description: string;
  dateCol?: string;
  noPlantFilter?: boolean; // some tables have no plant_id column
}

interface ExportCategory {
  label: string;
  icon: React.ElementType;
  color: string;
  accent: string;
  tables: ExportTable[];
}

const EXPORT_CATEGORIES: ExportCategory[] = [
  {
    label: 'Plant Overview',
    icon: Building2,
    color: 'text-teal-700 dark:text-teal-300',
    accent: 'bg-teal-100 dark:bg-teal-900/40',
    tables: [
      { id: 'daily_plant_summary',   label: 'Daily Plant Summary',     description: 'Aggregated daily production, NRW and consumption totals', dateCol: 'summary_date' },
      { id: 'production_costs',      label: 'Production Costs',         description: 'Per-m³ cost records: energy, chemical, labour, other',    dateCol: 'cost_date' },
    ],
  },
  {
    label: 'Operations',
    icon: MapPin,
    color: 'text-sky-700 dark:text-sky-300',
    accent: 'bg-sky-100 dark:bg-sky-900/40',
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
    color: 'text-cyan-700 dark:text-cyan-300',
    accent: 'bg-cyan-100 dark:bg-cyan-900/40',
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
    color: 'text-emerald-700 dark:text-emerald-300',
    accent: 'bg-emerald-100 dark:bg-emerald-900/40',
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
    color: 'text-amber-700 dark:text-amber-300',
    accent: 'bg-amber-100 dark:bg-amber-900/40',
    tables: [
      { id: 'power_readings',  label: 'Power Readings',  description: 'kWh meter readings and daily consumption logs',           dateCol: 'reading_datetime' },
      { id: 'electric_bills',  label: 'Electric Bills',  description: 'Monthly electricity billing records',                      dateCol: 'billing_month' },
      { id: 'power_tariffs',   label: 'Power Tariffs',   description: 'Tariff rate history with effective dates',                  dateCol: 'effective_date', noPlantFilter: true },
    ],
  },
  {
    label: 'Maintenance',
    icon: Wrench,
    color: 'text-orange-700 dark:text-orange-300',
    accent: 'bg-orange-100 dark:bg-orange-900/40',
    tables: [
      { id: 'incidents',            label: 'Incidents',              description: 'Incident reports with severity, status and resolution',  dateCol: 'when_datetime' },
      { id: 'checklist_executions', label: 'PM Checklist Executions',description: 'Preventive maintenance checklist run records',          dateCol: 'executed_at' },
      { id: 'well_pms_records',     label: 'Well PM Records',        description: 'Well preventive maintenance inspection data',           dateCol: 'date_gathered' },
    ],
  },
  {
    label: 'Analysis & Audit',
    icon: BarChart2,
    color: 'text-violet-700 dark:text-violet-300',
    accent: 'bg-violet-100 dark:bg-violet-900/40',
    tables: [
      { id: 'reading_normalizations', label: 'Reading Normalizations', description: 'Anomaly flags, corrections and retraction audit log',   dateCol: 'performed_at',  noPlantFilter: true },
      { id: 'regression_results',     label: 'Regression Results',     description: 'AI/ML regression model outputs per reading table',      dateCol: 'computed_at',   noPlantFilter: true },
    ],
  },
];

// Flat list for "export all"
const ALL_TABLES = EXPORT_CATEGORIES.flatMap(c => c.tables);

// ─────────────────────────────────────────────────────────────────────────────
// Date preset helpers
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '7D',  days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y',  days: 365 },
] as const;

function applyPreset(days: number, setFrom: (s: string) => void, setTo: (s: string) => void) {
  setFrom(format(subDays(new Date(), days), 'yyyy-MM-dd'));
  setTo(format(new Date(), 'yyyy-MM-dd'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Export engine
// ─────────────────────────────────────────────────────────────────────────────

async function runExport(
  table: ExportTable,
  plantId: string,
  from: string,
  to: string,
): Promise<{ count: number } | null> {
  let q = (supabase.from(table.id as any) as any).select('*').limit(50_000);
  if (plantId !== 'all' && !table.noPlantFilter) {
    q = q.eq('plant_id', plantId);
  }
  if (table.dateCol) {
    q = q.gte(table.dateCol, from).lte(table.dateCol, `${to}T23:59:59`);
  }
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) return null;
  downloadCSV(`${table.id}_${from}_to_${to}.csv`, data);
  return { count: data.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ExportRow({
  table,
  plantId,
  from,
  to,
}: {
  table: ExportTable;
  plantId: string;
  from: string;
  to: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'empty'>('idle');
  const [count, setCount] = useState<number | null>(null);

  const doExport = useCallback(async () => {
    setState('busy');
    try {
      const res = await runExport(table, plantId, from, to);
      if (!res) {
        setState('empty');
        toast.info(`No rows found in ${table.label}`);
        setTimeout(() => setState('idle'), 2500);
      } else {
        setCount(res.count);
        setState('done');
        toast.success(`Exported ${res.count.toLocaleString()} rows from ${table.label}`);
        setTimeout(() => setState('idle'), 3000);
      }
    } catch (e: any) {
      setState('idle');
      toast.error(e.message ?? 'Export failed');
    }
  }, [table, plantId, from, to]);

  return (
    <div className="flex items-center gap-3 py-2 px-3 hover:bg-muted/30 rounded-md transition-colors group">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-medium text-foreground leading-tight">{table.label}</span>
          {state === 'done' && count !== null && (
            <Badge variant="outline" className="text-[9px] px-1.5 h-4 text-emerald-700 border-emerald-300 dark:text-emerald-400 py-0">
              {count.toLocaleString()} rows
            </Badge>
          )}
          {table.noPlantFilter && (
            <Badge variant="outline" className="text-[9px] px-1.5 h-4 text-muted-foreground py-0">global</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <code className="text-[9.5px] font-mono text-muted-foreground/60">{table.id}</code>
          <span className="text-[10.5px] text-muted-foreground hidden sm:block truncate">{table.description}</span>
        </div>
      </div>
      <Button
        onClick={doExport}
        variant="outline"
        size="sm"
        disabled={state === 'busy'}
        className={cn(
          'shrink-0 h-7 px-2.5 text-xs gap-1.5 transition-colors',
          state === 'done' && 'border-emerald-300 text-emerald-700 dark:text-emerald-400',
          state === 'empty' && 'text-muted-foreground',
        )}
      >
        {state === 'busy' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === 'done' ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        {state === 'busy' ? 'Exporting…' : state === 'done' ? 'Done' : state === 'empty' ? 'No data' : 'CSV'}
      </Button>
    </div>
  );
}

function CategorySection({
  category,
  plantId,
  from,
  to,
  defaultOpen,
}: {
  category: ExportCategory;
  plantId: string;
  from: string;
  to: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [bulkState, setBulkState] = useState<'idle' | 'busy' | 'done'>('idle');
  const Icon = category.icon;

  const exportAll = useCallback(async () => {
    setBulkState('busy');
    let total = 0;
    const errors: string[] = [];
    for (const table of category.tables) {
      try {
        const res = await runExport(table, plantId, from, to);
        if (res) total += res.count;
      } catch (e: any) {
        errors.push(`${table.label}: ${e.message}`);
      }
    }
    setBulkState('done');
    if (errors.length) {
      toast.warning(`${category.label}: ${errors.length} table(s) failed`);
    } else {
      toast.success(`${category.label}: exported ${total.toLocaleString()} rows across ${category.tables.length} tables`);
    }
    setTimeout(() => setBulkState('idle'), 3000);
  }, [category, plantId, from, to]);

  return (
    <Card className="overflow-hidden">
      {/* Category header — clickable to expand/collapse */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', category.accent)}>
          <Icon className={cn('h-3.5 w-3.5', category.color)} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">{category.label}</span>
            <span className="text-[10.5px] text-muted-foreground">{category.tables.length} table{category.tables.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* Export all in category */}
          <div onClick={e => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
              disabled={bulkState === 'busy'}
              onClick={exportAll}
            >
              {bulkState === 'busy' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : bulkState === 'done' ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {bulkState === 'busy' ? 'Exporting…' : bulkState === 'done' ? 'Done' : 'Export all'}
            </Button>
          </div>
          <ChevronDown className={cn(
            'h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-150 shrink-0',
            open && 'rotate-180',
          )} />
        </div>
      </button>

      {/* Table rows */}
      {open && (
        <div className="border-t divide-y divide-border/40 px-0">
          {category.tables.map(t => (
            <ExportRow key={t.id} table={t} plantId={plantId} from={from} to={to} />
          ))}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function Exports() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? 'all');
  const [from, setFrom]       = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo]           = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activePreset, setActivePreset] = useState<number | null>(30);
  const [exportAllState, setExportAllState] = useState<'idle' | 'busy' | 'done'>('idle');

  const handlePreset = (days: number) => {
    applyPreset(days, setFrom, setTo);
    setActivePreset(days);
  };

  const handleDateChange = (setter: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setActivePreset(null); // clear preset highlight on manual edit
  };

  const exportAll = useCallback(async () => {
    setExportAllState('busy');
    let total = 0;
    let failed = 0;
    for (const table of ALL_TABLES) {
      try {
        const res = await runExport(table, plantId, from, to);
        if (res) total += res.count;
      } catch {
        failed++;
      }
    }
    setExportAllState('done');
    if (failed) toast.warning(`Export complete — ${failed} table(s) had errors`);
    else toast.success(`All tables exported — ${total.toLocaleString()} total rows`);
    setTimeout(() => setExportAllState('idle'), 3000);
  }, [plantId, from, to]);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Data Exports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Download any dataset as a CSV. {ALL_TABLES.length} tables across {EXPORT_CATEGORIES.length} categories.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportAll}
          disabled={exportAllState === 'busy'}
          className={cn(
            'gap-1.5 shrink-0',
            exportAllState === 'done' && 'border-emerald-300 text-emerald-700 dark:text-emerald-400',
          )}
        >
          {exportAllState === 'busy' ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
          ) : exportAllState === 'done' ? (
            <><CheckCircle2 className="h-3.5 w-3.5" /> Done</>
          ) : (
            <><Download className="h-3.5 w-3.5" /> Export all tables</>
          )}
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
          {/* Plant */}
          <div className="space-y-1">
            <Label className="text-xs">Plant</Label>
            <Select value={plantId} onValueChange={setPlantId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plants</SelectItem>
                {plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* From */}
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={from}
              onChange={handleDateChange(setFrom)}
              className="h-8 text-xs w-[130px]"
            />
          </div>

          {/* To */}
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={to}
              onChange={handleDateChange(setTo)}
              className="h-8 text-xs w-[130px]"
            />
          </div>

          {/* Quick presets */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground/60">Quick range</Label>
            <div className="flex gap-1">
              {PRESETS.map(p => (
                <button
                  key={p.days}
                  onClick={() => handlePreset(p.days)}
                  className={cn(
                    'h-8 px-2 rounded-md border text-xs font-medium transition-colors',
                    activePreset === p.days
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Global-table note */}
        <p className="mt-2 text-[10.5px] text-muted-foreground/60">
          Tables marked <span className="font-medium text-muted-foreground">global</span> export across all plants regardless of plant filter.
          Date filters apply only to tables with a date column.
        </p>
      </Card>

      {/* Category sections */}
      <div className="space-y-2">
        {EXPORT_CATEGORIES.map((cat, i) => (
          <CategorySection
            key={cat.label}
            category={cat}
            plantId={plantId}
            from={from}
            to={to}
            defaultOpen={i < 2}
          />
        ))}
      </div>
    </div>
  );
}
