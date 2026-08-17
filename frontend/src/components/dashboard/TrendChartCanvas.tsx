// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This is the actual <ResponsiveContainer> chart body: one
// big conditional tree picking between chart types/series depending on
// metric + drill mode/granularity (by-train RO drilldown, by-hour RO
// drilldown, kwh stacked bars, Plant Health, Raw Water, Permeate TDS, the
// default production/recovery/NRW/cost view, and their own drilldown
// variants). Every branch is a pure function of the props below — no
// state, no queries, no memoization of its own.
//
// Moved verbatim from TrendChart.tsx — no logic or markup changes, only
// the props needed to reach the free variables it already used.
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ComposedChart, Bar, BarChart, ReferenceLine, Area, AreaChart,
} from 'recharts';
import { C_PRODUCTION, C_CONSUMPTION, C_NRW, C_RAWWATER, C_RECOVERY, C_TDS, C_GRID_PV } from '@/lib/chartColors';
import { makeDrillableBarShape } from './TrendChartDrillKit';

export function TrendChartCanvas(props: Record<string, any>) {
  const {
    hasRoDrill, roDrillMode, viewGran, roTrainDrillData, roHourDrillData,
    hasConsumptionDrill, hasPlantHealth, phDrillMode, phActiveData, phDayFocus,
    metric, drillMode, chartData, trendRows, kwhChartRows, kwhSource,
    entityRows, visibleEntities, wellEntityRows, visibleWellEntities, visibleTrainEntities,
    focusedTrendRows, focusedEntityRows, drillFocusRange,
    formatYAxis, handleDrillBarActivate, handlePhDayDotActivate,
    handleLegendIsolate, handleTrainLegendIsolate, handleWellLegendIsolate,
    NegativeAwareTooltip, PvTooltip, valueKey, roUnit,
    showTotalCostLine, showPowerCostLine, showChemCostLine,
    stackMode, rawwaterBreakdown, viewBreakdown, prodDrillSource,
  } = props;
  return (
        <ResponsiveContainer width="100%" height="100%">
          {(hasRoDrill && roDrillMode === 'by-train' && viewGran === 'daily') ? (
            <LineChart data={roTrainDrillData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? `${v} ${roUnit}` : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleTrainLegendIsolate}
              />
              {visibleTrainEntities.map(({ id, label, color }) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : (hasRoDrill && roDrillMode === 'by-train') ? (
            // Weekly/Monthly (M4, deferred item now shipped) — per-train
            // averages are volume-weighted by that bucket's sample count
            // (see roTrainDrillData), rendered as grouped-or-stacked bars
            // with the same Stack/Group toggle and partial-bucket styling
            // the Production/NRW breakdown uses.
            <ComposedChart
              data={drillFocusRange ? roTrainDrillData.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey) : roTrainDrillData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? `${v} ${roUnit}` : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleTrainLegendIsolate}
              />
              {visibleTrainEntities.map(({ id, label, color }) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={label}
                  fill={color}
                  maxBarSize={28}
                  radius={[3, 3, 0, 0]}
                  stackId={stackMode === 'stacked' ? 'trains' : undefined}
                  shape={makeDrillableBarShape(
                    handleDrillBarActivate,
                    (p) => `Drill into ${p.date as string}`,
                  )}
                />
              ))}
            </ComposedChart>
          ) : (hasRoDrill && roDrillMode === 'by-hour') ? (
            <AreaChart data={roHourDrillData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="hourlyDrillFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={metric === 'tds' ? C_TDS : C_RECOVERY} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={metric === 'tds' ? C_TDS : C_RECOVERY} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fontWeight: 500 }}
                stroke="hsl(var(--muted-foreground))"
                interval={Math.max(0, Math.floor(roHourDrillData.length / 12) - 1)}
                angle={-35}
                textAnchor="end"
                height={48}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any) => [v != null ? `${v} ${roUnit}` : '—', metric === 'tds' ? 'Avg TDS' : 'Avg Recovery']}
                labelFormatter={(label) => label}
              />
              <Area
                type="monotone"
                dataKey="value"
                name={metric === 'tds' ? 'Avg TDS (ppm)' : 'Avg Recovery (%)'}
                stroke={metric === 'tds' ? C_TDS : C_RECOVERY}
                strokeWidth={2.5}
                fill="url(#hourlyDrillFill)"
                dot={false}
                connectNulls
              />
            </AreaChart>
          ) : (hasConsumptionDrill && drillMode === 'drilldown' && viewGran === 'daily') ? (
            // Daily — 5+ entities × 30 daily bars is noisy as bars, so this
            // stays line-based regardless of the Weekly/Monthly bar switch below.
            <ComposedChart data={focusedEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleLegendIsolate}
              />
              {visibleEntities.map(({ id, label, color }) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          ) : (hasConsumptionDrill && drillMode === 'drilldown') ? (
            // Weekly/Monthly — bars, grouped or stacked per the Stack/Group
            // toggle (M2). Bars are keyboard-focusable and clicking one
            // drills into that bucket at the next-finer granularity (M3);
            // partial edge buckets render with reduced opacity + a dashed
            // outline instead of looking like a genuine low-volume period.
            <ComposedChart data={focusedEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleLegendIsolate}
              />
              {visibleEntities.map(({ id, label, color }) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={label}
                  fill={color}
                  maxBarSize={28}
                  radius={[3, 3, 0, 0]}
                  stackId={stackMode === 'stacked' ? 'entities' : undefined}
                  shape={makeDrillableBarShape(
                    handleDrillBarActivate,
                    (payload) => `Drill into ${payload.date as string ?? label}`,
                  )}
                />
              ))}
            </ComposedChart>
          ) : metric === 'nrw' ? (
            // Total (non-drilled) NRW view — Production/Consumption bars +
            // NRW% line, from focusedTrendRows so Weekly/Monthly (M1/M4) and
            // a drill-in focus window (M3) both apply. Grouped by default;
            // Stack toggle (M2) collapses the two into one total-input bar.
            // Bars are click-to-drill: Monthly→that month's weeks,
            // Weekly→that week's days, Daily→opens the by-locator breakdown.
            <ComposedChart data={focusedTrendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis yAxisId="vol" tick={{ fontSize: 10 }} stroke={C_PRODUCTION} tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} stroke={C_NRW} width={32} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Bar
                yAxisId="vol" dataKey="production" fill={C_PRODUCTION} name="Production (m³)" radius={[3, 3, 0, 0]} maxBarSize={32}
                stackId={stackMode === 'stacked' ? 'nrw' : undefined}
                shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
              />
              <Bar
                yAxisId="vol" dataKey="consumption" fill={C_CONSUMPTION} name="Consumption (m³)" radius={[3, 3, 0, 0]} maxBarSize={32}
                stackId={stackMode === 'stacked' ? 'nrw' : undefined}
                shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
              />
              <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke={C_NRW} strokeWidth={2.5} dot={{ r: 3.5, fill: C_NRW, strokeWidth: 0 }} name="NRW %" connectNulls />
            </ComposedChart>
          ) : metric === 'chemCost' ? (
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="chemCostFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="hsl(var(--highlight))" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="hsl(var(--highlight))" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--highlight))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2.5} fill="url(#chemCostFill)" dot={false} name="Chemical Cost (₱)" connectNulls />
            </AreaChart>
          ) : metric === 'powerCost' ? (
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="powerCostFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="hsl(var(--chart-6))" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="hsl(var(--chart-6))" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--chart-6))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2.5} fill="url(#powerCostFill)" dot={false} name="Power Cost (₱)" connectNulls />
            </AreaChart>
          ) : (metric === 'productionCost' && stackMode === 'stacked') ? (
            // Production Cost — stacked composition view (M2): "the best
            // stacking candidate on the dashboard" per the plan — Power +
            // Chem stacked so the bar height IS the total cost, instead of
            // three overlaid lines the eye has to add up. Weekly/Monthly
            // (M4) via trendRows' volume-weighted powerCost/chemCost avg.
            <BarChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--accent))" tickFormatter={(v) => `₱${formatYAxis(v)}`} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? `₱${(+v).toFixed(4)}/m³` : '—', name]}
              />
              {showPowerCostLine && (
                <Bar dataKey="powerCost" name="Power (₱/m³)" fill="hsl(var(--chart-6))" stackId="cost" radius={[0, 0, 0, 0]} maxBarSize={32} />
              )}
              {showChemCostLine && (
                <Bar dataKey="chemCost" name="Chem (₱/m³)" fill="hsl(var(--highlight))" stackId="cost" radius={[3, 3, 0, 0]} maxBarSize={32} />
              )}
            </BarChart>
          ) : metric === 'productionCost' ? (
            // Production Cost — all lines as ₱/m³ (unit cost per cubic metre):
            //   Prod Cost  = Power Cost + Chem Cost          (teal, always visible)
            //   Power Cost = daily_kwh × rate_per_kwh / m³  (blue, toggle: Power ₱)
            //   Chem Cost  = chem_cost_₱ / m³               (orange, toggle: Chem ₱)
            // Single ₱/m³ Y-axis — all lines share the same scale.
            // Points gap (null) when production = 0 or no tariff is configured.
            // ─ Where does rate_per_kwh come from? ────────────────────────────────
            //   Costs → Power tab: each monthly bill entry auto-derives a tariff row
            //   (total_amount ÷ kWh). That rate is stored in power_tariffs and looked
            //   up here using the latest effective_date ≤ each reading's date.
            // trendRows (not chartData) so Weekly/Monthly (M4) apply — powerCost/
            // chemCost/totalCost are volume-weighted averages, not naive means
            // (see TREND_FIELD_AGG).
            <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--accent))"
                tickFormatter={(v) => `₱${formatYAxis(v)}`}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [
                  v != null ? `₱${(+v).toFixed(4)}/m³` : '—',
                  name,
                ]}
              />
              {showTotalCostLine && (
                <Line type="monotone" dataKey="totalCost" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 2 }} name="Prod Cost (₱/m³)" connectNulls />
              )}
              {showPowerCostLine && (
                <Line type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (₱/m³)" connectNulls />
              )}
              {showChemCostLine && (
                <Line type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2} dot={false} name="Chem (₱/m³)" connectNulls />
              )}
            </LineChart>
          ) : metric === 'pv' ? (
            // PV Ratio — two lines: Grid-only PV and (Grid+Solar) PV.
            // PvTooltip and domain are defined/hoisted above the return().
            // trendRows (not chartData) so Weekly/Monthly (M4) apply.
            <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke={C_GRID_PV}
                width={44}
                axisLine={false}
                tickLine={false}
                domain={[
                  0,
                  (dataMax: number) => {
                    // For small PV ratios (e.g. 0.4–1.5 kWh/m³), 'auto' may give
                    // a too-large max. Round up to the nearest sensible tick.
                    if (dataMax <= 0) return 2;
                    if (dataMax < 1)  return Math.ceil(dataMax * 10) / 10 + 0.1;
                    if (dataMax < 4)  return Math.ceil(dataMax * 4)  / 4;
                    return Math.ceil(dataMax);
                  },
                ]}
                tickCount={6}
                tickFormatter={(v) => +v.toFixed(2) === 0 ? '0' : v.toFixed(v < 1 ? 2 : 1)}
              />
              <Tooltip content={<PvTooltip />} />
              <Line
                type="monotone"
                dataKey={(d: any) => d.production > 0 ? +(d.kwh / d.production).toFixed(2) : null}
                stroke={C_GRID_PV}
                strokeWidth={2.5}
                dot={false}
                name="Grid PV (kWh/m³)"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey={(d: any) => d.production > 0 && (d.kwh + d.solarKwh) > 0
                  ? +((d.kwh + d.solarKwh) / d.production).toFixed(2)
                  : null}
                stroke={C_PRODUCTION}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                name="(Grid+Solar) PV (kWh/m³)"
                connectNulls
              />
            </LineChart>
          ) : metric === 'kwh' ? (
            // ── Power Consumption & Energy Mix ────────────────────────────────────
            // Uses kwhChartRows (source-filtered useMemo) so zero-value bars are
            // never emitted. hasSolarData/hasGridData guards mirror PowerChart exactly.
            (() => {
              const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
              const hasGridData  = chartData.some((d: any) => (d.kwh      ?? 0) > 0);

              // Rich tooltip: shows Solar, Grid, Total, and Solar % in one popover
              const KwhTooltip = ({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const solarVal = payload.find((p: any) => p.dataKey === 'solarKwh')?.value ?? 0;
                const gridVal  = payload.find((p: any) => p.dataKey === 'gridKwh')?.value  ?? 0;
                const total    = solarVal + gridVal;
                const pct      = total > 0 ? ((solarVal / total) * 100).toFixed(1) : null;
                const fmt      = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
                return (
                  <div style={{
                    background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                    borderRadius: 8, fontSize: 11, padding: '8px 10px',
                    minWidth: 160, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
                  }}>
                    <p style={{ margin: '0 0 5px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>{label}</p>
                    {hasSolarData && kwhSource !== 'grid' && solarVal > 0 && (
                      <p style={{ margin: '1px 0', color: 'hsl(48,96%,40%)' }}>
                        ☀ Solar: <strong>{fmt(solarVal)} kWh</strong>
                      </p>
                    )}
                    {hasGridData && kwhSource !== 'solar' && gridVal > 0 && (
                      <p style={{ margin: '1px 0', color: 'hsl(213,94%,55%)' }}>
                        ⚡ Grid: <strong>{fmt(gridVal)} kWh</strong>
                      </p>
                    )}
                    {total > 0 && (
                      <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
                        <p style={{ margin: '1px 0', color: 'hsl(var(--foreground))', fontWeight: 600 }}>
                          Total: {fmt(total)} kWh
                        </p>
                        {pct && hasSolarData && kwhSource === 'both' && (
                          <p style={{ margin: '2px 0 0', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
                            Solar: <span style={{ color: 'hsl(48,96%,40%)', fontWeight: 600 }}>{pct}%</span> of mix
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <ComposedChart
                  data={kwhChartRows}
                  margin={{ top: 8, right: 8, left: -8, bottom: 20 }}
                  barSize={Math.max(3, Math.min(18, 400 / Math.max(kwhChartRows.length, 1)))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    angle={-30}
                    textAnchor="end"
                    height={36}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={formatYAxis}
                    width={44}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<KwhTooltip />} />
                  {/* Solar — base of stack (or left bar when grouped), no rounded corners */}
                  {hasSolarData && kwhSource !== 'grid' && (
                    <Bar dataKey="solarKwh" name="☀ Solar (kWh)" fill="hsl(48,96%,53%)"
                      stackId={stackMode === 'stacked' ? 'kwh' : undefined}
                      radius={stackMode === 'stacked' ? [0, 0, 0, 0] : [3, 3, 0, 0]} />
                  )}
                  {/* Grid — top of stack (or right bar when grouped), rounded upper corners */}
                  {hasGridData && kwhSource !== 'solar' && (
                    <Bar dataKey="gridKwh"  name="⚡ Grid (kWh)"  fill="hsl(213,94%,68%)"
                      stackId={stackMode === 'stacked' ? 'kwh' : undefined}
                      radius={[3, 3, 0, 0]} />
                  )}
                </ComposedChart>
              );
            })()
          ) : hasPlantHealth ? (
            // ── Plant Health — % of trains Online per slot ───────────────────────
            // Color zones: ≥80% emerald, ≥50% amber, <50% rose.
            // Tooltip shows online/offline counts + named offline trains.
            (() => {
              const PhTooltip = ({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const row = phActiveData.find((d) => d.date === label);
                if (!row) return null;
                const pct = row.healthPct ?? 0;
                const dotColor = pct >= 80 ? 'hsl(var(--accent))' : pct >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';
                return (
                  <div style={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8, fontSize: 11, padding: '8px 10px',
                    minWidth: 170, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
                  }}>
                    <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
                    <p style={{ margin: '1px 0', color: dotColor, fontWeight: 700 }}>
                      Health: {pct != null ? `${pct}%` : '—'}
                    </p>
                    {row.onlineCount != null && (
                      <>
                        <p style={{ margin: '1px 0', color: 'hsl(var(--accent))' }}>
                          ● Online: {row.onlineCount} / {row.totalTrains}
                        </p>
                        <p style={{ margin: '1px 0', color: 'hsl(var(--danger))' }}>
                          ● Offline: {row.offlineCount}
                        </p>
                      </>
                    )}
                    {row.offlineTrains.length > 0 && (
                      <div style={{
                        marginTop: 6, paddingTop: 5,
                        borderTop: '1px solid hsl(var(--border))',
                      }}>
                        <p style={{ margin: '0 0 3px', fontSize: 10, fontWeight: 600, color: 'hsl(var(--danger))' }}>
                          Offline trains:
                        </p>
                        {row.offlineTrains.map((name) => (
                          <p key={name} style={{ margin: '1px 0', fontSize: 10, color: 'hsl(var(--danger))', opacity: 0.85 }}>
                            · {name}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              };

              // Color each dot by health zone
              const dotFill = (entry: any) => {
                const p = entry?.healthPct ?? 0;
                return p >= 80 ? 'hsl(var(--accent))' : p >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';
              };

              return (
                <ComposedChart data={phActiveData} margin={{ top: 8, right: 8, left: 0, bottom: phDrillMode === 'hourly' ? 32 : 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: phDrillMode === 'hourly' ? 8 : 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    angle={phDrillMode === 'hourly' ? -35 : 0}
                    textAnchor={phDrillMode === 'hourly' ? 'end' : 'middle'}
                    height={phDrillMode === 'hourly' ? 48 : 20}
                    interval={phDrillMode === 'hourly'
                      ? Math.max(0, Math.floor(phActiveData.length / 12) - 1)
                      : 'preserveStartEnd'}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    width={44}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<PhTooltip />} />
                  {/* ── Green zone ≥80% ── */}
                  <ReferenceLine y={80} stroke="hsl(var(--accent))" strokeDasharray="4 3" strokeWidth={1}
                    label={{ value: '80%', position: 'right', fontSize: 9, fill: 'hsl(var(--accent))' }} />
                  {/* ── Amber zone ≥50% ── */}
                  <ReferenceLine y={50} stroke="hsl(var(--warn))" strokeDasharray="4 3" strokeWidth={1}
                    label={{ value: '50%', position: 'right', fontSize: 9, fill: 'hsl(var(--warn))' }} />
                  <Line
                    type="monotone"
                    dataKey="healthPct"
                    name="Plant Health (%)"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, payload } = props;
                      const fill = dotFill(payload);
                      // M3: Day→Hour click-drill. Only the Daily view's dots
                      // are drillable — Hourly has nowhere finer to go, and
                      // Weekly/Monthly rows carry no _slotKey (see
                      // buildPhHealthRows callers above), so
                      // handlePhDayDotActivate would no-op there anyway;
                      // gating on phDrillMode keeps the pointer/keyboard
                      // affordance from appearing where it wouldn't do
                      // anything.
                      const isDrillable = phDrillMode === 'daily' && !!payload?._slotKey;
                      if (!isDrillable) {
                        return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={fill} stroke={fill} />;
                      }
                      const activate = () => handlePhDayDotActivate(payload);
                      return (
                        <g key={`dot-${cx}-${cy}`}>
                          {/* Larger transparent hit target — the visible 3px
                              dot is too small to reliably click or tab to;
                              this widens the interactive area without
                              changing what's drawn. */}
                          <circle
                            cx={cx} cy={cy} r={9} fill="transparent"
                            role="button"
                            tabIndex={0}
                            aria-label={`Drill into ${(payload?.date as string) ?? 'this day'}'s hourly health`}
                            style={{ cursor: 'pointer', outline: 'none' }}
                            onClick={activate}
                            onKeyDown={(e: React.KeyboardEvent) => {
                              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
                            }}
                          />
                          <circle cx={cx} cy={cy} r={3} fill={fill} stroke={fill} pointerEvents="none" />
                        </g>
                      );
                    }}
                    stroke="hsl(var(--accent))"
                    connectNulls
                  />
                </ComposedChart>
              );
            })()
          ) : (metric === 'rawwater' && rawwaterBreakdown === 'by-well' && viewGran === 'daily') ? (
            // By-well breakdown — daily stays line-based, same reasoning as
            // the Production/NRW breakdown (a handful of wells × 30 daily
            // bars reads better as lines than bars).
            <ComposedChart data={wellEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleWellLegendIsolate}
              />
              {visibleWellEntities.map(({ id, label, color }) => (
                <Line key={id} type="monotone" dataKey={id} name={label} stroke={color} strokeWidth={2} dot={false} connectNulls />
              ))}
            </ComposedChart>
          ) : (metric === 'rawwater' && rawwaterBreakdown === 'by-well') ? (
            // Weekly/Monthly — grouped or stacked bars, click-to-drill,
            // partial-bucket styling — identical machinery to the
            // Production/NRW breakdown, just pointed at wellEntityRows.
            <ComposedChart
              data={drillFocusRange ? wellEntityRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey) : wellEntityRows}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleWellLegendIsolate}
              />
              {visibleWellEntities.map(({ id, label, color }) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={label}
                  fill={color}
                  maxBarSize={28}
                  radius={[3, 3, 0, 0]}
                  stackId={stackMode === 'stacked' ? 'wells' : undefined}
                  shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
                />
              ))}
            </ComposedChart>
          ) : metric === 'rawwater' ? (
            // ── Raw Water — smooth gradient area chart ────────────────────────────
            // trendRows (not chartData) so Weekly/Monthly (M4) apply.
            <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rawWaterFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_RAWWATER} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C_RAWWATER} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fontWeight: 500 }}
                stroke="hsl(var(--muted-foreground))"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={formatYAxis}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area
                type="monotone"
                dataKey="rawwater"
                stroke={C_RAWWATER}
                strokeWidth={2.5}
                fill="url(#rawWaterFill)"
                dot={false}
                name="Raw Water (m³)"
                connectNulls
              />
            </AreaChart>
          ) : (metric === 'tds' && roDrillMode === 'default') ? (
            // ── Permeate TDS — smooth gradient area chart ─────────────────────────
            // trendRows (not chartData) so Weekly/Monthly (M4) apply — tds is a
            // sample-count-weighted average per TREND_FIELD_AGG, not a naive mean.
            <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tdsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_TDS} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C_TDS} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fontWeight: 500 }}
                stroke="hsl(var(--muted-foreground))"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={formatYAxis}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area
                type="monotone"
                dataKey="tds"
                stroke={C_TDS}
                strokeWidth={2.5}
                fill="url(#tdsFill)"
                dot={false}
                name="Permeate TDS (ppm)"
                connectNulls
              />
            </AreaChart>
          ) : (
            // ── Production / Recovery / TDS (default) — gradient area chart ────────
            // trendRows (not chartData): Production's Total view stays an
            // overlapping area chart at every granularity per the plan
            // ("Default overlap-area view stays as-is — reads better than a
            // stack") — it just now also supports Weekly/Monthly bucketing.
            // Recovery inherits the same weighted-avg treatment TDS gets.
            <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="productionFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_PRODUCTION} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C_PRODUCTION} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="consumptionFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_CONSUMPTION} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C_CONSUMPTION} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="recoveryFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_RECOVERY} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C_RECOVERY} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              {metric === 'production' && (<>
                {/* Render consumption behind production for the overlapping-area effect */}
                <Area type="monotone" dataKey="consumption" stroke={C_CONSUMPTION} strokeWidth={2.5} fill="url(#consumptionFill)" dot={false} name="Consumption (m³)" connectNulls />
                <Area type="monotone" dataKey="production" stroke={C_PRODUCTION} strokeWidth={2.5} fill="url(#productionFill)" dot={false} name="Production (m³)" connectNulls />
              </>)}
              {metric === 'recovery' && roDrillMode === 'default' && (
                <Area type="monotone" dataKey="recovery" stroke={C_RECOVERY} strokeWidth={2.5} fill="url(#recoveryFill)" dot={false} name="Recovery (%)" connectNulls />
              )}
              {metric === 'tds' && roDrillMode === 'default' && (
                <Area type="monotone" dataKey="tds" stroke={C_TDS} strokeWidth={2.5} fill="url(#tdsFill)" dot={false} name="Permeate TDS (ppm)" connectNulls />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
  );
}
