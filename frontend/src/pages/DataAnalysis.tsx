/**
 * DataAnalysis.tsx  — Data Analysis & Review Page
 * ─────────────────────────────────────────────────
 * Centralised hub for raw-data review and regression-based normalization.
 *
 * Access:
 *   Admin / Data Analyst → full edit + regression rights
 *   Manager              → read-only (no edit / no run-regression)
 *   Others               → access denied
 *
 * Layout:
 *   Left  → Raw Data Table (read-only display; editable only via the Edit modal)
 *   Right → Regression Results Table (corrected_value + notes)
 *
 * Workflow:
 *   1. Select source table + column + optional plant + date range
 *   2. Run Regression  → OLS fit runs client-side, result stored in Supabase
 *   3. Review the regression table
 *   4. Apply (writes corrected values + reading_normalizations rows)
 *      or Retract if already applied
 *   5. All edits are logged; dashboard picks up ⚠️ / 🔄 / ⏪ symbols
 *
 * Backend: 100% Supabase — no Python backend required.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import {
  FlaskConical, Play, CheckCircle2, Undo2, Pencil, ShieldAlert,
  TrendingUp, Database, AlertTriangle, RefreshCw, Clock, Eye,
  ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCE_TABLES: Record<string, string[]> = {
  well_readings:          ['daily_volume', 'current_reading', 'previous_reading', 'power_meter_reading'],
  locator_readings:       ['daily_volume', 'current_reading', 'previous_reading'],
  product_meter_readings: ['daily_volume', 'current_reading', 'previous_reading'],
  ro_train_readings:      ['permeate_tds', 'permeate_ph', 'turbidity_ntu', 'dp_psi', 'recovery_pct', 'permeate_meter', 'feed_meter', 'reject_meter'],
  power_readings:         ['daily_consumption_kwh', 'meter_reading_kwh', 'daily_solar_kwh', 'daily_grid_kwh'],
};

/** Tables that do not have a norm_status column — skip it in SELECT. */
const TABLES_WITHOUT_NORM_STATUS = new Set(['power_readings']);

/** Tables recorded at sub-daily frequency — show full datetime (YYYY-MM-DD HH:mm), not just date. */
const TABLES_WITH_TIME = new Set(['ro_train_readings']);

/** Format a reading_datetime string based on whether the table uses time. */
function fmtDatetime(raw: string, showTime: boolean): { date: string; time?: string } {
  const s = raw.replace('T', ' ').replace('Z', '');
  if (!showTime) return { date: s.slice(0, 10) };
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

const TABLE_LABELS: Record<string, string> = {
  well_readings:          'Well Readings',
  locator_readings:       'Locator Readings',
  product_meter_readings: 'Product Meter Readings',
  ro_train_readings:      'RO Train Readings',
  power_readings:         'Grid & Solar Readings',
};

/** For each source table: which Supabase lookup table + FK column on the readings row.
 *  power_readings is plant-level only (no sub-entity FK); it is intentionally absent here.
 *  Instead, a "Source" filter (Solar / Grid) is provided via POWER_SOURCE_FILTER. */
const ENTITY_CONFIG: Record<string, {
  lookupTable: string;
  fkColumn: string;
  selectCols: string;
  labelFn: (row: Record<string, unknown>) => string;
  filterLabel: string;
}> = {
  well_readings: {
    lookupTable: 'wells',
    fkColumn:    'well_id',
    selectCols:  'id, name, plant_id, status',
    labelFn:     r => String(r.name ?? r.id),
    filterLabel: 'Well',
  },
  locator_readings: {
    lookupTable: 'locators',
    fkColumn:    'locator_id',
    selectCols:  'id, name, plant_id, status',
    labelFn:     r => String(r.name ?? r.id),
    filterLabel: 'Locator',
  },
  ro_train_readings: {
    lookupTable: 'ro_trains',
    fkColumn:    'train_id',
    selectCols:  'id, name, train_number, plant_id, status',
    labelFn:     r => r.name ? String(r.name) : `Train ${r.train_number}`,
    filterLabel: 'RO Train',
  },
  product_meter_readings: {
    lookupTable: 'product_meters',
    fkColumn:    'meter_id',
    selectCols:  'id, name, plant_id',
    labelFn:     r => String(r.name ?? r.id),
    filterLabel: 'Meter',
  },
};

/** power_readings has no sub-entity FK — it is plant-level.
 *  We provide a "Source" pseudo-filter so users can isolate Solar vs Grid columns. */
const POWER_SOURCE_OPTIONS = [
  { value: 'all',   label: 'All Sources' },
  { value: 'solar', label: 'Solar',       columns: ['daily_solar_kwh'] },
  { value: 'grid',  label: 'Grid',        columns: ['daily_grid_kwh'] },
  { value: 'total', label: 'Total / Meter', columns: ['daily_consumption_kwh', 'meter_reading_kwh'] },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type NormStatus = 'normal' | 'erroneous' | 'normalized' | 'retracted';

interface RawReading {
  id: string;
  reading_datetime: string;
  plant_id?: string;
  norm_status?: NormStatus;
  [key: string]: unknown;
}

interface CorrectionRow {
  reading_id: string;
  reading_datetime: string;
  original_value: number | null;
  corrected_value: number | null;
  z_score: number | null;
  is_outlier: boolean;
  note: string;
}

interface RegressionResult {
  result_id: string;
  source_table: string;
  column_name: string;
  plant_id: string | null;
  row_count: number;
  outlier_count: number;
  r_squared: number | null;
  slope: number | null;
  intercept: number | null;
  corrections: CorrectionRow[];
  status: 'pending' | 'applied' | 'retracted';
  created_at: string;
}

interface Plant { id: string; name: string; }
interface EntityOption { id: string; label: string; }

// ── OLS Regression (client-side) ───────────────────────────────────────────────

const Z_THRESHOLD = 2.5;
const MIN_ROWS = 5;

interface OLSResult {
  corrections: CorrectionRow[];
  stats: { r_squared: number | null; slope: number | null; intercept: number | null };
}

function runOLS(readings: RawReading[], column: string): OLSResult {
  // Collect valid (index, value) pairs
  const pairs: Array<{ idx: number; val: number }> = [];
  readings.forEach((row, i) => {
    const raw = row[column];
    if (raw != null && !isNaN(Number(raw))) {
      pairs.push({ idx: i, val: Number(raw) });
    }
  });

  if (pairs.length < MIN_ROWS) {
    return {
      corrections: readings.map(row => ({
        reading_id:       String(row.id),
        reading_datetime: String(row.reading_datetime),
        original_value:   row[column] != null ? Number(row[column]) : null,
        corrected_value:  null,
        z_score:          null,
        is_outlier:       false,
        note:             'Insufficient data for regression',
      })),
      stats: { r_squared: null, slope: null, intercept: null },
    };
  }

  const n   = pairs.length;
  const xs  = pairs.map(p => p.idx);
  const ys  = pairs.map(p => p.val);

  // Least-squares
  const sumX  = xs.reduce((a, b) => a + b, 0);
  const sumY  = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  const slope     = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  // Predictions and residuals
  const yPred    = xs.map(x => slope * x + intercept);
  const residuals = ys.map((y, i) => y - yPred[i]);

  // R²
  const meanY  = sumY / n;
  const ssTot  = ys.reduce((acc, y) => acc + (y - meanY) ** 2, 0);
  const ssRes  = residuals.reduce((acc, r) => acc + r * r, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : null;

  // Z-scores on residuals
  const meanRes = residuals.reduce((a, b) => a + b, 0) / n;
  const stdRes  = Math.sqrt(residuals.reduce((acc, r) => acc + (r - meanRes) ** 2, 0) / n) || 0;
  const zScores = residuals.map(r => (stdRes > 0 ? r / stdRes : 0));

  // Build lookup: row-index → {val, z, pred}
  const pairMap = new Map<number, { val: number; z: number; pred: number }>();
  pairs.forEach((p, i) => pairMap.set(p.idx, { val: p.val, z: zScores[i], pred: yPred[i] }));

  const corrections: CorrectionRow[] = readings.map((row, i) => {
    const rid = String(row.id);
    const rdt = String(row.reading_datetime);
    const entry = pairMap.get(i);

    if (!entry) {
      return {
        reading_id:       rid,
        reading_datetime: rdt,
        original_value:   null,
        corrected_value:  null,
        z_score:          null,
        is_outlier:       false,
        note:             'Missing value — skipped',
      };
    }

    const { val, z, pred } = entry;
    const isOutlier = Math.abs(z) > Z_THRESHOLD;
    const direction  = z > 0 ? 'high' : 'low';
    const note = isOutlier
      ? `out of range (z=${z.toFixed(2)}, ${direction}); regression-corrected`
      : 'within normal range';

    return {
      reading_id:       rid,
      reading_datetime: rdt,
      original_value:   val,
      corrected_value:  isOutlier ? parseFloat(pred.toFixed(4)) : null,
      z_score:          parseFloat(z.toFixed(4)),
      is_outlier:       isOutlier,
      note,
    };
  });

  return {
    corrections,
    stats: {
      r_squared: rSquared != null ? parseFloat(rSquared.toFixed(6)) : null,
      slope:     parseFloat(slope.toFixed(6)),
      intercept: parseFloat(intercept.toFixed(6)),
    },
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function NormBadge({ status }: { status?: NormStatus }) {
  if (!status || status === 'normal') return null;
  const cfg: Record<string, { emoji: string; cls: string }> = {
    erroneous:  { emoji: '⚠️', cls: 'border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/30' },
    normalized: { emoji: '🔄', cls: 'border-teal-400  text-teal-700  bg-teal-50  dark:bg-teal-950/30'  },
    retracted:  { emoji: '⏪', cls: 'border-border    text-muted-foreground bg-muted'                    },
  };
  const c = cfg[status];
  if (!c) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border', c.cls)}>
      {c.emoji} {status}
    </span>
  );
}

function StatusBadge({ status }: { status: RegressionResult['status'] }) {
  const cfg = {
    pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    applied:   { label: 'Applied',   cls: 'bg-teal-100  text-teal-800  border-teal-300'  },
    retracted: { label: 'Retracted', cls: 'bg-muted     text-muted-foreground border-border' },
  }[status];
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border', cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Edit Raw Value Dialog ──────────────────────────────────────────────────────

interface EditRawDialogProps {
  open: boolean;
  onClose: () => void;
  reading: RawReading | null;
  column: string;
  onSuccess: () => void;
}

function EditRawDialog({ open, onClose, reading, column, onSuccess }: EditRawDialogProps) {
  const { session, isAdmin, roles } = useAuth();
  const [newValue, setNewValue] = useState('');
  const [note, setNote]         = useState('');
  const [saving, setSaving]     = useState(false);

  const oldValue = reading ? (reading[column] as number | null) : null;

  const handleSave = async () => {
    if (!reading) return;
    const parsed = parseFloat(newValue);
    if (isNaN(parsed)) { toast.error('Enter a valid number'); return; }
    setSaving(true);
    try {
      // 1. Update the source table value
      const { error: updateErr } = await (supabase
        .from(reading._sourceTable as never) as any)
        .update({ [column]: parsed })
        .eq('id', reading.id);
      if (updateErr) throw new Error(updateErr.message);

      // 2. Log to audit table
      const userRole = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');
      await supabase.from('raw_edit_log').insert({
        source_table: reading._sourceTable,
        source_id:    reading.id,
        column_name:  column,
        old_value:    oldValue,
        new_value:    parsed,
        edited_by:    session?.user?.id ?? null,
        edited_role:  userRole,
        edited_at:    new Date().toISOString(),
        note:         note || '',
      });

      toast.success('Value updated and logged');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit Raw Value
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-xs text-muted-foreground">
            Column: <span className="font-mono font-semibold">{column}</span>
            <br />
            Reading: <span className="font-mono">{reading?.reading_datetime?.slice(0, 10)}</span>
          </div>
          <div>
            <Label className="text-xs">Current value</Label>
            <Input value={oldValue ?? '—'} disabled className="font-mono text-sm bg-muted/40 mt-1" />
          </div>
          <div>
            <Label className="text-xs">New value <span className="text-danger">*</span></Label>
            <Input
              className="font-mono text-sm mt-1"
              placeholder="e.g. 123.45"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Reason / note</Label>
            <Input className="mt-1 text-sm" placeholder="Optional" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="rounded bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            <Info className="inline h-3 w-3 mr-1" />
            All edits are logged in the audit trail and cannot be deleted.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !newValue}>
            {saving ? 'Saving…' : 'Save edit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Regression Results Detail ──────────────────────────────────────────────────

function RegressionDetail({
  result, canEdit, onRefresh,
}: { result: RegressionResult; canEdit: boolean; onRefresh: () => void }) {
  const { session, isAdmin, roles } = useAuth();
  const [applying, setApplying]     = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [expanded, setExpanded]     = useState(false);

  const outliers = result.corrections.filter(c => c.is_outlier);

  const userRole = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

  const handleApply = async () => {
    setApplying(true);
    try {
      // Fetch full row (corrections may be truncated in list view)
      const { data: row, error: fetchErr } = await supabase
        .from('regression_results')
        .select('*')
        .eq('id', result.result_id)
        .maybeSingle();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? 'Result not found');
      if (row.status !== 'pending') throw new Error(`Result is '${row.status}' — can only apply pending results`);

      const toApply: CorrectionRow[] = (row.corrections ?? []).filter(
        (c: CorrectionRow) => c.is_outlier && c.corrected_value != null,
      );

      // Update norm_status on each source row
      for (const c of toApply) {
        await (supabase.from(row.source_table as never) as any)
          .update({ norm_status: 'normalized' })
          .eq('id', c.reading_id);
      }

      // Insert reading_normalizations rows
      if (toApply.length > 0) {
        const normRows = toApply.map((c: CorrectionRow) => ({
          source_table:   row.source_table,
          source_id:      c.reading_id,
          action:         'normalize',
          original_value: c.original_value,
          adjusted_value: c.corrected_value,
          note:           c.note || `Regression correction (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    true,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      // Mark result applied
      await supabase.from('regression_results')
        .update({ status: 'applied' })
        .eq('id', result.result_id);

      toast.success(`Applied ${toApply.length} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const handleRetract = async () => {
    setRetracting(true);
    try {
      const { data: row, error: fetchErr } = await supabase
        .from('regression_results')
        .select('*')
        .eq('id', result.result_id)
        .maybeSingle();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? 'Result not found');
      if (row.status !== 'applied') throw new Error(`Result is '${row.status}' — can only retract applied results`);

      const toRetract: CorrectionRow[] = (row.corrections ?? []).filter(
        (c: CorrectionRow) => c.is_outlier,
      );

      for (const c of toRetract) {
        await (supabase.from(row.source_table as never) as any)
          .update({ norm_status: 'retracted' })
          .eq('id', c.reading_id);
      }

      if (toRetract.length > 0) {
        const normRows = toRetract.map((c: CorrectionRow) => ({
          source_table:   row.source_table,
          source_id:      c.reading_id,
          action:         'retract',
          original_value: c.original_value,
          adjusted_value: null,
          note:           `Retracted regression correction (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    false,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      await supabase.from('regression_results')
        .update({ status: 'retracted' })
        .eq('id', result.result_id);

      toast.success(`Retracted ${toRetract.length} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Retract failed');
    } finally {
      setRetracting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium text-sm truncate">
            {TABLE_LABELS[result.source_table] ?? result.source_table} ·{' '}
            <span className="font-mono">{result.column_name}</span>
          </span>
          <StatusBadge status={result.status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && result.status === 'pending' && outliers.length > 0 && (
            <Button size="sm" onClick={handleApply} disabled={applying} className="h-7 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {applying ? 'Applying…' : `Apply (${outliers.length})`}
            </Button>
          )}
          {canEdit && result.status === 'applied' && (
            <Button size="sm" variant="outline" onClick={handleRetract} disabled={retracting} className="h-7 text-xs">
              <Undo2 className="h-3 w-3 mr-1" />
              {retracting ? 'Retracting…' : 'Retract'}
            </Button>
          )}
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 divide-x text-center px-0 py-2 border-b">
        {[
          { label: 'Rows',     value: result.row_count },
          { label: 'Outliers', value: outliers.length },
          { label: 'R²',       value: result.r_squared != null ? result.r_squared.toFixed(4) : '—' },
          { label: 'Run at',   value: result.created_at ? format(parseISO(result.created_at), 'MMM d HH:mm') : '—' },
        ].map(s => (
          <div key={s.label} className="px-3 py-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
            <div className="font-mono text-sm font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Corrections table (collapsible) */}
      {expanded && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Original</TableHead>
                <TableHead className="text-right">Corrected</TableHead>
                <TableHead className="text-right">Z-score</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outliers.map(c => (
                <TableRow key={c.reading_id} className="text-xs">
                  <TableCell className="font-mono">{c.reading_datetime?.slice(0, 10)}</TableCell>
                  <TableCell className="text-right font-mono text-danger">
                    {c.original_value?.toFixed(2) ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-teal-600">
                    {c.corrected_value?.toFixed(2) ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {c.z_score != null ? (
                      <span className={Math.abs(c.z_score) > 3 ? 'text-danger font-bold' : ''}>
                        {c.z_score.toFixed(2)}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">{c.note}</TableCell>
                </TableRow>
              ))}
              {outliers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                    No outliers detected in this run.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Raw Data Table ─────────────────────────────────────────────────────────────

function RawDataTable({
  sourceTable, column, plantId, entityId, dateFrom, dateTo, canEdit, onEdit,
}: {
  sourceTable: string; column: string; plantId: string; entityId: string; dateFrom: string; dateTo: string;
  canEdit: boolean;
  onEdit: (reading: RawReading) => void;
}) {
  const entityCfgRT = ENTITY_CONFIG[sourceTable];
  const { data: entityRows } = useQuery({
    queryKey: ['entity-name-lookup', sourceTable],
    queryFn: async () => {
      if (!entityCfgRT) return [];
      const { data, error } = await (supabase.from(entityCfgRT.lookupTable as never) as any)
        .select(entityCfgRT.selectCols)
        .order('name');
      if (error) console.warn('[entity-name-lookup] error for', entityCfgRT.lookupTable, error.message);
      return (data ?? []) as Record<string, unknown>[];
    },
    enabled: !!entityCfgRT,
    staleTime: 60_000,
  });
  const entityLookup: Record<string, string> = Object.fromEntries(
    (entityRows ?? []).map(r => [String(r.id), entityCfgRT ? entityCfgRT.labelFn(r) : String(r.id)])
  );

  const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(sourceTable);

  const { data, isLoading } = useQuery({
    queryKey: ['raw-readings', sourceTable, column, plantId, entityId, dateFrom, dateTo],
    queryFn: async () => {
      const entityCfg = ENTITY_CONFIG[sourceTable];
      const selectCols = [
        'id',
        'reading_datetime',
        column,
        hasNormStatus ? 'norm_status' : null,
        'plant_id',
        entityCfg ? entityCfg.fkColumn : null,
      ].filter(Boolean).join(',');

      let q = supabase.from(sourceTable as 'well_readings')
        .select(selectCols)
        .order('reading_datetime', { ascending: false })
        .limit(200);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      if (entityCfg && entityId && entityId !== 'all') q = q.eq(entityCfg.fkColumn as never, entityId);
      if (dateFrom) q = q.gte('reading_datetime', dateFrom);
      if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data || []).map(r => ({ ...r, _sourceTable: sourceTable })) as RawReading[];
    },
    enabled: !!sourceTable && !!column,
  });

  // Delta: group rows by entity FK so we never diff across different trains/wells/etc.
  const deltaMap = new Map<string, number | null>();
  if (data) {
    const entityFk = ENTITY_CONFIG[sourceTable]?.fkColumn;
    if (entityFk) {
      const groups = new Map<string, RawReading[]>();
      data.forEach(row => {
        const key = String(row[entityFk] ?? '__none__');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      });
      groups.forEach(rows => {
        rows.forEach((row, i) => {
          const curr = row[column] as number | null;
          const prev = i + 1 < rows.length ? (rows[i + 1][column] as number | null) : null;
          deltaMap.set(row.id, curr != null && prev != null ? curr - prev : null);
        });
      });
    } else {
      data.forEach((row, i) => {
        const curr = row[column] as number | null;
        const prev = i + 1 < data.length ? (data[i + 1][column] as number | null) : null;
        deltaMap.set(row.id, curr != null && prev != null ? curr - prev : null);
      });
    }
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading raw data…</div>;
  if (!data?.length) return <div className="py-8 text-center text-sm text-muted-foreground">No readings found for this selection.</div>;

  const showTime = TABLES_WITH_TIME.has(sourceTable);

  return (
    <div className="overflow-auto max-h-[560px] rounded border">
      <Table className="text-[11px]">
        <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <TableHead className={cn('whitespace-nowrap', showTime ? 'w-[118px]' : 'w-[88px]')}>
              {showTime ? 'Date & Time' : 'Date'}
            </TableHead>
            {ENTITY_CONFIG[sourceTable] && <TableHead className="whitespace-nowrap">{ENTITY_CONFIG[sourceTable].filterLabel}</TableHead>}
            <TableHead className="text-right whitespace-nowrap">{column}</TableHead>
            <TableHead className="text-right whitespace-nowrap">Δ Delta</TableHead>
            {hasNormStatus && <TableHead className="whitespace-nowrap">Status</TableHead>}
            {canEdit && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(row => {
            const delta = deltaMap.get(row.id) ?? null;
            const { date, time } = fmtDatetime(String(row.reading_datetime || ''), showTime);
            return (
              <TableRow key={row.id} className={cn(hasNormStatus && row.norm_status === 'erroneous' && 'bg-amber-50/60 dark:bg-amber-950/20')}>
                <TableCell className="font-mono whitespace-nowrap py-1.5">
                  {showTime ? (
                    <span className="flex flex-col leading-tight">
                      <span className="text-[11px]">{date}</span>
                      <span className="text-[10px] text-muted-foreground">{time}</span>
                    </span>
                  ) : (
                    <span className="text-[11px]">{date}</span>
                  )}
                </TableCell>
                {ENTITY_CONFIG[sourceTable] && (
                  <TableCell className="text-[11px] text-muted-foreground font-mono py-1.5">
                    {entityLookup[row[ENTITY_CONFIG[sourceTable].fkColumn] as string] ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono text-[11px] py-1.5">
                  {row[column] != null ? Number(row[column]).toFixed(3) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right font-mono text-[11px] py-1.5">
                  {delta != null ? (
                    <span className={cn(
                      delta > 0  && 'text-teal-600',
                      delta < 0  && 'text-danger',
                      delta === 0 && 'text-muted-foreground',
                    )}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                {hasNormStatus && <TableCell className="py-1.5"><NormBadge status={row.norm_status} /></TableCell>}
                {canEdit && (
                  <TableCell className="py-1.5">
                    <button
                      className="text-muted-foreground hover:text-primary transition-colors"
                      title="Edit raw value"
                      onClick={() => onEdit(row)}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Audit Log Tab — reads raw_edit_log via Supabase ────────────────────────────

function AuditLogTab({ sourceTable }: { sourceTable: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['raw-edit-log', sourceTable],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('raw_edit_log')
        .select('*')
        .eq('source_table', sourceTable)
        .order('edited_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return { log: (data ?? []) as Array<Record<string, unknown>> };
    },
    enabled: !!sourceTable,
    retry: false,
    throwOnError: false,
  });

  const rows = data?.log ?? [];

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading audit log…</div>;
  if (isError)   return (
    <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Audit log unavailable — run the <code className="font-mono">20260515_supabase_only_and_data_analysis.sql</code> migration in Supabase to create the <code className="font-mono">raw_edit_log</code> table.
    </div>
  );
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted-foreground">No edits recorded yet.</div>;

  return (
    <div className="overflow-auto max-h-[400px] rounded border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow className="text-[11px]">
            <TableHead>Edited at</TableHead>
            <TableHead>Column</TableHead>
            <TableHead className="text-right">Old</TableHead>
            <TableHead className="text-right">New</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className="text-xs">
              <TableCell className="font-mono">{String(r.edited_at ?? '').slice(0, 16)}</TableCell>
              <TableCell className="font-mono">{String(r.column_name ?? '')}</TableCell>
              <TableCell className="text-right font-mono text-danger">{r.old_value != null ? Number(r.old_value).toFixed(3) : '—'}</TableCell>
              <TableCell className="text-right font-mono text-teal-600">{r.new_value != null ? Number(r.new_value).toFixed(3) : '—'}</TableCell>
              <TableCell><Badge variant="outline" className="text-[10px]">{String(r.edited_role ?? '')}</Badge></TableCell>
              <TableCell className="text-muted-foreground max-w-[180px] truncate">{String(r.note ?? '')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Normalization Audit Tab ────────────────────────────────────────────────────

function NormalizationAuditTab({ sourceTable }: { sourceTable: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['norm-audit', sourceTable],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_normalizations')
        .select('*')
        .eq('source_table', sourceTable)
        .order('performed_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!sourceTable,
  });

  const rows = data ?? [];

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted-foreground">No normalization records for this table.</div>;

  const actionCfg = {
    tag:       { emoji: '⚠️', cls: 'text-amber-700  bg-amber-50  border-amber-300  dark:bg-amber-950/30 dark:text-amber-300' },
    normalize: { emoji: '🔄', cls: 'text-teal-700   bg-teal-50   border-teal-300   dark:bg-teal-950/30  dark:text-teal-300'  },
    retract:   { emoji: '⏪', cls: 'text-muted-foreground bg-muted border-border' },
  } as const;

  return (
    <div className="overflow-auto max-h-[400px] rounded border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow className="text-[11px]">
            <TableHead>Date</TableHead>
            <TableHead>Action</TableHead>
            <TableHead className="text-right">Original</TableHead>
            <TableHead className="text-right">Adjusted</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r: Record<string, unknown>) => {
            const cfg = actionCfg[r.action as keyof typeof actionCfg] ?? actionCfg.retract;
            return (
              <TableRow key={r.id as string} className="text-xs">
                <TableCell className="font-mono">{String(r.performed_at ?? '').slice(0, 16)}</TableCell>
                <TableCell>
                  <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border', cfg.cls)}>
                    {cfg.emoji} {r.action as string}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-danger">
                  {r.original_value != null ? Number(r.original_value).toFixed(3) : '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-teal-600">
                  {r.adjusted_value != null ? Number(r.adjusted_value).toFixed(3) : '—'}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{String(r.performed_role ?? '')}</Badge></TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">{String(r.note ?? '')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DataAnalysis() {
  const { isAdmin, isDataAnalyst, isManager, session, roles } = useAuth();
  const qc = useQueryClient();

  // ── Universal plant selection — initialize from global store ─────────────
  const selectedPlantId    = useAppStore(s => s.selectedPlantId);
  const setSelectedPlantId = useAppStore(s => s.setSelectedPlantId);

  // Filter state — plant defaults to the app-wide plant selection
  const [sourceTable, setSourceTable] = useState('well_readings');
  const [column, setColumn]           = useState('daily_volume');
  // Convert null (all plants) to 'all' for Select component
  const [plantId, setPlantId]         = useState<string>(selectedPlantId ?? 'all');
  const [entityId, setEntityId]       = useState('all');
  const [powerSource, setPowerSource] = useState('all'); // only used when sourceTable === 'power_readings'
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');

  // Keep local plantId in sync whenever the global store changes
  useEffect(() => {
    setPlantId(selectedPlantId ?? 'all');
    setEntityId('all');
  }, [selectedPlantId]);

  // Edit dialog
  const [editReading, setEditReading] = useState<RawReading | null>(null);

  // Regression state
  const [running, setRunning] = useState(false);

  const canEdit = isAdmin || isDataAnalyst;
  const canView = canEdit || isManager;

  // Plants list
  const { data: plantsData } = useQuery({
    queryKey: ['plants-list'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id,name').order('name');
      return (data ?? []) as Plant[];
    },
  });
  const plants = plantsData ?? [];

  // Entity drill-down options
  const entityCfgMain = ENTITY_CONFIG[sourceTable];
  const { data: entityOptionsData, isFetching: entityFetching } = useQuery({
    queryKey: ['entity-options-main', sourceTable, plantId],
    queryFn: async () => {
      if (!entityCfgMain) return [];
      let q = (supabase.from(entityCfgMain.lookupTable as never) as any)
        .select(entityCfgMain.selectCols)
        .order('name');
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      q = q.eq('status', 'Active');
      const { data, error } = await q;
      if (error) {
        let fbq = (supabase.from(entityCfgMain.lookupTable as never) as any)
          .select(entityCfgMain.selectCols)
          .order('name');
        if (plantId && plantId !== 'all') fbq = fbq.eq('plant_id', plantId);
        const { data: fallback } = await fbq;
        return (fallback ?? []) as Record<string, unknown>[];
      }
      return (data ?? []) as Record<string, unknown>[];
    },
    enabled: !!entityCfgMain,
    staleTime: 30_000,
  });
  const entityOptions: EntityOption[] = (entityOptionsData ?? []).map(r => ({
    id:    String(r.id),
    label: entityCfgMain ? entityCfgMain.labelFn(r) : String(r.id),
  }));

  // ── Regression results — fetched directly from Supabase ──────────────────
  const { data: resultsData, refetch: refetchResults, isError: resultsError } = useQuery({
    queryKey: ['regression-results', sourceTable, plantId, entityId],
    queryFn: async () => {
      let q = supabase.from('regression_results')
        .select('*')
        .eq('source_table', sourceTable)
        .order('created_at', { ascending: false })
        .limit(20);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      // Map DB `id` → `result_id`; compute outlier_count from corrections JSONB
      const results: RegressionResult[] = (data ?? []).map((r: Record<string, unknown>) => {
        const corrections = (r.corrections ?? []) as CorrectionRow[];
        return {
          result_id:     String(r.id),
          source_table:  String(r.source_table),
          column_name:   String(r.column_name),
          plant_id:      r.plant_id ? String(r.plant_id) : null,
          row_count:     Number(r.row_count ?? 0),
          outlier_count: corrections.filter(c => c.is_outlier).length,
          r_squared:     r.r_squared != null ? Number(r.r_squared) : null,
          slope:         r.slope     != null ? Number(r.slope)     : null,
          intercept:     r.intercept != null ? Number(r.intercept) : null,
          corrections,
          status:        (r.status as RegressionResult['status']) ?? 'pending',
          created_at:    String(r.created_at ?? ''),
        };
      });
      return { results };
    },
    enabled: canView,
    staleTime: 15_000,
    retry: false,
    throwOnError: false,
  });
  const regressionResults = resultsData?.results ?? [];

  // When source table changes, reset column and entity
  const handleTableChange = (t: string) => {
    setSourceTable(t);
    setColumn(SOURCE_TABLES[t]?.[0] ?? '');
    setEntityId('all');
    setPowerSource('all');
  };

  // When plant changes here, also update the global store so other pages stay in sync
  const handlePlantChange = (p: string) => {
    setPlantId(p);
    setEntityId('all');
    setSelectedPlantId(p === 'all' ? null : p);
  };

  // ── Run Regression — OLS computed client-side, result saved to Supabase ──
  const handleRunRegression = async () => {
    if (!sourceTable || !column) { toast.error('Select a table and column first'); return; }
    setRunning(true);
    try {
      const entityCfg = ENTITY_CONFIG[sourceTable];
      const hasNorm   = !TABLES_WITHOUT_NORM_STATUS.has(sourceTable);
      const selectCols = [
        'id', 'reading_datetime', column,
        hasNorm ? 'norm_status' : null,
        'plant_id',
        entityCfg ? entityCfg.fkColumn : null,
      ].filter(Boolean).join(',');

      let q = supabase
        .from(sourceTable as 'well_readings')
        .select(selectCols)
        .order('reading_datetime', { ascending: true })
        .limit(2000);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      if (entityCfg && entityId && entityId !== 'all') q = q.eq(entityCfg.fkColumn as never, entityId);
      if (dateFrom) q = q.gte('reading_datetime', dateFrom);
      if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');

      const { data: readings, error: readErr } = await q;
      if (readErr) throw new Error(readErr.message);

      const { corrections, stats } = runOLS((readings || []) as RawReading[], column);
      const resultId    = crypto.randomUUID();
      const outlierCount = corrections.filter(c => c.is_outlier).length;
      const userRole    = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

      const doc = {
        id:           resultId,
        source_table: sourceTable,
        column_name:  column,
        plant_id:     (plantId && plantId !== 'all') ? plantId : null,
        date_from:    dateFrom || null,
        date_to:      dateTo   || null,
        created_by:   session?.user?.id ?? null,
        created_role: userRole,
        row_count:    (readings || []).length,
        r_squared:    stats.r_squared,
        slope:        stats.slope,
        intercept:    stats.intercept,
        corrections,
        status:       'pending',
      };

      const { error: insertErr } = await supabase
        .from('regression_results')
        .insert(doc);
      if (insertErr) throw new Error(insertErr.message);

      toast.success(`Regression complete — ${outlierCount} outlier(s) detected`);
      refetchResults();
      qc.invalidateQueries({ queryKey: ['raw-readings'] });
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Regression failed');
    } finally {
      setRunning(false);
    }
  };

  if (!canView) {
    return (
      <Card className="p-8 text-center space-y-2 max-w-md mx-auto mt-12">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Data Analysis & Review requires Admin, Data Analyst, or Manager role.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in" data-testid="data-analysis-page">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          Data Analysis & Review
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Centralised regression analysis, raw-value editing, and normalization.
          All other pages are read-only — edits happen here only.
        </p>
      </div>

      {/* Role notice for Manager */}
      {isManager && !canEdit && (
        <div className="flex items-center gap-2 rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          You have read-only access. Admin or Data Analyst role is required to edit or run regression.
        </div>
      )}

      {/* ── Filter bar ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 items-end">
            {/* Source table */}
            <div className="space-y-1">
              <Label className="text-xs">Source table</Label>
              <Select value={sourceTable} onValueChange={handleTableChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TABLE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Column */}
            <div className="space-y-1">
              <Label className="text-xs">Column</Label>
              <Select value={column} onValueChange={setColumn}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(SOURCE_TABLES[sourceTable] ?? []).map(c => (
                    <SelectItem key={c} value={c} className="text-xs font-mono">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Plant — mirrors the universal plant selection from the top bar */}
            <div className="space-y-1">
              <Label className="text-xs">Plant</Label>
              <Select value={plantId} onValueChange={handlePlantChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All plants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs text-muted-foreground">All plants</SelectItem>
                  {plants.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity drill-down — for tables with sub-entities (wells, locators, trains, meters) */}
            {entityCfgMain && (
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  {entityCfgMain.filterLabel}
                  {entityOptions.length > 0 && (
                    <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground font-normal">
                      {entityOptions.length}
                    </span>
                  )}
                </Label>
                <Select
                  value={entityId}
                  onValueChange={setEntityId}
                  disabled={entityFetching && entityOptions.length === 0}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue
                      placeholder={
                        entityFetching
                          ? `Loading ${entityCfgMain.filterLabel}s…`
                          : `All ${entityCfgMain.filterLabel}s`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs text-muted-foreground">
                      All {entityCfgMain.filterLabel}s
                      {entityOptions.length > 0 && (
                        <span className="ml-1.5 text-[10px] opacity-60">({entityOptions.length})</span>
                      )}
                    </SelectItem>
                    {entityOptions.length === 0 && !entityFetching && (
                      <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
                        No {entityCfgMain.filterLabel.toLowerCase()}s found
                        {plantId !== 'all' ? ' for this plant' : ''}
                      </div>
                    )}
                    {entityOptions.map(opt => (
                      <SelectItem key={opt.id} value={opt.id} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Power Source filter — only for Grid & Solar Readings (plant-level, no sub-entity FK) */}
            {sourceTable === 'power_readings' && (
              <div className="space-y-1">
                <Label className="text-xs">Source</Label>
                <Select value={powerSource} onValueChange={v => {
                  setPowerSource(v);
                  // Auto-select the first matching column when filtering by source
                  const opt = POWER_SOURCE_OPTIONS.find(o => o.value === v);
                  if (opt && 'columns' in opt && opt.columns.length > 0) {
                    setColumn(opt.columns[0]);
                  } else if (v === 'all') {
                    setColumn(SOURCE_TABLES['power_readings'][0]);
                  }
                }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POWER_SOURCE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date from */}
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" className="h-8 text-xs" value={dateFrom}
                onChange={e => setDateFrom(e.target.value)} />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" className="h-8 text-xs" value={dateTo}
                onChange={e => setDateTo(e.target.value)} />
            </div>

            {/* Run button */}
            {canEdit && (
              <Button onClick={handleRunRegression} disabled={running} className="h-8 text-xs mt-auto">
                {running ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running…</>
                ) : (
                  <><Play className="h-3.5 w-3.5 mr-1.5" />Run Regression</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Two-table layout ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* LEFT — Raw Data Table (wider) */}
        <Card className="xl:col-span-3">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              Raw Data
              <Badge variant="outline" className="text-[10px] ml-1">Read-only source</Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Latest 200 rows for <span className="font-mono font-medium">{column}</span>.
              {canEdit && ' Click ✏ to edit a value (logged to audit trail).'}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-4">
            <RawDataTable
              sourceTable={sourceTable}
              column={column}
              plantId={plantId}
              entityId={entityId}
              dateFrom={dateFrom}
              dateTo={dateTo}
              canEdit={canEdit}
              onEdit={r => setEditReading(r)}
            />
          </CardContent>
        </Card>

        {/* RIGHT — Regression / Correction Table (narrower) */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Regression Results
              <Badge variant="outline" className="text-[10px] ml-1">corrected_value + notes</Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Each run shows outlier readings, corrected values (OLS projection), and Z-scores.
              {canEdit && ' Apply to write corrections; Retract to undo.'}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-4 space-y-3">
            {resultsError && (
              <div className="flex flex-col gap-1.5 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2.5 text-[11px]">
                <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Regression results table not found
                </div>
                <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                  The <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">regression_results</code> and{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">raw_edit_log</code> tables
                  have not been created in Supabase yet. Run the migration to fix this:
                </p>
                <p className="text-amber-700 dark:text-amber-400 font-mono text-[10px] bg-amber-100 dark:bg-amber-900 px-2 py-1 rounded">
                  supabase/migrations/20260515_supabase_only_and_data_analysis.sql
                </p>
                <p className="text-amber-600 dark:text-amber-500">
                  Go to <strong>Supabase Dashboard → SQL Editor</strong> and run the migration file above.
                </p>
              </div>
            )}
            {!resultsError && regressionResults.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {canEdit
                  ? 'No regression runs yet. Select a column and click "Run Regression".'
                  : 'No regression runs found for this selection.'}
              </div>
            )}
            {regressionResults.map(r => (
              <RegressionDetail
                key={r.result_id}
                result={r}
                canEdit={canEdit}
                onRefresh={() => { refetchResults(); qc.invalidateQueries({ queryKey: ['raw-readings'] }); }}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Audit / Normalization tabs ── */}
      <Card>
        <Tabs defaultValue="audit">
          <CardHeader className="pb-0 pt-4 px-4">
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="audit" className="text-xs">
                <Clock className="h-3 w-3 mr-1" /> Edit Audit
              </TabsTrigger>
              <TabsTrigger value="normalization" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" /> Flagged Readings
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent className="pt-3 px-3 pb-4">
            <TabsContent value="audit" className="mt-0">
              <AuditLogTab sourceTable={sourceTable} />
            </TabsContent>
            <TabsContent value="normalization" className="mt-0">
              <NormalizationAuditTab sourceTable={sourceTable} />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      {/* Edit raw value dialog */}
      <EditRawDialog
        open={!!editReading}
        onClose={() => setEditReading(null)}
        reading={editReading}
        column={column}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['raw-readings'] })}
      />
    </div>
  );
}
