import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download, Building2, Activity, Waves, FlaskConical,
  Zap, Wrench, ShieldCheck, ShieldAlert, MapPin, BarChart2, ChevronDown,
  CheckCircle2, Loader2, RefreshCw, Search, CheckSquare, Square,
  Layers, Package, FileSpreadsheet, Sparkles, Filter,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/lib/csv';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { usePermission } from '@/hooks/usePermission';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format, subDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/dashboard/StatCard';
import { Checkbox } from '@/components/ui/checkbox';

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
  isSelected,
  onToggleSelect,
}: {
  table: ExportTable;
  plantId: string;
  from: string;
  to: string;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
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
    } catch (e) {
      setState('idle');
      toast.error(friendlyError(e));
    }
  }, [table, plantId, from, to]);

  return (
    <div className={cn(
      'flex items-center gap-3 py-2 px-3 hover:bg-muted/30 rounded-md transition-colors group',
      isSelected && 'bg-primary/5',
    )}>
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggleSelect(table.id)}
        className="h-4 w-4 shrink-0"
        aria-label={`Select ${table.label}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-foreground leading-tight">{table.label}</span>
          {state === 'done' && count !== null && (
            <Badge variant="outline" className="text-3xs px-1.5 h-4 text-accent border-accent py-0">
              {count.toLocaleString()} rows
            </Badge>
          )}
          {table.noPlantFilter && (
            <Badge variant="outline" className="text-3xs px-1.5 h-4 text-muted-foreground py-0">global</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <code className="text-3xs font-mono text-muted-foreground/70">{table.id}</code>
          <span className="text-2xs text-muted-foreground hidden sm:block truncate">{table.description}</span>
        </div>
      </div>
      <Button
        onClick={doExport}
        variant="outline"
        size="sm"
        disabled={state === 'busy'}
        className={cn(
          'shrink-0 h-7 px-2.5 text-xs gap-1.5 transition-colors font-semibold',
          state === 'done' && 'border-accent text-accent',
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
  selectedTableIds,
  onToggleSelect,
}: {
  category: ExportCategory;
  plantId: string;
  from: string;
  to: string;
  defaultOpen: boolean;
  selectedTableIds: Set<string>;
  onToggleSelect: (id: string) => void;
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
      toast.info(`${category.label}: ${errors.length} table(s) failed`);
    } else {
      toast.success(`${category.label}: exported ${total.toLocaleString()} rows across ${category.tables.length} tables`);
    }
    setTimeout(() => setBulkState('idle'), 3000);
  }, [category, plantId, from, to]);

  return (
    <Card className="overflow-hidden border-border/70">
      {/* Category header — clickable to expand/collapse */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', category.accent)}>
          <Icon className={cn('h-4 w-4', category.color)} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{category.label}</span>
            <Badge variant="outline" className="text-3xs py-0 h-4 font-normal text-muted-foreground">
              {category.tables.length} table{category.tables.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* Export all in category */}
          <div onClick={e => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground font-semibold"
              disabled={bulkState === 'busy'}
              onClick={exportAll}
            >
              {bulkState === 'busy' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : bulkState === 'done' ? (
                <CheckCircle2 className="h-3 w-3 text-accent" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {bulkState === 'busy' ? 'Exporting…' : bulkState === 'done' ? 'Done' : 'Export category'}
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
        <div className="border-t divide-y divide-border/40 px-1 py-1">
          {category.tables.map(t => (
            <ExportRow
              key={t.id}
              table={t}
              plantId={plantId}
              from={from}
              to={to}
              isSelected={selectedTableIds.has(t.id)}
              onToggleSelect={onToggleSelect}
            />
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
  const navigate = useNavigate();
  const canView = usePermission('data_exports', 'view');
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? 'all');
  const [from, setFrom]       = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo]           = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activePreset, setActivePreset] = useState<number | null>(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(new Set());
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done'>('idle');

  const handlePreset = (days: number) => {
    applyPreset(days, setFrom, setTo);
    setActivePreset(days);
  };

  const handleDateChange = (setter: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setActivePreset(null);
  };

  const toggleSelectTable = useCallback((id: string) => {
    setSelectedTableIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedTableIds(new Set(ALL_TABLES.map(t => t.id)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTableIds(new Set());
  }, []);

  // Quick Preset Package Selectors
  const selectCuratedPackage = useCallback((pkgType: 'ops' | 'ro' | 'chem' | 'power') => {
    const pkgMap: Record<string, string[]> = {
      ops: ['daily_plant_summary', 'locator_readings', 'well_readings', 'product_meter_readings'],
      ro: ['ro_train_readings', 'ro_pretreatment_readings', 'pump_readings', 'afm_readings', 'cip_logs'],
      chem: ['chemical_dosing_logs', 'chemical_deliveries', 'chemical_inventory', 'chemical_residual_samples'],
      power: ['power_readings', 'electric_bills', 'power_tariffs', 'production_costs'],
    };
    setSelectedTableIds(new Set(pkgMap[pkgType] || []));
    toast.success(`Selected ${pkgType.toUpperCase()} table package (${(pkgMap[pkgType] || []).length} tables)`);
  }, []);

  // Export all tables
  const exportAll = useCallback(async () => {
    setExportState('busy');
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
    setExportState('done');
    if (failed) toast.info(`Export complete — ${failed} table(s) had errors`);
    else toast.success(`All tables exported — ${total.toLocaleString()} total rows`);
    setTimeout(() => setExportState('idle'), 3000);
  }, [plantId, from, to]);

  // Export selected tables
  const exportSelected = useCallback(async () => {
    if (selectedTableIds.size === 0) {
      toast.error('Select at least one table to export');
      return;
    }
    setExportState('busy');
    let total = 0;
    let failed = 0;
    const targetTables = ALL_TABLES.filter(t => selectedTableIds.has(t.id));
    for (const table of targetTables) {
      try {
        const res = await runExport(table, plantId, from, to);
        if (res) total += res.count;
      } catch {
        failed++;
      }
    }
    setExportState('done');
    if (failed) toast.info(`Export complete — ${failed} table(s) had errors`);
    else toast.success(`Exported ${total.toLocaleString()} rows across ${targetTables.length} selected tables`);
    setTimeout(() => setExportState('idle'), 3000);
  }, [selectedTableIds, plantId, from, to]);

  // Filtered categories based on search
  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return EXPORT_CATEGORIES;
    return EXPORT_CATEGORIES.map(cat => ({
      ...cat,
      tables: cat.tables.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.tables.length > 0);
  }, [searchQuery]);

  if (!canView) {
    return (
      <Card className="p-6 text-center space-y-2" data-testid="exports-access-denied">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Data Exports is available to Manager, Data Analyst, and Admin.
        </p>
        <button
          className="text-sm text-accent hover:underline"
          onClick={() => navigate('/')}
        >
          Back to dashboard
        </button>
      </Card>
    );
  }

  const selectedPlantName = plantId === 'all'
    ? 'Fleet Global (All Plants)'
    : plants?.find(p => p.id === plantId)?.name ?? 'Selected Plant';

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PageHeader
          title="Data Warehouse & Exports"
          titleIcon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          subtitle={<>Enterprise telemetry and operational database export hub. Download datasets across {ALL_TABLES.length} system tables.</>}
        />
        <div className="flex items-center gap-2 flex-wrap">
          {selectedTableIds.size > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={exportSelected}
              disabled={exportState === 'busy'}
              className="h-8 gap-1.5 font-semibold shrink-0"
            >
              {exportState === 'busy' ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
              ) : (
                <><Download className="h-3.5 w-3.5" /> Export Selected ({selectedTableIds.size})</>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportAll}
            disabled={exportState === 'busy'}
            className={cn(
              'h-8 gap-1.5 shrink-0 font-semibold',
              exportState === 'done' && 'border-accent/40 text-accent',
            )}
          >
            {exportState === 'busy' ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
            ) : exportState === 'done' ? (
              <><CheckCircle2 className="h-3.5 w-3.5" /> Done</>
            ) : (
              <><Download className="h-3.5 w-3.5" /> Export All ({ALL_TABLES.length})</>
            )}
          </Button>
        </div>
      </div>

      {/* ── Executive Warehouse Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Layers}
          label="Available Export Tables"
          value={`${ALL_TABLES.length} Tables`}
        />
        <StatCard
          icon={Building2}
          label="Target Facility"
          value={selectedPlantName}
        />
        <StatCard
          icon={Activity}
          label="Active Time Range"
          value={activePreset ? `${activePreset} Days Horizon` : `${from} → ${to}`}
        />
        <StatCard
          icon={CheckCircle2}
          label="Selected Export Package"
          value={selectedTableIds.size > 0 ? `${selectedTableIds.size} Selected` : 'Ready to Export'}
          tone={selectedTableIds.size > 0 ? 'accent' : 'default'}
        />
      </div>

      {/* Filters & Range Toolbar */}
      <Card className="p-3.5 space-y-3 border-border/70">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2.5 items-end">
          {/* Plant */}
          <div className="space-y-1">
            <Label htmlFor="exports-plant" className="text-xs font-semibold">Plant Facility</Label>
            <Select value={plantId} onValueChange={setPlantId}>
              <SelectTrigger className="h-8 text-xs font-medium" id="exports-plant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plants (Fleet Global)</SelectItem>
                {plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* From */}
          <div className="space-y-1">
            <Label htmlFor="exports-from" className="text-xs font-semibold">From Date</Label>
            <Input
              type="date"
              value={from}
              onChange={handleDateChange(setFrom)}
              className="h-8 text-xs w-[135px]"
              id="exports-from"
            />
          </div>

          {/* To */}
          <div className="space-y-1">
            <Label htmlFor="exports-to" className="text-xs font-semibold">To Date</Label>
            <Input
              type="date"
              value={to}
              onChange={handleDateChange(setTo)}
              className="h-8 text-xs w-[135px]"
              id="exports-to"
            />
          </div>

          {/* Quick presets */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Range Horizon</p>
            <div className="flex gap-1">
              {PRESETS.map(p => (
                <button
                  key={p.days}
                  onClick={() => handlePreset(p.days)}
                  className={cn(
                    'h-8 px-2.5 rounded-md border text-xs font-semibold transition-colors',
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

        {/* Curated Package Presets & Table Search Bar */}
        <div className="pt-2 border-t border-border/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Curated Packages:</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('ops')}
            >
              💧 Operations (4)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('ro')}
            >
              🌊 RO Trains (5)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('chem')}
            >
              🧪 Chemicals (4)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('power')}
            >
              ⚡ Energy & Costs (4)
            </Button>
            {selectedTableIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-3xs text-muted-foreground hover:text-foreground"
                onClick={clearSelection}
              >
                Clear selection ({selectedTableIds.size})
              </Button>
            )}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tables (e.g. dosing, train)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-7 text-xs pl-8 font-medium"
            />
          </div>
        </div>
      </Card>

      {/* Category sections */}
      <div className="space-y-2.5">
        {filteredCategories.map((cat, i) => (
          <CategorySection
            key={cat.label}
            category={cat}
            plantId={plantId}
            from={from}
            to={to}
            defaultOpen={i < 2 || searchQuery.length > 0}
            selectedTableIds={selectedTableIds}
            onToggleSelect={toggleSelectTable}
          />
        ))}
        {filteredCategories.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No export tables match "{searchQuery}".
          </Card>
        )}
      </div>
    </div>
  );
}
