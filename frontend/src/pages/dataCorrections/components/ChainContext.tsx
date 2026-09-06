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
import { AnomalyDiagnosticsBadge, formatElapsedDuration, PrecedingReadingTooltip } from './DiagnosticPopover';
import { CompactReasonBadge, QUICK_ANOMALY_REASONS } from './CompactReasonBadge';


// ── Chain context component (item 4) ──────────────────────────────────────────

export function ChainContext({ focusedId, sourceTable, entityId, plantId }:
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