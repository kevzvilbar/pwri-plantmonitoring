import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { type RawReading, type CorrectionRow, runOLS } from '@/lib/regressionCorrection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangePicker } from '@/components/ui/date-picker';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { FlaskConical, Play, ShieldAlert, TrendingUp, Database, AlertCircle, RefreshCw, Clock, Eye } from 'lucide-react';
import { SOURCE_TABLES, TABLES_WITHOUT_NORM_STATUS, TABLE_LABELS, ENTITY_CONFIG, POWER_SOURCE_OPTIONS, RegressionResult, Plant, EntityOption, ROW_LIMIT } from './dataAnalysis/shared';
import { detectGaps } from '@/lib/gapDetection';
import { EditRawDialog } from './dataAnalysis/EditRawDialog';
import { RegressionDetail } from './dataAnalysis/RegressionDetail';
import { RawDataTable } from './dataAnalysis/RawDataTable';
import { AuditLogTab } from './dataAnalysis/AuditLogTab';
import { NormalizationAuditTab } from './dataAnalysis/NormalizationAuditTab';

export default function DataAnalysis() {
  const { isAdmin, isDataAnalyst, isManager, session, roles } = useAuth();
  const qc = useQueryClient();

  // ── Universal plant selection — initialize from global store ─────────────
  const selectedPlantId    = useAppStore(s => s.selectedPlantId);
  const setSelectedPlantId = useAppStore(s => s.setSelectedPlantId);

  // ── Persisted filter state — survives navigation away and back ───────────
  // Each filter value is read from sessionStorage on mount and written on change.
  const SS_KEY = 'da:filters';
  const loadFilters = () => {
    try {
      const raw = sessionStorage.getItem(SS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const saveFilters = useCallback((patch: Record<string, string>) => {
    try {
      const prev = loadFilters();
      sessionStorage.setItem(SS_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch { /* quota */ }
  }, []);

  const saved = useRef(loadFilters());

  const [sourceTable, _setSourceTable] = useState<string>(saved.current.sourceTable ?? 'well_readings');
  const [column, _setColumn]           = useState<string>(saved.current.column       ?? 'daily_volume');
  const [plantId, _setPlantId]         = useState<string>(saved.current.plantId      ?? (selectedPlantId ?? 'all'));
  const [entityId, _setEntityId]       = useState<string>(saved.current.entityId     ?? 'all');
  const [powerSource, _setPowerSource] = useState<string>(saved.current.powerSource  ?? 'all');
  const [dateFrom, _setDateFrom]       = useState<string>(saved.current.dateFrom     ?? '');
  const [dateTo, _setDateTo]           = useState<string>(saved.current.dateTo       ?? '');

  const setSourceTable = (v: string) => { _setSourceTable(v); saveFilters({ sourceTable: v }); };
  const setColumn      = (v: string) => { _setColumn(v);      saveFilters({ column: v });      };
  const setPlantId     = (v: string) => { _setPlantId(v);     saveFilters({ plantId: v });     };
  const setEntityId    = (v: string) => { _setEntityId(v);    saveFilters({ entityId: v });    };
  const setPowerSource = (v: string) => { _setPowerSource(v); saveFilters({ powerSource: v }); };
  const setDateFrom    = (v: string) => { _setDateFrom(v);    saveFilters({ dateFrom: v });    };
  const setDateTo      = (v: string) => { _setDateTo(v);      saveFilters({ dateTo: v });      };

  // Keep local plantId in sync ONLY when user changes plant in the top bar
  // and has NOT already chosen a plant on this page (avoid overwriting their selection)
  const lastGlobalPlant = useRef(selectedPlantId);
  useEffect(() => {
    if (selectedPlantId !== lastGlobalPlant.current) {
      lastGlobalPlant.current = selectedPlantId;
      // Only sync if the page's plantId still matches the old global value
      // i.e. the user hasn't independently changed it here
      setPlantId(selectedPlantId ?? 'all');
      setEntityId('all');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlantId]);

  // Edit dialog
  const [editReading, setEditReading] = useState<RawReading | null>(null);

  // Regression state
  const [running, setRunning] = useState(false);

  const canEdit = usePermission('data_analysis_review', 'edit');
  const canView = usePermission('data_analysis_review', 'view');

  // Plants list
  const { data: plantsData } = useQuery({
    queryKey: ['plants-list'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id,name').order('name');
      return (data ?? []) as Plant[];
    },
  });
  const plants = plantsData ?? [];

  // Entity drill-down options
  const entityCfgMain = ENTITY_CONFIG[sourceTable];
  const { data: entityOptionsData, isFetching: entityFetching } = useQuery({
    queryKey: ['entity-options-main', sourceTable, plantId],
    queryFn: async () => {
      if (!entityCfgMain) return [];
      let q = (supabase.from(entityCfgMain.lookupTable as never) as any)
        .select(entityCfgMain.selectCols)
        .order('name');
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      q = q.eq('status', 'Active');
      const { data, error } = await q;
      if (error) {
        let fbq = (supabase.from(entityCfgMain.lookupTable as never) as any)
          .select(entityCfgMain.selectCols)
          .order('name');
        if (plantId && plantId !== 'all') fbq = fbq.eq('plant_id', plantId);
        const { data: fallback } = await fbq;
        return (fallback ?? []) as Record<string, unknown>[];
      }
      return (data ?? []) as Record<string, unknown>[];
    },
    enabled: !!entityCfgMain,
    staleTime: 30_000,
  });
  const entityOptions: EntityOption[] = (entityOptionsData ?? []).map(r => ({
    id:    String(r.id),
    label: entityCfgMain ? entityCfgMain.labelFn(r) : String(r.id),
  }));

  // ── Regression results — fetched directly from Supabase ──────────────────
  const { data: resultsData, refetch: refetchResults, isError: resultsError } = useQuery({
    queryKey: ['regression-results', sourceTable, plantId, entityId],
    queryFn: async () => {
      let q = supabase.from('regression_results')
        .select('*')
        .eq('source_table', sourceTable)
        .order('created_at', { ascending: false })
        .limit(20);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      // Map DB `id` → `result_id`.  outlier_count now comes from the
      // materialised column (populated by trigger on insert/update) — we no
      // longer need to filter the full corrections JSONB array just to get
      // a count.  corrections is still fetched here because RegressionDetail
      // needs it when the card is expanded; if that becomes a performance
      // concern, switch to a lazy `.select('id,...,outlier_count')` for the
      // list and a separate query for corrections on expand.
      const results: RegressionResult[] = (data ?? []).map((r: Record<string, unknown>) => {
        const corrections = (r.corrections ?? []) as CorrectionRow[];
        return {
          result_id:     String(r.id),
          source_table:  String(r.source_table),
          column_name:   String(r.column_name),
          plant_id:      r.plant_id ? String(r.plant_id) : null,
          row_count:     Number(r.row_count ?? 0),
          truncated:     Boolean(r.truncated),
          outlier_count: r.outlier_count != null ? Number(r.outlier_count) : corrections.filter(c => c.is_outlier).length,
          r_squared:     r.r_squared != null ? Number(r.r_squared) : null,
          slope:         r.slope     != null ? Number(r.slope)     : null,
          intercept:     r.intercept != null ? Number(r.intercept) : null,
          corrections,
          status:        (r.status as RegressionResult['status']) ?? 'pending',
          created_at:    String(r.created_at ?? ''),
        };
      });
      return { results };
    },
    enabled: canView,
    staleTime: 15_000,
    retry: false,
    throwOnError: false,
  });
  const regressionResults = resultsData?.results ?? [];

  // When source table changes, reset column and entity
  const handleTableChange = (t: string) => {
    setSourceTable(t);
    setColumn(SOURCE_TABLES[t]?.[0] ?? '');
    setEntityId('all');
    setPowerSource('all');
  };

  // When plant changes here, also update the global store so other pages stay in sync
  const handlePlantChange = (p: string) => {
    setPlantId(p);
    setEntityId('all');
    setSelectedPlantId(p === 'all' ? null : p);
  };

  // ── Run Regression — OLS computed client-side, result saved to Supabase ──
  const handleRunRegression = async () => {
    if (!sourceTable || !column) { toast.error('Select a table and column first'); return; }
    setRunning(true);
    try {
      const entityCfg = ENTITY_CONFIG[sourceTable];
      const hasNorm   = !TABLES_WITHOUT_NORM_STATUS.has(sourceTable);
      const selectCols = [
        'id', 'reading_datetime', column,
        hasNorm ? 'norm_status' : null,
        'plant_id',
        entityCfg ? entityCfg.fkColumn : null,
        // Fetch is_meter_replacement for ro_train_readings so regression can warn when
        // it encounters rows whose delta is overridden to 0 by that flag.
        (sourceTable === 'ro_train_readings') ? 'is_meter_replacement' : null,
      ].filter(Boolean).join(',');

      let q = supabase
        .from(sourceTable.replace('well_readings','well_readings_clean').replace('locator_readings','locator_readings_clean') as any)
        .select(selectCols)
        .order('reading_datetime', { ascending: true })
        .limit(ROW_LIMIT + 1);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      if (entityCfg && entityId && entityId !== 'all') q = q.eq(entityCfg.fkColumn as never, entityId);
      if (dateFrom) q = q.gte('reading_datetime', dateFrom);
      if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');

      const { data: fetchedRows, error: readErr } = await q;
      if (readErr) throw new Error(readErr.message);

      // DATA-INTEGRITY FIX: the date range can contain more rows than the
      // regression cap — previously this was applied silently, so a
      // multi-year dataset would run on an arbitrary chronological slice
      // with no indication to the analyst. Detect it by fetching one row
      // past the cap, trim back to ROW_LIMIT for the actual fit, and
      // surface it in both the toast and the stored result.
      const truncated = (fetchedRows?.length ?? 0) > ROW_LIMIT;
      const readings = truncated ? (fetchedRows as any[]).slice(0, ROW_LIMIT) : fetchedRows;

      const { corrections, stats, resetCount } = runOLS((readings || []) as unknown as RawReading[], column);

      // ── Gap detection — find missing dates and interpolate values ─────────
      const gapFills     = detectGaps((readings || []) as unknown as RawReading[], column, sourceTable, t => ENTITY_CONFIG[t]?.fkColumn ?? null);
      const allCorrections = [...corrections, ...gapFills];

      // ── Meter-replacement warning ─────────────────────────────────────────
      // For ro_train_readings.permeate_meter: rows with is_meter_replacement=true
      // have their permeate_meter_delta forced to 0 by an override rule in the
      // operator log.  Correcting permeate_meter via regression fixes the
      // cumulative reading but the delta will STAY at 0 until the replacement
      // flag is unchecked — at which point a full cascade recalculation runs.
      // Surface this as a visible warning in each correction note so the analyst
      // knows the override is active before applying.
      if (sourceTable === 'ro_train_readings') {
        const replIds = new Set(
          ((readings || []) as any[])
            .filter((r: any) => r.is_meter_replacement)
            .map((r: any) => String(r.id)),
        );
        if (replIds.size > 0) {
          corrections.forEach(c => {
            if (replIds.has(c.reading_id)) {
              const warning =
                '⚠️ Meter replacement flag is active on this row — ' +
                'permeate_meter_delta will remain 0 even after correcting the meter value. ' +
                'Uncheck the replacement flag in the Operator Log to trigger a full delta recalculation.';
              c.note = c.note ? `${warning} | ${c.note}` : warning;
            }
          });
        }
      }
      const resultId    = crypto.randomUUID();
      const outlierCount = corrections.filter(c => c.is_outlier).length;
      const userRole    = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

      const doc = {
        id:            resultId,
        source_table:  sourceTable,
        column_name:   column,
        plant_id:      (plantId && plantId !== 'all') ? plantId : null,
        date_from:     dateFrom || null,
        date_to:       dateTo   || null,
        created_by:    session?.user?.id ?? null,
        created_role:  userRole,
        row_count:     (readings || []).length,
        truncated,
        r_squared:     stats.r_squared,
        slope:         stats.slope,
        intercept:     stats.intercept,
        corrections:   allCorrections,
        outlier_count: outlierCount, // also set by DB trigger, but explicit here avoids a stale-read window
        status:        'pending',
      };

      const { error: insertErr } = await supabase
        .from('regression_results')
        .insert(doc as any);
      if (insertErr) throw new Error(insertErr.message);

      const resetMsg = resetCount > 0 ? `, ${resetCount} reset anomaly fix(es)` : '';
      const olsMsg   = (outlierCount - resetCount) > 0 ? `, ${outlierCount - resetCount} statistical outlier(s)` : '';
      const gapMsg   = gapFills.length > 0 ? `, ${gapFills.length} gap date(s) to fill` : '';
      toast.success(`Analysis complete — ${outlierCount} anomaly(s) found${resetMsg}${olsMsg}${gapMsg}`);
      if (truncated) {
        toast.warning(
          `This date range has more than ${ROW_LIMIT.toLocaleString()} readings — the analysis only covers the earliest ${ROW_LIMIT.toLocaleString()} rows. Narrow the date range to analyze the rest.`,
          { duration: 10000 },
        );
      }
      refetchResults();
      qc.invalidateQueries({ queryKey: ['raw-readings'] });
    } catch (e: unknown) {
      toast.error(friendlyError(e));
    } finally {
      setRunning(false);
    }
  };

  const latestRun = regressionResults[0] ?? null;
  const totalOutliers = useMemo(() => regressionResults.reduce((acc, r) => acc + (r.outlier_count || 0), 0), [regressionResults]);
  const pendingCount = useMemo(() => regressionResults.filter(r => r.status === 'pending').length, [regressionResults]);

  if (!canView) {
    return (
      <Card className="p-8 text-center space-y-2 max-w-md mx-auto mt-12">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Data Analysis & Review requires Admin, Data Analyst, or Manager role.
        </p>
      </Card>
    );
  }

  const applyPreset = (days: number | null) => {
    if (!days) {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    setDateFrom(from);
    setDateTo(to);
  };

  // Backfill Sweep state
  const [sweepingBackfill, setSweepingBackfill] = useState(false);
  const handleRunBackfillSweep = async () => {
    setSweepingBackfill(true);
    try {
      const todayDateStr = new Date().toISOString().slice(0, 10);
      const { data, error } = await (supabase.rpc as any)('fn_backfill_missing_readings', {
        p_date: todayDateStr,
        p_lookback_days: 14,
      });
      if (error) throw error;
      toast.success(
        `Backfill sweep complete: ${data?.swept_count ?? 0} reading(s) backfilled, ${data?.retracted_count ?? 0} retracted.`,
      );
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setSweepingBackfill(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-[1600px] mx-auto pb-10" data-testid="data-analysis-page">
      <PageHeader
        title="Data Analysis & Review"
        titleIcon={<FlaskConical className="h-5 w-5 text-primary" />}
        subtitle="Centralised regression analysis, raw-value editing, and normalization. All other pages are read-only — edits happen here only."
        actions={
          <div className="flex items-center gap-2">
            {isManager && !canEdit && (
              <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground border">
                <Eye className="h-3.5 w-3.5" />
                <span>Read-Only Review</span>
              </div>
            )}
            {canEdit && (
              <>
                <Button
                  onClick={handleRunBackfillSweep}
                  disabled={sweepingBackfill}
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-primary/60 text-primary hover:bg-primary-soft"
                  data-testid="run-backfill-sweep-btn"
                  title="Scans all reading tables for bounded date gaps and auto-backfills missing readings"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", sweepingBackfill && "animate-spin")} />
                  {sweepingBackfill ? 'Sweeping…' : 'Run Backfill Sweep'}
                </Button>
                <Button
                  onClick={handleRunRegression}
                  disabled={running}
                  size="sm"
                  className="h-8 text-xs gap-1.5"
              >
                {running ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Running OLS Model…</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Run Regression</span>
                  </>
                )}
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* ── 2. QUICK SOURCE TABLES SELECTOR ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {Object.entries(TABLE_LABELS).map(([k, label]) => {
          const isActive = sourceTable === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => handleTableChange(k)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all shrink-0 border flex items-center gap-1.5 ${
                isActive
                  ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                  : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted border-border'
              }`}
            >
              <span>{label}</span>
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── 3. FILTER CONSOLE TOOLBAR ── */}
      <Card className="rounded-2xl border border-border/80 shadow-2xs overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            
            {/* Column Target */}
            <div className="space-y-1 lg:col-span-3">
              <Label htmlFor="dataanalysis-column" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                Target Telemetry Metric
              </Label>
              <Select value={column} onValueChange={setColumn}>
                <SelectTrigger className="h-9 text-xs rounded-xl font-mono bg-muted/30" id="dataanalysis-column">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(SOURCE_TABLES[sourceTable] ?? []).map(c => (
                    <SelectItem key={c} value={c} className="text-xs font-mono">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Plant Facility */}
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="dataanalysis-plant" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                Plant Facility
              </Label>
              <Select value={plantId} onValueChange={handlePlantChange}>
                <SelectTrigger className="h-9 text-xs rounded-xl bg-muted/30" id="dataanalysis-plant">
                  <SelectValue placeholder="All plants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs text-muted-foreground">All plants</SelectItem>
                  {plants.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity drill-down */}
            {entityCfgMain && (
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="dataanalysis-field-2" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground flex items-center justify-between">
                  <span>{entityCfgMain.filterLabel}</span>
                  {entityOptions.length > 0 && (
                    <span className="text-3xs font-mono font-normal">
                      {entityOptions.length} available
                    </span>
                  )}
                </Label>
                <Select
                  value={entityId}
                  onValueChange={setEntityId}
                  disabled={entityFetching && entityOptions.length === 0}
                >
                  <SelectTrigger className="h-9 text-xs rounded-xl bg-muted/30" id="dataanalysis-field-2">
                    <SelectValue
                      placeholder={
                        entityFetching
                          ? `Loading ${entityCfgMain.filterLabel}s…`
                          : `All ${entityCfgMain.filterLabel}s`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs text-muted-foreground">
                      All {entityCfgMain.filterLabel}s ({entityOptions.length})
                    </SelectItem>
                    {entityOptions.map(opt => (
                      <SelectItem key={opt.id} value={opt.id} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Power Source filter */}
            {sourceTable === 'power_readings' && (
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="dataanalysis-source" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                  Power Stream
                </Label>
                <Select value={powerSource} onValueChange={v => {
                  setPowerSource(v);
                  const opt = POWER_SOURCE_OPTIONS.find(o => o.value === v);
                  if (opt && 'columns' in opt && opt.columns.length > 0) {
                    setColumn(opt.columns[0]);
                  } else if (v === 'all') {
                    setColumn(SOURCE_TABLES['power_readings'][0]);
                  }
                }}>
                  <SelectTrigger className="h-9 text-xs rounded-xl bg-muted/30" id="dataanalysis-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POWER_SOURCE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date Range */}
            <div className="space-y-1 lg:col-span-4">
              <Label htmlFor="dataanalysis-from" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
                Date Range
              </Label>
              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={({ from: f, to: t }) => {
                  if (f) setDateFrom(f);
                  if (t) setDateTo(t);
                }}
                className="h-9 text-xs rounded-xl w-full"
              />
            </div>
          </div>

          {/* Quick Date Presets Bar */}
          <div className="flex items-center gap-1.5 pt-2 border-t border-border/50 text-2xs">
            <span className="text-muted-foreground font-semibold mr-1">Date Presets:</span>
            <button
              type="button"
              onClick={() => applyPreset(7)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 7d
            </button>
            <button
              type="button"
              onClick={() => applyPreset(30)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 30d
            </button>
            <button
              type="button"
              onClick={() => applyPreset(90)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 90d
            </button>
            <button
              type="button"
              onClick={() => applyPreset(null)}
              className="px-2 py-0.5 rounded-lg bg-muted/50 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              All Time
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Two-table layout ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* LEFT — Raw Data Table (wider) */}
        <Card className="xl:col-span-3">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              Raw Data
              <Badge variant="outline" className="text-2xs ml-1">Read-only source</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Latest 200 rows for <span className="font-mono font-medium">{column}</span>.
              {canEdit && ' Click ✏ to edit a value (logged to audit trail).'}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-4">
            <RawDataTable
              sourceTable={sourceTable}
              column={column}
              plantId={plantId}
              entityId={entityId}
              dateFrom={dateFrom}
              dateTo={dateTo}
              canEdit={canEdit}
              onEdit={r => setEditReading(r)}
            />
          </CardContent>
        </Card>

        {/* RIGHT — Regression / Correction Table (narrower) */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Regression Results
              <Badge variant="outline" className="text-2xs ml-1">corrected_value + notes</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Each run shows outlier readings, corrected values (OLS projection), and Z-scores.
              {canEdit && ' Apply to write corrections; Retract to undo.'}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-4 space-y-3">
            {resultsError && (
              <div className="flex flex-col gap-1.5 rounded border border-warn bg-warn-soft px-3 py-2.5 text-xs">
                <div className="flex items-center gap-2 font-medium text-warn">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Regression results table not found
                </div>
                <p className="text-warn leading-relaxed">
                  The <code className="font-mono bg-warn-soft px-1 rounded">regression_results</code> and{' '}
                  <code className="font-mono bg-warn-soft px-1 rounded">raw_edit_log</code> tables
                  have not been created in Supabase yet. Run the migration to fix this:
                </p>
                <p className="text-warn font-mono text-2xs bg-warn-soft px-2 py-1 rounded">
                  supabase/migrations/20260515_supabase_only_and_data_analysis.sql
                </p>
                <p className="text-warn">
                  Go to <strong>Supabase Dashboard → SQL Editor</strong> and run the migration file above.
                </p>
              </div>
            )}
            {!resultsError && regressionResults.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {canEdit
                  ? 'No regression runs yet. Select a column and click "Run Regression".'
                  : 'No regression runs found for this selection.'}
              </div>
            )}
            {regressionResults.map(r => (
              <RegressionDetail
                key={r.result_id}
                result={r}
                canEdit={canEdit}
                onRefresh={() => { refetchResults(); qc.invalidateQueries({ queryKey: ['raw-readings'] }); }}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Audit / Normalization tabs ── */}
      <Card>
        <Tabs defaultValue="audit">
          <CardHeader className="pb-0 pt-4 px-4">
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="audit" className="text-xs">
                <Clock className="h-3 w-3 mr-1" /> Edit Audit
              </TabsTrigger>
              <TabsTrigger value="normalization" className="text-xs">
                <AlertCircle className="h-3 w-3 mr-1" /> Flagged Readings
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent className="pt-3 px-3 pb-4">
            <TabsContent value="audit" className="mt-0">
              <AuditLogTab sourceTable={sourceTable} />
            </TabsContent>
            <TabsContent value="normalization" className="mt-0">
              <NormalizationAuditTab sourceTable={sourceTable} />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      {/* Edit raw value dialog */}
      <EditRawDialog
        open={!!editReading}
        onClose={() => setEditReading(null)}
        reading={editReading}
        column={column}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['raw-readings'] })}
      />
    </div>
  );
}
