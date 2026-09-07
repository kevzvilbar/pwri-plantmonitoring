import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { deltaCache } from '@/lib/deltaCache';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { recalculateTrainDeltas } from '../../../ro-trains/helpers';

export const PAGE_SIZE = 20;

const ALL_COLS = [
  'id', 'reading_datetime', 'recorded_by',
  'permeate_flow', 'feed_flow', 'reject_flow',
  'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
  'feed_tds', 'permeate_tds', 'reject_tds',
  'feed_ph', 'permeate_ph', 'temperature_c', 'turbidity_ntu',
  'recovery_pct',
  'permeate_meter', 'permeate_meter_prev', 'permeate_meter_delta',
  'is_meter_replacement',
  'is_feed_meter_replacement', 'is_permeate_meter_replacement', 'is_reject_meter_replacement',
  'remarks',
];
const TIER2_COLS = [
  'id', 'reading_datetime', 'recorded_by',
  'permeate_flow', 'feed_flow', 'reject_flow',
  'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
  'feed_tds', 'permeate_tds', 'reject_tds',
  'temperature_c', 'recovery_pct',
  'permeate_meter', 'permeate_meter_delta',
  'is_meter_replacement',
];
const TIER3_COLS = [
  'id', 'reading_datetime', 'recorded_by',
  'permeate_flow', 'feed_flow', 'reject_flow',
  'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
  'feed_tds', 'permeate_tds', 'reject_tds',
  'temperature_c', 'recovery_pct',
  'permeate_meter',
];

function untilNextDay(dateTo: string | null): string | null {
  if (!dateTo) return null;
  const [y, m, d] = dateTo.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export function useOperatorLog(trainId: string, trainLabel: string, plantId: string) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [page, setPage] = useState(0);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgoStr = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgoStr);
  const [dateTo, setDateTo]     = useState(todayStr);
  const [rangePreset, setRangePreset] = useState<'7' | '30' | '90' | 'custom'>('30');

  const applyPreset = (p: '7' | '30' | '90') => {
    const days = parseInt(p);
    setDateFrom(format(new Date(Date.now() - days * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
    setDateTo(todayStr);
    setRangePreset(p);
    setPage(0);
  };

  const nextDay = useMemo(() => untilNextDay(dateTo), [dateTo]);

  const queryKey = ['train-operator-log', trainId, dateFrom, nextDay];

  const { data: logs = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const buildQ = (cols: string[]) => {
          let q = (supabase.from('ro_train_readings' as any) as any)
            .select(cols.join(','))
            .eq('train_id', trainId)
            .order('reading_datetime', { ascending: false })
            .limit(2000);
          if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
          if (nextDay) q = q.lt('reading_datetime',  `${nextDay}T00:00:00`);
          return q;
        };

        let readings: any[] | null = null;
        for (const tier of [ALL_COLS, TIER2_COLS, TIER3_COLS]) {
          const { data, error } = await buildQ(tier);
          if (!error) { readings = data ?? []; break; }
          const isMissingCol = error.message.includes('column') || error.message.includes('does not exist');
          if (!isMissingCol) { console.error('operator log fetch:', error); break; }
        }
        if (!readings?.length) return [];

        const ascReadings = [...(readings as any[])].reverse();
        const lastMeter = new Map<string, number>();
        ascReadings.forEach((r: any) => {
          if (r.permeate_meter != null) {
            const prev = lastMeter.get(r.train_id ?? trainId);
            r._computed_delta = prev != null ? Math.max(0, +r.permeate_meter - prev) : null;
            lastMeter.set(r.train_id ?? trainId, +r.permeate_meter);
          }
        });

        const uids = [...new Set((readings as any[]).map((r: any) => r.recorded_by).filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          for (const table of ['user_profiles', 'profiles']) {
            const { data: pdata, error: perr } = await (supabase.from(table as any) as any)
              .select('id, first_name, last_name, username').in('id', uids);
            if (!perr && pdata?.length) {
              profileMap = Object.fromEntries(
                (pdata as any[]).map((p: any) => {
                  const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
                  return [p.id, name || null];
                }).filter(([, n]) => n)
              );
              if (Object.keys(profileMap).length) break;
            }
          }
        }
        return (readings as any[]).map((r: any) => ({
          ...r,
          _operatorName: profileMap[r.recorded_by] ?? (r.recorded_by ? `UID:${String(r.recorded_by).slice(0, 8)}` : 'Unknown'),
        }));
      } catch (err) {
        console.error('operator log error:', err);
        return [];
      }
    },
    staleTime: 30_000,
    gcTime: 60_000,
  });

  const toggleMeterReplacement = async (r: any) => {
    if (!isManager) return;
    const next = !r.is_meter_replacement;
    if (next) {
      setReplaceReadingId(r.id);
      return;
    }
    setTogglingId(r.id);
    const { error } = await (supabase.from('ro_train_readings' as any) as any)
      .update({
        is_meter_replacement: false,
        is_feed_meter_replacement: false,
        is_permeate_meter_replacement: false,
        is_reject_meter_replacement: false,
      }).eq('id', r.id);
    setTogglingId(null);
    if (error) {
      toast.error('is_meter_replacement column missing — run: ALTER TABLE ro_train_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN DEFAULT FALSE');
      return;
    }

    deltaCache.invalidate(r.train_id ?? trainId);
    await recalculateTrainDeltas(r.train_id ?? trainId);

    toast.success('Replacement flag removed — Δ recalculated from actual meter readings');
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
    qc.invalidateQueries();
  };

  const totalPages = Math.ceil(logs.length / PAGE_SIZE);
  const pageLogs   = logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const fmtVal = (v: any, unit = '') =>
    v != null && v !== '' ? (
      <span className="font-mono tabular-nums whitespace-nowrap">
        {Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {unit && <span className="text-muted-foreground/60 ml-0.5 text-3xs font-sans">{unit}</span>}
      </span>
    ) : (
      <span className="text-muted-foreground/30">—</span>
    );

  const exportCSV = () => {
    if (!logs.length) { toast.error('No logs to export'); return; }
    const headers = [
      'Date/Time','Operator','Meter Repl.',
      'Perm Flow (m³/h)','Feed Flow (m³/h)','Reject Flow (m³/h)',
      'Feed Press (psi)','Reject Press (psi)','Suction Press (psi)',
      'Feed TDS (ppm)','Perm TDS (ppm)','Reject TDS (ppm)',
      'Feed pH','Perm pH','Temp (°C)','Turbidity (NTU)',
      'Recovery (%)','Perm Meter Curr','Perm Meter Prev','Perm Delta (m³)',
      'Remarks',
    ];
    const csvRows = logs.map((r: any) => [
      r.reading_datetime ? format(new Date(r.reading_datetime), 'yyyy-MM-dd HH:mm') : '',
      r._operatorName ?? 'Unknown',
      r.is_meter_replacement ? 'YES' : '',
      r.permeate_flow ?? '', r.feed_flow ?? '', r.reject_flow ?? '',
      r.feed_pressure_psi ?? '', r.reject_pressure_psi ?? '', r.suction_pressure_psi ?? '',
      r.feed_tds ?? '', r.permeate_tds ?? '', r.reject_tds ?? '',
      r.feed_ph ?? '', r.permeate_ph ?? '', r.temperature_c ?? '', r.turbidity_ntu ?? '',
      r.recovery_pct ?? '',
      r.permeate_meter ?? '', r.permeate_meter_prev ?? '', r.permeate_meter_delta ?? '',
      r.remarks ?? '',
    ].map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${trainLabel.replace(/\s+/g, '_')}_operator_log.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Log exported');
  };

  return {
    page, setPage, PAGE_SIZE,
    togglingId, setTogglingId,
    replaceReadingId, setReplaceReadingId,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    rangePreset, setRangePreset,
    applyPreset,
    logs, isLoading, error, refetch, queryKey,
    totalPages, pageLogs,
    fmtVal, exportCSV,
    toggleMeterReplacement,
    isManager, trainId, trainLabel, plantId, qc,
  };
}
