import { useCallback } from 'react';
import { toast } from 'sonner';
import { FileDown, RefreshCw, Building2, User, Info } from 'lucide-react';
import { LayoutGrid, List, ChevronLeft, ChevronRight, Award, Layers } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/DataState';
import { PLANT_COLUMN_ACCENTS } from '../types';
import { useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  AppraisalTier, APPRAISAL_TIERS, getAppraisalTier,
  INPUT_COLS, InputColKey, SHARED_COLS,
  computeEntityOverallScore,
  KPI_STATUS, scoreStatus, scoreColor,
  generateDays2, KpiRange2, KpiViewMode,
  DEFAULT_RO_OPERATOR_SHIFT_TARGET, DEFAULT_RO_HOURLY_TARGET,
  DayScore2, ScoreMap2, EntityTypeScore, ScoreMatrix,
  roTargetForPlant,
} from './KpiTab/constants';
import { useKpiData } from './KpiTab/useKpiData';
import { MiniHeatmap } from './KpiTab/MiniHeatmap';
import { KpiLegend } from './KpiTab/KpiLegend';

export type { AppraisalTier };
export { APPRAISAL_TIERS, getAppraisalTier };
export { computeEntityOverallScore } from './KpiTab/constants';
export type { EntityTypeScore } from './KpiTab/constants';

const RANGES: { label: string; value: KpiRange2 }[] = [
  { label: 'Today', value: 'today' },
  { label: '7D',    value: 7 },
  { label: '14D',   value: 14 },
  { label: '30D',   value: 30 },
  { label: '90D (Qtr)', value: 90 },
  { label: 'Annual (YTD)', value: 365 },
];

function exportAppraisalCsv(
  plantsWithOps: any[],
  operators: any[],
  individual: ScoreMatrix,
  days: string[],
  todayStr: string,
  range: KpiRange2,
) {
  const headers = [
    'Operator Name', 'Username', 'Plant',
    'Wells %', 'Locator %', 'RO Train %', 'Prod Meter %', 'Solar %', 'Grid %', 'Chemicals %',
    'Overall KPI Score %', 'Appraisal Rating Tier', 'Period Range',
  ];
  const rows: string[][] = [];

  plantsWithOps.forEach((plant) => {
    const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
    plantOps.forEach((op) => {
      const matKey = `${op.id}:${plant.id}`;
      const ts = individual[matKey] ?? {};
      const overall = computeEntityOverallScore(ts, days, todayStr);

      const catScores = INPUT_COLS.map((col) => {
        const dayMap = ts[col.key] ?? {};
        const validDays = days.map((d) => dayMap[d]).filter((s): s is number => typeof s === 'number');
        if (!validDays.length) return 'N/A';
        const avg = Math.round((validDays.reduce((a, b) => a + b, 0) / validDays.length) * 100);
        return `${avg}%`;
      });

      rows.push([
        `"${op.first_name} ${op.last_name}"`.trim(),
        `"${op.username ?? ''}"`,
        `"${plant.name}"`,
        ...catScores.map((s) => `"${s}"`),
        `"${overall.totalValid > 0 ? `${overall.scorePct}%` : 'N/A'}"`,
        `"${overall.totalValid > 0 ? overall.tier.tier : 'N/A'}"`,
        `"${range === 'today' ? 'Today' : `${range} Days`}"`,
      ]);
    });
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `operator_annual_appraisal_kpi_${range}_${todayStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast.success('Annual appraisal KPI report exported successfully.');
}

function KpiTab({ staff, roles, plants }: { staff: any[]; roles: any[]; plants: any[] }) {
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState<KpiRange2>('today');
  const [viewMode, setViewMode] = useState<KpiViewMode>(
    () => (searchParams.get('view') === 'individual' ? 'individual' : 'team'),
  );
  const [expandedPlants, setExpandedPlants] = useState<Set<string>>(() => {
    const plantId = searchParams.get('plant');
    return plantId ? new Set([plantId]) : new Set();
  });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const data = useKpiData({ staff, roles, plants, range, refreshKey, viewMode });

  const { days, todayStr, operators, plantsWithOps, individual, teamCoverage,
          activeMatrix, summary, appraisalStats, isLoading, kpiError, retryKpiQueries } = data;

  const togglePlant = useCallback((id: string) => {
    setExpandedPlants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onHover = useCallback((text: string | null, e?: React.MouseEvent) => {
    setTooltip(text && e ? { x: e.clientX, y: e.clientY, text } : null);
  }, []);

  return (
    <div className="space-y-3.5">
      <div className="p-3.5 rounded-xl border border-border/70 bg-card/80 backdrop-blur-sm space-y-2.5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <Award className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-foreground">Operational KPI & Appraisal Index</h3>
                <span className={cn('text-3xs font-bold px-2 py-0.5 rounded-full border', getAppraisalTier(appraisalStats.avgScore).badge)}>
                  {getAppraisalTier(appraisalStats.avgScore).icon} Fleet Avg: {appraisalStats.avgScore}%
                </span>
              </div>
              <p className="text-3xs text-muted-foreground">Comprehensive weighted logging compliance for operator evaluations</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background"
              onClick={() => exportAppraisalCsv(plantsWithOps, operators, individual, days, todayStr, range)}
              title="Download full operator appraisal matrix in CSV"
            >
              <FileDown className="h-3.5 w-3.5 text-primary" />
              <span>Export Appraisal CSV</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setRefreshKey((k) => k + 1)}
              title="Refresh matrix"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/40 text-2xs">
          <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Appraisal Tiers:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold">
            🏆 Outstanding (≥90%): {appraisalStats.outstanding}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/30 font-bold">
            ⭐ Exceeds (80-89%): {appraisalStats.exceeds}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 font-bold">
            ✓ Meets (70-79%): {appraisalStats.meets}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold">
            ⚠️ Needs Imp (&lt;70%): {appraisalStats.needsImp + appraisalStats.unsat}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-muted/40 border border-border/60">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex rounded-lg border bg-background overflow-hidden p-0.5 shadow-2xs">
            {RANGES.map(({ label, value }) => (
              <button
                key={String(value)}
                className={cn(
                  'px-2.5 py-1 text-2xs font-bold rounded-md transition-all',
                  range === value
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                onClick={() => setRange(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border bg-background overflow-hidden p-0.5 shadow-2xs">
            <button
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                viewMode === 'team'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewMode('team')}
            >
              <Building2 className="h-3.5 w-3.5" /> Team Coverage
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                viewMode === 'individual'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewMode('individual')}
            >
              <User className="h-3.5 w-3.5" /> Individual Activity
            </button>
          </div>
        </div>

        <div className="text-2xs text-muted-foreground flex items-center gap-2">
          {viewMode === 'team' ? (
            <span><strong className="text-foreground">{plantsWithOps.length}</strong> plants</span>
          ) : (
            <span><strong className="text-foreground">{operators.length}</strong> evaluated operators</span>
          )}
          <span>·</span>
          <span className={cn('font-bold', summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger')}>
            {summary.pct}% Overall Logging Rate
          </span>
        </div>
      </div>

      <KpiLegend />

      <div className="flex items-start gap-2 bg-info-soft border border-info/40 rounded-xl px-3.5 py-2.5 text-xs text-info shadow-2xs">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="leading-relaxed">
          {viewMode === 'team' ? (
            <><strong>Team Coverage Lens:</strong> Verifies if each asset was logged by anyone on schedule (operator shift or automated feed). This evaluates overall plant compliance.</>
          ) : (
            <><strong>Individual Activity Lens (Annual Appraisal Metric):</strong> Evaluates individual operator performance with a <strong>60% Individual (RO Train diligence, ~8/shift) + 40% Shared Duties (facility monitoring on active shift days)</strong> weighted score. Rest days and off-duty periods are excluded via attendance proxy.</>
          )}
          {' '}Targets: Shared facility duties ≥1/day (Wells, Locators, Meters, Power, Chemicals) · RO Train ~{DEFAULT_RO_OPERATOR_SHIFT_TARGET}/shift (hourly per train).
        </span>
      </div>

      <Card className="overflow-hidden border border-border/70 shadow-2xs">
        <DataState
          loading={isLoading}
          error={kpiError}
          isEmpty={plantsWithOps.length === 0}
          emptyTitle="No operators assigned to any plant."
          onRetry={retryKpiQueries}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b bg-muted/60">
                  <th className="text-left px-3 py-2.5 font-bold text-xs sticky left-0 bg-muted/60 z-10 min-w-[170px]">
                    {viewMode === 'team' ? 'Plant Facility' : 'Operator / Facility'}
                  </th>
                  <th className="py-2.5 px-3 font-bold text-center bg-muted/80 border-x border-border/60 min-w-[150px]">
                    <div className="flex flex-col items-center">
                      <span className="text-2xs font-extrabold uppercase tracking-wide text-foreground">Overall KPI Score</span>
                      <span className="text-3xs text-muted-foreground font-normal">
                        {viewMode === 'individual' ? '60% Indiv · 40% Shared' : 'Facility Appraisal'}
                      </span>
                    </div>
                  </th>
                  {INPUT_COLS.map((col) => (
                    <th key={col.key} className="py-2 px-1 font-semibold text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-white text-3xs font-bold whitespace-nowrap shadow-2xs"
                          style={{ background: col.color }}
                        >
                          {col.label}
                        </span>
                        {viewMode === 'individual' && (
                          <span
                            className={cn(
                              'text-3xs font-semibold px-1 rounded',
                              col.key === 'ro_train'
                                ? 'bg-primary-soft text-primary font-bold border border-primary/30'
                                : 'text-muted-foreground'
                            )}
                          >
                            {col.key === 'ro_train' ? 'Indiv 60%' : 'Shared'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {viewMode === 'team' ? (
                  plantsWithOps.map((plant, pi) => {
                    const accent = PLANT_COLUMN_ACCENTS[pi % PLANT_COLUMN_ACCENTS.length];
                    const ts = teamCoverage[plant.id] ?? {};
                    const overall = computeEntityOverallScore(ts, days, todayStr);

                    return (
                      <tr key={`team:${plant.id}`} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 sticky left-0 z-10 bg-background"
                          style={{ borderLeft: `3px solid ${accent.line}` }}>
                          <div className="flex items-center gap-2">
                            <Building2 className={cn('h-3.5 w-3.5 shrink-0', accent.text)} />
                            <span className={cn('font-bold text-xs', accent.text)}>{plant.name}</span>
                          </div>
                        </td>

                        <td className="py-2 px-3 border-x border-border/60 bg-muted/10 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-xs text-foreground">{overall.scorePct}%</span>
                              <span className={cn('text-3xs px-1.5 py-0.2 rounded-full border font-bold', overall.tier.badge)}>
                                {overall.tier.icon} {overall.tier.tier}
                              </span>
                            </div>
                            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                              <div
                                className={cn('h-full transition-all', overall.tier.dot)}
                                style={{ width: `${overall.scorePct}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {INPUT_COLS.map((col) => (
                          <td key={col.key} className="py-0 px-0 align-middle">
                            <MiniHeatmap
                              scores={(ts[col.key] ?? {}) as ScoreMap2}
                              days={days}
                              todayStr={todayStr}
                              label={`${plant.name} · ${col.full}`}
                              onHover={onHover}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })
                ) : (
                  plantsWithOps.flatMap((plant, pi) => {
                    const accent = PLANT_COLUMN_ACCENTS[pi % PLANT_COLUMN_ACCENTS.length];
                    const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
                    const isExpanded = expandedPlants.has(plant.id);
                    const rows: React.ReactNode[] = [];

                    const plantOpScores = plantOps
                      .map((op) => {
                        const matKey = `${op.id}:${plant.id}`;
                        return computeEntityOverallScore(individual[matKey] ?? {}, days, todayStr);
                      })
                      .filter((res) => res.totalValid > 0)
                      .map((res) => res.scorePct);
                    const plantAvgScore = plantOpScores.length > 0
                      ? Math.round(plantOpScores.reduce((a, b) => a + b, 0) / plantOpScores.length)
                      : 0;
                    const plantTier = getAppraisalTier(plantAvgScore);

                    rows.push(
                      <tr
                        key={`ph:${plant.id}`}
                        className="border-b cursor-pointer select-none bg-muted/20 hover:bg-muted/40 transition-colors"
                        onClick={() => togglePlant(plant.id)}
                      >
                        <td
                          className="px-3 py-2.5 sticky left-0 z-10 bg-background"
                          style={{ borderLeft: `3px solid ${accent.line}` }}
                        >
                          <div className="flex items-center gap-2">
                            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform shrink-0', accent.text, isExpanded && 'rotate-90')} />
                            <Building2 className={cn('h-3.5 w-3.5 shrink-0', accent.text)} />
                            <span className={cn('font-bold text-xs', accent.text)}>{plant.name}</span>
                            <span className="text-3xs px-1.5 py-0.2 rounded-full bg-muted font-bold text-muted-foreground border border-border/60">
                              {plantOps.length} staff
                            </span>
                          </div>
                        </td>

                        <td className="py-2 px-3 border-x border-border/60 bg-muted/30 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-xs text-foreground">{plantAvgScore}%</span>
                              <span className={cn('text-3xs px-1.5 py-0.2 rounded-full border font-bold', plantTier.badge)}>
                                {plantTier.icon} {plantTier.tier}
                              </span>
                            </div>
                            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                              <div
                                className={cn('h-full transition-all', plantTier.dot)}
                                style={{ width: `${plantAvgScore}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {INPUT_COLS.map((col) => {
                          const allDayScores = plantOps.flatMap((op) =>
                            days.map((d) => {
                              const s = individual[`${op.id}:${plant.id}`]?.[col.key]?.[d];
                              return (s !== undefined && s !== null) ? s : null;
                            })
                          ).filter((s): s is number => s !== null);
                          const avg = allDayScores.length > 0
                            ? allDayScores.reduce((a, b) => a + b, 0) / allDayScores.length
                            : null;
                          return (
                            <td key={col.key} className={cn('py-2 px-1 text-center', accent.bg)}>
                              <div className="flex items-center justify-center">
                                <div
                                  className="h-2.5 w-2.5 rounded-sm shadow-2xs"
                                  style={{ background: scoreColor(avg), opacity: 0.9 }}
                                  title={avg !== null ? `${Math.round(avg * 100)}% on active shifts` : 'Off duty / N/A'}
                                />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );

                    if (isExpanded) {
                      plantOps.forEach((op) => {
                        const matKey = `${op.id}:${plant.id}`;
                        const ts = individual[matKey] ?? {};
                        const opOverall = computeEntityOverallScore(ts, days, todayStr);

                        rows.push(
                          <tr key={`op:${matKey}`} className="border-b hover:bg-muted/30 transition-colors">
                            <td
                              className="px-3 py-2 sticky left-0 z-10 bg-background pl-8"
                              style={{ borderLeft: `3px solid ${accent.line}` }}
                            >
                              <div className="flex items-center gap-2">
                                <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center text-3xs font-bold text-white shrink-0 shadow-2xs')}>
                                  {op.first_name?.[0]}{op.last_name?.[0]}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-foreground truncate max-w-[120px] leading-tight">
                                    {op.first_name} {op.last_name}
                                  </div>
                                  {op.username && (
                                    <div className="text-3xs text-muted-foreground font-mono truncate">@{op.username}</div>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="py-1.5 px-3 border-x border-border/60 bg-muted/15 text-center">
                              {opOverall.totalValid > 0 ? (
                                <div
                                  className="flex flex-col items-center gap-0.5"
                                  title={`Overall: ${opOverall.scorePct}% (60% RO Train: ${opOverall.roAvg !== null ? Math.round(opOverall.roAvg * 100) + '%' : 'N/A'} + 40% Shared: ${opOverall.sharedAvg !== null ? Math.round(opOverall.sharedAvg * 100) + '%' : 'N/A'})`}
                                >
                                  <div className="flex items-center gap-1">
                                    <span className="font-extrabold text-xs text-foreground">{opOverall.scorePct}%</span>
                                    <span className={cn('text-3xs px-1.5 py-0.2 rounded-md border font-semibold truncate max-w-[100px]', opOverall.tier.badge)}>
                                      {opOverall.tier.icon} {opOverall.tier.tier}
                                    </span>
                                  </div>
                                  <div className="w-24 h-1.5 rounded-full bg-muted/80 overflow-hidden border border-border/40">
                                    <div
                                      className={cn('h-full transition-all', opOverall.tier.dot)}
                                      style={{ width: `${opOverall.scorePct}%` }}
                                    />
                                  </div>
                                  <span className="text-3xs text-muted-foreground/80 font-mono-num">
                                    RO {opOverall.roAvg !== null ? Math.round(opOverall.roAvg * 100) + '%' : '—'} · Sh {opOverall.sharedAvg !== null ? Math.round(opOverall.sharedAvg * 100) + '%' : '—'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-3xs text-muted-foreground italic">N/A (Off duty)</span>
                              )}
                            </td>

                            {INPUT_COLS.map((col) => (
                              <td key={col.key} className="py-0 px-0 align-middle">
                                <MiniHeatmap
                                  scores={(ts[col.key] ?? {}) as ScoreMap2}
                                  days={days}
                                  todayStr={todayStr}
                                  label={`${op.first_name} ${op.last_name} · ${col.full}`}
                                  onHover={onHover}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      });
                    }

                    return rows;
                  })
                )}
              </tbody>
            </table>
          </div>
        </DataState>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: viewMode === 'team' ? 'Coverage Rate' : 'Overall Logging Rate', value: `${summary.pct}%`, color: summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger' },
          { label: viewMode === 'team' ? 'Asset-Days Logged' : 'Cells Completed', value: `${summary.complete}/${summary.total}`, color: 'text-info' },
          { label: viewMode === 'team' ? 'Assets Missed' : 'Cells Missed', value: `${summary.missed}`, color: summary.missed === 0 ? 'text-accent' : 'text-danger' },
          { label: 'Pending Today', value: `${summary.pending}`, color: summary.pending === 0 ? 'text-muted-foreground' : 'text-info' },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-card rounded-xl border border-border/70 py-3 px-2 text-center gap-0.5 shadow-2xs">
            <span className={cn('text-xl font-bold leading-none', s.color)}>{s.value}</span>
            <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">{s.label}</span>
          </div>
        ))}
      </div>

      {tooltip && (
        <div className="fixed z-50 bg-popover text-popover-foreground border text-2xs rounded-lg px-2.5 py-2 shadow-[var(--shadow-elev)] pointer-events-none whitespace-pre leading-relaxed"
          style={{ left: tooltip.x + 12, top: tooltip.y - 12 }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

export { KpiTab };
