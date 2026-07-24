/**
 * ro-trains/TrainLogModal.tsx
 *
 * Per-train operator history dialog — shows paginated RO and Pre-Treatment
 * readings with edit/correction-request actions.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Loader2, BarChart2, Download, Upload, Pencil, MessageSquarePlus,
  Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { cn } from '@/lib/utils';
import { canEditEntry, recalculateTrainDeltas } from './helpers';
import { EditRoReadingDialog } from './EditRoReadingDialog';
import { EditPretreatReadingDialog } from './EditPretreatReadingDialog';
import { ImportROReadingsDialog } from './ImportROReadingsDialog';
import { ImportPretreatReadingsDialog } from './ImportPretreatReadingsDialog';

interface TrainLogModalProps {
  trainId: string;
  trainLabel: string;
  /** Required for CSV import dialogs. Passed from TrainCard (train.plant_id). */
  plantId: string;
  onClose: () => void;
}

export function TrainLogModal({ trainId, trainLabel, plantId, onClose }: TrainLogModalProps) {
  const qc = useQueryClient();
  const { isManager, activeOperator } = useAuth();
  const [page, setPage]               = useState(0);
  const PAGE_SIZE = 20;
  const [togglingId, setTogglingId]   = useState<string | null>(null);
  const [logTab, setLogTab]           = useState<'ro' | 'pretreat'>('ro');
  const [editingRoRow, setEditingRoRow]           = useState<any | null>(null);
  const [editingPretreatRow, setEditingPretreatRow] = useState<any | null>(null);
  const [correctionTarget, setCorrectionTarget]   = useState<CorrectionTarget | null>(null);
  // Piece 3+4: gap-scoped import dialogs
  const [showImportRO, setShowImportRO]           = useState(false);
  const [showImportPretreat, setShowImportPretreat] = useState(false);

  const todayStr  = format(new Date(), 'yyyy-MM-dd');
  const thirtyAgo = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom]       = useState(thirtyAgo);
  const [dateTo, setDateTo]           = useState(todayStr);
  const [rangePreset, setRangePreset] = useState<'7' | '30' | '90' | 'custom'>('30');

  const applyPreset = (p: '7' | '30' | '90') => {
    setDateFrom(format(new Date(Date.now() - parseInt(p) * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
    setDateTo(todayStr); setRangePreset(p); setPage(0);
  };

  const untilNextDay = dateTo ? (() => {
    const [y, m, d] = dateTo.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  })() : null;

  const queryKey = ['train-log-overview', trainId, dateFrom, untilNextDay];
  const { data: logs = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const ALL_COLS = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'feed_ph','permeate_ph','temperature_c','turbidity_ntu','recovery_pct','chlorine_residual_mg_l',
          'feed_meter','feed_meter_prev','feed_meter_delta',
          'permeate_meter','permeate_meter_prev','permeate_meter_delta',
          'reject_meter','reject_meter_prev','reject_meter_delta','is_meter_replacement','remarks'];
        const TIER2 = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'feed_ph','permeate_ph','temperature_c','turbidity_ntu','recovery_pct','chlorine_residual_mg_l','remarks',
          'feed_meter','permeate_meter','permeate_meter_delta','reject_meter','is_meter_replacement'];
        const TIER3 = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'feed_ph','permeate_ph','temperature_c','turbidity_ntu','recovery_pct','remarks','permeate_meter'];
        const TIER4 = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'temperature_c','recovery_pct','permeate_meter'];

        const buildQ = (cols: string[]) => {
          let q = (supabase.from('ro_train_readings' as any) as any)
            .select(cols.join(',')).eq('train_id', trainId)
            .order('reading_datetime', { ascending: false }).limit(2000);
          if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
          if (untilNextDay) q = q.lt('reading_datetime',  `${untilNextDay}T00:00:00`);
          return q;
        };

        let readings: any[] | null = null;
        for (const tier of [ALL_COLS, TIER2, TIER3, TIER4]) {
          const { data, error } = await buildQ(tier);
          if (!error) { readings = data ?? []; break; }
          const isMissingCol = error.message.includes('column') || error.message.includes('does not exist');
          if (!isMissingCol) break;
        }
        if (!readings?.length) return [];

        // Compute client-side deltas and build profile map
        const ascReadings = [...readings].reverse();
        const lastMeter    = new Map<string, number>();
        const lastRejMeter = new Map<string, number>();
        ascReadings.forEach((r: any) => {
          if (r.permeate_meter != null) {
            const prev = lastMeter.get(trainId);
            r._computed_delta = prev != null ? Math.max(0, +r.permeate_meter - prev) : null;
            lastMeter.set(trainId, +r.permeate_meter);
          }
          if (r.reject_meter != null) {
            const prev = lastRejMeter.get(trainId);
            r._computed_rej_delta = prev != null ? Math.max(0, +r.reject_meter - prev) : null;
            lastRejMeter.set(trainId, +r.reject_meter);
          }
        });

        const uids = [...new Set(readings.map((r: any) => r.recorded_by).filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          for (const table of ['user_profiles', 'profiles']) {
            const { data: pdata, error: perr } = await (supabase.from(table as any) as any)
              .select('id, first_name, last_name, username').in('id', uids);
            if (!perr && pdata?.length) {
              profileMap = Object.fromEntries((pdata as any[]).map((p: any) => {
                const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
                return [p.id, name || null];
              }).filter(([, n]) => n));
              if (Object.keys(profileMap).length) break;
            }
          }
        }
        return readings.map((r: any) => ({
          ...r,
          _operatorName: profileMap[r.recorded_by] ?? (r.recorded_by ? `UID:${String(r.recorded_by).slice(0, 8)}` : 'Unknown'),
        }));
      } catch { return []; }
    },
    staleTime: 30_000,
  });

  const preQueryKey = ['pretreat-log-modal', trainId, dateFrom, untilNextDay];
  const { data: preLogs = [], isLoading: preLoading } = useQuery({
    queryKey: preQueryKey,
    queryFn: async () => {
      try {
        let q = (supabase.from('ro_pretreatment_readings' as any) as any)
          .select('id,reading_datetime,recorded_by,created_at,plant_id,hpp_target_pressure_psi,bag_filters_changed,afm_units,mmf_readings,booster_pumps,filter_housings,cartridge_filter_housings,remarks')
          .eq('train_id', trainId).order('reading_datetime', { ascending: false }).limit(2000);
        if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
        if (untilNextDay) q = q.lt('reading_datetime',  `${untilNextDay}T00:00:00`);
        const { data, error } = await q;
        if (error) return [];
        const uids = [...new Set((data ?? []).map((r: any) => r.recorded_by).filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          for (const table of ['user_profiles', 'profiles']) {
            const { data: pd, error: pe } = await (supabase.from(table as any) as any)
              .select('id, first_name, last_name, username').in('id', uids);
            if (!pe && pd?.length) {
              profileMap = Object.fromEntries((pd as any[]).map((p: any) => {
                const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
                return [p.id, name || null];
              }).filter(([, n]) => n));
              if (Object.keys(profileMap).length) break;
            }
          }
        }
        return (data ?? []).map((r: any) => ({
          ...r,
          _operatorName: profileMap[r.recorded_by] ?? (r.recorded_by ? `UID:${String(r.recorded_by).slice(0, 8)}` : 'Unknown'),
        }));
      } catch { return []; }
    },
    staleTime: 30_000,
  });

  const toggleMeterReplacement = async (r: any) => {
    if (!isManager) return;
    setTogglingId(r.id);
    const next = !r.is_meter_replacement;
    const { error } = await (supabase.from('ro_train_readings' as any) as any)
      .update({ is_meter_replacement: next }).eq('id', r.id);
    setTogglingId(null);
    if (error) { toast.error('is_meter_replacement column missing — run migration'); return; }
    await recalculateTrainDeltas(trainId);
    toast.success(next ? 'Marked as meter replacement' : 'Replacement flag removed');
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['ro-overview'] });
  };

  const logsWithMeterFlow = useMemo(() => {
    return logs.map((r: any, i: number) => {
      const delta = r._computed_delta ?? r.permeate_meter_delta;
      if (delta == null || r.is_meter_replacement) return { ...r, _perm_flow_meter: null };
      const nextR = logs[i + 1];
      if (!nextR?.reading_datetime || !r.reading_datetime) return { ...r, _perm_flow_meter: null };
      const durHr = (new Date(r.reading_datetime).getTime() - new Date(nextR.reading_datetime).getTime()) / 3_600_000;
      if (durHr <= 0) return { ...r, _perm_flow_meter: null };
      return { ...r, _perm_flow_meter: +(delta / durHr).toFixed(2) };
    });
  }, [logs]);
  const pageLogsWithMeterFlow = logsWithMeterFlow.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const fmtVal = (v: any, unit = '') =>
    v != null
      ? <span>{Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}<span className="text-muted-foreground/60 ml-0.5 text-[10px]">{unit}</span></span>
      : <span className="text-muted-foreground/30">—</span>;

  const exportCSV = () => {
    if (!logs.length) { toast.error('No logs to export'); return; }
    const headers = ['Date/Time','Operator','Repl.','Perm Flow','Feed Flow','Rej Flow','Feed Press','Rej Press','Suction',
      'Feed TDS','Perm TDS','Rej TDS','Temp','Turbidity (NTU)','Feed pH','Perm pH','Cl Residual (mg/L)',
      'Recovery','Feed Meter','Perm Meter','Δ Perm m³','Rej Meter','Δ Rej m³','Remarks'];
    const rows2 = logs.map((r: any) => [
      r.reading_datetime ? format(new Date(r.reading_datetime), 'yyyy-MM-dd HH:mm') : '',
      r._operatorName ?? 'Unknown', r.is_meter_replacement ? 'YES' : '',
      r.permeate_flow ?? '', r.feed_flow ?? '', r.reject_flow ?? '',
      r.feed_pressure_psi ?? '', r.reject_pressure_psi ?? '', r.suction_pressure_psi ?? '',
      r.feed_tds ?? '', r.permeate_tds ?? '', r.reject_tds ?? '',
      r.temperature_c ?? '', r.turbidity_ntu ?? '', r.feed_ph ?? '', r.permeate_ph ?? '',
      r.chlorine_residual_mg_l ?? '', r.recovery_pct ?? '',
      r.feed_meter ?? '', r.permeate_meter ?? '', r._computed_delta ?? r.permeate_meter_delta ?? '',
      r.reject_meter ?? '', r._computed_rej_delta ?? r.reject_meter_delta ?? '', r.remarks ?? '',
    ].map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...rows2].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${trainLabel.replace(/\s+/g, '_')}_log.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Log exported');
  };

  const activeTotal = logTab === 'ro' ? logs.length : preLogs.length;
  const totalPages  = Math.ceil(activeTotal / PAGE_SIZE);

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent
          className="max-w-[95vw] w-full max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
          onInteractOutside={(e) => {
            if (editingRoRow || editingPretreatRow) { e.preventDefault(); return; }
            onClose();
          }}
        >
          <DialogTitle className="sr-only">Operator Log — {trainLabel}</DialogTitle>

          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
            <div className="min-w-0">
              <div className="text-base font-semibold flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-teal-600 shrink-0" />
                <span className="truncate">Operator Log — {trainLabel}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {logTab === 'ro'
                  ? `All RO train readings · ${isManager ? 'Click orange checkbox to flag meter replacement' : 'Managers can flag meter replacements'}`
                  : 'Pre-Treatment records — AFM/MMF, Booster Pumps, Filter Housings, HPP'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mr-8">
              {/* Piece 3: Import RO CSV — only shown on the RO tab */}
              {logTab === 'ro' && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 px-2.5 text-xs gap-1 text-teal-700 border-teal-300 hover:bg-teal-50 dark:text-teal-300 dark:border-teal-700 dark:hover:bg-teal-950/30"
                  onClick={() => setShowImportRO(true)}
                >
                  <Upload className="h-3 w-3" /><span className="hidden sm:inline">Import RO CSV</span>
                </Button>
              )}
              {/* Piece 4: Import Pre-Treatment CSV — only shown on the Pre-Treatment tab */}
              {logTab === 'pretreat' && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 px-2.5 text-xs gap-1 text-teal-700 border-teal-300 hover:bg-teal-50 dark:text-teal-300 dark:border-teal-700 dark:hover:bg-teal-950/30"
                  onClick={() => setShowImportPretreat(true)}
                >
                  <Upload className="h-3 w-3" /><span className="hidden sm:inline">Import Pre-Treatment CSV</span>
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={exportCSV}>
                <Download className="h-3 w-3" /><span className="hidden sm:inline">Export CSV</span>
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20 shrink-0 flex-wrap">
            <div className="flex rounded-full border border-border overflow-hidden text-xs font-semibold mr-1">
              {(['ro', 'pretreat'] as const).map(tab => (
                <button key={tab} onClick={() => { setLogTab(tab); setPage(0); }}
                  className={cn('px-3 py-1 transition-colors',
                    logTab === tab ? 'bg-teal-700 text-white' : 'bg-background text-muted-foreground hover:bg-muted')}>
                  {tab === 'ro' ? 'RO' : 'Pre-Treatment'}
                </button>
              ))}
            </div>
            {(['7', '30', '90'] as const).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={cn('h-6 px-2 rounded text-xs font-medium border transition-colors',
                  rangePreset === p ? 'bg-teal-700 text-white border-teal-700' : 'bg-background border-input text-muted-foreground hover:text-foreground')}>
                {p}d
              </button>
            ))}
            <input type="date" value={dateFrom} max={dateTo || todayStr}
              onChange={e => { setDateFrom(e.target.value); setRangePreset('custom'); setPage(0); }}
              className="h-6 text-xs px-2 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-teal-600" />
            <span className="text-muted-foreground text-xs">→</span>
            <input type="date" value={dateTo} min={dateFrom} max={todayStr}
              onChange={e => { setDateTo(e.target.value); setRangePreset('custom'); setPage(0); }}
              className="h-6 text-xs px-2 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-teal-600" />
            {!isLoading && !preLoading && (
              <span className="text-xs text-muted-foreground ml-auto">
                <span className="font-semibold text-foreground">{activeTotal}</span> entries
              </span>
            )}
          </div>

          {/* Table area */}
          <div className="flex-1 overflow-auto">
            {logTab === 'ro' && (isLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Calendar className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">No logs found</p>
                <p className="text-xs mt-0.5">Try expanding the date range.</p>
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-background border-b z-10">
                  <tr className="text-muted-foreground uppercase tracking-wide text-[10px]">
                    <th className="text-left px-3 py-2 font-semibold whitespace-nowrap w-[130px]">Date / Time</th>
                    <th className="text-left px-2 py-2 font-semibold w-[100px]">Operator</th>
                    <th className="text-right px-0 py-0 font-semibold whitespace-nowrap" colSpan={2}>
                      <div className="flex flex-col items-end">
                        <span className="px-2 pt-2 pb-0.5">Perm Flow</span>
                        <div className="flex border-t border-border/40 w-full">
                          <span className="flex-1 px-1.5 pb-1.5 pt-0.5 text-[9px] text-right border-r border-border/30">EM</span>
                          <span className="flex-1 px-1.5 pb-1.5 pt-0.5 text-[9px] text-right text-teal-600 dark:text-teal-400">Meter</span>
                        </div>
                      </div>
                    </th>
                    {['Feed Flow','Rej. Flow','Feed Press.','Rej. Press.','Suction',
                      'Feed TDS','Perm TDS','Rej. TDS','Temp','Turbidity','Feed pH','Perm pH',
                      'Cl Residual','Recovery','Feed Meter','Perm Meter','Δ Perm m³','Rej. Meter','Δ Rej. m³'].map(h => (
                      <th key={h} className="text-right px-2 py-2 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-2 py-2 font-semibold text-center text-orange-600 whitespace-nowrap w-[50px]" title="Meter Replacement flag">Repl.</th>
                    <th className="text-left px-2 py-2 font-semibold">Remarks</th>
                    <th className="px-2 py-2 font-semibold text-center whitespace-nowrap w-[36px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageLogsWithMeterFlow.map((r: any, i: number) => {
                    const isRepl     = !!r.is_meter_replacement;
                    const isToggling = togglingId === r.id;
                    const opName     = r._operatorName ?? 'Unknown';
                    const initials   = opName !== 'Unknown'
                      ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
                    const delta = r._computed_delta ?? r.permeate_meter_delta;
                    return (
                      <tr key={r.id ?? i} className={cn('border-t transition-colors', isRepl ? 'bg-orange-50/40 dark:bg-orange-950/10' : 'hover:bg-muted/30')}>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">
                          <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                          <div className="text-muted-foreground">{r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="h-5 w-5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-[9px] font-bold inline-flex items-center justify-center shrink-0">{initials}</span>
                            <span className="text-[11px] font-medium leading-tight truncate max-w-[80px]">{opName}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right border-r border-border/20">{fmtVal(r.permeate_flow, 'm³/h')}</td>
                        <td className="px-2 py-2 text-right">
                          {isRepl ? <span className="text-orange-400 text-[10px]">—</span>
                            : r._perm_flow_meter != null
                              ? <span className="text-teal-700 dark:text-teal-400 font-mono text-[11px]">{r._perm_flow_meter}<span className="text-muted-foreground/60 ml-0.5 text-[9px]">m³/h</span></span>
                              : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_flow, 'm³/h')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.reject_flow, 'm³/h')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_pressure_psi, 'psi')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.reject_pressure_psi, 'psi')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.suction_pressure_psi, 'psi')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_tds, 'ppm')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.permeate_tds, 'ppm')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.reject_tds, 'ppm')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.temperature_c, '°C')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.turbidity_ntu, 'NTU')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_ph, '')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.permeate_ph, '')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.chlorine_residual_mg_l, 'mg/L')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.recovery_pct, '%')}</td>
                        <td className="px-2 py-2 text-right font-mono text-[11px]">
                          {r.feed_meter != null ? <span>{Number(r.feed_meter).toLocaleString()}<span className="text-muted-foreground/60 ml-0.5 text-[9px]">m³</span></span> : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[11px]">
                          {r.permeate_meter != null ? <span>{Number(r.permeate_meter).toLocaleString()}<span className="text-muted-foreground/60 ml-0.5 text-[9px]">m³</span></span> : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className={cn('px-2 py-2 text-right font-mono text-[11px]', isRepl && 'text-orange-500')}>
                          {isRepl ? <span className="text-orange-500 font-semibold">★ 0</span>
                            : delta != null ? <span>{Number(delta).toLocaleString()}<span className="text-muted-foreground/60 ml-0.5 text-[9px]">m³</span></span>
                            : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[11px]">
                          {r.reject_meter != null ? <span>{Number(r.reject_meter).toLocaleString()}<span className="text-muted-foreground/60 ml-0.5 text-[9px]">m³</span></span> : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[11px]">
                          {(r._computed_rej_delta ?? r.reject_meter_delta) != null ? <span>{Number(r._computed_rej_delta ?? r.reject_meter_delta).toLocaleString()}<span className="text-muted-foreground/60 ml-0.5 text-[9px]">m³</span></span> : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {isManager ? (
                            <button onClick={() => toggleMeterReplacement(r)} disabled={isToggling}
                              title={isRepl ? 'Meter replacement — click to unmark' : 'Toggle meter replacement flag'}
                              aria-label={isRepl ? 'Meter replacement — click to unmark' : 'Toggle meter replacement flag'}
                              className={cn('h-5 w-5 rounded border-2 inline-flex items-center justify-center transition-colors mx-auto',
                                isRepl ? 'border-orange-500 bg-orange-500 text-white' : 'border-border bg-background hover:border-orange-400',
                                isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer')}>
                              {isToggling ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : isRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null}
                            </button>
                          ) : isRepl ? <span className="text-orange-500 text-[10px]">★</span> : null}
                        </td>
                        <td className="px-2 py-2 text-[11px] text-muted-foreground max-w-[150px] truncate">{r.remarks || ''}</td>
                        <td className="px-2 py-2 text-center">
                          {canEditEntry(r, isManager, activeOperator?.id) ? (
                            <button onClick={() => setEditingRoRow(r)} title="Edit reading" aria-label="Edit reading"
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                              <Pencil className="h-3 w-3" />
                            </button>
                          ) : !isManager && activeOperator?.id && r.permeate_meter != null && (
                            <button
                              onClick={() => setCorrectionTarget({
                                id: r.id, sourceTable: 'ro_train_readings',
                                plantId: r.plant_id ?? '', entityName: trainLabel,
                                currentReading: Number(r.permeate_meter),
                                previousReading: r.permeate_meter_prev != null ? Number(r.permeate_meter_prev) : null,
                                dailyVolume: (r._computed_delta ?? r.permeate_meter_delta) != null ? Number(r._computed_delta ?? r.permeate_meter_delta) : null,
                                readingDatetime: r.reading_datetime ?? new Date().toISOString(),
                              })}
                              title="Request correction" aria-label="Request correction"
                              className="p-1 rounded hover:bg-amber-50 text-muted-foreground/40 hover:text-amber-600 transition-colors">
                              <MessageSquarePlus className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}

            {logTab === 'pretreat' && (preLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : preLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Calendar className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">No pre-treatment records found</p>
                <p className="text-xs mt-0.5">Try expanding the date range.</p>
              </div>
            ) : (() => {
              const pagePreLogs = preLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
              const pressurePills = (units: any[], getLabel = (u: any) => `U${u.unit}`) =>
                units.length === 0
                  ? <span className="text-muted-foreground/30">—</span>
                  : <div className="flex flex-wrap gap-0.5 justify-end">
                      {units.map((u: any, j: number) => {
                        const inP  = u.in_psi ?? u.inlet_psi ?? null;
                        const outP = u.out_psi ?? u.outlet_psi ?? null;
                        const dp   = u.dp_psi != null ? u.dp_psi : (inP != null && outP != null ? (inP - outP).toFixed(1) : null);
                        if (u.backwash_on) {
                          const mRow   = (u._mmfReadings ?? []).find((m: any) => m.unit === u.unit);
                          const mDelta = mRow?.meter_start != null && mRow?.meter_end != null ? ` +${(mRow.meter_end - mRow.meter_start).toFixed(0)}` : '';
                          return <span key={j} className="text-[9px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 font-mono whitespace-nowrap text-amber-700 dark:text-amber-300">{getLabel(u)} BW{mDelta}</span>;
                        }
                        return <span key={j} className="text-[9px] px-1 py-0.5 rounded bg-muted/50 border border-border/40 font-mono whitespace-nowrap">{getLabel(u)}{dp != null ? ` ΔP=${dp}` : inP != null ? ` ${inP}→${outP}` : ''}</span>;
                      })}
                    </div>;
              const boosterPills = (units: any[]) =>
                units.length === 0
                  ? <span className="text-muted-foreground/30">—</span>
                  : <div className="flex flex-wrap gap-0.5 justify-end">
                      {units.map((u: any, j: number) => (
                        <span key={j} className="text-[9px] px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 font-mono whitespace-nowrap">
                          P{u.unit} {u.target_pressure_psi != null ? `${u.target_pressure_psi}psi` : u.target_hz != null ? `${u.target_hz}Hz` : '—'}{u.amperage != null ? ` ${u.amperage}A` : ''}
                        </span>
                      ))}
                    </div>;
              return (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-background border-b z-10">
                    <tr className="text-muted-foreground uppercase tracking-wide text-[10px]">
                      {['Date / Time','Operator','HPP (psi)','AFM/MMF Units','Booster Pumps','Cart./Bag Housings','Filter Housings','Changed','Remarks',''].map((h, i) => (
                        <th key={i} className={cn('px-2 py-2 font-semibold whitespace-nowrap', i === 0 ? 'text-left px-3 w-[130px]' : i === 1 ? 'text-left w-[100px]' : i === 8 ? 'text-left' : i === 9 ? 'text-center w-[36px]' : 'text-right')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pagePreLogs.map((r: any, i: number) => {
                      const opName   = r._operatorName ?? 'Unknown';
                      const initials = opName !== 'Unknown' ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
                      return (
                        <tr key={r.id ?? i} className="border-t hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">
                            <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                            <div className="text-muted-foreground">{r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}</div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="h-5 w-5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-[9px] font-bold inline-flex items-center justify-center shrink-0">{initials}</span>
                              <span className="text-[11px] font-medium leading-tight truncate max-w-[80px]">{opName}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-[11px]">
                            {r.hpp_target_pressure_psi != null ? <span>{r.hpp_target_pressure_psi}<span className="text-muted-foreground/60 ml-0.5 text-[9px]">psi</span></span> : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-2 py-2 text-right">{pressurePills(r.afm_units ?? [])}</td>
                          <td className="px-2 py-2 text-right">{boosterPills(r.booster_pumps ?? [])}</td>
                          <td className="px-2 py-2 text-right">{pressurePills(r.cartridge_filter_housings ?? [], u => `H${u.unit}`)}</td>
                          <td className="px-2 py-2 text-right">{pressurePills(r.filter_housings ?? [], u => `F${u.unit}`)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[11px]">
                            {r.bag_filters_changed != null && r.bag_filters_changed > 0
                              ? <span className="text-amber-600 font-semibold">{r.bag_filters_changed}</span>
                              : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-2 py-2 text-[11px] text-muted-foreground max-w-[150px] truncate">{r.remarks || ''}</td>
                          <td className="px-2 py-2 text-center">
                            {canEditEntry(r, isManager, activeOperator?.id) ? (
                              <button onClick={() => setEditingPretreatRow(r)} title="Edit reading" aria-label="Edit reading"
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                                <Pencil className="h-3 w-3" />
                              </button>
                            ) : !isManager && activeOperator?.id && (
                              <button
                                onClick={() => setCorrectionTarget({
                                  id: r.id, sourceTable: 'ro_train_readings',
                                  plantId: r.plant_id ?? '', entityName: `${trainLabel} (pre-treatment)`,
                                  currentReading: r.hpp_target_pressure_psi ?? 0,
                                  previousReading: null, dailyVolume: null,
                                  readingDatetime: r.reading_datetime ?? new Date().toISOString(),
                                })}
                                title="Request correction" aria-label="Request correction"
                                className="p-1 rounded hover:bg-amber-50 text-muted-foreground/40 hover:text-amber-600 transition-colors">
                                <MessageSquarePlus className="h-3 w-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })())}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/20 shrink-0">
              <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-3 w-3" />Prev</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Piece 3: RO import — pre-scoped to this train.
          NOTE: dateRange is intentionally not passed here — there is no
          detected-gap data source yet (see ro-train-gap-correction-plan-v2.md
          §5, ro_train_data_gaps) for this modal to read a window from. This is
          a train-scoped import today, not yet a gap-scoped one. Once a gap
          table/detection job exists, thread its window through here. */}
      {showImportRO && (
        <ImportROReadingsDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          trainId={trainId}
          trainLabel={trainLabel}
          onClose={() => setShowImportRO(false)}
          onImported={() => {
            setShowImportRO(false);
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {/* Piece 4: Pre-Treatment import — pre-scoped to this train */}
      {showImportPretreat && (
        <ImportPretreatReadingsDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          trainId={trainId}
          trainLabel={trainLabel}
          onClose={() => setShowImportPretreat(false)}
          onImported={() => {
            setShowImportPretreat(false);
            qc.invalidateQueries({ queryKey: preQueryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {editingRoRow && (
        <EditRoReadingDialog
          row={editingRoRow} trainId={trainId}
          onClose={() => setEditingRoRow(null)}
          onSaved={() => { setEditingRoRow(null); qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: ['ro-overview'] }); }}
        />
      )}
      {editingPretreatRow && (
        <EditPretreatReadingDialog
          row={editingPretreatRow} trainId={trainId}
          onClose={() => setEditingPretreatRow(null)}
          onSaved={() => { setEditingPretreatRow(null); qc.invalidateQueries({ queryKey: preQueryKey }); qc.invalidateQueries({ queryKey: ['ro-overview'] }); }}
        />
      )}
      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget}
          onClose={() => setCorrectionTarget(null)}
          onSubmitted={() => { setCorrectionTarget(null); qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: preQueryKey }); }}
        />
      )}
    </>
  );
}
