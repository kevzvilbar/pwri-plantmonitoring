/**
 * DataCorrections.tsx
 * ═══════════════════
 * Unified correction hub — replaces the scattered Admin → Normalization panel,
 * the Pending Readings queue, and the per-row ReadingHistoryDialog corrections.
 *
 * Tabs
 * ────
 * 1. Pending Review  — readings auto-flagged by the DB trigger awaiting approval.
 *                      Bulk approve/retract + inline chain context (items 3, 4, 5).
 * 2. Correction Inbox — all active backward or erroneous readings still norm_status='normal'.
 *                      Admin can edit value (cascade), retract, or mark as replacement (item 6).
 * 3. Edit History    — reading_normalizations audit trail.
 * 4. Operator Stats  — rolling 30-day error rate table (item 7).
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2,
  ChevronDown, ChevronUp, ClipboardCheck, Inbox, History,
  Users, ArrowRight, Pencil, Search, ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceTable = 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';

interface FlaggedRow {
  id: string;
  source_table: SourceTable;
  entity_name: string;
  plant_name: string;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  operator_email: string | null;
  norm_status: string;
  flag_reason?: string;
}

interface CorrectionRequest {
  id: string;
  source_table: SourceTable;
  source_id: UUID;
  entity_name?: string;
  plant_name?: string;
  original_value: number;
  proposed_value: number;
  reason: string;
  note: string | null;
  status: string;
  submitter_email: string | null;
  created_at: string;
}

type UUID = string;

interface ChainEntry {
  id: string;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  norm_status: string;
  isFocused?: boolean;
}

interface OperatorStat {
  operator_email: string;
  total_entries: number;
  pending_review: number;
  retracted: number;
  backward_readings: number;
  error_rate_pct: number;
  last_entry_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtNum = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-PH', { maximumFractionDigits: 2 });

const fmtDt = (s: string) => format(new Date(s), 'dd MMM yy HH:mm');

const tableLabel: Record<SourceTable, string> = {
  locator_readings: 'Locator',
  well_readings: 'Well',
  product_meter_readings: 'Product Meter',
  ro_train_readings: 'RO Train',
};

function DeltaBadge({ vol }: { vol: number | null }) {
  if (vol == null) return <span className="text-muted-foreground">—</span>;
  const isNeg = vol < 0;
  return (
    <span className={cn('font-mono text-xs font-medium',
      isNeg ? 'text-destructive' : vol > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
      {vol >= 0 ? '+' : ''}{fmtNum(vol)} m³
    </span>
  );
}

// ── Chain context component (item 4) ──────────────────────────────────────────

function ChainContext({ focusedId, sourceTable, entityId, plantId }:
  { focusedId: string; sourceTable: SourceTable; entityId: string; plantId: string }) {

  const entityCol = sourceTable === 'locator_readings' ? 'locator_id'
    : sourceTable === 'well_readings' ? 'well_id'
    : sourceTable === 'product_meter_readings' ? 'meter_id' : null;

  const { data: chain = [], isLoading } = useQuery({
    queryKey: ['chain-context', focusedId, sourceTable],
    queryFn: async () => {
      if (!entityCol) return [];
      // Get the focused row's datetime
      const { data: focus } = await (supabase
        .from(sourceTable as any)
        .select('reading_datetime')
        .eq('id', focusedId)
        .single() as any);
      if (!focus) return [];

      const focusDt = focus.reading_datetime;
      const before3 = new Date(focusDt);
      before3.setDate(before3.getDate() - 7);
      const after3 = new Date(focusDt);
      after3.setDate(after3.getDate() + 7);

      const { data: rows } = await (supabase
        .from(sourceTable as any)
        .select('id,reading_datetime,previous_reading,current_reading,daily_volume,norm_status')
        .eq(entityCol, entityId)
        .eq('plant_id', plantId)
        .gte('reading_datetime', before3.toISOString())
        .lte('reading_datetime', after3.toISOString())
        .order('reading_datetime', { ascending: true })
        .limit(10) as any);

      return ((rows ?? []) as ChainEntry[]).map(r => ({ ...r, isFocused: r.id === focusedId }));
    },
    staleTime: 30_000,
  });

  if (isLoading) return <div className="p-3 text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading chain…</div>;
  if (!chain.length) return null;

  return (
    <div className="mt-3 border rounded-lg overflow-hidden text-xs">
      <div className="bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        Meter chain context
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left px-3 py-1.5 text-[10px] text-muted-foreground font-medium">Date / Time</th>
            <th className="text-right px-3 py-1.5 text-[10px] text-muted-foreground font-medium">Previous</th>
            <th className="text-right px-3 py-1.5 text-[10px] text-muted-foreground font-medium">Current</th>
            <th className="text-right px-3 py-1.5 text-[10px] text-muted-foreground font-medium">Delta</th>
            <th className="px-3 py-1.5 text-[10px] text-muted-foreground font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {chain.map(row => (
            <tr key={row.id}
              className={cn('border-b last:border-0 transition-colors',
                row.isFocused
                  ? 'bg-amber-50 dark:bg-amber-950/30 font-semibold'
                  : 'hover:bg-muted/20')}>
              <td className="px-3 py-2 font-mono">
                {row.isFocused && <span className="mr-1 text-amber-600">▶</span>}
                {format(new Date(row.reading_datetime), 'dd MMM HH:mm')}
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtNum(row.previous_reading)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtNum(row.current_reading)}</td>
              <td className="px-3 py-2 text-right"><DeltaBadge vol={row.daily_volume} /></td>
              <td className="px-3 py-2">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                  row.norm_status === 'retracted' ? 'bg-muted text-muted-foreground' :
                  row.norm_status === 'pending_review' ? 'bg-amber-100 text-amber-700' :
                  row.norm_status === 'normalized' ? 'bg-teal-100 text-teal-700' :
                  row.isFocused ? 'bg-amber-100 text-amber-700' : 'bg-muted/50 text-muted-foreground')}>
                  {row.norm_status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Edit value dialog (item 6 – cascade correction) ───────────────────────────

function EditValueModal({
  row, onClose, onDone,
}: { row: FlaggedRow; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const [newVal, setNewVal] = useState(String(row.current_reading));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const delta = Number(newVal) - (row.previous_reading ?? 0);

  const handleSave = async () => {
    const parsed = Number(newVal);
    if (isNaN(parsed) || !newVal) { toast.error('Enter a valid number'); return; }
    if (!reason.trim()) { toast.error('A correction reason is required'); return; }
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc('fn_cascade_reading_correction', {
        p_table:       row.source_table,
        p_row_id:      row.id,
        p_new_current: parsed,
        p_admin_id:    user?.id ?? null,
        p_reason:      reason,
      }) as any);
      if (error) throw error;
      toast.success(`Corrected: ${fmtNum(row.current_reading)} → ${fmtNum(parsed)}${data?.cascade_id ? ' · next row updated' : ''}`);
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? 'Correction failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background border rounded-xl shadow-xl p-5 w-full max-w-sm space-y-4 mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-sm">Edit reading — {row.entity_name}</h3>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>{row.plant_name} · {fmtDt(row.reading_datetime)}</div>
          <div>Previous reading: <span className="font-mono">{fmtNum(row.previous_reading)}</span></div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Correct current reading</label>
          <Input
            type="number"
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            className="font-mono h-9 text-sm"
            autoFocus
          />
          {newVal && !isNaN(Number(newVal)) && (
            <p className="text-xs text-muted-foreground">
              New delta: <DeltaBadge vol={delta} />
              {' · next row previous_reading will auto-update'}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Correction reason *</label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select reason…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Meter misread">Meter misread</SelectItem>
              <SelectItem value="Data entry typo">Data entry typo</SelectItem>
              <SelectItem value="Wrong previous value used">Wrong previous value used</SelectItem>
              <SelectItem value="Meter replaced — baseline reset">Meter replaced — baseline reset</SelectItem>
              <SelectItem value="Duplicate entry removed">Duplicate entry removed</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
          {reason === 'Other' && (
            <Input
              placeholder="Describe the issue…"
              className="h-8 text-xs mt-1"
              onChange={e => setReason(e.target.value)}
            />
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !reason || !newVal}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save &amp; cascade
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Pending Review tab (items 3, 4, 5) ───────────────────────────────────────

async function fetchPending(): Promise<FlaggedRow[]> {
  const tables: SourceTable[] = ['locator_readings', 'well_readings', 'product_meter_readings'];
  const results: FlaggedRow[] = [];

  for (const table of tables) {
    const entityCol = table === 'locator_readings' ? 'locator_id'
      : table === 'well_readings' ? 'well_id' : 'meter_id';
    const entityTable = table === 'locator_readings' ? 'locators'
      : table === 'well_readings' ? 'wells' : 'product_meters';

    const { data: rows } = await (supabase
      .from(table as any)
      .select(`id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, ${entityCol}`)
      .eq('norm_status', 'pending_review')
      .order('reading_datetime', { ascending: false })
      .limit(200) as any);

    if (!rows?.length) continue;

    // Resolve entity names
    const entityIds = [...new Set(rows.map((r: any) => r[entityCol]))].filter(Boolean) as string[];
    const { data: entities } = await (supabase
      .from(entityTable as any)
      .select('id, name')
      .in('id', entityIds) as any);
    const entityMap = Object.fromEntries((entities ?? []).map((e: any) => [e.id, e.name]));

    // Resolve plant names
    const plantIds = [...new Set(rows.map((r: any) => r.plant_id))].filter(Boolean) as string[];
    const { data: plants } = await (supabase
      .from('plants')
      .select('id, name')
      .in('id', plantIds) as any);
    const plantMap = Object.fromEntries((plants ?? []).map((p: any) => [p.id, p.name]));

    // Resolve emails from user_profiles
    const userIds = [...new Set(rows.map((r: any) => r.recorded_by))].filter(Boolean) as string[];
    const { data: profiles } = await (supabase
      .from('user_profiles')
      .select('id, email')
      .in('id', userIds) as any);
    const emailMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.email]));

    for (const r of rows) {
      const vol = r.daily_volume ?? (r.previous_reading != null ? r.current_reading - r.previous_reading : null);
      results.push({
        id: r.id,
        source_table: table,
        entity_name: entityMap[r[entityCol]] ?? '—',
        plant_name: plantMap[r.plant_id] ?? '—',
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading,
        daily_volume: vol,
        operator_email: emailMap[r.recorded_by] ?? null,
        norm_status: r.norm_status,
        flag_reason: vol != null && vol < 0 ? 'backward' : 'spike',
      });
    }
  }

  return results.sort((a, b) => new Date(b.reading_datetime).getTime() - new Date(a.reading_datetime).getTime());
}

async function fetchCorrectionRequests(): Promise<CorrectionRequest[]> {
  const { data: reqs } = await (supabase
    .from('correction_requests' as any)
    .select('id,source_table,source_id,plant_id,original_value,proposed_value,reason,note,status,submitted_by,created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100) as any);
  if (!reqs?.length) return [];

  const plantIds = [...new Set(reqs.map((r: any) => r.plant_id))].filter(Boolean) as string[];
  const { data: plants } = await (supabase.from('plants').select('id,name').in('id', plantIds) as any);
  const plantMap = Object.fromEntries((plants ?? []).map((p: any) => [p.id, p.name]));
  const userIds = [...new Set(reqs.map((r: any) => r.submitted_by))].filter(Boolean) as string[];
  const { data: profiles } = await (supabase.from('user_profiles').select('id,email').in('id', userIds) as any);
  const emailMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.email]));

  return reqs.map((r: any) => ({
    id: r.id, source_table: r.source_table, source_id: r.source_id,
    plant_name: plantMap[r.plant_id] ?? '—',
    original_value: r.original_value, proposed_value: r.proposed_value,
    reason: r.reason, note: r.note, status: r.status,
    submitter_email: emailMap[r.submitted_by] ?? null,
    created_at: r.created_at,
  }));
}

function PendingReviewTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ['data-corrections-pending'],
    queryFn: fetchPending,
    refetchInterval: 60_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<FlaggedRow | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [plantFilter, setPlantFilter] = useState('all');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const plants = useMemo(() => [...new Set(rows.map(r => r.plant_name))].sort(), [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (plantFilter !== 'all' && r.plant_name !== plantFilter) return false;
    if (searchQ) {
      const q = searchQ.toLowerCase();
      return r.entity_name.toLowerCase().includes(q) || r.operator_email?.toLowerCase().includes(q) || false;
    }
    return true;
  }), [rows, plantFilter, searchQ]);

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['data-corrections-pending'] });
    qc.invalidateQueries({ queryKey: ['pending-readings'] });
    qc.invalidateQueries({ queryKey: ['pending-readings-count'] });
    qc.invalidateQueries({ queryKey: ['correction-requests-pending'] });
  }, [qc]);

  const { data: corrReqs = [] } = useQuery({
    queryKey: ['correction-requests-pending'],
    queryFn: fetchCorrectionRequests,
    refetchInterval: 60_000,
  });

  const approveRequest = async (req: CorrectionRequest) => {
    // 1. Run cascade correction to apply proposed value
    const { error } = await (supabase.rpc('fn_cascade_reading_correction', {
      p_table:       req.source_table,
      p_row_id:      req.source_id,
      p_new_current: req.proposed_value,
      p_admin_id:    user?.id ?? null,
      p_reason:      'Approved correction request: ' + req.reason,
    }) as any);
    if (error) { toast.error(error.message); return; }
    // 2. Mark request as approved (triggers operator notification)
    await (supabase.from('correction_requests' as any)
      .update({ status: 'approved', resolved_by: user?.id, resolved_at: new Date().toISOString() })
      .eq('id', req.id) as any);
    toast.success('Correction approved and applied');
    invalidate();
  };

  const rejectRequest = async (req: CorrectionRequest, resolutionNote: string) => {
    // Revert to normal without changing value
    await (supabase.from(req.source_table as any).update({ norm_status: 'normal' }).eq('id', req.source_id) as any);
    await (supabase.from('correction_requests' as any)
      .update({ status: 'rejected', resolved_by: user?.id, resolved_at: new Date().toISOString(), resolution_note: resolutionNote || null })
      .eq('id', req.id) as any);
    toast.info('Correction request rejected — original value kept');
    invalidate();
  };

  const unlockReading = async (row: FlaggedRow) => {
    await (supabase.from(row.source_table as any)
      .update({ locked_at: null, locked_by: null })
      .eq('id', row.id) as any);
    toast.success(`${row.entity_name}: unlocked`);
    invalidate();
  };

  const resolveOne = async (row: FlaggedRow, decision: 'normal' | 'retracted') => {
    setBusy(p => ({ ...p, [row.id]: true }));
    const { error } = await (supabase
      .from(row.source_table as any)
      .update({ norm_status: decision })
      .eq('id', row.id) as any);

    if (!error) {
      await (supabase.from('reading_normalizations' as any).insert({
        source_table: row.source_table, source_id: row.id,
        action: decision === 'normal' ? 'normalize' : 'retract',
        original_value: row.current_reading,
        adjusted_value: decision === 'normal' ? row.current_reading : null,
        note: notes[row.id] || (decision === 'normal' ? 'Approved from corrections queue' : 'Rejected from corrections queue'),
        performed_by: user?.id ?? null, performed_role: 'Admin',
      }) as any);
      toast.success(decision === 'normal' ? `${row.entity_name}: approved` : `${row.entity_name}: rejected`);
      invalidate();
    } else {
      toast.error(error.message);
    }
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  const bulkResolve = async (decision: 'normal' | 'retracted') => {
    if (!selected.size) return;
    setBulkBusy(true);
    const targets = rows.filter(r => selected.has(r.id));
    let ok = 0;
    for (const row of targets) {
      const { error } = await (supabase.from(row.source_table as any).update({ norm_status: decision }).eq('id', row.id) as any);
      if (!error) { ok++; }
    }
    await (supabase.from('reading_normalizations' as any).insert(
      targets.map(row => ({
        source_table: row.source_table, source_id: row.id,
        action: decision === 'normal' ? 'normalize' : 'retract',
        original_value: row.current_reading,
        note: `Bulk ${decision === 'normal' ? 'approval' : 'rejection'} (${targets.length} rows)`,
        performed_by: user?.id ?? null, performed_role: 'Admin',
      }))
    ) as any);
    toast.success(`${ok} of ${targets.length} readings ${decision === 'normal' ? 'approved' : 'rejected'}`);
    setSelected(new Set());
    setBulkBusy(false);
    invalidate();
  };

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-3">
      {/* Filters + Bulk bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search locator or operator…" className="pl-8 h-8 text-xs" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        </div>
        <Select value={plantFilter} onValueChange={setPlantFilter}>
          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plants</SelectItem>
            {plants.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}><RefreshCw className="h-3 w-3" /></Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <div className="flex gap-1.5 ml-auto">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-emerald-400/40 text-emerald-700 hover:bg-emerald-50"
              disabled={bulkBusy} onClick={() => bulkResolve('normal')}>
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Approve all
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
              disabled={bulkBusy} onClick={() => bulkResolve('retracted')}>
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Reject all
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Item 8: Operator correction requests */}
      {corrReqs.length > 0 && (
        <div className="space-y-2 pb-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
            Operator correction requests ({corrReqs.length})
          </p>
          {corrReqs.map(req => (
            <Card key={req.id} className="p-4 border-blue-300/40 bg-blue-50/20 dark:bg-blue-950/10">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{tableLabel[req.source_table]}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{req.plant_name}</Badge>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                        Operator request
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {req.submitter_email} · {fmtDt(req.created_at)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div><div className="text-muted-foreground">Original</div><div className="font-mono font-medium text-amber-600">{fmtNum(req.original_value)}</div></div>
                  <div>
                    <div className="text-muted-foreground flex items-center gap-1"><ArrowRight className="h-2.5 w-2.5" />Proposed</div>
                    <div className="font-mono font-medium text-emerald-600">{fmtNum(req.proposed_value)}</div>
                  </div>
                  <div><div className="text-muted-foreground">Reason</div><div className="text-[11px] leading-tight">{req.reason}</div></div>
                </div>
                {req.note && <p className="text-xs text-muted-foreground italic">"{req.note}"</p>}
                <div className="flex gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-emerald-400/40 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => approveRequest(req)}>
                    <CheckCircle2 className="h-3 w-3" />Apply correction
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
                    onClick={() => rejectRequest(req, '')}>
                    <XCircle className="h-3 w-3" />Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-emerald-500" />
          {rows.length === 0 ? 'No readings pending review — all clear.' : 'No results match the current filters.'}
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select-all header */}
          <div className="flex items-center gap-2 px-1">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} className="h-4 w-4" />
            <span className="text-xs text-muted-foreground">{filtered.length} reading{filtered.length !== 1 ? 's' : ''} pending</span>
          </div>

          {filtered.map(row => {
            const isBack = (row.daily_volume ?? 0) < 0;
            const isBusy = busy[row.id] ?? false;
            const isExp = expanded === row.id;
            // Rough entity + plant IDs for chain context — we pass plant_id from the row
            // The row doesn't carry entityId directly; we use id as proxy for chain lookup
            return (
              <Card key={row.id} className={cn('p-4', isBack ? 'border-destructive/30' : 'border-amber-300/40')}>
                <div className="flex items-start gap-2.5">
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleOne(row.id)} className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate">{row.entity_name}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{row.plant_name}</Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{tableLabel[row.source_table]}</Badge>
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                            isBack ? 'bg-destructive/10 text-destructive' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300')}>
                            {isBack ? '↓ backward' : '↑ spike'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {fmtDt(row.reading_datetime)} · {row.operator_email ?? '—'}
                        </div>
                      </div>
                      <button onClick={() => setExpanded(isExp ? null : row.id)}
                        className="text-muted-foreground hover:text-foreground shrink-0 p-0.5">
                        {isExp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Meter values */}
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div><div className="text-muted-foreground">Previous</div><div className="font-mono font-medium">{fmtNum(row.previous_reading)}</div></div>
                      <div><div className="text-muted-foreground">Current</div><div className="font-mono font-medium">{fmtNum(row.current_reading)}</div></div>
                      <div><div className="text-muted-foreground">Delta</div><DeltaBadge vol={row.daily_volume} /></div>
                    </div>

                    {/* Chain context (item 4) */}
                    {isExp && (
                      <ChainContext
                        focusedId={row.id}
                        sourceTable={row.source_table}
                        entityId={row.id}
                        plantId={''}
                      />
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Optional note…"
                        value={notes[row.id] ?? ''}
                        onChange={e => setNotes(p => ({ ...p, [row.id]: e.target.value }))}
                        className="h-7 text-xs flex-1 min-w-[120px]"
                        disabled={isBusy}
                      />
                      <Button size="sm" variant="outline"
                        className="h-7 gap-1 text-xs border-teal-400/40 text-teal-700 hover:bg-teal-50"
                        disabled={isBusy} onClick={() => resolveOne(row, 'normal')}>
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Approve
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-7 gap-1 text-xs border-amber-400/40 text-amber-700 hover:bg-amber-50"
                        disabled={isBusy} onClick={() => setEditRow(row)}>
                        <Pencil className="h-3 w-3" />
                        Edit value
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
                        disabled={isBusy} onClick={() => resolveOne(row, 'retracted')}>
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        Reject
                      </Button>
                      {/* Item 9: unlock button — only shows after supervisor approval locks the row */}
                      {(row as any).locked_at && (
                        <Button size="sm" variant="outline"
                          className="h-7 gap-1 text-xs border-teal-400/40 text-teal-700 hover:bg-teal-50"
                          disabled={isBusy} onClick={() => unlockReading(row)}>
                          🔓 Unlock
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editRow && (
        <EditValueModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// ── Correction Inbox tab — active backward/erroneous readings ─────────────────

function CorrectionInboxTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editRow, setEditRow] = useState<FlaggedRow | null>(null);
  const [plantFilter, setPlantFilter] = useState('all');
  const [tableFilter, setTableFilter] = useState<'all' | SourceTable>('all');

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ['correction-inbox', plantFilter, tableFilter],
    queryFn: async () => {
      const results: FlaggedRow[] = [];
      const tables: SourceTable[] = tableFilter === 'all'
        ? ['locator_readings', 'well_readings', 'product_meter_readings']
        : [tableFilter as SourceTable];

      for (const table of tables) {
        const entityCol = table === 'locator_readings' ? 'locator_id'
          : table === 'well_readings' ? 'well_id' : 'meter_id';
        const entityTable = table === 'locator_readings' ? 'locators'
          : table === 'well_readings' ? 'wells' : 'product_meters';

        const { data: rows } = await (supabase
          .from(table as any)
          .select(`id,reading_datetime,previous_reading,current_reading,daily_volume,norm_status,recorded_by,plant_id,${entityCol}`)
          .eq('norm_status', 'normal')
          .lt('daily_volume', 0)
          .eq('is_meter_replacement', false)
          .order('reading_datetime', { ascending: false })
          .limit(100) as any);

        if (!rows?.length) continue;

        const entityIds = [...new Set(rows.map((r: any) => r[entityCol]))].filter(Boolean) as string[];
        const { data: entities } = await (supabase.from(entityTable as any).select('id,name').in('id', entityIds) as any);
        const entityMap = Object.fromEntries((entities ?? []).map((e: any) => [e.id, e.name]));
        const plantIds = [...new Set(rows.map((r: any) => r.plant_id))].filter(Boolean) as string[];
        const { data: plants } = await (supabase.from('plants').select('id,name').in('id', plantIds) as any);
        const plantMap = Object.fromEntries((plants ?? []).map((p: any) => [p.id, p.name]));
        const userIds = [...new Set(rows.map((r: any) => r.recorded_by))].filter(Boolean) as string[];
        const { data: profiles } = await (supabase.from('user_profiles').select('id,email').in('id', userIds) as any);
        const emailMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.email]));

        for (const r of rows) {
          if (plantFilter !== 'all' && plantMap[r.plant_id] !== plantFilter) continue;
          results.push({
            id: r.id, source_table: table,
            entity_name: entityMap[r[entityCol]] ?? '—',
            plant_name: plantMap[r.plant_id] ?? '—',
            reading_datetime: r.reading_datetime,
            previous_reading: r.previous_reading,
            current_reading: r.current_reading,
            daily_volume: r.daily_volume,
            operator_email: emailMap[r.recorded_by] ?? null,
            norm_status: r.norm_status,
            flag_reason: 'backward (active)',
          });
        }
      }
      return results.sort((a, b) => new Date(b.reading_datetime).getTime() - new Date(a.reading_datetime).getTime());
    },
    staleTime: 60_000,
  });

  const plants = useMemo(() => [...new Set(rows.map(r => r.plant_name))].sort(), [rows]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const retractOne = async (row: FlaggedRow) => {
    setBusy(p => ({ ...p, [row.id]: true }));
    const { error } = await (supabase.from(row.source_table as any).update({ norm_status: 'retracted' }).eq('id', row.id) as any);
    if (!error) {
      await (supabase.from('reading_normalizations' as any).insert({
        source_table: row.source_table, source_id: row.id, action: 'retract',
        original_value: row.current_reading, note: 'Retracted from correction inbox',
        performed_by: user?.id ?? null, performed_role: 'Admin',
      }) as any);
      toast.success(`${row.entity_name}: retracted`);
      qc.invalidateQueries({ queryKey: ['correction-inbox'] });
    } else { toast.error(error.message); }
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  const markReplacement = async (row: FlaggedRow) => {
    setBusy(p => ({ ...p, [row.id]: true }));
    const { error } = await (supabase.from(row.source_table as any).update({ is_meter_replacement: true, norm_status: 'normalized' }).eq('id', row.id) as any);
    if (!error) { toast.success(`${row.entity_name}: marked as meter replacement`); qc.invalidateQueries({ queryKey: ['correction-inbox'] }); }
    else toast.error(error.message);
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={plantFilter} onValueChange={setPlantFilter}>
          <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue placeholder="All plants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plants</SelectItem>
            {plants.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tableFilter} onValueChange={v => setTableFilter(v as any)}>
          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="locator_readings">Locator</SelectItem>
            <SelectItem value="well_readings">Well</SelectItem>
            <SelectItem value="product_meter_readings">Product Meter</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}><RefreshCw className="h-3 w-3" /></Button>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} active backward readings</span>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-emerald-500" />
          No active backward readings — inbox clear.
        </Card>
      ) : rows.map(row => {
        const isBusy = busy[row.id] ?? false;
        const isExp = expanded === row.id;
        return (
          <Card key={row.id} className="p-4 border-destructive/20">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium">{row.entity_name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{row.plant_name}</Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{tableLabel[row.source_table]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{fmtDt(row.reading_datetime)} · {row.operator_email ?? '—'}</div>
                </div>
                <button onClick={() => setExpanded(isExp ? null : row.id)} className="text-muted-foreground hover:text-foreground p-0.5">
                  {isExp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div><div className="text-muted-foreground">Previous</div><div className="font-mono font-medium">{fmtNum(row.previous_reading)}</div></div>
                <div><div className="text-muted-foreground">Current</div><div className="font-mono font-medium">{fmtNum(row.current_reading)}</div></div>
                <div><div className="text-muted-foreground">Delta</div><DeltaBadge vol={row.daily_volume} /></div>
              </div>
              {isExp && <ChainContext focusedId={row.id} sourceTable={row.source_table} entityId={row.id} plantId="" />}
              <div className="flex gap-1.5 flex-wrap">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={isBusy} onClick={() => setEditRow(row)}>
                  <Pencil className="h-3 w-3" />Edit value
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-amber-700 border-amber-400/40" disabled={isBusy} onClick={() => markReplacement(row)}>
                  Mark as meter replacement
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-destructive border-destructive/30" disabled={isBusy} onClick={() => retractOne(row)}>
                  {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}Retract
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
      {editRow && (
        <EditValueModal row={editRow} onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); qc.invalidateQueries({ queryKey: ['correction-inbox'] }); }} />
      )}
    </div>
  );
}

// ── Edit History tab ──────────────────────────────────────────────────────────

function EditHistoryTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['correction-history'],
    queryFn: async () => {
      const { data } = await (supabase
        .from('reading_normalizations' as any)
        .select('*')
        .order('performed_at', { ascending: false })
        .limit(200) as any);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const actionBadge = (action: string) => {
    const cfg: Record<string, string> = {
      normalize: 'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300',
      retract:   'bg-muted text-muted-foreground',
      tag:       'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
    };
    return <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', cfg[action] ?? 'bg-muted text-muted-foreground')}>{action}</span>;
  };

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Last 200 normalization actions across all tables.</p>
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No normalization history yet.</Card>
      ) : (
        <div className="border rounded-lg overflow-hidden text-xs">
          <table className="w-full">
            <thead className="bg-muted/40">
              <tr>
                {['Date', 'Table', 'Action', 'Original', 'Adjusted', 'Note', 'By'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-[10px] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{format(new Date(r.performed_at), 'dd MMM yy HH:mm')}</td>
                  <td className="px-3 py-2 text-muted-foreground">{tableLabel[r.source_table as SourceTable] ?? r.source_table}</td>
                  <td className="px-3 py-2">{actionBadge(r.action)}</td>
                  <td className="px-3 py-2 font-mono text-right">{fmtNum(r.original_value)}</td>
                  <td className="px-3 py-2 font-mono text-right">{fmtNum(r.adjusted_value)}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate" title={r.note}>{r.note ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.performed_role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Operator Stats tab (item 7) ───────────────────────────────────────────────

function OperatorStatsTab() {
  const { data: stats = [], isLoading } = useQuery({
    queryKey: ['operator-error-rates'],
    queryFn: async () => {
      const { data } = await (supabase
        .from('operator_error_rates_30d' as any)
        .select('*')
        .order('error_rate_pct', { ascending: false }) as any);
      return (data ?? []) as OperatorStat[];
    },
    staleTime: 5 * 60_000,
  });

  const rateColor = (pct: number) =>
    pct >= 20 ? 'text-destructive font-semibold' :
    pct >= 10 ? 'text-amber-600 font-medium' :
    pct >= 5  ? 'text-amber-500' : 'text-emerald-600';

  const rateBg = (pct: number) =>
    pct >= 20 ? 'bg-destructive/10' :
    pct >= 10 ? 'bg-amber-50 dark:bg-amber-950/20' : '';

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Rolling 30-day error rate across locator and well readings. Operators at ≥10% are highlighted.</p>
      {stats.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No operator data available yet.</Card>
      ) : (
        <div className="border rounded-lg overflow-hidden text-xs">
          <table className="w-full">
            <thead className="bg-muted/40">
              <tr>
                {['Operator', 'Entries', 'Backward', 'Pending', 'Retracted', 'Error rate', 'Last entry'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-[10px] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={i} className={cn('border-t', rateBg(s.error_rate_pct))}>
                  <td className="px-3 py-2.5 font-medium max-w-[180px]">
                    <div className="truncate" title={s.operator_email}>{s.operator_email ?? '—'}</div>
                    {s.error_rate_pct >= 10 && (
                      <div className="text-[10px] text-amber-600 mt-0.5">Needs review</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{s.total_entries.toLocaleString()}</td>
                  <td className="px-3 py-2.5">{s.backward_readings > 0 ? <span className="text-destructive font-medium">{s.backward_readings}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2.5">{s.pending_review > 0 ? <span className="text-amber-600 font-medium">{s.pending_review}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2.5">{s.retracted > 0 ? <span className="text-muted-foreground">{s.retracted}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn('font-mono', rateColor(s.error_rate_pct))}>
                      {s.error_rate_pct?.toFixed(1) ?? '0.0'}%
                    </span>
                    <div className="w-full bg-muted rounded-full h-1 mt-1">
                      <div className={cn('h-1 rounded-full', s.error_rate_pct >= 20 ? 'bg-destructive' : s.error_rate_pct >= 10 ? 'bg-amber-500' : 'bg-emerald-500')}
                        style={{ width: `${Math.min(100, s.error_rate_pct * 3)}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {s.last_entry_at ? formatDistanceToNow(new Date(s.last_entry_at), { addSuffix: true }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Pending count hook (for tab badge) ────────────────────────────────────────

function usePendingCount() {
  return useQuery({
    queryKey: ['pending-readings-count'],
    queryFn: async () => {
      const tables = ['locator_readings', 'well_readings', 'product_meter_readings'];
      const counts = await Promise.all(tables.map(t =>
        (supabase.from(t as any).select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review') as any)
      ));
      return counts.reduce((sum, r) => sum + (r.count ?? 0), 0);
    },
    refetchInterval: 60_000,
  });
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function DataCorrections() {
  const { isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: pendingCount = 0 } = usePendingCount();

  if (!isAdmin && !isManager && !isDataAnalyst) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="p-8 text-center space-y-2 max-w-sm">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
          <h2 className="font-semibold">Access restricted</h2>
          <p className="text-sm text-muted-foreground">Data Corrections requires Admin, Manager, or Data Analyst access.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Data Corrections</h1>
        <p className="text-xs text-muted-foreground">
          Review flagged readings, correct values, retract errors, and track operator accuracy — all in one place.
        </p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="pending" className="gap-1.5 text-xs">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Pending
            {pendingCount > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-destructive text-destructive-foreground">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="inbox" className="gap-1.5 text-xs">
            <Inbox className="h-3.5 w-3.5" />
            Inbox
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 text-xs">
            <History className="h-3.5 w-3.5" />
            History
          </TabsTrigger>
          <TabsTrigger value="operators" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            Operators
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4"><PendingReviewTab /></TabsContent>
        <TabsContent value="inbox" className="mt-4"><CorrectionInboxTab /></TabsContent>
        <TabsContent value="history" className="mt-4"><EditHistoryTab /></TabsContent>
        <TabsContent value="operators" className="mt-4"><OperatorStatsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
