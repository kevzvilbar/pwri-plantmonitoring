import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { SourceTable, ChainEntry, fmtNum } from '../types';
import { DeltaBadge } from './DeltaBadge';

export function ChainContext({
  focusedId,
  sourceTable,
  entityId,
  plantId,
}: {
  focusedId: string;
  sourceTable: SourceTable;
  entityId: string;
  plantId: string;
}) {
  const { data: chain = [], isLoading } = useQuery({
    queryKey: ['chain-context', focusedId, sourceTable],
    queryFn: async () => {
      let focusDt: string | null = null;
      if (sourceTable === 'locator_readings') {
        const { data } = await supabase.from('locator_readings').select('reading_datetime').eq('id', focusedId).maybeSingle();
        focusDt = data?.reading_datetime ?? null;
      } else if (sourceTable === 'well_readings') {
        const { data } = await supabase.from('well_readings').select('reading_datetime').eq('id', focusedId).maybeSingle();
        focusDt = data?.reading_datetime ?? null;
      } else if (sourceTable === 'product_meter_readings') {
        const { data } = await supabase.from('product_meter_readings').select('reading_datetime').eq('id', focusedId).maybeSingle();
        focusDt = data?.reading_datetime ?? null;
      }
      if (!focusDt) return [];

      const before3 = new Date(focusDt);
      before3.setDate(before3.getDate() - 7);
      const after3 = new Date(focusDt);
      after3.setDate(after3.getDate() + 7);
      const since = before3.toISOString();
      const until = after3.toISOString();

      let entries: ChainEntry[] = [];
      if (sourceTable === 'locator_readings') {
        let q = supabase
          .from('locator_readings')
          .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status')
          .eq('locator_id', entityId)
          .gte('reading_datetime', since)
          .lte('reading_datetime', until);
        if (plantId) q = q.eq('plant_id', plantId);
        const { data } = await q.order('reading_datetime', { ascending: true }).limit(10);
        entries = (data ?? []).map(r => ({
          id: r.id,
          reading_datetime: r.reading_datetime,
          previous_reading: r.previous_reading,
          current_reading: r.current_reading ?? 0,
          daily_volume: r.daily_volume,
          norm_status: r.norm_status ?? 'normal',
        }));
      } else if (sourceTable === 'well_readings') {
        let q = supabase
          .from('well_readings')
          .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status')
          .eq('well_id', entityId)
          .gte('reading_datetime', since)
          .lte('reading_datetime', until);
        if (plantId) q = q.eq('plant_id', plantId);
        const { data } = await q.order('reading_datetime', { ascending: true }).limit(10);
        entries = (data ?? []).map(r => ({
          id: r.id,
          reading_datetime: r.reading_datetime,
          previous_reading: r.previous_reading,
          current_reading: r.current_reading ?? 0,
          daily_volume: r.daily_volume,
          norm_status: r.norm_status ?? 'normal',
        }));
      } else if (sourceTable === 'product_meter_readings') {
        let q = supabase
          .from('product_meter_readings')
          .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status')
          .eq('meter_id', entityId)
          .gte('reading_datetime', since)
          .lte('reading_datetime', until);
        if (plantId) q = q.eq('plant_id', plantId);
        const { data } = await q.order('reading_datetime', { ascending: true }).limit(10);
        entries = (data ?? []).map(r => ({
          id: r.id,
          reading_datetime: r.reading_datetime,
          previous_reading: r.previous_reading,
          current_reading: r.current_reading ?? 0,
          daily_volume: r.daily_volume,
          norm_status: r.norm_status ?? 'normal',
        }));
      }
      return entries.map(r => ({ ...r, isFocused: r.id === focusedId }));
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-3 text-xs text-muted-foreground flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading chain…
      </div>
    );
  }
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