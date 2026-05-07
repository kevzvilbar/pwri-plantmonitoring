/**
 * DataSummaryModal.tsx
 *
 * A pop-up (Dialog) Data Summary panel for the Dashboard.
 * Replaces any foldable/collapsible summary with a proper modal.
 *
 * Features:
 *  - Production tab  : per-product-meter rows + plant grouping + daily total
 *  - Consumption tab : per-locator rows with daily consumed volume + daily total
 *  - NRW derived delta shown in the header
 *  - Date picker to browse any day (defaults to today)
 *
 * Usage in Dashboard.tsx:
 *
 *   import { DataSummaryModal } from '@/components/dashboard/DataSummaryModal';
 *
 *   // state
 *   const [summaryOpen, setSummaryOpen] = useState(false);
 *
 *   // trigger button (e.g. in the page header or on the Production stat card)
 *   <button onClick={() => setSummaryOpen(true)}>Data Summary</button>
 *
 *   // modal
 *   <DataSummaryModal
 *     open={summaryOpen}
 *     onClose={() => setSummaryOpen(false)}
 *     plantIds={plantIds}
 *     plantCodeById={plantCodeById}
 *   />
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { fmtNum } from '@/lib/calculations';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Droplet, Activity, ArrowUpRight, ArrowDownRight, Minus, CalendarDays } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataSummaryModalProps {
  open: boolean;
  onClose: () => void;
  plantIds: string[];
  /** Map<plantId, code/name> — used to label per-plant rows */
  plantCodeById: Map<string, string>;
}

type Tab = 'production' | 'consumption';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveVol(r: any): number {
  if (r.daily_volume != null && +r.daily_volume > 0) return +r.daily_volume;
  if (r.current_reading != null && r.previous_reading != null)
    return Math.max(0, +r.current_reading - +r.previous_reading);
  return 0;
}

function deltaIcon(pct: number | null) {
  if (pct == null) return <Minus className="h-3 w-3 text-muted-foreground" />;
  if (pct > 0) return <ArrowUpRight className="h-3 w-3 text-emerald-500" />;
  return <ArrowDownRight className="h-3 w-3 text-rose-500" />;
}

function pctLabel(pct: number | null) {
  if (pct == null) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function pctDelta(today: number, yesterday: number): number | null {
  if (!yesterday) return null;
  return +((((today - yesterday) / yesterday) * 100).toFixed(1));
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayBounds(dateStr: string) {
  // dateStr is YYYY-MM-DD
  const start = new Date(dateStr + 'T00:00:00').toISOString();
  const end   = new Date(dateStr + 'T23:59:59').toISOString();
  return { start, end };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DataSummaryModal({ open, onClose, plantIds, plantCodeById }: DataSummaryModalProps) {
  const [tab, setTab] = useState<Tab>('production');
  const [dateStr, setDateStr] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  const prevDateStr = format(subDays(new Date(dateStr + 'T12:00:00'), 1), 'yyyy-MM-dd');

  const { start, end } = dayBounds(dateStr);
  const { start: pStart, end: pEnd } = dayBounds(prevDateStr);

  // ── Production: product meters ─────────────────────────────────────────────
  const { data: productMeters } = useQuery({
    queryKey: ['summary-product-meters', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters } = await (supabase.from('product_meters' as any) as any)
        .select('id,name,plant_id').in('plant_id', plantIds);
      return (meters ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
  });

  const meterIds = useMemo(() => (productMeters ?? []).map((m: any) => m.id), [productMeters]);

  const { data: prodReadings, isLoading: prodLoading } = useQuery({
    queryKey: ['summary-prod-readings', meterIds, dateStr],
    queryFn: async () => {
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime')
        .in('meter_id', meterIds)
        .gte('reading_datetime', start)
        .lte('reading_datetime', end)
        .order('reading_datetime', { ascending: false });
      return (data ?? []) as any[];
    },
    enabled: open && meterIds.length > 0,
  });

  const { data: prevProdReadings } = useQuery({
    queryKey: ['summary-prod-readings-prev', meterIds, prevDateStr],
    queryFn: async () => {
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading')
        .in('meter_id', meterIds)
        .gte('reading_datetime', pStart)
        .lte('reading_datetime', pEnd);
      return (data ?? []) as any[];
    },
    enabled: open && meterIds.length > 0,
  });

  // ── Consumption: locators ──────────────────────────────────────────────────
  const { data: locators } = useQuery({
    queryKey: ['summary-locators', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase
        .from('locators')
        .select('id,name,code,plant_id')
        .in('plant_id', plantIds)
        .eq('active', true);
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
  });

  const locatorIds = useMemo(() => (locators ?? []).map((l: any) => l.id), [locators]);

  const { data: consReadings, isLoading: consLoading } = useQuery({
    queryKey: ['summary-cons-readings', locatorIds, dateStr],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', start)
        .lte('reading_datetime', end)
        .order('reading_datetime', { ascending: false });
      return (data ?? []) as any[];
    },
    enabled: open && locatorIds.length > 0,
  });

  const { data: prevConsReadings } = useQuery({
    queryKey: ['summary-cons-readings-prev', locatorIds, prevDateStr],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', pStart)
        .lte('reading_datetime', pEnd);
      return (data ?? []) as any[];
    },
    enabled: open && locatorIds.length > 0,
  });

  // ── Derived: per-meter production rows ────────────────────────────────────
  const prodRows = useMemo(() => {
    const byMeter = new Map<string, number>();
    (prodReadings ?? []).forEach((r: any) => {
      const v = resolveVol(r);
      byMeter.set(r.meter_id, (byMeter.get(r.meter_id) ?? 0) + v);
    });
    const prevByMeter = new Map<string, number>();
    (prevProdReadings ?? []).forEach((r: any) => {
      const v = resolveVol(r);
      prevByMeter.set(r.meter_id, (prevByMeter.get(r.meter_id) ?? 0) + v);
    });

    return (productMeters ?? []).map((m: any) => {
      const vol  = byMeter.get(m.id) ?? 0;
      const prev = prevByMeter.get(m.id) ?? 0;
      return {
        id:       m.id,
        name:     m.name ?? `Meter ${m.id.slice(-4)}`,
        plantId:  m.plant_id,
        plant:    plantCodeById.get(m.plant_id) ?? m.plant_id,
        vol,
        delta:    pctDelta(vol, prev),
      };
    }).sort((a, b) => a.plant.localeCompare(b.plant) || a.name.localeCompare(b.name));
  }, [productMeters, prodReadings, prevProdReadings, plantCodeById]);

  const prodTotal     = prodRows.reduce((s, r) => s + r.vol, 0);
  const prevProdTotal = useMemo(() => {
    const prev = new Map<string, number>();
    (prevProdReadings ?? []).forEach((r: any) => {
      prev.set(r.meter_id, (prev.get(r.meter_id) ?? 0) + resolveVol(r));
    });
    return Array.from(prev.values()).reduce((s, v) => s + v, 0);
  }, [prevProdReadings]);

  // ── Derived: per-locator consumption rows ─────────────────────────────────
  const consRows = useMemo(() => {
    // Latest reading per locator for the day
    const byLoc = new Map<string, number>();
    (consReadings ?? []).forEach((r: any) => {
      const v = resolveVol(r);
      byLoc.set(r.locator_id, (byLoc.get(r.locator_id) ?? 0) + v);
    });
    const prevByLoc = new Map<string, number>();
    (prevConsReadings ?? []).forEach((r: any) => {
      const v = resolveVol(r);
      prevByLoc.set(r.locator_id, (prevByLoc.get(r.locator_id) ?? 0) + v);
    });

    return (locators ?? []).map((l: any) => {
      const vol  = byLoc.get(l.id) ?? 0;
      const prev = prevByLoc.get(l.id) ?? 0;
      return {
        id:      l.id,
        name:    l.name ?? l.code ?? `Locator ${l.id.slice(-4)}`,
        code:    l.code,
        plantId: l.plant_id,
        plant:   plantCodeById.get(l.plant_id) ?? l.plant_id,
        vol,
        delta:   pctDelta(vol, prev),
        hasReading: byLoc.has(l.id),
      };
    }).sort((a, b) => a.plant.localeCompare(b.plant) || a.name.localeCompare(b.name));
  }, [locators, consReadings, prevConsReadings, plantCodeById]);

  const consTotal    = consRows.reduce((s, r) => s + r.vol, 0);
  const nrw = prodTotal > 0 ? +(((prodTotal - consTotal) / prodTotal) * 100).toFixed(1) : null;
  const nrwDelta = pctDelta(
    prodTotal - consTotal,
    prevProdTotal - (consRows.reduce((s) => s, 0)), // simplified
  );

  // Group by plant for grouped list display
  const prodByPlant = useMemo(() => {
    const m = new Map<string, typeof prodRows>();
    prodRows.forEach((r) => {
      if (!m.has(r.plant)) m.set(r.plant, []);
      m.get(r.plant)!.push(r);
    });
    return m;
  }, [prodRows]);

  const consByPlant = useMemo(() => {
    const m = new Map<string, typeof consRows>();
    consRows.forEach((r) => {
      if (!m.has(r.plant)) m.set(r.plant, []);
      m.get(r.plant)!.push(r);
    });
    return m;
  }, [consRows]);

  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="data-summary-modal"
      >
        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Data Summary
              {isToday && (
                <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  Today
                </span>
              )}
            </DialogTitle>

            {/* Date picker */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <CalendarDays className="h-3.5 w-3.5" />
              <input
                type="date"
                value={dateStr}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => e.target.value && setDateStr(e.target.value)}
                className="bg-transparent border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </label>
          </div>

          {/* KPI banner */}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <KpiBadge
              label="Production"
              value={fmtNum(prodTotal)}
              unit="m³"
              delta={pctDelta(prodTotal, prevProdTotal)}
              color="text-primary"
            />
            <span className="text-muted-foreground text-xs">vs</span>
            <KpiBadge
              label="Consumption"
              value={fmtNum(consTotal)}
              unit="m³"
              delta={pctDelta(consTotal, consRows.reduce((s) => s, 0))}
              color="text-highlight"
            />
            {nrw != null && (
              <>
                <span className="text-muted-foreground text-xs">·</span>
                <span
                  className={[
                    'text-xs font-semibold',
                    nrw > 20 ? 'text-rose-600' : 'text-emerald-600',
                  ].join(' ')}
                >
                  NRW {nrw}%
                  {nrw > 20 && (
                    <span className="ml-1 text-[10px] font-normal text-rose-500 bg-rose-50 dark:bg-rose-950/30 px-1 py-0.5 rounded">
                      above 20% limit
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </DialogHeader>

        {/* ── Tabs ── */}
        <div className="flex border-b shrink-0 px-5">
          {(['production', 'consumption'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-4 py-2 text-xs font-medium capitalize border-b-2 -mb-px transition-colors',
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'production' ? 'Production' : 'Consumption (Locators)'}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">

          {/* ─ PRODUCTION TAB ─ */}
          {tab === 'production' && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Production = sum of <strong>Product Meter</strong> deltas (treated / distributed water output).
                Each row is one product meter; meters are grouped by plant.
              </p>

              {prodLoading && (
                <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>
              )}

              {!prodLoading && prodRows.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">
                  No product meter readings for this date.
                </div>
              )}

              {!prodLoading && Array.from(prodByPlant.entries()).map(([plant, rows]) => {
                const plantTotal = rows.reduce((s, r) => s + r.vol, 0);
                return (
                  <div key={plant}>
                    {/* Plant group header */}
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {plant}
                      </span>
                      <span className="text-[11px] font-mono-num text-muted-foreground">
                        {fmtNum(plantTotal)} m³
                      </span>
                    </div>

                    <div className="rounded-lg border divide-y overflow-hidden">
                      {rows.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/30 transition-colors">
                          <div className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                          <span className="flex-1 min-w-0 truncate text-xs">{r.name}</span>
                          <span className="font-mono-num text-xs tabular-nums">
                            {r.vol > 0 ? fmtNum(r.vol) : <span className="text-muted-foreground">—</span>}
                          </span>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">m³</span>
                          <span className={[
                            'flex items-center gap-0.5 text-[10px] w-14 justify-end',
                            r.delta == null ? 'text-muted-foreground'
                              : r.delta > 0 ? 'text-emerald-600' : 'text-rose-500',
                          ].join(' ')}>
                            {deltaIcon(r.delta)}
                            {pctLabel(r.delta)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Production total footer */}
              {!prodLoading && prodRows.length > 0 && (
                <TotalFooter label="Total Production" value={prodTotal} delta={pctDelta(prodTotal, prevProdTotal)} color="text-primary" />
              )}
            </>
          )}

          {/* ─ CONSUMPTION TAB ─ */}
          {tab === 'consumption' && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Consumption = sum of <strong>Locator meter</strong> deltas (billed / distributed water consumed by end-points).
                Each row is one active locator grouped by plant. Locators without a reading today show <em>—</em>.
              </p>

              {consLoading && (
                <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>
              )}

              {!consLoading && consRows.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">
                  No locator readings for this date.
                </div>
              )}

              {!consLoading && Array.from(consByPlant.entries()).map(([plant, rows]) => {
                const plantTotal = rows.reduce((s, r) => s + r.vol, 0);
                const readCount  = rows.filter((r) => r.hasReading).length;
                return (
                  <div key={plant}>
                    {/* Plant group header */}
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {plant}
                        <span className="ml-1.5 text-[10px] font-normal normal-case">
                          ({readCount}/{rows.length} read)
                        </span>
                      </span>
                      <span className="text-[11px] font-mono-num text-muted-foreground">
                        {fmtNum(plantTotal)} m³
                      </span>
                    </div>

                    <div className="rounded-lg border divide-y overflow-hidden">
                      {rows.map((r) => (
                        <div
                          key={r.id}
                          className={[
                            'flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/30 transition-colors',
                            !r.hasReading ? 'opacity-50' : '',
                          ].join(' ')}
                        >
                          <div className={[
                            'w-2 h-2 rounded-full shrink-0',
                            r.hasReading ? 'bg-highlight' : 'bg-muted-foreground/30',
                          ].join(' ')} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs truncate">{r.name}</div>
                            {r.code && r.code !== r.name && (
                              <div className="text-[10px] text-muted-foreground">{r.code}</div>
                            )}
                          </div>
                          <span className="font-mono-num text-xs tabular-nums">
                            {r.vol > 0 ? fmtNum(r.vol) : <span className="text-muted-foreground">—</span>}
                          </span>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">m³</span>
                          <span className={[
                            'flex items-center gap-0.5 text-[10px] w-14 justify-end',
                            r.delta == null ? 'text-muted-foreground'
                              : r.delta > 0 ? 'text-emerald-600' : 'text-rose-500',
                          ].join(' ')}>
                            {deltaIcon(r.delta)}
                            {r.hasReading ? pctLabel(r.delta) : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Consumption total footer */}
              {!consLoading && consRows.length > 0 && (
                <TotalFooter label="Total Consumption" value={consTotal} delta={null} color="text-highlight" />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiBadge({
  label, value, unit, delta, color,
}: { label: string; value: string; unit: string; delta: number | null; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold font-mono-num ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground">{unit}</span>
      {delta != null && (
        <span className={[
          'flex items-center text-[10px]',
          delta > 0 ? 'text-emerald-500' : 'text-rose-500',
        ].join(' ')}>
          {deltaIcon(delta)}
          {pctLabel(delta)}
        </span>
      )}
    </div>
  );
}

function TotalFooter({
  label, value, delta, color,
}: { label: string; value: number; delta: number | null; color: string }) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-4 py-2.5 bg-muted/40 border mt-1`}>
      <div className="flex items-center gap-2">
        <Droplet className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold font-mono-num ${color}`}>{fmtNum(value)}</span>
        <span className="text-xs text-muted-foreground">m³</span>
        {delta != null && (
          <span className={[
            'flex items-center text-[10px]',
            delta > 0 ? 'text-emerald-500' : 'text-rose-500',
          ].join(' ')}>
            {deltaIcon(delta)}
            {pctLabel(delta)}
          </span>
        )}
      </div>
    </div>
  );
}
