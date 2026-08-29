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
  AlertTriangle, CheckSquare, FileText,
} from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceTable = 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';

interface FlaggedRow {
  id: string;
  source_table: SourceTable;
  /** well_id / locator_id / meter_id — the FK on the reading row, not the
   *  reading's own id. Only populated by fetchPending() so far; used to look
   *  up wells.meter_rollover_max for the rollover-default fetch below. */
  entity_id?: string;
  entity_name: string;
  plant_name: string;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  operator_email: string | null;
  norm_status: string;
  flag_reason?: string;
  /** True when current_reading < previous_reading — the real "backward jump"
   *  signal, computed once in fetchPending() from the raw values rather than
   *  the already-clamped daily_volume. See fetchPending for why the latter
   *  can't be trusted for this. */
  is_backward?: boolean;
  /** The operator's own explanation for this reading, captured at save time
   *  by AnomalyRemarkBanner / submitAnomalyRemark() (reading_anomaly_remarks)
   *  whenever the reading's flow rate fell outside the normal band — the
   *  same "needs_remark" / "critical" classification that (independently)
   *  landed this row in Pending Review. Distinct from `notes` in
   *  PendingReviewTab, which is the reviewer's own note when approving/
   *  rejecting. Undefined while loading; null once loaded if no remark
   *  exists (e.g. this row was flagged for backward/spike reasons the DB
   *  trigger catches but the client-side flow-rate guard didn't, so no
   *  remark was ever required at entry). */
  anomaly_remark?: { text: string; tier: 'needs_remark' | 'critical'; logged_at: string } | null;
  /** BUGFIX: this reading may instead (or also) have a required "Reason for
   *  this edit" logged by CorrectionReasonField / logReadingEdit() when it
   *  was edited via one of the History dialogs (ReadingHistoryDialog.tsx) —
   *  a completely separate table (reading_edit_audit_log) from
   *  anomaly_remark above (reading_anomaly_remarks). Previously fetchPending()
   *  never queried this table at all, so a row with a genuine, mandatorily-
   *  collected edit reason would still render "No operator remark on file
   *  for this reading" — technically true of reading_anomaly_remarks, but
   *  misleading to a reviewer who has no way to know a second, populated
   *  audit trail exists for the same row. Undefined while loading; null
   *  once loaded if this row was never edited (or was edited without RLS
   *  read access to the log — see reading_edit_audit_log's Admin/Manager-
   *  only SELECT policy, 20260717_reading_edit_audit_log.sql). */
  edit_reason?: { text: string; actor_label: string | null; logged_at: string } | null;
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

// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).
const ROLE_DISPLAY_PRIORITY: Record<string, number> = { Admin: 1, 'Data Analyst': 2, Manager: 3 };
function pickDisplayRole(roles: string[]): string {
  if (!roles.length) return 'Unknown';
  return [...roles].sort((a, b) => (ROLE_DISPLAY_PRIORITY[a] ?? 99) - (ROLE_DISPLAY_PRIORITY[b] ?? 99))[0];
}

function DeltaBadge({ vol }: { vol: number | null }) {
  if (vol == null) return <span className="text-muted-foreground">—</span>;
  const isNeg = vol < 0;
  return (
    <span className={cn('font-mono text-xs font-medium',
      isNeg ? 'text-destructive' : vol > 0 ? 'text-accent' : 'text-muted-foreground')}>
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
      <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Meter chain context
      </div>
      {/* overflow-x-auto on this inner wrapper (not the outer one, which
          stays overflow-hidden purely for the rounded-corner clipping trick
          above) — without it, this 5-column table was silently *clipped*
          rather than scrollable on a narrow phone: overflow-hidden hides
          anything past the container edge with no way to reach it, so the
          rightmost Status column just vanished instead of becoming
          reachable. min-w forces the columns to keep their natural width
          and scroll as a unit instead of getting squeezed illegibly thin. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b">
              <th className="text-left px-3 py-1.5 text-2xs text-muted-foreground font-medium">Date / Time</th>
              <th className="text-right px-3 py-1.5 text-2xs text-muted-foreground font-medium">Previous</th>
              <th className="text-right px-3 py-1.5 text-2xs text-muted-foreground font-medium">Current</th>
              <th className="text-right px-3 py-1.5 text-2xs text-muted-foreground font-medium">Delta</th>
              <th className="px-3 py-1.5 text-2xs text-muted-foreground font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {chain.map(row => (
              <tr key={row.id}
                className={cn('border-b last:border-0 transition-colors',
                  row.isFocused
                    ? 'bg-warn-soft font-semibold'
                    : 'hover:bg-muted/20')}>
                <td className="px-3 py-2 font-mono whitespace-nowrap">
                  {row.isFocused && <span className="mr-1 text-warn">▶</span>}
                  {format(new Date(row.reading_datetime), 'dd MMM HH:mm')}
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtNum(row.previous_reading)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtNum(row.current_reading)}</td>
                <td className="px-3 py-2 text-right"><DeltaBadge vol={row.daily_volume} /></td>
                <td className="px-3 py-2">
                  <span className={cn('text-2xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap',
                    row.norm_status === 'retracted' ? 'bg-muted text-muted-foreground' :
                    row.norm_status === 'pending_review' ? 'bg-warn-soft text-warn' :
                    row.norm_status === 'normalized' ? 'bg-primary-soft text-primary' :
                    row.isFocused ? 'bg-warn-soft text-warn' : 'bg-muted/50 text-muted-foreground')}>
                    {row.norm_status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [customReason, setCustomReason] = useState('');
  const [busy, setBusy] = useState(false);

  const delta = Number(newVal) - (row.previous_reading ?? 0);

  const handleSave = async () => {
    const parsed = Number(newVal);
    if (isNaN(parsed) || !newVal) { toast.error('Enter a valid number'); return; }
    if (!isReasonComplete(reason, customReason)) { toast.error('A correction reason is required'); return; }
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc('fn_cascade_reading_correction', {
        p_table:       row.source_table,
        p_row_id:      row.id,
        p_new_current: parsed,
        p_admin_id:    user?.id ?? null,
        p_reason:      resolveReason(reason, customReason),
      }) as any);
      if (error) throw error;
      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        'Superseded — value corrected directly from Pending Review',
      );
      toast.success(`Corrected: ${fmtNum(row.current_reading)} → ${fmtNum(parsed)}${data?.cascade_id ? ' · next row updated' : ''}`);
      onDone();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => { if (!o && !busy) onClose(); }}
      title={`Edit reading — ${row.entity_name}`}
      description={(
        <>
          {row.plant_name} · {fmtDt(row.reading_datetime)}
          <br />
          Previous reading: <span className="font-mono">{fmtNum(row.previous_reading)}</span>
        </>
      )}
      className="max-w-sm"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !isReasonComplete(reason, customReason) || !newVal}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save &amp; cascade
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 pb-4">
        <div className="space-y-1">
          <label htmlFor="datacorrections-new-value" className="text-xs font-medium">Correct current reading</label>
          <Input
            id="datacorrections-new-value"
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

        <CorrectionReasonField
          reason={reason} onReasonChange={setReason}
          customReason={customReason} onCustomReasonChange={setCustomReason}
          label="Correction reason"
        />
      </div>
    </ResponsiveDialog>
  );
}

// Same "guessed max, human confirms" heuristic as Step 1 of
// supabase/migrations/*_meter_rollover_backfill.sql: a mechanical register
// almost always wraps at a round power-of-ten boundary just above its
// previous value (e.g. a reading in the 900,000s on a 6-digit odometer
// wraps at 999999.99). It's a starting point for the admin to confirm or
// overtype against the physical meter's real register size, never applied
// automatically.
function guessMeterMax(previousReading: number | null): number {
  if (previousReading == null || !Number.isFinite(previousReading)) return 99999.99;
  const digits = String(Math.floor(Math.abs(previousReading))).length;
  return Math.pow(10, digits) - 0.01;
}

// "Mark as rollover" for a row stuck in Pending Review because it looked
// like a backward reading. Deliberately single-row only (no bulk variant,
// unlike Approve/Reject all) — telling a genuine meter wrap-around apart
// from a data-entry typo needs a human actually looking at the value
// against this meter's normal range, the same reasoning behind the backfill
// script's explicit per-row allow-list instead of an auto-apply pass.
function MarkRolloverModal({
  row, onClose, onDone,
}: { row: FlaggedRow; onClose: () => void; onDone: () => void }) {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const [maxVal, setMaxVal] = useState(String(guessMeterMax(row.previous_reading)));
  const [maxTouched, setMaxTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Wells can carry a configured wrap point (wells.meter_rollover_max, see
  // 20260806143000_wells_meter_rollover_max_config.sql) — prefer it over the
  // guessed digit-count heuristic once it loads. Locators and product
  // meters have no equivalent config column yet, so they keep using the
  // guess. maxTouched guards against clobbering a value the admin already
  // started typing before this resolves.
  const { data: configuredMax } = useQuery({
    queryKey: ['well-rollover-max', row.entity_id],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('meter_rollover_max').eq('id', row.entity_id as string).maybeSingle();
      return (data as any)?.meter_rollover_max ?? null;
    },
    enabled: row.source_table === 'well_readings' && !!row.entity_id,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (configuredMax != null && !maxTouched) setMaxVal(String(configuredMax));
  }, [configuredMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedMax = Number(maxVal);
  const validMax = maxVal !== '' && !isNaN(parsedMax) && parsedMax > 0
    && (row.previous_reading == null || parsedMax >= row.previous_reading);

  // Same formula as calc.dailyVolume (frontend) and the DB's rollover-aware
  // daily_volume expression: (max - previous) + current, floored at zero.
  const computedVolume = validMax
    ? Math.max(0, Math.round((parsedMax - (row.previous_reading ?? 0)) + row.current_reading))
    : null;

  const handleSave = async () => {
    if (!validMax) {
      toast.error(row.previous_reading != null
        ? `Enter a wrap point ≥ the previous reading (${fmtNum(row.previous_reading)})`
        : 'Enter a valid wrap point');
      return;
    }
    setBusy(true);
    try {
      // locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres
      // recomputes it from is_meter_rollover/meter_rollover_max automatically
      // and must never appear in this UPDATE. well_readings and
      // product_meter_readings store it as a plain column that needs setting
      // directly — the same table-shape distinction the backfill SQL
      // script's Step 2 makes.
      const payload: Record<string, unknown> = {
        is_meter_rollover: true,
        meter_rollover_max: parsedMax,
        norm_status: 'normal',
      };
      if (row.source_table !== 'locator_readings') {
        payload.daily_volume = computedVolume;
      }
      const { error } = await (supabase.from(row.source_table as any).update(payload).eq('id', row.id) as any);
      if (error) throw error;

      await (supabase.from('reading_normalizations' as any).insert({
        source_table: row.source_table, source_id: row.id,
        action: 'normalize',
        original_value: row.current_reading,
        adjusted_value: computedVolume,
        note: `Marked as meter rollover (wrap point ${fmtNum(parsedMax)}) from Pending Review — true delta ${fmtNum(computedVolume)} m³`,
        performed_by: user?.id ?? null, performed_role: actorRole,
      }) as any);
      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        'Superseded — reading marked as meter rollover directly from Pending Review',
      );
      toast.success(`${row.entity_name}: marked as rollover · +${fmtNum(computedVolume)} m³`);
      onDone();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => { if (!o && !busy) onClose(); }}
      title={(
        <span className="flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-primary shrink-0" />
          Mark as meter rollover — {row.entity_name}
        </span>
      )}
      description={(
        <>
          {row.plant_name} · {fmtDt(row.reading_datetime)}
          <br />
          Previous: <span className="font-mono">{fmtNum(row.previous_reading)}</span>
          {' → '}Current: <span className="font-mono">{fmtNum(row.current_reading)}</span>
        </>
      )}
      className="max-w-sm"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !validMax}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Confirm rollover
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 pb-4">
        <p className="text-xs text-muted-foreground">
          Only confirm this if the meter's register actually wrapped around —
          the current reading should look like an early value for this meter
          (small, near its usual minimum), not a plausible mid-range value
          with a digit dropped or transposed.
        </p>

        <div className="space-y-1">
          <label htmlFor="datacorrections-wrap-point" className="text-xs font-medium">Meter wrap point (register max)</label>
          <Input
            id="datacorrections-wrap-point"
            type="number"
            value={maxVal}
            onChange={e => { setMaxVal(e.target.value); setMaxTouched(true); }}
            className="font-mono h-9 text-sm"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {configuredMax != null && !maxTouched
              ? "From this well's configured wrap point (Edit Well) — overtype if it's wrong."
              : "Guessed from the previous reading's digit count — overtype with the physical meter's actual register size if you know it."}
          </p>
          {validMax && (
            <p className="text-xs text-muted-foreground">
              True delta if confirmed: <DeltaBadge vol={computedVolume} />
            </p>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  );
}

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
const PENDING_FETCH_LIMIT_PER_TABLE = 1000;

async function fetchPending(): Promise<{ rows: FlaggedRow[]; truncated: boolean }> {
  const tables: SourceTable[] = ['locator_readings', 'well_readings', 'product_meter_readings'];
  const results: FlaggedRow[] = [];
  let truncated = false;

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
      .limit(PENDING_FETCH_LIMIT_PER_TABLE) as any);

    if (!rows?.length) continue;
    if (rows.length === PENDING_FETCH_LIMIT_PER_TABLE) truncated = true;

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

    // Resolve the operator's own anomaly remark for each row (AnomalyRemarkBanner
    // at entry time, reading_anomaly_remarks) — so the reviewer sees WHY the
    // operator says a flagged reading is correct, not just an empty note box.
    // Ordered oldest→newest so the reduce below keeps the latest remark per
    // record_id in the rare case a row picked up more than one (e.g. re-saved
    // after the underlying reading was edited and flagged again).
    const rowIds = rows.map((r: any) => r.id);
    const { data: remarkRows } = await (supabase
      .from('reading_anomaly_remarks' as any)
      .select('record_id, remark_text, tier, logged_at')
      .eq('table_name', table)
      .in('record_id', rowIds)
      .order('logged_at', { ascending: true }) as any);
    const remarkMap = (remarkRows ?? []).reduce((acc: Record<string, any>, rem: any) => {
      acc[rem.record_id] = { text: rem.remark_text, tier: rem.tier, logged_at: rem.logged_at };
      return acc;
    }, {} as Record<string, any>);

    // BUGFIX: a reading can also (or instead) carry a required "Reason for
    // this edit" — a totally different field from the anomaly remark above,
    // logged by CorrectionReasonField/logReadingEdit() to
    // reading_edit_audit_log whenever someone edits an already-saved
    // reading via the History dialogs. This was never queried here, so a
    // row with a genuine, mandatorily-collected edit reason still rendered
    // "No operator remark on file for this reading" — misleading, since a
    // populated audit trail did exist for it, just in a table this page
    // never looked at. Only 'update' actions carry a reason (see
    // 20260809_reading_edit_audit_log_reason.sql); ordered oldest→newest so
    // the reduce keeps the most recent edit's reason per record.
    const { data: editReasonRows } = await (supabase
      .from('reading_edit_audit_log' as any)
      .select('record_id, reason, actor_label, edited_at')
      .eq('table_name', table)
      .eq('action', 'update')
      .in('record_id', rowIds)
      .not('reason', 'is', null)
      .order('edited_at', { ascending: true }) as any);
    const editReasonMap = (editReasonRows ?? []).reduce((acc: Record<string, any>, e: any) => {
      acc[e.record_id] = { text: e.reason, actor_label: e.actor_label, logged_at: e.edited_at };
      return acc;
    }, {} as Record<string, any>);

    for (const r of rows) {
      const vol = r.daily_volume ?? (r.previous_reading != null ? r.current_reading - r.previous_reading : null);
      // BUGFIX: this used to classify backward vs. spike by checking
      // `vol < 0`, but daily_volume is clamped to 0 at save time (and, for
      // locator_readings, by its own GENERATED expression) — so a genuine
      // backward jump waiting in Pending Review almost never actually shows
      // a negative stored volume, and was silently misfiled as 'spike'.
      // Compare the two raw meter values directly instead, matching how
      // the DB trigger / SQL backfill audit both define "backward".
      const isBackward = r.previous_reading != null && Number(r.current_reading) < Number(r.previous_reading);
      results.push({
        id: r.id,
        source_table: table,
        entity_id: r[entityCol],
        entity_name: entityMap[r[entityCol]] ?? '—',
        plant_name: plantMap[r.plant_id] ?? '—',
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading,
        daily_volume: vol,
        operator_email: emailMap[r.recorded_by] ?? null,
        norm_status: r.norm_status,
        flag_reason: isBackward ? 'backward' : 'spike',
        is_backward: isBackward,
        anomaly_remark: remarkMap[r.id] ?? null,
        edit_reason: editReasonMap[r.id] ?? null,
      });
    }
  }

  return {
    rows: results.sort((a, b) => new Date(b.reading_datetime).getTime() - new Date(a.reading_datetime).getTime()),
    truncated,
  };
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

/**
 * BUGFIX: a reading could end up with BOTH its own norm_status =
 * 'pending_review' (shown in the main Pending list below) AND a separate
 * correction_requests row (shown under "Operator correction requests")
 * for the exact same underlying reading — e.g. an operator files a
 * correction request for a reading that was independently auto-flagged,
 * or two operators file overlapping requests for the same reading. These
 * were never linked: resolving one left the other sitting there
 * indefinitely, which looks exactly like "approved corrections still
 * stays." Whichever path resolves a reading first now also closes out any
 * OTHER still-pending correction_requests for that same
 * source_table + source_id, so there's only ever one live approval prompt
 * per reading.
 *
 * Reuses the 'rejected' status rather than introducing an unverified new
 * 'superseded' value: correction_requests isn't defined in any migration in
 * this repo (it was set up directly in the Supabase dashboard per the
 * 20260723 migration's note), so its exact status CHECK constraint can't be
 * confirmed from here — 'rejected' is already a value this table accepts
 * (see rejectRequest below). The resolution_note distinguishes the two
 * cases for anyone reading the Inbox/History later.
 */
async function supersedeOtherCorrectionRequests(
  sourceTable: SourceTable,
  sourceId: string,
  resolvedBy: string | undefined,
  note: string,
  excludeRequestId?: string,
) {
  let q = supabase.from('correction_requests' as any)
    .update({
      status: 'rejected',
      resolved_by: resolvedBy ?? null,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    })
    .eq('source_table', sourceTable)
    .eq('source_id', sourceId)
    .eq('status', 'pending');
  if (excludeRequestId) q = q.neq('id', excludeRequestId);
  // Best-effort dedup step — a failure here shouldn't block the primary
  // approve/reject action that's already succeeded, but it also shouldn't
  // vanish silently, since it's the same class of "looks fine, quietly
  // didn't happen" bug as the one on the primary update below.
  const { error } = await (q as any);
  if (error) console.error('supersedeOtherCorrectionRequests failed:', error);
}

function PendingReviewTab() {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['data-corrections-pending'],
    queryFn: fetchPending,
    refetchInterval: 60_000,
  });
  const rows = data?.rows ?? [];
  const truncated = data?.truncated ?? false;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<FlaggedRow | null>(null);
  const [rolloverRow, setRolloverRow] = useState<FlaggedRow | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [plantFilter, setPlantFilter] = useState('all');
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** Required rejection reason for operator correction requests (item 8) —
   *  keyed by correction_requests.id. Unlike `notes` above (optional, for
   *  admin's own direct edits/approvals), this one gates the Reject button:
   *  an operator who submitted a reasoned request is owed an explanation
   *  when it's turned down, not just a silent "kept the original value." */
  const [reqNotes, setReqNotes] = useState<Record<string, string>>({});

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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['data-corrections-pending'] });
    qc.invalidateQueries({ queryKey: ['correction-inbox'] });
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
    if (error) { toast.error(friendlyError(error)); return; }
    // 2. Mark request as approved (triggers operator notification).
    // .select('id') matters here: an UPDATE that RLS silently narrows to
    // zero matching rows returns { data: [], error: null } — identical to
    // a real success unless you check what actually came back. Without
    // this check, the row keeps re-appearing as "pending" on every refetch
    // with no visible reason why (see 20260723 migration's note that this
    // table's RLS was set up outside the migration history and was never
    // actually confirmed from code).
    const { data: resolvedRows, error: resolveErr } = await (supabase
      .from('correction_requests' as any)
      .update({ status: 'approved', resolved_by: user?.id, resolved_at: new Date().toISOString() })
      .eq('id', req.id)
      .select('id') as any);
    if (resolveErr) { toast.error(friendlyError(resolveErr)); return; }
    if (!resolvedRows?.length) {
      toast.error('Reading corrected, but the request could not be marked approved — you may not have permission to update it. It will keep showing here until that\u2019s fixed.');
      invalidate();
      return;
    }
    // 3. Close out any OTHER pending request for this same reading (e.g. a
    // second operator flagged it too) so it doesn't linger as a duplicate
    // approval prompt for a reading that's already been corrected.
    await supersedeOtherCorrectionRequests(
      req.source_table, req.source_id, user?.id,
      'Superseded — a duplicate correction request for this reading was already approved',
      req.id,
    );
    toast.success('Correction approved and applied');
    invalidate();
  };

  const rejectRequest = async (req: CorrectionRequest, resolutionNote: string) => {
    if (!resolutionNote.trim()) { toast.error('A reason is required to reject a correction request'); return; }
    // Revert to normal without changing value
    const { error: revertErr } = await (supabase
      .from(req.source_table as any).update({ norm_status: 'normal' }).eq('id', req.source_id) as any);
    if (revertErr) { toast.error(friendlyError(revertErr)); return; }
    // .select('id') for the same reason as approveRequest above: a silently
    // RLS-blocked update returns { data: [], error: null }, not an error —
    // without checking what actually came back, the request would keep
    // reappearing as pending with no indication anything went wrong.
    const { data: resolvedRows, error: resolveErr } = await (supabase
      .from('correction_requests' as any)
      .update({ status: 'rejected', resolved_by: user?.id, resolved_at: new Date().toISOString(), resolution_note: resolutionNote || null })
      .eq('id', req.id)
      .select('id') as any);
    if (resolveErr) { toast.error(friendlyError(resolveErr)); return; }
    if (!resolvedRows?.length) {
      toast.error('Could not mark this request as rejected — you may not have permission to update it.');
      invalidate();
      return;
    }
    // The reading was just confirmed as fine (norm_status back to 'normal'),
    // so any OTHER still-pending request against the same reading is moot too.
    await supersedeOtherCorrectionRequests(
      req.source_table, req.source_id, user?.id,
      'Superseded — the underlying reading was already resolved (a related request was rejected)',
      req.id,
    );
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
    // NOTE: .select('id') is required here, not cosmetic. Without it, a
    // silent RLS/lock mismatch returns { data: [], error: null } — same
    // failure mode approveRequest/rejectRequest already guard against above.
    // Skipping it means "approved" toasts fire even when nothing changed,
    // and the row reappears on next refetch with no visible explanation.
    const { data: updated, error } = await (supabase
      .from(row.source_table as any)
      .update({ norm_status: decision })
      .eq('id', row.id)
      .select('id') as any);

    if (error) {
      toast.error(friendlyError(error));
    } else if (!updated?.length) {
      toast.error(`${row.entity_name}: update didn't apply — check permissions or whether this reading is locked, then refresh.`);
      invalidate();
    } else {
      await (supabase.from('reading_normalizations' as any).insert({
        source_table: row.source_table, source_id: row.id,
        action: decision === 'normal' ? 'normalize' : 'retract',
        original_value: row.current_reading,
        adjusted_value: decision === 'normal' ? row.current_reading : null,
        note: notes[row.id] || (decision === 'normal' ? 'Approved from corrections queue' : 'Rejected from corrections queue'),
        performed_by: user?.id ?? null, performed_role: actorRole,
      }) as any);
      // This reading is no longer pending — close out any duplicate
      // correction_requests row for it too (see supersedeOtherCorrectionRequests).
      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        decision === 'normal'
          ? 'Superseded — reading approved directly from Pending Review'
          : 'Superseded — reading rejected directly from Pending Review',
      );
      toast.success(decision === 'normal' ? `${row.entity_name}: approved` : `${row.entity_name}: rejected`);
      invalidate();
    }
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  const bulkResolve = async (decision: 'normal' | 'retracted') => {
    if (!selected.size) return;
    setBulkBusy(true);
    const targets = rows.filter(r => selected.has(r.id));
    const succeeded: FlaggedRow[] = [];
    const failed: FlaggedRow[] = [];
    for (const row of targets) {
      // Same .select('id') requirement as resolveOne — an unaffected row
      // must not be counted as succeeded just because there was no error.
      const { data: updated, error } = await (supabase
        .from(row.source_table as any)
        .update({ norm_status: decision })
        .eq('id', row.id)
        .select('id') as any);
      if (!error && updated?.length) succeeded.push(row);
      else failed.push(row);
    }
    if (succeeded.length) {
      await (supabase.from('reading_normalizations' as any).insert(
        succeeded.map(row => ({
          source_table: row.source_table, source_id: row.id,
          action: decision === 'normal' ? 'normalize' : 'retract',
          original_value: row.current_reading,
          note: `Bulk ${decision === 'normal' ? 'approval' : 'rejection'} (${targets.length} rows)`,
          performed_by: user?.id ?? null, performed_role: actorRole,
        }))
      ) as any);
      // Close out any duplicate correction_requests for each row actually
      // resolved — batched per source_table rather than one call per row.
      const bySourceTable = new Map<SourceTable, string[]>();
      for (const row of succeeded) {
        const ids = bySourceTable.get(row.source_table) ?? [];
        ids.push(row.id);
        bySourceTable.set(row.source_table, ids);
      }
      const note = decision === 'normal'
        ? 'Superseded — reading approved via bulk action from Pending Review'
        : 'Superseded — reading rejected via bulk action from Pending Review';
      const results = await Promise.all([...bySourceTable.entries()].map(([sourceTable, ids]) =>
        supabase.from('correction_requests' as any)
          .update({ status: 'rejected', resolved_by: user?.id ?? null, resolved_at: new Date().toISOString(), resolution_note: note })
          .eq('source_table', sourceTable)
          .eq('status', 'pending')
          .in('source_id', ids) as any,
      ));
      // Same class of "looks fine, quietly didn't happen" risk as
      // supersedeOtherCorrectionRequests above — this is a best-effort
      // cleanup step (the primary bulk approve/reject already succeeded
      // via reading_normalizations), so it shouldn't block the user, but a
      // failure here shouldn't vanish either.
      for (const r of results) {
        if ((r as any)?.error) console.error('bulkResolve correction_requests supersede failed:', (r as any).error);
      }
    }
    const ok = succeeded.length;
    if (ok) {
      toast.success(`${ok} of ${targets.length} readings ${decision === 'normal' ? 'approved' : 'rejected'}`);
    }
    if (failed.length) {
      toast.error(
        `${failed.length} row(s) didn't update — permission or lock issue: ${failed.map(f => f.entity_name).join(', ')}`,
      );
    }
    setSelected(new Set());
    setBulkBusy(false);
    invalidate();
  };

  if (isLoading) return <DataState loading />;
  if (error) return <DataState error={error} onRetry={refetch} />;

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
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-accent/40 text-accent hover:bg-accent-soft"
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

      {/* Item 8: Operator correction requests with quick-reason presets and visual diff */}
      {corrReqs.length > 0 && (
        <div className="space-y-2.5 pb-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">
                Operator Correction Requests
              </p>
              <Badge className="h-5 px-2 text-3xs font-bold bg-amber-500 text-white animate-pulse">
                {corrReqs.length} Awaiting Approval
              </Badge>
            </div>
            <span className="text-3xs text-muted-foreground">Action required by Manager or Admin</span>
          </div>

          <div className="grid gap-3">
            {corrReqs.map(req => {
              const diff = req.proposed_value - req.original_value;
              const isPositive = diff > 0;
              const hasDiff = diff !== 0;

              return (
                <Card key={req.id} className="p-4 border-amber-500/40 bg-amber-500/5 shadow-2xs space-y-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground">{tableLabel[req.source_table]}</span>
                        <Badge variant="outline" className="text-3xs px-2 py-0 font-bold border-amber-500/40 bg-background">
                          {req.plant_name}
                        </Badge>
                        <span className="text-3xs px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          Operator Requested
                        </span>
                      </div>
                      <div className="text-3xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <span>Submitted by <strong className="text-foreground">{req.submitter_email}</strong></span>
                        <span>·</span>
                        <span>{fmtDt(req.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Side-by-side Visual Diff */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-2.5 rounded-lg bg-background/80 border border-border/60 text-xs">
                    <div>
                      <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Original Recorded</div>
                      <div className="font-mono font-bold text-sm text-destructive mt-0.5">{fmtNum(req.original_value)}</div>
                    </div>
                    <div>
                      <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                        <ArrowRight className="h-3 w-3 text-primary" /> Proposed New Value
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono font-bold text-sm text-accent">{fmtNum(req.proposed_value)}</span>
                        {hasDiff && (
                          <span className={cn('text-3xs font-mono font-bold px-1.5 py-0.2 rounded',
                            isPositive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400')}>
                            {isPositive ? `+${fmtNum(diff)}` : fmtNum(diff)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Operator Reason</div>
                      <div className="text-xs font-semibold text-foreground mt-0.5 leading-snug">{req.reason}</div>
                    </div>
                  </div>

                  {req.note && (
                    <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border/40 italic">
                      "{req.note}"
                    </div>
                  )}

                  {/* Action & Preset Rejection Reason Row */}
                  <div className="space-y-2 pt-1 border-t border-border/40">
                    <div className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Rejection explanation (required to reject)…"
                        value={reqNotes[req.id] ?? ''}
                        onChange={e => setReqNotes(p => ({ ...p, [req.id]: e.target.value }))}
                        className="h-8 text-xs flex-1 min-w-[200px] bg-background"
                      />
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-xs font-bold bg-accent text-accent-foreground hover:bg-accent/90"
                        onClick={() => approveRequest(req)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve &amp; Apply</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs font-bold border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={!reqNotes[req.id]?.trim()}
                        onClick={() => rejectRequest(req, reqNotes[req.id] ?? '')}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Reject</span>
                      </Button>
                    </div>

                    {/* Quick preset reason chips */}
                    <div className="flex items-center gap-1.5 flex-wrap text-3xs">
                      <span className="text-muted-foreground font-semibold">Quick rejection presets:</span>
                      {[
                        'Verified accurate against field logbook',
                        'Exceeds plausibility threshold',
                        'Duplicate correction request',
                        'Requires meter replacement flow',
                      ].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
                          onClick={() => setReqNotes(p => ({ ...p, [req.id]: preset }))}
                        >
                          + {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {truncated && (
        <div className="flex items-center gap-2 px-3 py-2 bg-warn-soft border border-warn/30 rounded-lg text-xs text-warn">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          One or more tables have more than {PENDING_FETCH_LIMIT_PER_TABLE.toLocaleString()} pending readings —
          showing the most recent {PENDING_FETCH_LIMIT_PER_TABLE.toLocaleString()} per table. Use the plant filter
          to narrow this down, or work through the newest ones first.
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-accent" />
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
            const isBack = !!row.is_backward;
            const isBusy = busy[row.id] ?? false;
            const isExp = expanded === row.id;
            // Rough entity + plant IDs for chain context — we pass plant_id from the row
            // The row doesn't carry entityId directly; we use id as proxy for chain lookup
            return (
              <Card key={row.id} className={cn('p-4', isBack ? 'border-destructive/30' : 'border-warn/40')}>
                <div className="flex items-start gap-2.5">
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleOne(row.id)} className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate">{row.entity_name}</span>
                          <Badge variant="outline" className="text-2xs px-1.5 py-0">{row.plant_name}</Badge>
                          <Badge variant="outline" className="text-2xs px-1.5 py-0">{tableLabel[row.source_table]}</Badge>
                          <span className={cn('text-2xs px-1.5 py-0.5 rounded font-medium',
                            isBack ? 'bg-destructive/10 text-destructive' : 'bg-warn-soft text-warn')}>
                            {isBack ? '↓ backward' : '↑ spike'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {fmtDt(row.reading_datetime)} · {row.operator_email ?? '—'}
                        </div>
                      </div>
                      <button onClick={() => setExpanded(isExp ? null : row.id)}
                        aria-label={isExp ? 'Collapse details' : 'Expand details'}
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

                    {/* Operator's own remark (reading_anomaly_remarks, captured
                        at entry time by AnomalyRemarkBanner when this reading's
                        flow rate fell outside the normal band) OR — a separate
                        source, checked as a fallback — the required "reason for
                        this edit" (reading_edit_audit_log) logged if this row
                        was corrected via a History dialog. Distinct from the
                        reviewer's own note in the Actions row below. A row can
                        have neither (flagged fresh by the DB trigger, never
                        edited) — that's the only case that should show the
                        "nothing on file" message. */}
                    {row.anomaly_remark ? (
                      <div className={cn('flex items-start gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border',
                        row.anomaly_remark.tier === 'critical'
                          ? 'bg-destructive/10 border-destructive/30 text-destructive'
                          : 'bg-warn-soft border-warn/40 text-warn')}>
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          <span className="font-medium">Operator remark: </span>
                          <span className="font-normal text-foreground/90">"{row.anomaly_remark.text}"</span>
                        </span>
                      </div>
                    ) : row.edit_reason ? (
                      <div className="flex items-start gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-info-soft border-info/40 text-info">
                        <Pencil className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          <span className="font-medium">Edit reason: </span>
                          <span className="font-normal text-foreground/90">"{row.edit_reason.text}"</span>
                          {row.edit_reason.actor_label && (
                            <span className="text-2xs text-muted-foreground"> — {row.edit_reason.actor_label}</span>
                          )}
                        </span>
                      </div>
                    ) : (
                      <p className="text-2xs text-muted-foreground italic">No operator remark or edit reason on file for this reading.</p>
                    )}

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
                        className="h-7 gap-1 text-xs border-primary/40 text-primary hover:bg-primary-soft"
                        disabled={isBusy} onClick={() => resolveOne(row, 'normal')}>
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Approve
                      </Button>
                      {isBack && (
                        <Button size="sm" variant="outline"
                          className="h-7 gap-1 text-xs border-accent/40 text-accent hover:bg-accent-soft"
                          disabled={isBusy} onClick={() => setRolloverRow(row)}>
                          <Gauge className="h-3 w-3" />
                          Mark as rollover
                        </Button>
                      )}
                      <Button size="sm" variant="outline"
                        className="h-7 gap-1 text-xs border-warn/40 text-warn hover:bg-warn-soft"
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
                          className="h-7 gap-1 text-xs border-primary/40 text-primary hover:bg-primary-soft"
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
      {rolloverRow && (
        <MarkRolloverModal
          row={rolloverRow}
          onClose={() => setRolloverRow(null)}
          onDone={() => { setRolloverRow(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// ── Correction Inbox tab — active backward/erroneous readings ─────────────────

function CorrectionInboxTab() {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const qc = useQueryClient();
  const [editRow, setEditRow] = useState<FlaggedRow | null>(null);
  const [plantFilter, setPlantFilter] = useState('all');
  const [tableFilter, setTableFilter] = useState<'all' | SourceTable>('all');

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
                  <div className="text-xs text-muted-foreground mt-0.5">{fmtDt(row.reading_datetime)} · {row.operator_email ?? '—'}</div>
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
          onDone={() => { setEditRow(null); qc.invalidateQueries({ queryKey: ['correction-inbox'] }); }} />
      )}
    </div>
  );
}

// ── Edit History tab ──────────────────────────────────────────────────────────

function EditHistoryTab() {
  const { data: rows = [], isLoading, error, refetch } = useQuery({
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
      normalize: 'bg-primary-soft text-primary',
      retract:   'bg-muted text-muted-foreground',
      tag:       'bg-warn-soft text-warn',
    };
    return <span className={cn('text-2xs px-1.5 py-0.5 rounded font-medium', cfg[action] ?? 'bg-muted text-muted-foreground')}>{action}</span>;
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Last 200 normalization actions across all tables.</p>
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No normalization history yet."
        onRetry={refetch}
      >
        <div className="border rounded-lg overflow-hidden text-xs">
          {/* See ChainContext for why this is a separate inner wrapper from
              the outer overflow-hidden, not the same element. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-muted/40">
                <tr>
                  {['Date', 'Table', 'Action', 'Original', 'Adjusted', 'Note', 'By'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-2xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{format(new Date(r.performed_at), 'dd MMM yy HH:mm')}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{tableLabel[r.source_table as SourceTable] ?? r.source_table}</td>
                    <td className="px-3 py-2">{actionBadge(r.action)}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmtNum(r.original_value)}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmtNum(r.adjusted_value)}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate" title={r.note}>{r.note ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.performed_role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DataState>
    </div>
  );
}

// ── Operator Stats tab (item 7) ───────────────────────────────────────────────

function OperatorStatsTab() {
  const { data: stats = [], isLoading, error, refetch } = useQuery({
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
    pct >= 10 ? 'text-warn font-medium' :
    pct >= 5  ? 'text-warn' : 'text-accent';

  const rateBg = (pct: number) =>
    pct >= 20 ? 'bg-destructive/10' :
    pct >= 10 ? 'bg-warn-soft' : '';

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Rolling 30-day error rate across locator and well readings. Operators at ≥10% are highlighted.</p>
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={stats.length === 0}
        emptyTitle="No operator data available yet."
        onRetry={refetch}
      >
        <div className="border rounded-lg overflow-hidden text-xs">
          {/* See ChainContext for why this is a separate inner wrapper from
              the outer overflow-hidden, not the same element. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-muted/40">
                <tr>
                  {['Operator', 'Entries', 'Backward', 'Pending', 'Retracted', 'Error rate', 'Last entry'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-2xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => (
                  <tr key={i} className={cn('border-t', rateBg(s.error_rate_pct))}>
                    <td className="px-3 py-2.5 font-medium max-w-[180px]">
                      <div className="truncate" title={s.operator_email}>{s.operator_email ?? '—'}</div>
                      {s.error_rate_pct >= 10 && (
                        <div className="text-2xs text-warn mt-0.5">Needs review</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{s.total_entries.toLocaleString()}</td>
                    <td className="px-3 py-2.5">{s.backward_readings > 0 ? <span className="text-destructive font-medium">{s.backward_readings}</span> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="px-3 py-2.5">{s.pending_review > 0 ? <span className="text-warn font-medium">{s.pending_review}</span> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="px-3 py-2.5">{s.retracted > 0 ? <span className="text-muted-foreground">{s.retracted}</span> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={cn('font-mono', rateColor(s.error_rate_pct))}>
                        {s.error_rate_pct?.toFixed(1) ?? '0.0'}%
                      </span>
                      <div className="w-full bg-muted rounded-full h-1 mt-1">
                        <div className={cn('h-1 rounded-full', s.error_rate_pct >= 20 ? 'bg-destructive' : s.error_rate_pct >= 10 ? 'bg-warn' : 'bg-accent')}
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
        </div>
      </DataState>
    </div>
  );
}

// ── Summary hooks ─────────────────────────────────────────────────────────────

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

function useCorrectionRequestsCount() {
  return useQuery({
    queryKey: ['correction-requests-pending-count'],
    queryFn: async () => {
      const { count } = await (supabase
        .from('correction_requests' as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending') as any);
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}

function useInboxCount() {
  return useQuery({
    queryKey: ['correction-inbox-count'],
    queryFn: async () => {
      const tables = ['locator_readings', 'well_readings', 'product_meter_readings'];
      const counts = await Promise.all(tables.map(t =>
        (supabase.from(t as any)
          .select('id', { count: 'exact', head: true })
          .eq('norm_status', 'normal')
          .lt('daily_volume', 0)
          .eq('is_meter_replacement', false) as any)
      ));
      return counts.reduce((sum, r) => sum + (r.count ?? 0), 0);
    },
    staleTime: 60_000,
  });
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function DataCorrections() {
  const { isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: pendingCount = 0 } = usePendingCount();
  const { data: corrReqsCount = 0 } = useCorrectionRequestsCount();
  const { data: inboxCount = 0 } = useInboxCount();

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
      <PageHeader
        title="Data Corrections & Review Hub"
        subtitle="Review flagged readings, approve operator requested corrections, retract errors, and track data quality in one place."
      />

      {/* ── Summary Tiles ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={ClipboardCheck}
          label="Pending Flagged Readings"
          value={pendingCount.toLocaleString()}
          tone={pendingCount > 0 ? 'warn' : undefined}
        />
        <StatCard
          icon={CheckSquare}
          label="Operator Requests Awaiting Approval"
          value={corrReqsCount.toLocaleString()}
          tone={corrReqsCount > 0 ? 'danger' : undefined}
        />
        <StatCard
          icon={Inbox}
          label="Active Backward Anomalies"
          value={inboxCount.toLocaleString()}
          tone={inboxCount > 0 ? 'warn' : undefined}
        />
        <StatCard
          icon={CheckCircle2}
          label="Review Pipeline Status"
          value={pendingCount === 0 && corrReqsCount === 0 ? 'All Clear' : 'Action Required'}
          tone={pendingCount === 0 && corrReqsCount === 0 ? 'accent' : 'warn'}
        />
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 gap-1 h-auto sm:h-10 w-full">
          <TabsTrigger value="pending" className="gap-1.5 text-xs">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Pending Reviews
            {(pendingCount > 0 || corrReqsCount > 0) && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-2xs bg-destructive text-destructive-foreground">
                {pendingCount + corrReqsCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="inbox" className="gap-1.5 text-xs">
            <Inbox className="h-3.5 w-3.5" />
            Inbox
            {inboxCount > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-2xs bg-warn text-warn-foreground">
                {inboxCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 text-xs">
            <History className="h-3.5 w-3.5" />
            History &amp; Audits
          </TabsTrigger>
          <TabsTrigger value="operators" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            Operator Accuracy
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
