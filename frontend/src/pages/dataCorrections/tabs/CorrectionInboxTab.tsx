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

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { DataState } from '@/components/DataState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { format, formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2,
  ChevronDown, ChevronUp, ClipboardCheck, Inbox, History,
  Users, ArrowRight, Pencil, Search, ShieldAlert, Gauge,
  AlertTriangle, CheckSquare, FileText, Clock, Activity, Tag, HelpCircle, FileQuestion,
} from 'lucide-react';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  computeRollingAverageRate, computeRollingAverageRateFromDeltas, RatePoint, VolumePoint,
} from '@/lib/flowRateGuards';
import { submitAnomalyRemark } from '@/lib/anomalyRemarks';
import { cn } from '@/lib/utils';
import { SourceTable, FlaggedRow, CorrectionRequest, ChainEntry, OperatorStat, tableLabel, fmtNum, fmtDt, parseNumeric, extractOldValueFromChanges, pickDisplayRole, ROLE_DISPLAY_PRIORITY, UUID } from '../types';
import { PENDING_FETCH_LIMIT_PER_TABLE, guessMeterMax, fetchPending, fetchCorrectionRequests, supersedeOtherCorrectionRequests } from '../api';
import { DeltaBadge } from '../components/DeltaBadge';
import { FlagBadge } from '../components/FlagBadge';
import { ChainContext } from '../components/ChainContext';
import { AnomalyDiagnosticsBadge, formatElapsedDuration, PrecedingReadingTooltip } from '../components/DiagnosticPopover';
import { RecentCorrectionsPanel, useRecentCorrections, RecentCorrection } from '../components/RecentCorrectionsPanel';
import { EditValueModal } from '../components/EditValueModal';
import { CompactReasonBadge, QUICK_ANOMALY_REASONS } from '../components/CompactReasonBadge';
import { MarkRolloverModal } from '../components/MarkRolloverModal';


// ── Types ─────────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).
// ── Recently corrected (old ↔ new value) panel ────────────────────────────────
// Both "Edit value" (fn_cascade_reading_correction) and "Approve & Apply" on an
// operator correction request immediately flip the reading's norm_status away
// from whatever this tab is filtering on — 'pending_review' here, 'pending' for
// correction_requests — so the row disappears from the list the instant it's
// corrected. The only record of what changed used to be a toast that fades in
// a few seconds; the durable copy (reading_normalizations) only surfaces later,
// buried in the separate Edit History tab. This keeps the last few corrections
// visible, old value and new value side by side, right where the reviewer is
// already looking. Session-only by design — Edit History is the permanent record.
// ── Chain context component (item 4) ──────────────────────────────────────────
// ── Edit value dialog (item 6 – cascade correction) ───────────────────────────
// Same "guessed max, human confirms" heuristic as Step 1 of
// supabase/migrations/*_meter_rollover_backfill.sql: a mechanical register
// almost always wraps at a round power-of-ten boundary just above its
// previous value (e.g. a reading in the 900,000s on a 6-digit odometer
// wraps at 999999.99). It's a starting point for the admin to confirm or
// overtype against the physical meter's real register size, never applied
// automatically.
// "Mark as rollover" for a row stuck in Pending Review because it looked
// like a backward reading. Deliberately single-row only (no bulk variant,
// unlike Approve/Reject all) — telling a genuine meter wrap-around apart
// from a data-entry typo needs a human actually looking at the value
// against this meter's normal range, the same reasoning behind the backfill
// script's explicit per-row allow-list instead of an auto-apply pass.
// ── Pending Review tab (items 3, 4, 5) ───────────────────────────────────────

// BUGFIX: this previously capped each of the 3 source tables at .limit(200)
// while the header badge (usePendingCount, below) does an exact head-count
// with no limit at all. With >200 pending rows in any one table, the badge
// and the visible list permanently disagreed — approving everything visible
// would empty the list while the badge still showed a large leftover number,
// which reads exactly like "approved items are still stuck as pending."
// They weren't stuck; they were never fetched. Raised to PostgREST's own
// per-request row cap (1000) and the query now reports whether even THAT
// was hit, so a future plant with >1000 pending rows in one table gets a
// visible "showing partial results" banner instead of the same silent gap.
// ── Correction Inbox tab — active backward/erroneous readings ─────────────────

export function CorrectionInboxTab() {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const qc = useQueryClient();
  const [editRow, setEditRow] = useState<FlaggedRow | null>(null);
  const [plantFilter, setPlantFilter] = useState('all');
  const [tableFilter, setTableFilter] = useState<'all' | SourceTable>('all');
  const recent = useRecentCorrections();

  const { data: rows = [], isLoading, error, refetch } = useQuery({
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
        const { data: profiles } = await (supabase
          .from('user_profiles')
          .select('id, username, first_name, last_name')
          .in('id', userIds) as any);
        const usernameMap = Object.fromEntries(
          (profiles ?? []).map((p: any) => {
            const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
            const display = p.username ? `@${p.username}` : (full || '—');
            return [p.id, display];
          })
        );

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
            operator_username: usernameMap[r.recorded_by] ?? null,
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
        performed_by: user?.id ?? null, performed_role: actorRole,
      }) as any);
      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        'Superseded — reading retracted directly from Correction Inbox',
      );
      toast.success(`${row.entity_name}: retracted`);
      qc.invalidateQueries({ queryKey: ['correction-inbox'] });
    } else { toast.error(friendlyError(error)); }
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  const markReplacement = async (row: FlaggedRow) => {
    setBusy(p => ({ ...p, [row.id]: true }));
    const { error } = await (supabase.from(row.source_table as any).update({ is_meter_replacement: true, norm_status: 'normalized' }).eq('id', row.id) as any);
    if (!error) { toast.success(`${row.entity_name}: marked as meter replacement`); qc.invalidateQueries({ queryKey: ['correction-inbox'] }); }
    else toast.error(friendlyError(error));
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  if (isLoading) return <DataState loading />;
  if (error) return <DataState error={error} onRetry={refetch} />;

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

      <RecentCorrectionsPanel items={recent.items} onClear={recent.clear} />

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-accent" />
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
                    <Badge variant="outline" className="text-2xs px-1.5 py-0">{row.plant_name}</Badge>
                    <Badge variant="outline" className="text-2xs px-1.5 py-0">{tableLabel[row.source_table]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{fmtDt(row.reading_datetime)} · Submitted by <span className="font-medium text-foreground">{row.operator_username ?? '—'}</span></div>
                </div>
                <button onClick={() => setExpanded(isExp ? null : row.id)} aria-label={isExp ? 'Collapse details' : 'Expand details'} className="text-muted-foreground hover:text-foreground p-0.5">
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
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-warn border-warn/40" disabled={isBusy} onClick={() => markReplacement(row)}>
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
          onDone={(result) => {
            if (result) {
              recent.add({
                label: editRow.entity_name,
                plantName: editRow.plant_name,
                sourceTable: editRow.source_table,
                oldValue: result.oldValue,
                newValue: result.newValue,
              });
            }
            setEditRow(null);
            qc.invalidateQueries({ queryKey: ['correction-inbox'] });
          }} />
      )}
    </div>
  );
}