import { useState } from 'react';
import { deltaCache } from '@/lib/deltaCache';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Loader2, Download, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ReplaceTrainMeterDialog } from '../../ro-trains/ReplaceTrainMeterDialog';
import { recalculateTrainDeltas } from '../../ro-trains/helpers';

// ─── Train Operator Log Modal ─────────────────────────────────────────────────
// Full paginated operator log with all columns + meter-replacement toggle,
// matching the Operations reading-history pattern.

export function TrainOperatorLogModal({
  trainId,
  trainLabel,
  plantId,
  onClose,
}: {
  trainId: string;
  trainLabel: string;
  /** Required so a checked Repl. box can open ReplaceTrainMeterDialog, which
   *  logs plant_id on ro_train_meter_replacements like every other module's
   *  replacement table. */
  plantId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Reading id currently going through ReplaceTrainMeterDialog. See
  // toggleMeterReplacement below for why checking opens this instead of a
  // bare flag flip.
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);

  // Date range — default last 30 days
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

  const untilNextDay = dateTo
    ? (() => {
        const [y, m, d] = dateTo.split('-').map(Number);
        const next = new Date(y, m - 1, d + 1);
        return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      })()
    : null;

  const queryKey = ['train-operator-log', trainId, dateFrom, untilNextDay];

  const { data: logs = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        // Columns added by migration — may not exist in un-migrated DBs.
        // Try full select first; if Supabase returns a schema error for any
        // new column, fall back to the original safe set so logs always load.
        // Column tiers — each retry drops only the columns that failed.
        // This way is_meter_replacement stays in the query once it exists in DB,
        // even if other newer columns (remarks, reject_flow etc.) are still missing.
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
        // Tier 2: drop migration-only columns (remarks, permeate_meter_prev) but
        // keep all original schema columns so Rej. Flow / Suction / Temp etc. display.
        const TIER2_COLS = [
          'id', 'reading_datetime', 'recorded_by',
          'permeate_flow', 'feed_flow', 'reject_flow',
          'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
          'feed_tds', 'permeate_tds', 'reject_tds',
          'temperature_c', 'recovery_pct',
          'permeate_meter', 'permeate_meter_delta',
          'is_meter_replacement',
        ];
        // Tier 3: absolute minimum — original columns only, no migration deps
        const TIER3_COLS = [
          'id', 'reading_datetime', 'recorded_by',
          'permeate_flow', 'feed_flow', 'reject_flow',
          'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
          'feed_tds', 'permeate_tds', 'reject_tds',
          'temperature_c', 'recovery_pct',
          'permeate_meter',
        ];

        const buildQ = (cols: string[]) => {
          let q = (supabase.from('ro_train_readings' as any) as any)
            .select(cols.join(','))
            .eq('train_id', trainId)
            .order('reading_datetime', { ascending: false })
            .limit(2000);
          if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
          if (untilNextDay) q = q.lt('reading_datetime',  `${untilNextDay}T00:00:00`);
          return q;
        };

        // Try each tier in order — stop at first success
        let readings: any[] | null = null;
        for (const tier of [ALL_COLS, TIER2_COLS, TIER3_COLS]) {
          const { data, error } = await buildQ(tier);
          if (!error) { readings = data ?? []; break; }
          // If the error isn't about a missing column, stop retrying — it's a real error
          const isMissingCol = error.message.includes('column') || error.message.includes('does not exist');
          if (!isMissingCol) { console.error('operator log fetch:', error); break; }
        }
        if (!readings?.length) return [];

        // Compute permeate_meter_delta in-memory from consecutive permeate_meter values.
        // Rows are sorted descending; reverse to ascending so prev-curr diff is correct.
        //
        // FIX: previously lastMeter was only updated inside the
        //   `if (permeate_meter_delta == null)` branch, so any row that already had a
        //   stored delta (even a wrong one written before DataAnalysis correction) would
        //   freeze the baseline.  Every subsequent null-delta row then computed against
        //   a stale previous reading, inflating or deflating its computed delta.
        //
        // Now:
        //   • lastMeter ALWAYS advances to the current row's permeate_meter.
        //   • _computed_delta is set for EVERY row that has a permeate_meter — it
        //     uses the corrected meter value, so DataAnalysis corrections to
        //     permeate_meter are reflected immediately without waiting for the stored
        //     permeate_meter_delta to be back-filled.
        const ascReadings = [...(readings as any[])].reverse();
        const lastMeter = new Map<string, number>(); // trainId → last seen permeate_meter
        ascReadings.forEach((r: any) => {
          if (r.permeate_meter != null) {
            const prev = lastMeter.get(r.train_id ?? trainId);
            // Always compute from meter readings — overrides stored delta which may
            // have been derived from a permeate_meter value that was later corrected.
            r._computed_delta = prev != null ? Math.max(0, +r.permeate_meter - prev) : null;
            lastMeter.set(r.train_id ?? trainId, +r.permeate_meter);
          }
        });

        // Resolve operator names
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

  // Toggle is_meter_replacement on a row (manager-only).
  // CHECKING opens ReplaceTrainMeterDialog so the swap actually gets logged
  // against ro_train_meter_replacements (which meter, old/new brand, size,
  // serial, installed date) instead of just flipping a flag.
  // UNCHECKING clears all three granular flags directly — nothing to log for
  // undoing a mis-tap — and, same as before, triggers a full cascade
  // recalculation so every downstream row's delta stays consistent.
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

    // ── HYBRID STRATEGY: flush delta cache for this train ────────────────────
    // Toggling is_meter_replacement changes the delta of every row that follows
    // this one in the sequence.  Clear the entire train's cache entries so the
    // next render recomputes from Tier-2 raw data.  recalculateTrainDeltas below
    // will then re-populate the cache with corrected Tier-1 (stored) values.
    deltaCache.invalidate(r.train_id ?? trainId);

    // Full cascade: recompute permeate_meter_delta for every row in this train
    // so the changed flag propagates correctly through the entire meter sequence.
    // recalculateTrainDeltas also re-populates deltaCache with the new values.
    await recalculateTrainDeltas(r.train_id ?? trainId);

    toast.success('Replacement flag removed — Δ recalculated from actual meter readings');
    qc.invalidateQueries({ queryKey });
    // Invalidate Dashboard / TrendChart so the corrected production totals appear immediately
    qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    // DataSummaryModal Production tab reads dsm-ro-readings directly
    qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
    qc.invalidateQueries();
  };

  const totalPages = Math.ceil(logs.length / PAGE_SIZE);
  const pageLogs   = logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const fmtVal = (v: any, unit = '') =>
    v != null ? <span>{Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}<span className="text-muted-foreground/60 ml-0.5 text-2xs">{unit}</span></span>
              : <span className="text-muted-foreground/30">—</span>;

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

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-[95vw] w-full max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
        onInteractOutside={(e) => {
          // ReplaceTrainMeterDialog is a Radix Dialog.Portal — its content
          // mounts as a sibling of this DialogContent's node, not a
          // descendant, so any pointerdown inside it looks "outside" this
          // layer. Without this guard, opening it via the Repl. checkbox and
          // then clicking anything inside it (a field, the meter-type
          // Select) closes this whole Operator Log modal — and takes the
          // just-opened replace dialog down with it — before the swap can
          // be saved.
          if (replaceReadingId) { e.preventDefault(); return; }
          onClose();
        }}
      >
        <DialogTitle className="sr-only">Operator Log — {trainLabel}</DialogTitle>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <div className="text-base font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">Operator Log — {trainLabel}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              All readings submitted for this RO train · {isManager ? 'Click orange checkbox to flag meter replacement' : 'Managers can flag meter replacements'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mr-8">
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={exportCSV}>
              <Download className="h-3 w-3" /><span className="hidden sm:inline">Export CSV</span>
            </Button>
          </div>
        </div>

        {/* ── Filters bar ── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20 shrink-0 flex-wrap">
          {(['7','30','90'] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={[
                'h-6 px-2 rounded text-xs font-medium border transition-colors',
                rangePreset === p
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-input text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >{p}d</button>
          ))}
          <input
            type="date" value={dateFrom} max={dateTo || todayStr}
            onChange={e => { setDateFrom(e.target.value); setRangePreset('custom'); setPage(0); }}
            className="h-6 text-xs px-2 rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <input
            type="date" value={dateTo} min={dateFrom} max={todayStr}
            onChange={e => { setDateTo(e.target.value); setRangePreset('custom'); setPage(0); }}
            className="h-6 text-xs px-2 rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {!isLoading && (
            <span className="text-xs text-muted-foreground ml-auto">
              <span className="font-semibold text-foreground">{logs.length}</span> {logs.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        {/* ── Log table ── */}
        <div className="flex-1 overflow-auto">
          <DataState
            loading={isLoading}
            error={error}
            isEmpty={logs.length === 0}
            emptyTitle="No logs found"
            emptyDescription="Try expanding the date range."
            onRetry={refetch}
          >
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-background border-b z-10">
                <tr className="text-muted-foreground uppercase tracking-wide text-2xs">
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap w-[130px]">Date / Time</th>
                  <th className="text-left px-2 py-2 font-semibold w-[110px]">Operator</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Perm Flow</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Feed Flow</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Rej. Flow</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Feed Press.</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Rej. Press.</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Suction</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Feed TDS</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Perm TDS</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Rej. TDS</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Temp</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Recovery</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Perm Meter</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Δ m³</th>
                  <th className="px-2 py-2 font-semibold text-center text-kpi-solar whitespace-nowrap w-[54px]" title="Meter Replacement — flags reading as meter change; zeroes Δ in chart">Repl.</th>
                  <th className="text-left px-2 py-2 font-semibold">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageLogs.map((r: any, i: number) => {
                  const isRepl     = !!r.is_meter_replacement;
                  const isToggling = togglingId === r.id;
                  const opName     = r._operatorName ?? 'Unknown';
                  const initials   = opName !== 'Unknown'
                    ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
                    : '?';
                  return (
                    <tr
                      key={r.id ?? i}
                      className={[
                        'border-t transition-colors',
                        isRepl ? 'bg-kpi-solar/40' : 'hover:bg-muted/30',
                      ].join(' ')}
                    >
                      {/* Date / Time */}
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground font-mono text-xs">
                        <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                        <div className="flex items-center gap-1">
                          {r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}
                          {isRepl && (
                            <span className="text-3xs font-bold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">repl.</span>
                          )}
                        </div>
                      </td>
                      {/* Operator */}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-5 w-5 rounded-full bg-primary-soft text-primary flex items-center justify-center text-3xs font-bold shrink-0">
                            {initials}
                          </div>
                          <span className="truncate max-w-[80px]" title={opName}>{opName}</span>
                        </div>
                      </td>
                      {/* Flow */}
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.permeate_flow, 'm³/h')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.feed_flow, 'm³/h')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.reject_flow, 'm³/h')}</td>
                      {/* Pressure */}
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.feed_pressure_psi, 'psi')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.reject_pressure_psi, 'psi')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.suction_pressure_psi, 'psi')}</td>
                      {/* Quality */}
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.feed_tds, 'ppm')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.permeate_tds, 'ppm')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.reject_tds, 'ppm')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.temperature_c, '°C')}</td>
                      {/* Recovery */}
                      <td className="px-2 py-2 text-right font-mono">
                        {r.recovery_pct != null
                          ? <span className="text-accent font-medium">{Number(r.recovery_pct).toFixed(1)}%</span>
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      {/* Permeate meter */}
                      <td className="px-2 py-2 text-right font-mono text-xs">{fmtVal(r.permeate_meter)}</td>
                      {/* Δ m³ — prefer in-memory delta (computed from corrected permeate_meter)
                           over the stored permeate_meter_delta, which may have been written
                           before DataAnalysis corrected the underlying meter reading. */}
                      <td className="px-2 py-2 text-right font-mono text-xs">
                        {(() => {
                          // _computed_delta is always available when permeate_meter exists and
                          // there is a predecessor row.  Fall back to stored delta only when
                          // _computed_delta is null (e.g. first-ever reading for this train).
                          const d = r._computed_delta ?? (r.permeate_meter_delta != null ? +r.permeate_meter_delta : null);
                          if (d == null) return <span className="text-muted-foreground/30">—</span>;
                          if (isRepl) return <span className="text-kpi-solar font-medium">0</span>;
                          return d > 0
                            ? <span className="text-primary">+{d.toLocaleString(undefined,{maximumFractionDigits:1})}</span>
                            : <span className="text-muted-foreground/40">0</span>;
                        })()}
                      </td>
                      {/* Meter replacement toggle — next to Perm Meter / Δ */}
                      <td className="px-2 py-2 text-center">
                        <button
                          title={isRepl ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ in chart)'}
                          aria-label={isRepl ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ in chart)'}
                          disabled={!isManager || isToggling}
                          onClick={() => toggleMeterReplacement(r)}
                          className={[
                            'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                            !isManager ? 'opacity-30 cursor-not-allowed' : 'disabled:opacity-40 disabled:cursor-not-allowed',
                            isRepl
                              ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                              : 'border-input bg-background hover:border-kpi-solar/90 hover:bg-kpi-solar/15',
                          ].join(' ')}
                        >
                          {isToggling
                            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            : isRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null
                          }
                        </button>
                      </td>
                      {/* Remarks */}
                      <td className="px-2 py-2 text-muted-foreground max-w-[140px] truncate" title={r.remarks ?? ''}>{r.remarks || <span className="opacity-30">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataState>
        </div>

        {/* ── Pagination footer ── */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t shrink-0">
          <span className="text-xs text-muted-foreground">
            {totalPages > 1 ? `Page ${page + 1} of ${totalPages} · ` : ''}{logs.length} {logs.length === 1 ? 'entry' : 'entries'}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          )}
        </div>

        {replaceReadingId && (
          <ReplaceTrainMeterDialog
            trainId={trainId}
            plantId={plantId}
            readingId={replaceReadingId}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey });
              qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
              qc.invalidateQueries({ queryKey: ['trend-ro'] });
              qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
            }}
            onClose={() => setReplaceReadingId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Trains List ─────────────────────────────────────────────────────────────

