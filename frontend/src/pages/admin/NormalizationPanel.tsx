/**
 * NormalizationPanel
 * ──────────────────
 * Admin console tab visible to Admin and Data Analyst.
 * Displays all flagged/normalized/retracted readings across tables,
 * lets authorised users bulk-tag, normalize, or retract, and shows
 * the full normalization audit trail.
 *
 * Requires the reading_normalizations table and norm_status columns —
 * see NormalizeButton.tsx for the SQL migration.
 */

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  AlertTriangle, RefreshCw, Undo2, Search, Download, FlaskConical,
  Database, Activity, ShieldAlert,
} from 'lucide-react';
import { NormStatusBadge, NormStatusEmoji, NormalizeButton, type NormStatus } from '@/components/NormalizeButton';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type NormAction = 'tag' | 'normalize' | 'retract';

interface AuditRow {
  id: string;
  source_table: string;
  source_id: string;
  action: NormAction;
  original_value: number | null;
  adjusted_value: number | null;
  note: string | null;
  performed_by: string | null;
  performed_role: string;
  performed_at: string;
  retractable: boolean;
}

interface FlaggedReading {
  id: string;
  table_name: string;
  reading_datetime: string;
  current_reading: number | null;
  daily_volume: number | null;
  norm_status: NormStatus;
  plant_id: string | null;
  entity_label: string | null;
}

type FilterTab = 'all' | 'erroneous' | 'normalized' | 'retracted';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tableIcon(t: string) {
  if (t.includes('locator'))   return <Activity className="h-3.5 w-3.5 text-primary" />;
  if (t.includes('well'))      return <Database className="h-3.5 w-3.5 text-teal-600" />;
  if (t.includes('product'))   return <FlaskConical className="h-3.5 w-3.5 text-accent" />;
  if (t.includes('ro_train'))  return <RefreshCw className="h-3.5 w-3.5 text-chart-6" />;
  return <Database className="h-3.5 w-3.5 text-muted-foreground" />;
}

function tableLabel(t: string) {
  const map: Record<string, string> = {
    locator_readings:       'Locator',
    well_readings:          'Well',
    product_meter_readings: 'Product Meter',
    ro_train_readings:      'RO Train',
  };
  return map[t] ?? t;
}

function actionBadge(action: NormAction) {
  const cfg: Record<NormAction, { label: string; cls: string }> = {
    tag:       { label: '⚠️ Tagged',     cls: 'border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300' },
    normalize: { label: '🔄 Normalized', cls: 'border-teal-400  text-teal-700  bg-teal-50  dark:bg-teal-950/30  dark:text-teal-300'  },
    retract:   { label: '⏪ Retracted',  cls: 'border-border    text-muted-foreground bg-muted' },
  };
  const { label, cls } = cfg[action];
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', cls)}>
      {label}
    </span>
  );
}

// ── Flagged readings section ──────────────────────────────────────────────────

function FlaggedReadingsSection({ isDataAnalyst }: { isDataAnalyst: boolean }) {
  const qc                          = useQueryClient();
  const [filter, setFilter]         = useState<FilterTab>('all');
  const [search, setSearch]         = useState('');
  const INVALIDATE                  = [['norm-flagged']];

  // Fetch non-normal readings from both main reading tables
  // Uses 'as any' because norm_status is added via migration and not yet in types.ts
  const { data: locFlagged, isLoading: locLoading } = useQuery({
    queryKey: ['norm-flagged', 'locator'],
    queryFn: async () => {
      const { data } = await (supabase.from('locator_readings' as any) as any)
        .select('id, reading_datetime, current_reading, daily_volume, norm_status, plant_id, locator_id')
        .not('norm_status', 'is', null)
        .neq('norm_status', 'normal')
        .order('reading_datetime', { ascending: false })
        .limit(200);
      return (data ?? []).map((r: any) => ({
        ...r, table_name: 'locator_readings', entity_label: r.locator_id,
      })) as FlaggedReading[];
    },
  });

  const { data: wellFlagged, isLoading: wellLoading } = useQuery({
    queryKey: ['norm-flagged', 'well'],
    queryFn: async () => {
      const { data } = await (supabase.from('well_readings' as any) as any)
        .select('id, reading_datetime, current_reading, daily_volume, norm_status, plant_id, well_id')
        .not('norm_status', 'is', null)
        .neq('norm_status', 'normal')
        .order('reading_datetime', { ascending: false })
        .limit(200);
      return (data ?? []).map((r: any) => ({
        ...r, table_name: 'well_readings', entity_label: r.well_id,
      })) as FlaggedReading[];
    },
  });

  const all = useMemo<FlaggedReading[]>(() => {
    const merged = [...(locFlagged ?? []), ...(wellFlagged ?? [])];
    merged.sort((a, b) => new Date(b.reading_datetime).getTime() - new Date(a.reading_datetime).getTime());
    return merged;
  }, [locFlagged, wellFlagged]);

  const filtered = useMemo(() => {
    let list = all;
    if (filter !== 'all') list = list.filter((r) => r.norm_status === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) =>
      (r.entity_label ?? '').toLowerCase().includes(q) ||
      tableLabel(r.table_name).toLowerCase().includes(q),
    );
    return list;
  }, [all, filter, search]);

  // Export flagged readings as CSV
  const handleExport = () => {
    const headers = ['id', 'table', 'entity', 'reading_datetime', 'current_reading', 'daily_volume', 'norm_status'];
    const rows = filtered.map((r) => [
      r.id, r.table_name, r.entity_label ?? '', r.reading_datetime,
      r.current_reading ?? '', r.daily_volume ?? '', r.norm_status,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `normalization_export_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Exported flagged readings.');
  };

  const isLoading = locLoading || wellLoading;

  const TABS: { value: FilterTab; label: string; icon: React.ReactNode }[] = [
    { value: 'all',        label: 'All',        icon: <Database className="h-3 w-3" /> },
    { value: 'erroneous',  label: 'Flagged',    icon: <AlertTriangle className="h-3 w-3 text-amber-500" /> },
    { value: 'normalized', label: 'Normalized', icon: <RefreshCw className="h-3 w-3 text-teal-500" /> },
    { value: 'retracted',  label: 'Retracted',  icon: <Undo2 className="h-3 w-3" /> },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status filter tabs */}
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-0.5">
          {TABS.map(({ value, label, icon }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                filter === value
                  ? 'bg-card shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid={`norm-filter-${value}`}
            >
              {icon}{label}
              {value !== 'all' && (
                <span className="ml-0.5 tabular-nums text-[10px] opacity-70">
                  ({all.filter((r) => r.norm_status === value).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search entity / table…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport}
          disabled={filtered.length === 0}>
          <Download className="h-3 w-3 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Table missing warning */}
      <Card className="p-3 text-xs text-amber-700 border-amber-500/30 bg-amber-500/5 hidden [&.show]:flex items-start gap-2"
        id="norm-migration-warning">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          <strong>norm_status columns not yet created.</strong> Run{' '}
          <code>supabase/migrations/20260514_normalization.sql</code> in your
          Supabase SQL editor to enable the full normalization workflow.
        </span>
      </Card>

      {/* Results */}
      {isLoading ? (
        <Card className="p-6 text-center text-xs text-muted-foreground">Loading flagged readings…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-center text-xs text-muted-foreground">
          {filter === 'all' ? 'No flagged or normalized readings yet.' : `No ${filter} readings found.`}
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/60">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reading date</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Value</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Status</th>
                {isDataAnalyst && (
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={`${r.table_name}-${r.id}`}
                  className={cn('border-t border-border/50', i % 2 === 0 ? 'bg-background' : 'bg-muted/10')}
                  data-testid={`norm-row-${r.id}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {tableIcon(r.table_name)}
                      <span className="font-medium">{tableLabel(r.table_name)}</span>
                      <span className="text-muted-foreground text-[10px] font-mono truncate max-w-[80px]">
                        {(r.entity_label ?? '').slice(-8)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.daily_volume ?? r.current_reading ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <NormStatusBadge status={r.norm_status} />
                  </td>
                  {isDataAnalyst && (
                    <td className="px-3 py-2 text-right">
                      <NormalizeButton
                        sourceTable={r.table_name as any}
                        sourceId={r.id}
                        currentStatus={r.norm_status}
                        readingValue={r.daily_volume ?? r.current_reading ?? 0}
                        invalidateKeys={[['norm-flagged', 'locator'], ['norm-flagged', 'well']]}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Showing {filtered.length} of {all.length} non-normal readings.
        Symbols: ⚠️ flagged · 🔄 normalized · ⏪ retracted.
      </p>
    </div>
  );
}

// ── Audit trail section ───────────────────────────────────────────────────────

function NormAuditTrail() {
  const [actionFilter, setActionFilter] = useState<NormAction | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['norm-audit', actionFilter],
    queryFn: async () => {
      let q = (supabase.from('reading_normalizations' as any) as any)
        .select('*')
        .order('performed_at', { ascending: false })
        .limit(100);
      if (actionFilter !== 'all') q = q.eq('action', actionFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {(['all', 'tag', 'normalize', 'retract'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setActionFilter(a)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-md border transition-colors',
              actionFilter === a ? 'bg-accent text-accent-foreground border-accent' : 'bg-card hover:bg-muted',
            )}
            data-testid={`norm-audit-filter-${a}`}
          >
            {a === 'all' ? 'All actions' : a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>

      {isLoading && (
        <Card className="p-4 text-center text-xs text-muted-foreground">Loading audit trail…</Card>
      )}

      {!isLoading && (data?.length ?? 0) === 0 && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          No normalization actions recorded yet.
        </Card>
      )}

      <div className="space-y-1.5">
        {(data ?? []).map((e) => (
          <Card key={e.id} className="p-3 space-y-1" data-testid={`norm-audit-${e.id}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {actionBadge(e.action)}
                <span className="text-[11px] font-medium">
                  {tableLabel(e.source_table)}
                  <span className="text-muted-foreground font-normal ml-1 font-mono">
                    …{e.source_id.slice(-8)}
                  </span>
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {format(new Date(e.performed_at), 'MMM d yyyy, HH:mm')}
              </span>
            </div>

            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3">
              <span>By: <strong className="text-foreground">{e.performed_role}</strong></span>
              {e.original_value != null && (
                <span>Original: <strong className="text-foreground font-mono">{e.original_value}</strong></span>
              )}
              {e.adjusted_value != null && (
                <span>Adjusted: <strong className="text-teal-600 dark:text-teal-400 font-mono">{e.adjusted_value}</strong></span>
              )}
              {e.retractable && (
                <span className="text-primary">retractable</span>
              )}
            </div>

            {e.note && (
              <p className="text-[11px] italic text-muted-foreground">"{e.note}"</p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function NormalizationPanel() {
  const { isAdmin, isDataAnalyst } = useAuth();
  const [activeTab, setActiveTab] = useState<'flagged' | 'audit'>('flagged');

  if (!isDataAnalyst) {
    return (
      <Card className="p-6 text-center space-y-2">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold text-sm">Access denied</h2>
        <p className="text-xs text-muted-foreground">
          Normalization tools are restricted to Admin and Data Analyst roles.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-teal-600" />
          Data Normalization
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Review flagged readings, apply normalization adjustments, and audit all
          normalization actions. Admin and Data Analyst only.
        </p>
      </div>

      {/* Legend */}
      <Card className="p-3">
        <p className="text-[11px] font-medium mb-2 text-muted-foreground uppercase tracking-wide">Status legend</p>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <strong>⚠️ Flagged</strong> — erroneous / out-of-range reading
          </span>
          <span className="flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5 text-teal-500" />
            <strong>🔄 Normalized</strong> — value adjusted by analyst
          </span>
          <span className="flex items-center gap-1.5">
            <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
            <strong>⏪ Retracted</strong> — normalization undone, original preserved
          </span>
        </div>
      </Card>

      {/* Workflow info (Admin only) */}
      {isAdmin && (
        <Card className="p-3 border-violet-200 bg-violet-50/40 dark:border-violet-800 dark:bg-violet-950/20">
          <p className="text-xs text-violet-700 dark:text-violet-300">
            <strong>Admin:</strong> You can hard-delete readings and assign the Data Analyst role
            from the Users tab. Data Analysts can tag, normalize, and retract but cannot delete.
          </p>
        </Card>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 border-b">
        {[
          { id: 'flagged', label: 'Flagged & Normalized readings' },
          { id: 'audit',   label: 'Normalization audit trail' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={cn(
              'px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            data-testid={`norm-tab-${id}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'flagged' && <FlaggedReadingsSection isDataAnalyst={isDataAnalyst} />}
      {activeTab === 'audit'   && <NormAuditTrail />}
    </div>
  );
}
