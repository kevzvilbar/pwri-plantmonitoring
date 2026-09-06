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


// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceTable = 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';


// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlaggedRow {
  id: string;
  source_table: SourceTable;
  /** well_id / locator_id / meter_id — the FK on the reading row, not the
   *  reading's own id. Only populated by fetchPending() so far; used to look
   *  up wells.meter_rollover_max for the rollover-default fetch below. */
  entity_id?: string;
  entity_name: string;
  plant_id?: string;
  plant_name: string;
  reading_datetime: string;
  previous_reading: number | null;
  /** Preceding reading timestamp and operator, queried for tooltip details */
  previous_reading_datetime?: string | null;
  previous_operator_username?: string | null;
  current_reading: number;
  daily_volume: number | null;
  operator_username: string | null;
  norm_status: string;
  flag_reason?: 'backward' | 'unchanged' | 'edited' | 'spike' | string;
  /** True when current_reading < previous_reading — the real "backward jump"
   *  signal, computed once in fetchPending() from the raw values rather than
   *  the already-clamped daily_volume. See fetchPending for why the latter
   *  can't be trusted for this. */
  is_backward?: boolean;
  /** True when previous_reading != null and current_reading === previous_reading (zero flow). */
  is_unchanged?: boolean;
  /** The operator's own explanation for this reading, captured at save time
   *  by AnomalyRemarkBanner / submitAnomalyRemark() (reading_anomaly_remarks)
   *  whenever the reading's flow rate fell outside the normal band. */
  anomaly_remark?: {
    text: string;
    tier: 'needs_remark' | 'critical';
    direction?: 'high' | 'low' | null;
    deviation_pct?: number | null;
    flow_rate?: number | null;
    avg_flow_rate?: number | null;
    rate_unit?: string;
    logged_at: string;
    logged_by?: string | null;
  } | null;
  /** Edit reason from reading_edit_audit_log if modified via history dialog */
  edit_reason?: { text: string; actor_label: string | null; logged_at: string } | null;
  /** The value of this reading BEFORE it was edited/corrected */
  pre_edit_value?: number | null;
  /** Computed flow rate diagnostics explaining why this reading was quarantined */
  calculated_flow_rate?: number | null;
  avg_flow_rate?: number | null;
  deviation_pct?: number | null;
  deviation_direction?: 'high' | 'low' | null;
  elapsed_hours?: number | null;
  diagnostic_summary?: string;
}


export interface CorrectionRequest {
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


export interface ChainEntry {
  id: string;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  norm_status: string;
  isFocused?: boolean;
}


export interface OperatorStat {
  operator_email: string;
  total_entries: number;
  pending_review: number;
  retracted: number;
  backward_readings: number;
  error_rate_pct: number;
  last_entry_at: string | null;
}


export const tableLabel: Record<SourceTable, string> = {
  locator_readings: 'Locator',
  well_readings: 'Well',
  product_meter_readings: 'Product Meter',
  ro_train_readings: 'RO Train',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export const fmtNum = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Helpers ───────────────────────────────────────────────────────────────────
export const fmtDt = (s: string) => format(new Date(s), 'dd MMM yy HH:mm');


// ── Types ─────────────────────────────────────────────────────────────────────

export function parseNumeric(val: any): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const clean = val.replace(/,/g, '').trim();
    const num = Number(clean);
    return isNaN(num) ? null : num;
  }
  return null;
}


// ── Types ─────────────────────────────────────────────────────────────────────

export function extractOldValueFromChanges(changes: any): number | null {
  if (!changes || typeof changes !== 'object') return null;
  const priorityKeys = [
    'current_reading', 'raw_meter_reading', 'meter_reading_kwh',
    'power_meter_reading', 'value', 'feed_meter_reading',
    'permeate_meter_reading', 'reject_meter_reading',
    'previous_reading', 'daily_volume'
  ];

  const getOld = (obj: any): number | null => {
    if (!obj || typeof obj !== 'object') return null;
    const candidates = [obj.old, obj.old_value, obj.from, obj.before, obj.previous, obj.prev];
    for (const c of candidates) {
      const parsed = parseNumeric(c);
      if (parsed != null) return parsed;
    }
    return null;
  };

  for (const k of priorityKeys) {
    const val = changes[k];
    const old = getOld(val);
    if (old != null) return old;
  }
  for (const key of Object.keys(changes)) {
    const val = changes[key];
    const old = getOld(val);
    if (old != null) return old;
  }
  return null;
}

export function pickDisplayRole(roles: string[]): string {
  if (!roles.length) return 'Unknown';
  return [...roles].sort((a, b) => (ROLE_DISPLAY_PRIORITY[a] ?? 99) - (ROLE_DISPLAY_PRIORITY[b] ?? 99))[0];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).
export const ROLE_DISPLAY_PRIORITY: Record<string, number> = { Admin: 1, 'Data Analyst': 2, Manager: 3 };


// ── Types ─────────────────────────────────────────────────────────────────────
export type UUID = string;