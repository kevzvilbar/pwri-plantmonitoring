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
import { DeltaBadge } from './DeltaBadge';
import { FlagBadge } from './FlagBadge';
import { ChainContext } from './ChainContext';
import { CompactReasonBadge, QUICK_ANOMALY_REASONS } from './CompactReasonBadge';


// ── Types ─────────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).

export function formatElapsedDuration(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins}m`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  const days = (hours / 24).toFixed(1);
  return `${days}d (${hours.toFixed(1)}h)`;
}


// ── Types ─────────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).

export function PrecedingReadingTooltip({
  prevReading,
  prevDatetime,
  prevUser,
  elapsedHours,
  label = 'Preceding Reading',
}: {
  prevReading: number | null;
  prevDatetime?: string | null;
  prevUser?: string | null;
  elapsedHours?: number | null;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground text-2xs font-semibold">{label}</span>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Preceding reading details"
              className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded p-0.5 hover:bg-muted/50 transition-colors focus:outline-none"
            >
              <Clock className="h-3 w-3 text-primary/80 hover:text-primary shrink-0" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs p-2.5 text-xs shadow-md space-y-1.5 z-50">
            <div className="font-semibold text-foreground flex items-center gap-1.5 text-2xs uppercase tracking-wider text-muted-foreground pb-1 border-b border-border/50">
              <Clock className="h-3 w-3 text-primary" /> Preceding Reading Details
            </div>
            <div className="space-y-1 text-2xs">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Date & Time:</span>
                <span className="font-mono font-medium text-foreground">
                  {prevDatetime ? fmtDt(prevDatetime) : 'Baseline / No prior timestamp'}
                </span>
              </div>
              {elapsedHours != null && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Elapsed Duration:</span>
                  <span className="font-medium text-accent">
                    {formatElapsedDuration(elapsedHours)} elapsed
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Preceding Value:</span>
                <span className="font-mono font-bold text-foreground">
                  {fmtNum(prevReading)} m³
                </span>
              </div>
              {prevUser && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Recorded By:</span>
                  <span className="text-foreground">{prevUser}</span>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}


// ── Types ─────────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).

export function AnomalyDiagnosticsBadge({ row }: { row: FlaggedRow }) {
  const isSpike = row.flag_reason === 'spike' || row.deviation_direction === 'high';
  const isBackward = row.is_backward;
  const isUnchanged = row.is_unchanged;
  const isEdited = row.flag_reason === 'edited';

  let badgeText = 'Anomaly Flagged';
  let badgeVariant = 'border-warn/30 bg-warn-soft text-warn';
  let Icon = Activity;

  if (isBackward) {
    badgeText = 'Meter Backward';
    badgeVariant = 'border-destructive/30 bg-destructive/10 text-destructive';
    Icon = AlertTriangle;
  } else if (isUnchanged) {
    badgeText = 'Zero Flow';
    badgeVariant = 'border-border bg-muted text-muted-foreground';
    Icon = Activity;
  } else if (isEdited) {
    badgeText = 'Manual Edit';
    badgeVariant = 'border-info/30 bg-info-soft text-info';
    Icon = Pencil;
  } else if (isSpike) {
    badgeText = row.deviation_pct != null
      ? `Spike (+${row.deviation_pct}%)`
      : 'High Flow Spike';
    badgeVariant = 'border-warn/40 bg-warn-soft text-warn';
    Icon = Activity;
  } else if (row.deviation_direction === 'low') {
    badgeText = row.deviation_pct != null
      ? `Low Flow (-${row.deviation_pct}%)`
      : 'Low Flow Rate';
    badgeVariant = 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    Icon = Activity;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn('inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded font-medium border cursor-pointer hover:opacity-85 transition-opacity', badgeVariant)}
            aria-label="View anomaly cause"
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span>{badgeText}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-xs p-2.5 text-xs shadow-lg space-y-2 z-50">
          <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground pb-1 border-b border-border/50">
            <ShieldAlert className="h-3.5 w-3.5 text-warn shrink-0" /> Why this was flagged as an anomaly
          </div>
          <p className="text-2xs text-foreground/90 leading-relaxed">
            {row.diagnostic_summary || 'Quarantined for supervisor verification.'}
          </p>
          {(row.calculated_flow_rate != null || row.avg_flow_rate != null) && (
            <div className="bg-muted/40 p-2 rounded text-2xs space-y-1 font-mono border border-border/40">
              {row.calculated_flow_rate != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Calculated Rate:</span>
                  <span className="font-bold text-foreground">{row.calculated_flow_rate.toFixed(2)} m³/hr</span>
                </div>
              )}
              {row.avg_flow_rate != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">7-Day Avg Rate:</span>
                  <span className="text-foreground">{row.avg_flow_rate.toFixed(2)} m³/hr</span>
                </div>
              )}
              {row.deviation_pct != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deviation from Avg:</span>
                  <span className={cn('font-bold', row.deviation_direction === 'high' ? 'text-destructive' : 'text-warn')}>
                    {row.deviation_direction === 'high' ? '+' : '-'}{row.deviation_pct}%
                  </span>
                </div>
              )}
              {row.elapsed_hours != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Elapsed Duration:</span>
                  <span className="text-foreground">{formatElapsedDuration(row.elapsed_hours)}</span>
                </div>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}