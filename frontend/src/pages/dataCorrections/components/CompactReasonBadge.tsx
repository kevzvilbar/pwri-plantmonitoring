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
import { AnomalyDiagnosticsBadge, formatElapsedDuration, PrecedingReadingTooltip } from './DiagnosticPopover';


// ── Types ─────────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).
export const QUICK_ANOMALY_REASONS = [
  { label: 'Demand Surge', icon: '⚡', text: 'Unusually high operational demand / production surge' },
  { label: 'Line Flushing / Leak', icon: '💧', text: 'Pipeline flushing / leak test conducted' },
  { label: 'Plant Downtime', icon: '🛑', text: 'Plant downtime / pump stopped during interval' },
  { label: 'Pump Maintenance', icon: '🔧', text: 'Pump or meter serviced / calibrated' },
  { label: 'Meter Rollover', icon: '🔄', text: 'Meter exceeded maximum register and rolled over' },
  { label: 'Data Entry Typo', icon: '✏️', text: 'Operator typo corrected or re-verified' },
];


// ── Types ─────────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).

export function CompactReasonBadge({
  row,
  customReason,
  onSaveReason,
}: {
  row: FlaggedRow;
  customReason: string;
  onSaveReason: (row: FlaggedRow, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(customReason || '');
  const [saving, setSaving] = useState(false);

  const existingReason = row.anomaly_remark?.text || row.edit_reason?.text || customReason;

  const handlePresetClick = async (presetText: string) => {
    setInputVal(presetText);
    setSaving(true);
    await onSaveReason(row, presetText);
    setSaving(false);
    setOpen(false);
  };

  const handleSaveManual = async () => {
    if (!inputVal.trim()) return;
    setSaving(true);
    await onSaveReason(row, inputVal.trim());
    setSaving(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {existingReason ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors font-medium max-w-[240px] truncate cursor-pointer"
            title={`Reason: "${existingReason}" (Click to view or edit)`}
          >
            <Tag className="h-3 w-3 shrink-0 text-emerald-500" />
            <span className="truncate">Reason: "{existingReason}"</span>
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors font-medium animate-pulse cursor-pointer"
            title="Set anomaly reason (required for approval)"
          >
            <FileQuestion className="h-3 w-3 shrink-0 text-amber-500" />
            <span>Set Reason</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2.5 text-xs shadow-xl z-50" align="start">
        <div className="flex items-center justify-between pb-1 border-b border-border/50">
          <span className="font-semibold text-xs flex items-center gap-1.5 text-foreground">
            <Tag className="h-3.5 w-3.5 text-primary" />
            {existingReason ? 'Anomaly Reason' : 'Set Anomaly Reason'}
          </span>
          {row.anomaly_remark?.tier && (
            <Badge variant="outline" className="text-3xs px-1 py-0 uppercase">
              {row.anomaly_remark.tier}
            </Badge>
          )}
        </div>

        {existingReason && !saving && (
          <div className="p-2 rounded bg-muted/40 border border-border/50 text-2xs text-foreground space-y-1">
            <div className="italic">"{existingReason}"</div>
            <div className="text-3xs text-muted-foreground flex justify-between pt-1 border-t border-border/40">
              <span>{row.anomaly_remark ? 'Operator Entry Remark' : row.edit_reason ? 'Edit Audit Log' : 'Supervisor Tag'}</span>
              {row.anomaly_remark?.logged_at && <span>{fmtDt(row.anomaly_remark.logged_at)}</span>}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-3xs font-medium uppercase text-muted-foreground tracking-wider">
            {existingReason ? 'Change Reason / Quick Presets:' : 'Quick Select Preset Reason:'}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {QUICK_ANOMALY_REASONS.map(preset => (
              <button
                key={preset.label}
                type="button"
                disabled={saving}
                onClick={() => handlePresetClick(preset.text)}
                className="text-left px-2 py-1 rounded bg-muted/30 hover:bg-primary/10 hover:text-primary text-2xs transition-colors border border-border/40 truncate flex items-center gap-1 disabled:opacity-50"
              >
                <span>{preset.icon}</span>
                <span className="truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-border/40">
          <Input
            placeholder="Or enter custom reason…"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            className="h-7 text-xs"
            disabled={saving}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveManual();
            }}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-2xs"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-2xs gap-1"
              disabled={saving || !inputVal.trim() || inputVal === existingReason}
              onClick={handleSaveManual}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Save Reason
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}