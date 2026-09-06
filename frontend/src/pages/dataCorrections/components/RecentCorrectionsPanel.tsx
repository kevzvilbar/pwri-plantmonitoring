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
import { CompactReasonBadge, QUICK_ANOMALY_REASONS } from './CompactReasonBadge';


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
export interface RecentCorrection {
  key: string;
  /** Entity name for a direct edit, or a short description for an approved
   *  operator request (which doesn't carry an entity name — see
   *  fetchCorrectionRequests / CorrectionRequest). */
  label: string;
  plantName: string;
  sourceTable: SourceTable;
  oldValue: number;
  newValue: number;
  correctedAt: string;
}


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

export function useRecentCorrections() {
  const [items, setItems] = useState<RecentCorrection[]>([]);
  const add = useCallback((c: Omit<RecentCorrection, 'key' | 'correctedAt'>) => {
    if (c.oldValue === c.newValue) return; // nothing actually changed — not worth a row
    setItems(prev => [
      { ...c, key: `${c.sourceTable}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, correctedAt: new Date().toISOString() },
      ...prev,
    ].slice(0, 8));
  }, []);
  const clear = useCallback(() => setItems([]), []);
  return { items, add, clear };
}


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

export function RecentCorrectionsPanel({ items, onClear }: { items: RecentCorrection[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2 pb-1">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-foreground uppercase tracking-wide">Just Corrected</p>
          <Badge variant="outline" className="text-3xs px-2 py-0 font-bold border-accent/40 bg-background">
            this session
          </Badge>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-2xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Clear
        </button>
      </div>
      <div className="grid gap-2">
        {items.map(c => (
          <Card key={c.key} className="p-3 border-accent/30 bg-accent-soft/30">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-xs font-semibold truncate">{c.label}</span>
                <Badge variant="outline" className="text-2xs px-1.5 py-0">{c.plantName}</Badge>
                <Badge variant="outline" className="text-2xs px-1.5 py-0">{tableLabel[c.sourceTable]}</Badge>
              </div>
              <span className="text-3xs text-muted-foreground whitespace-nowrap">{fmtDt(c.correctedAt)}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Corrected value</span>
              <span className="font-mono font-medium text-destructive line-through decoration-destructive/60">{fmtNum(c.oldValue)}</span>
              <ArrowRight className="h-3 w-3 text-accent shrink-0" />
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">New value</span>
              <span className="font-mono font-bold text-accent">{fmtNum(c.newValue)}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}