/**
 * Compliance.tsx — Compliance & Regulatory Radar page orchestrator.
 *
 * This file re-exports the full public API that external callers depend on
 * (Dashboard.tsx, ComplianceRadarCard, NRWGaugeCard, TrendChartCanvas,
 * ROTrains/Overview, ROTrains/index, PlantHeroBanner, Compliance.test.ts)
 * so that `import ... from '@/pages/Compliance'` continues to resolve.
 *
 * The actual logic lives in:
 *   ./compliance/types.ts          — types, utils, Supabase functions
 *   ./compliance/components/       — UI subcomponents
 */
export type { Thresholds, Violation, ChemSupply, PlantComplianceSummary } from './compliance/types';
export {
  DEFAULT_THRESHOLDS,
  computeViolations,
  fetchPlantMetrics,
  fetchChemDaysOfSupply,
  loadThresholds,
} from './compliance/types';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import {
  ShieldCheck, Loader2, RefreshCw, FileDown, Layers, Settings2, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { usePermission } from '@/hooks/usePermission';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import {
  loadThresholds,
  persistThresholds,
  fetchPlantMetrics,
  fetchChemDaysOfSupply,
  fetchPreviousPeriodMetrics,
  computeViolations,
  useFleetCompliance,
  scoreLabel,
  computeComplianceScore,
} from './compliance/types';
import type { Thresholds, DailyRow, ChemSupply, EvalResult } from './compliance/types';

import { StatusTab } from './compliance/components/StatusTab';
import { FleetMatrix } from './compliance/components/FleetMatrix';
import { ThresholdEditor } from './compliance/components/ThresholdEditor';
import { WhatIfSimulator } from './compliance/components/WhatIfSimulator';

export default function Compliance() {
  const { data: plants }    = usePlants();
  const { selectedPlantId, setSelectedPlantId } = useAppStore();
  const [plantId, setPlantId]   = useState<string>(selectedPlantId ?? (plants?.[0]?.id ?? 'global'));
  const [days, setDays]         = useState<number>(7);
  const [scope, setScope]       = useState<'global' | 'plant'>(selectedPlantId ? 'plant' : 'plant');
  const [editing, setEditing]   = useState(false);
  const canEditThresholds = usePermission('compliance', 'edit');
  const [local, setLocal]       = useState<Thresholds | null>(null);
  const [saving, setSaving]     = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult]     = useState<EvalResult | null>(null);
  const [overrideMetrics, setOverrideMetrics] = useState<Record<string, string>>({});
  const [complianceTab, setComplianceTab] = useTabPersist<'status' | 'fleet' | 'thresholds' | 'whatif'>(
    'tab:compliance', 'status',
  );
  const [dailyRows, setDailyRows]           = useState<DailyRow[]>([]);
  const [prevMetrics, setPrevMetrics]       = useState<Record<string, number | undefined>>({});
  const [previewMetrics, setPreviewMetrics] = useState<Record<string, number | undefined> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [whatIfViolations, setWhatIfViolations] = useState<ReturnType<typeof computeViolations> | null>(null);
  const [chemSupply, setChemSupply]         = useState<ChemSupply[]>([]);

  const { data: fleetSummaries = [], isLoading: fleetLoading, refetch: refetchFleet } = useFleetCompliance(plants, days);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (selectedPlantId) {
      setPlantId(selectedPlantId);
      setScope('plant');
    }
  }, [selectedPlantId]);

  const thresholdScope = scope === 'plant' && plantId ? plantId : 'global';

  const { data: thData, refetch: refetchThresholds } = useQuery({
    queryKey: ['thresholds', thresholdScope],
    queryFn:  async () => {
      const thresholds = await loadThresholds(thresholdScope);
      return { scope: thresholdScope, thresholds };
    },
    retry: false,
  });

  useEffect(() => {
    if (thData?.thresholds && !editing) setLocal(thData.thresholds);
  }, [thData, editing]);

  // Auto-preview metrics
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (scope !== 'plant' || !plantId || plantId === 'global') {
      setPreviewMetrics(null);
      setChemSupply([]);
      return;
    }
    const controller = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = controller;

    setPreviewLoading(true);
    Promise.all([
      fetchPlantMetrics(plantId, days),
      fetchChemDaysOfSupply(plantId),
    ])
      .then(([{ metrics }, chem]) => {
        if (!controller.signal.aborted) {
          setPreviewMetrics(metrics);
          setChemSupply(chem);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });

    return () => controller.abort();
  }, [scope, plantId, days]);

  // Real-time what-if simulations
  useEffect(() => {
    if (!local) return;
    const hasAnyOverride = Object.values(overrideMetrics).some((v) => v !== '');
    if (!hasAnyOverride) { setWhatIfViolations(null); return; }

    const merged: Record<string, number | undefined> = { ...(previewMetrics ?? {}) };
    for (const [k, v] of Object.entries(overrideMetrics)) {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) merged[k] = n;
    }
    setWhatIfViolations(computeViolations(merged, local, chemSupply));
  }, [overrideMetrics, previewMetrics, local, chemSupply]);

  // Evaluate current plant
  const runEvaluate = useCallback(async () => {
    if (!plantId || plantId === 'global') return;
    setEvaluating(true);
    try {
      const scope_label =
        scope === 'plant'
          ? (plants ?? []).find((p) => p.id === plantId)?.name
          : 'All plants';

      const [fetched, chemFetched] = await Promise.all([
        fetchPlantMetrics(plantId, days),
        fetchChemDaysOfSupply(plantId),
      ]);
      const metrics = { ...fetched.metrics };
      const rows    = fetched.rows;
      const chem    = chemFetched;

      const prev = await fetchPreviousPeriodMetrics(plantId, days);
      setPrevMetrics(prev);
      setDailyRows(rows);
      setPreviewMetrics(metrics);
      setChemSupply(chem);

      for (const [k, v] of Object.entries(overrideMetrics)) {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) metrics[k] = n;
      }

      const thresholds = await loadThresholds(thresholdScope);
      const violations = computeViolations(metrics, thresholds, chem);

      setResult({ scope: thresholdScope, scope_label, evaluated_at: new Date().toISOString(), violations, thresholds });
      setLocal(thresholds);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setEvaluating(false);
    }
  }, [plantId, scope, days, plants, overrideMetrics, thresholdScope]);

  useEffect(() => {
    if (plantId && plantId !== 'global') {
      runEvaluate();
    }
  }, [plantId, days, scope, runEvaluate]);

  // Save thresholds
  const saveThresholds = useCallback(async () => {
    if (!local) return;
    setSaving(true);
    try {
      await persistThresholds(thresholdScope, local);
      await queryClient.invalidateQueries({ queryKey: ['thresholds'] });
      toast.success('Thresholds saved successfully.');
      setEditing(false);
      refetchThresholds();
      refetchFleet();
      runEvaluate();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }, [local, thresholdScope, queryClient, refetchThresholds, refetchFleet, runEvaluate]);

  const totalCriticalViolations = fleetSummaries.reduce(
    (sum, p) => sum + p.violations.filter((v) => v.severity === 'high').length, 0,
  );

  const exportComplianceCsv = () => {
    const headers = [
      'Facility Name', 'Compliance Score %', 'Rating Tier', 'Total Violations',
      'Critical (High)', 'Medium Violations', 'Low Violations',
      'NRW %', 'Permeate TDS (ppm)', 'Permeate pH', 'Product Turbidity (NTU)',
      'Differential Pressure (psi)', 'Recovery %', 'Downtime (hrs/day)', 'Chemical Supply Alert', 'Audit Date',
    ];

    const rowsData = fleetSummaries.map((p) => {
      const highCount = p.violations.filter((v) => v.severity === 'high').length;
      const medCount = p.violations.filter((v) => v.severity === 'medium').length;
      const lowCount = p.violations.filter((v) => v.severity === 'low').length;
      const chemLow = p.violations.filter((v) => v.code === 'CHEM_LOW').map((v) => `${v.metric} (${v.value}d)`).join('; ') || 'Normal';
      const turbVal = p.metrics.product_turbidity ?? p.metrics.raw_turbidity;
      return [
        `"${p.plantName}"`, `"${p.score}%"`, `"${scoreLabel(p.score)}"`, `"${p.violations.length}"`,
        `"${highCount}"`, `"${medCount}"`, `"${lowCount}"`,
        `"${p.metrics.nrw_pct !== undefined ? p.metrics.nrw_pct.toFixed(1) + '%' : '—'}"`,
        `"${p.metrics.permeate_tds !== undefined ? p.metrics.permeate_tds.toFixed(1) : '—'}"`,
        `"${p.metrics.permeate_ph !== undefined ? p.metrics.permeate_ph.toFixed(2) : '—'}"`,
        `"${turbVal !== undefined ? turbVal.toFixed(2) : '—'}"`,
        `"${p.metrics.dp_psi !== undefined ? p.metrics.dp_psi.toFixed(1) : '—'}"`,
        `"${p.metrics.recovery_pct !== undefined ? p.metrics.recovery_pct.toFixed(1) + '%' : '—'}"`,
        `"${p.metrics.downtime_hrs !== undefined ? p.metrics.downtime_hrs.toFixed(1) : '—'}"`,
        `"${chemLow}"`, `"${new Date().toISOString().slice(0, 10)}"`,
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rowsData.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `compliance_audit_matrix_${days}d_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Compliance audit matrix exported successfully.');
  };

  const handleSelectPlant = (id: string) => {
    setPlantId(id);
    setScope('plant');
    setSelectedPlantId(id);
    setComplianceTab('status');
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PageHeader
          title="Compliance & Regulatory Radar"
          titleIcon={<ShieldCheck className="h-5 w-5 text-accent" />}
          subtitle="Real-time threshold surveillance for water quality parameters, plant hydraulic efficiency, NRW, downtime, and chemical autonomy."
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background"
            onClick={exportComplianceCsv} title="Download complete compliance evaluation audit across all plants">
            <FileDown className="h-3.5 w-3.5 text-primary" />
            <span>Export Compliance Audit (.csv)</span>
          </Button>
        </div>
      </div>

      {/* Controls Card */}
      <Card className="p-3 bg-muted/20 border-border/70">
        <div className="grid gap-2.5 md:grid-cols-[140px_1fr_140px_auto] items-end">
          <div>
            <Label htmlFor="compliance-scope" className="text-xs font-semibold">Surveillance Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as 'global' | 'plant')}>
              <SelectTrigger className="mt-1 bg-background" id="compliance-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="plant">Facility Specific</SelectItem>
                <SelectItem value="global">Global Standard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="compliance-plant" className="text-xs font-semibold">Active Facility</Label>
            <Select value={plantId} onValueChange={(v) => { setPlantId(v); setSelectedPlantId(v); }} disabled={scope === 'global'}>
              <SelectTrigger className="mt-1 bg-background" id="compliance-plant"><SelectValue placeholder="Pick plant…" /></SelectTrigger>
              <SelectContent>
                {(plants ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="compliance-window-days" className="text-xs font-semibold">Audit Window</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="mt-1 bg-background" id="compliance-window-days"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 7, 14, 30, 90].map((d) => (
                  <SelectItem key={d} value={String(d)}>{d === 90 ? '90d (Quarterly)' : `${d}d`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-9 font-semibold bg-background" disabled={evaluating} onClick={runEvaluate}>
              {evaluating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Re-Evaluate
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs value={complianceTab} onValueChange={(v) => setComplianceTab(v as typeof complianceTab)}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 gap-1 h-auto sm:h-10 w-full">
          <TabsTrigger value="status" className="gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Facility Radar &amp; Drill-down
          </TabsTrigger>
          <TabsTrigger value="fleet" className="gap-1.5 text-xs">
            <Layers className="h-3.5 w-3.5" />
            Fleet Comparative Matrix
            {totalCriticalViolations > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-2xs bg-destructive text-destructive-foreground">
                {totalCriticalViolations}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="thresholds" className="gap-1.5 text-xs">
            <Settings2 className="h-3.5 w-3.5" />
            Threshold Limits
          </TabsTrigger>
          <TabsTrigger value="whatif" className="gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5" />
            What-If Simulator
            {whatIfViolations !== null && (
              <Badge className="ml-1 text-2xs h-4 px-1 bg-warn">
                {whatIfViolations.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="mt-4 space-y-4">
          <StatusTab
            result={result}
            evaluating={evaluating}
            dailyRows={dailyRows}
            previewMetrics={previewMetrics}
            prevMetrics={prevMetrics}
            chemSupply={chemSupply}
            days={days}
          />
        </TabsContent>

        <TabsContent value="fleet" className="mt-4">
          <FleetMatrix
            fleetSummaries={fleetSummaries}
            fleetLoading={fleetLoading}
            days={days}
            onRefetch={() => refetchFleet()}
            onSelectPlant={handleSelectPlant}
          />
        </TabsContent>

        <TabsContent value="thresholds" className="mt-4">
          <ThresholdEditor
            local={local}
            editing={editing}
            saving={saving}
            canEdit={canEditThresholds}
            thresholdScope={thresholdScope}
            plants={plants}
            onLocalChange={setLocal}
            onScopeChange={(val) => {
              if (val === 'global') {
                setScope('global');
                setPlantId('');
              } else {
                setScope('plant');
                setPlantId(val);
              }
              setEditing(false);
            }}
            onStartEdit={() => setEditing(true)}
            onCancelEdit={() => { setEditing(false); if (thData) setLocal(thData.thresholds); }}
            onSave={saveThresholds}
          />
        </TabsContent>

        <TabsContent value="whatif" className="mt-4 space-y-4">
          <WhatIfSimulator
            overrideMetrics={overrideMetrics}
            previewMetrics={previewMetrics}
            whatIfViolations={whatIfViolations}
            local={local}
            onOverrideChange={(k, v) => setOverrideMetrics((m) => ({ ...m, [k]: v }))}
            onClear={() => { setOverrideMetrics({}); setWhatIfViolations(null); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
