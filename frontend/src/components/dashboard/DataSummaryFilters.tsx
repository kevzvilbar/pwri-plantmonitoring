import React from 'react';
import { CalendarDays, Activity, Droplet, Receipt, Gauge } from 'lucide-react';
import { SummaryTab } from './DataSummaryModal';

export interface DataSummaryFiltersProps {
  fromStr: string;
  toStr: string;
  setFromStr: (v: string) => void;
  setToStr: (v: string) => void;
  tab: SummaryTab;
  setTab: (t: SummaryTab) => void;
  currentSide: 'consumption' | 'production';
  setCurrentSide: (s: 'consumption' | 'production') => void;
  isLoading: boolean;
}

export function DataSummaryFilters({
  fromStr,
  toStr,
  setFromStr,
  setToStr,
  tab,
  setTab,
  currentSide,
  setCurrentSide,
  isLoading,
}: DataSummaryFiltersProps) {
  const todayStr = toStr;

  return (
    <>
      {/* ── Header ── */}
      <div className="px-5 pt-4 pb-3 border-b shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-base font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Data Summary
          </div>

          {/* Date range picker */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <input
              type="date"
              value={fromStr}
              max={toStr}
              onChange={(e) => e.target.value && setFromStr(e.target.value)}
              className="bg-transparent border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <span>→</span>
            <input
              type="date"
              value={toStr}
              min={fromStr}
              max={todayStr}
              onChange={(e) => e.target.value && setToStr(e.target.value)}
              className="bg-transparent border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>
      </div>

      {/* ── Option toggles: Prod. vs Consum. / Production / Consumption ── */}
      <div className="flex border-b shrink-0 px-5 bg-muted/20">
        {([
          { key: 'both' as SummaryTab,        label: 'Prod. vs Consum.',  icon: <Activity className="h-3 w-3" /> },
          { key: 'production' as SummaryTab,  label: 'Production',        icon: <Droplet  className="h-3 w-3" /> },
          { key: 'consumption' as SummaryTab, label: 'Consumption',       icon: <Receipt  className="h-3 w-3" /> },
          { key: 'current' as SummaryTab,     label: 'Current Readings',  icon: <Gauge    className="h-3 w-3" /> },
        ]).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              'px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            <span className="flex items-center gap-1.5">{icon}{label}</span>
          </button>
        ))}
      </div>

      {/* ── Current-Readings side toggle — OUTSIDE the scroll container so
           sticky thead is never displaced when scrolling horizontally. ── */}
      {!isLoading && tab === 'current' && (
        <div className="flex items-center gap-1 px-4 py-2 border-b bg-muted/10 shrink-0">
          <span className="text-2xs text-muted-foreground mr-1">Show:</span>
          {(['consumption', 'production'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setCurrentSide(s)}
              className={[
                'px-2.5 py-0.5 text-2xs rounded-full border transition-colors',
                currentSide === s
                  ? 'bg-primary text-primary-foreground border-primary font-semibold'
                  : 'border-border text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {s === 'consumption' ? 'Consumption' : 'Production'}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
