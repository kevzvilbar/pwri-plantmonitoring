import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { Loader2, BarChart2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { ReactNode } from 'react';

type OperatorLogTableProps = {
  trainLabel: string;
  logs: any[];
  pageLogs: any[];
  isLoading: boolean;
  error: any;
  togglingId: string | null;
  isManager: boolean;
  totalPages: number;
  page: number;
  todayStr: string;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  rangePreset: '7' | '30' | '90' | 'custom';
  setRangePreset: (v: '7' | '30' | '90' | 'custom') => void;
  fmtVal: (v: any, unit?: string) => ReactNode;
  onToggleMeterReplacement: (r: any) => void;
  onExport: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onRetry: () => void;
};

export function OperatorLogTable({
  trainLabel, logs, pageLogs, isLoading, error, togglingId, isManager,
  totalPages, page, todayStr, dateFrom, setDateFrom, dateTo, setDateTo,
  rangePreset, setRangePreset, fmtVal, onToggleMeterReplacement, onExport,
  onPrevPage, onNextPage, onRetry,
}: OperatorLogTableProps) {
  return (
    <>
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
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={onExport}>
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>
      </div>

      {/* ── Filters bar ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20 shrink-0 flex-wrap">
        {(['7','30','90'] as const).map((p) => (
          <button
            key={p}
            onClick={() => {
              const days = parseInt(p);
              setDateFrom(format(new Date(Date.now() - days * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
              setDateTo(todayStr);
              setRangePreset(p);
            }}
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
          onChange={e => { setDateFrom(e.target.value); setRangePreset('custom'); }}
          className="h-6 text-xs px-2 rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-muted-foreground text-xs">→</span>
        <input
          type="date" value={dateTo} min={dateFrom} max={todayStr}
          onChange={e => { setDateTo(e.target.value); setRangePreset('custom'); }}
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
          onRetry={onRetry}
        >
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-background border-b border-border/60 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
              <tr className="text-muted-foreground uppercase tracking-wide text-2xs">
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap w-[130px] sticky left-0 top-0 z-30 bg-background border-r border-border/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]">Date / Time</th>
                <th className="text-left px-2 py-2 font-semibold w-[110px] whitespace-nowrap">Operator</th>
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
                <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">Remarks</th>
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
                    className={cn(
                      'group border-b border-border/40 transition-colors',
                      isRepl ? 'bg-kpi-solar/40' : 'hover:bg-muted/40'
                    )}
                  >
                    {/* Date / Time */}
                    <td className={cn(
                      'px-3 py-2 whitespace-nowrap font-mono tabular-nums text-xs sticky left-0 z-10 border-r border-border/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                      isRepl ? 'bg-kpi-solar/40' : 'bg-background group-hover:bg-muted/40'
                    )}>
                      <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground text-3xs">{r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}</span>
                        {isRepl && (
                          <span className="text-3xs font-bold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">repl.</span>
                        )}
                      </div>
                    </td>
                    {/* Operator */}
                    <td className="px-2 py-2 text-left">
                      <div className="flex items-center gap-1.5">
                        <div className="h-5 w-5 rounded-full bg-primary-soft text-primary flex items-center justify-center text-3xs font-bold shrink-0">
                          {initials}
                        </div>
                        <span className="truncate max-w-[80px] block text-xs font-medium" title={opName}>{opName}</span>
                      </div>
                    </td>
                    {/* Flow */}
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.permeate_flow, 'm³/h')}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.feed_flow, 'm³/h')}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.reject_flow, 'm³/h')}</td>
                    {/* Pressure */}
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.feed_pressure_psi, 'psi')}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.reject_pressure_psi, 'psi')}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.suction_pressure_psi, 'psi')}</td>
                    {/* Quality */}
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.feed_tds, 'ppm')}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.permeate_tds, 'ppm')}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.reject_tds, 'ppm')}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.temperature_c, '°C')}</td>
                    {/* Recovery */}
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                      {r.recovery_pct != null
                        ? <span className="text-accent font-medium">{Number(r.recovery_pct).toFixed(1)}%</span>
                        : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    {/* Permeate meter */}
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs">{fmtVal(r.permeate_meter)}</td>
                    {/* Δ m³ */}
                    <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs">
                      {(() => {
                        const d = r._computed_delta ?? (r.permeate_meter_delta != null ? +r.permeate_meter_delta : null);
                        if (d == null) return <span className="text-muted-foreground/30">—</span>;
                        if (isRepl) return <span className="text-kpi-solar font-medium">0.00</span>;
                        return d > 0
                          ? <span className="text-primary font-semibold">+{d.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          : <span className="text-muted-foreground/40">0.00</span>;
                      })()}
                    </td>
                    {/* Meter replacement toggle */}
                    <td className="px-2 py-2 text-center whitespace-nowrap">
                      <button
                        title={isRepl ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ in chart)'}
                        aria-label={isRepl ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ in chart)'}
                        disabled={!isManager || isToggling}
                        onClick={() => onToggleMeterReplacement(r)}
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
                    <td className="px-2 py-2 text-left text-muted-foreground max-w-[140px] truncate text-xs" title={r.remarks ?? ''}>
                      {r.remarks ? <span title={r.remarks}>{r.remarks}</span> : <span className="text-muted-foreground/30">—</span>}
                    </td>
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
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page === 0} onClick={onPrevPage}>← Prev</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= totalPages - 1} onClick={onNextPage}>Next →</Button>
          </div>
        )}
      </div>
    </>
  );
}
