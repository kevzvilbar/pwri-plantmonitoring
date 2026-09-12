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
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { cn } from '@/lib/utils';
import { FlaskConical, Play, ShieldAlert, RefreshCw, Eye } from 'lucide-react';
import { SOURCE_TABLES, TABLES_WITHOUT_NORM_STATUS, ENTITY_CONFIG, POWER_SOURCE_OPTIONS, RegressionResult, Plant, EntityOption, ROW_LIMIT } from './dataAnalysis/shared';
import { EditRawDialog } from './dataAnalysis/EditRawDialog';
import { RegressionDetail } from './dataAnalysis/RegressionDetail';
import { RawDataTable } from './dataAnalysis/RawDataTable';
import { AuditLogTab } from './dataAnalysis/AuditLogTab';
import { NormalizationAuditTab } from './dataAnalysis/NormalizationAuditTab';
import { FilterToolbar } from './dataAnalysis/FilterToolbar';
import { RawDataPanel } from './dataAnalysis/RawDataPanel';
import { RegressionResultsPanel } from './dataAnalysis/RegressionResultsPanel';
import { AuditTabsSection } from './dataAnalysis/AuditTabsSection';
import { useRunRegression } from './dataAnalysis/useRunRegression';

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

  // Backfill Sweep state
  const [sweepingBackfill, setSweepingBackfill] = useState(false);

  const canEdit = usePermission('data_analysis_review', 'edit');
  const canView = usePermission('data_analysis_review', 'view');

  // Plants list
  const { data: plantsData } = useQuery({
    queryKey: ['plants-list'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id,name').order('name');
      return (data ?? []) as Plant[];
    },
    staleTime: 10 * 60_000,
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
      // Only wells/locators/product_meters have an Active/Inactive status
      // column — ro_trains.status is the Running/Offline/Maintenance enum
      // and has no 'Active' value, so filtering by it throws a Postgres
      // 22P02 error. See ENTITY_CONFIG.filterActiveStatus in shared.ts.
      if (entityCfgMain.filterActiveStatus) q = q.eq('status', 'Active');
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

  const { handleRunRegression } = useRunRegression({
    sourceTable,
    column,
    plantId,
    entityId,
    dateFrom,
    dateTo,
    entityOptionsData,
    isAdmin,
    roles,
    session,
    refetchResults,
  });

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

  // Backfill Sweep
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

      <FilterToolbar
        sourceTable={sourceTable}
        column={column}
        plantId={plantId}
        entityId={entityId}
        powerSource={powerSource}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onColumnChange={setColumn}
        onPlantChange={setPlantId}
        onEntityChange={setEntityId}
        onPowerSourceChange={(v: string) => {
          setPowerSource(v);
          const opt = POWER_SOURCE_OPTIONS.find(o => o.value === v);
          if (opt && 'columns' in opt && opt.columns && opt.columns.length > 0) {
            setColumn(opt.columns[0]);
          } else if (v === 'all') {
            setColumn(SOURCE_TABLES['power_readings'][0]);
          }
        }}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        handleTableChange={handleTableChange}
        handlePlantChange={handlePlantChange}
        applyPreset={applyPreset}
        plants={plants}
        entityOptions={entityOptions}
        entityFetching={entityFetching}
        entityCfgMain={entityCfgMain}
        canEdit={canEdit}
      />

      {/* ── Two-table layout ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <RawDataPanel
          sourceTable={sourceTable}
          column={column}
          plantId={plantId}
          entityId={entityId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          canEdit={canEdit}
          onEdit={r => setEditReading(r)}
        />
        <RegressionResultsPanel
          resultsError={resultsError}
          regressionResults={regressionResults}
          canEdit={canEdit}
          onRefresh={() => { refetchResults(); qc.invalidateQueries({ queryKey: ['raw-readings'] }); }}
        />
      </div>

      <AuditTabsSection sourceTable={sourceTable} />

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
