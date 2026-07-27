import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';



export interface HistoryRow { date: string; consumption: number; reading?: number; }

export function EntityHistoryChart({
  entityId,
  entityType,
  entityName,
}: {
  entityId: string;
  entityType: 'locator' | 'well' | 'product_meter';
  entityName: string;
}) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading } = useQuery<HistoryRow[]>({
    queryKey: ['entity-history', entityType, entityId, range],
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      let raw: any[] = [];

      if (entityType === 'locator') {
        const { data } = await supabase
          .from('locator_readings')
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('locator_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        raw = data ?? [];
      } else if (entityType === 'well') {
        const { data } = await supabase
          .from('well_readings')
          // Fix: include daily_volume so stored delta is preferred over live current-previous calc
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('well_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        raw = data ?? [];
      } else {
        const { data } = await supabase
          .from('product_meter_readings' as any)
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('meter_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        raw = (data ?? []) as any[];
      }

      return raw.map((r: any) => {
        const dateStr = r.reading_datetime?.slice(0, 10) ?? '';
        let consumption = 0;
        if (r.daily_volume != null && +r.daily_volume > 0) {
          consumption = +r.daily_volume;
        } else if (r.current_reading != null && r.previous_reading != null) {
          consumption = Math.max(0, +r.current_reading - +r.previous_reading);
        }
        return { date: dateStr, consumption: +consumption.toFixed(2), reading: r.current_reading != null ? +r.current_reading : undefined };
      }).filter(r => r.date);
    },
    staleTime: 60_000,
  });

  // Aggregate by date (sum consumption for multi-reading days)
  const aggregated = useMemo<HistoryRow[]>(() => {
    const map = new Map<string, HistoryRow>();
    rows.forEach(r => {
      if (map.has(r.date)) {
        map.get(r.date)!.consumption += r.consumption;
        if (r.reading != null) map.get(r.date)!.reading = r.reading;
      } else {
        map.set(r.date, { ...r });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const exportCSV = () => {
    if (!aggregated.length) { toast.error('No data to export'); return; }
    const header = 'date,consumption_m3,reading';
    const lines = aggregated.map(r => `${r.date},${r.consumption},${r.reading ?? ''}`);
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entityName.replace(/\s+/g, '_')}_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const totalConsumption = aggregated.reduce((s, r) => s + r.consumption, 0);
  const avgConsumption = aggregated.length ? totalConsumption / aggregated.length : 0;

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.color }}>
            {p.name === 'consumption' ? 'Consumption' : 'Reading'}: <span className="font-mono font-semibold">{fmtNum(p.value)}</span>
            {p.name === 'consumption' ? ' m³' : ''}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">Historical Consumption</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Range pills */}
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30','90','180','all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{r === 'all' ? 'All' : `${r}d`}</button>
            ))}
          </div>
          <Button
            size="sm" variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={exportCSV}
            title="Export to CSV"
          >
            <Download className="h-3 w-3" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      {aggregated.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Readings</div>
            <div className="font-mono font-semibold text-base">{aggregated.length}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Total</div>
            <div className="font-mono font-semibold text-base">{fmtNum(totalConsumption)}</div>
            <div className="text-muted-foreground text-[9px]">m³</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Avg/day</div>
            <div className="font-mono font-semibold text-base">{fmtNum(avgConsumption)}</div>
            <div className="text-muted-foreground text-[9px]">m³</div>
          </div>
        </div>
      )}

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading chart…
        </div>
      ) : aggregated.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" />
          <p>No readings in this period</p>
        </div>
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aggregated} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / aggregated.length))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)} // show MM-DD
                interval="preserveStartEnd"
                angle={-30}
                textAnchor="end"
                height={36}
              />
              <YAxis
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                width={38}
                tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)}
              />
              <Tooltip content={customTooltip} />
              <Bar dataKey="consumption" fill="hsl(174, 72%, 40%)" name="consumption" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── MeterDetailSheet ─────────────────────────────────────────────────────────
// A button that expands into a Dialog showing meter details.
// Used in LocatorDetail, WellDetail, etc. as a replacement for inline meter rows.

export function MeterDetailButton({
  label,
  icon,
  fields,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  fields: { label: string; value: string | null | undefined }[];
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const filledCount = fields.filter(f => f.value && f.value !== '—').length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors group text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <span className="text-sm font-medium truncate">{label}</span>
          {filledCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 font-medium shrink-0">
              {filledCount} field{filledCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 -rotate-90" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {icon}
              <span>{label}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {fields.map((f, i) => (
                <div key={i} className={f.label === 'Installed' ? 'col-span-2' : ''}>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{f.label}</div>
                  <div className="font-mono-num font-medium">{f.value || '—'}</div>
                </div>
              ))}
            </div>
            {children && <div className="pt-2 border-t">{children}</div>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

