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
// ── Edit History tab ──────────────────────────────────────────────────────────
// ── Operator Stats tab (item 7) ───────────────────────────────────────────────

export function OperatorStatsTab() {
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
                  {['Operator (Username)', 'Entries', 'Backward', 'Pending', 'Retracted', 'Error rate', 'Last entry'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-2xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s: any, i) => (
                  <tr key={i} className={cn('border-t', rateBg(s.error_rate_pct))}>
                    <td className="px-3 py-2.5 font-medium max-w-[180px]">
                      <div className="truncate" title={s.username ? `@${s.username}` : s.operator_email}>
                        {s.username ? `@${s.username}` : (s.operator_email ?? '—')}
                      </div>
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