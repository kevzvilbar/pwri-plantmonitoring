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
 *   2. Run Regression  → backend fits OLS, flags outliers, stores result
 *   3. Review the regression table
 *   4. Apply (writes corrected values + reading_normalizations rows)
 *      or Retract if already applied
 *   5. All edits are logged; dashboard picks up ⚠️ / 🔄 / ⏪ symbols
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import {
  FlaskConical, Play, CheckCircle2, Undo2, Pencil, ShieldAlert,
  TrendingUp, Database, AlertTriangle, RefreshCw, Clock, Eye,
  ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';

const SOURCE_TABLES: Record<string, string[]> = {
  well_readings:          ['daily_volume', 'current_reading', 'previous_reading', 'power_meter_reading'],
  locator_readings:       ['daily_volume', 'current_reading', 'previous_reading'],
  product_meter_readings: ['daily_volume', 'current_reading', 'previous_reading'],
  ro_train_readings:      ['permeate_tds', 'permeate_ph', 'raw_turbidity', 'dp_psi', 'recovery_pct'],
};

const TABLE_LABELS: Record<string, string> = {
  well_readings:          'Well Readings',
  locator_readings:       'Locator Readings',
  product_meter_readings: 'Product Meter Readings',
  ro_train_readings:      'RO Train Readings',
};

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

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
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
    pending:   { label: 'Pending',  cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    applied:   { label: 'Applied',  cls: 'bg-teal-100  text-teal-800  border-teal-300'  },
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
  token: string;
  onSuccess: () => void;
}

function EditRawDialog({ open, onClose, reading, column, token, onSuccess }: EditRawDialogProps) {
  const [newValue, setNewValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const oldValue = reading ? (reading[column] as number | null) : null;

  const handleSave = async () => {
    if (!reading) return;
    const parsed = parseFloat(newValue);
    if (isNaN(parsed)) { toast.error('Enter a valid number'); return; }
    setSaving(true);
    try {
      await apiPost('/api/data-analysis/edit-raw', {
        source_table: reading._sourceTable,
        source_id:    reading.id,
        column_name:  column,
        old_value:    oldValue,
        new_value:    parsed,
        note:         note || undefined,
      }, token);
      toast.success('Value updated and logged');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast.error((e as Error).message);
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
  result, token, canEdit, onRefresh,
}: { result: RegressionResult; token: string; canEdit: boolean; onRefresh: () => void }) {
  const [applying, setApplying] = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const outliers = result.corrections.filter(c => c.is_outlier);

  const handleApply = async () => {
    setApplying(true);
    try {
      const r = await apiPost<{ applied: number }>('/api/data-analysis/apply-regression',
        { result_id: result.result_id }, token);
      toast.success(`Applied ${r.applied} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const handleRetract = async () => {
    setRetracting(true);
    try {
      const r = await apiPost<{ retracted: number }>('/api/data-analysis/retract-regression',
        { result_id: result.result_id }, token);
      toast.success(`Retracted ${r.retracted} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message);
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
          { label: 'Rows',      value: result.row_count },
          { label: 'Outliers',  value: outliers.length },
          { label: 'R²',        value: result.r_squared != null ? result.r_squared.toFixed(4) : '—' },
          { label: 'Run at',    value: result.created_at ? format(parseISO(result.created_at), 'MMM d HH:mm') : '—' },
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
              {result.corrections.filter(c => c.is_outlier).map(c => (
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
  sourceTable, column, plantId, dateFrom, dateTo, canEdit, token, onEdit,
}: {
  sourceTable: string; column: string; plantId: string; dateFrom: string; dateTo: string;
  canEdit: boolean; token: string;
  onEdit: (reading: RawReading) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['raw-readings', sourceTable, column, plantId, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from(sourceTable as 'well_readings')
        .select(`id,reading_datetime,${column},norm_status,plant_id`)
        .order('reading_datetime', { ascending: false })
        .limit(200);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      if (dateFrom) q = q.gte('reading_datetime', dateFrom);
      if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data || []).map(r => ({ ...r, _sourceTable: sourceTable })) as RawReading[];
    },
    enabled: !!sourceTable && !!column,
  });

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading raw data…</div>;
  if (!data?.length) return <div className="py-8 text-center text-sm text-muted-foreground">No readings found for this selection.</div>;

  return (
    <div className="overflow-auto max-h-[520px] rounded border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow className="text-[11px]">
            <TableHead>Date</TableHead>
            <TableHead className="text-right">{column}</TableHead>
            <TableHead>Status</TableHead>
            {canEdit && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(row => (
            <TableRow key={row.id} className={cn('text-xs', row.norm_status === 'erroneous' && 'bg-amber-50/60 dark:bg-amber-950/20')}>
              <TableCell className="font-mono">{String(row.reading_datetime || '').slice(0, 10)}</TableCell>
              <TableCell className="text-right font-mono">
                {row[column] != null ? Number(row[column]).toFixed(3) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell><NormBadge status={row.norm_status} /></TableCell>
              {canEdit && (
                <TableCell>
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Audit log tab ──────────────────────────────────────────────────────────────

function AuditLogTab({ token, sourceTable }: { token: string; sourceTable: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['raw-edit-log', sourceTable],
    queryFn: () => apiGet<{ log: object[] }>(
      `/api/data-analysis/raw-edit-log?source_table=${encodeURIComponent(sourceTable)}&limit=100`,
      token,
    ),
    enabled: !!sourceTable && !!token,
  });

  const rows = (data as { log: Array<Record<string, unknown>> } | undefined)?.log ?? [];

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading audit log…</div>;
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

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DataAnalysis() {
  const { isAdmin, isDataAnalyst, isManager, session } = useAuth();
  const qc = useQueryClient();
  const token = session?.access_token ?? '';

  // Filter state
  const [sourceTable, setSourceTable] = useState('well_readings');
  const [column, setColumn]           = useState('daily_volume');
  const [plantId, setPlantId]         = useState('all');
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');

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

  // Regression results
  const { data: resultsData, refetch: refetchResults } = useQuery({
    queryKey: ['regression-results', sourceTable, plantId],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (sourceTable) qs.set('source_table', sourceTable);
      if (plantId && plantId !== 'all') qs.set('plant_id', plantId);
      qs.set('limit', '20');
      return apiGet<{ results: RegressionResult[] }>(`/api/data-analysis/results?${qs}`, token);
    },
    enabled: !!token && canView,
    staleTime: 15_000,
  });
  const regressionResults = (resultsData as { results: RegressionResult[] } | undefined)?.results ?? [];

  // When source table changes, reset column to first valid one
  const handleTableChange = (t: string) => {
    setSourceTable(t);
    setColumn(SOURCE_TABLES[t]?.[0] ?? '');
  };

  const handleRunRegression = async () => {
    if (!sourceTable || !column) { toast.error('Select a table and column first'); return; }
    setRunning(true);
    try {
      await apiPost('/api/data-analysis/run-regression', {
        source_table: sourceTable,
        column_name:  column,
        plant_id:     (plantId && plantId !== 'all') ? plantId : undefined,
        date_from:    dateFrom || undefined,
        date_to:      dateTo   || undefined,
      }, token);
      toast.success('Regression complete — results updated');
      refetchResults();
      qc.invalidateQueries({ queryKey: ['raw-readings'] });
    } catch (e: unknown) {
      toast.error((e as Error).message);
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
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

            {/* Plant */}
            <div className="space-y-1">
              <Label className="text-xs">Plant (optional)</Label>
              <Select value={plantId} onValueChange={setPlantId}>
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* LEFT — Raw Data Table */}
        <Card>
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
              dateFrom={dateFrom}
              dateTo={dateTo}
              canEdit={canEdit}
              token={token}
              onEdit={r => setEditReading(r)}
            />
          </CardContent>
        </Card>

        {/* RIGHT — Regression / Correction Table */}
        <Card>
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
            {regressionResults.length === 0 && (
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
                token={token}
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
              <AuditLogTab token={token} sourceTable={sourceTable} />
            </TabsContent>
            <TabsContent value="normalization" className="mt-0">
              <NormalizationAuditTab token={token} sourceTable={sourceTable} />
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
        token={token}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['raw-readings'] })}
      />
    </div>
  );
}

// ── Normalization Audit Tab ────────────────────────────────────────────────────

function NormalizationAuditTab({ token, sourceTable }: { token: string; sourceTable: string }) {
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
