import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import {
  readStackMode, writeStackMode, type StackMode,
  type DrillFocus, type Granularity,
} from '../TrendChartDrillKit';
import { RANGE_DAYS, type ChartMetric, type RangeKey } from '../types';
import { rangeDaysBetween } from '../TrendChartAggregate';
import { format, subDays, startOfDay } from 'date-fns';

export interface TrendChartState {
  metric: string;
  plantIds: string[];
  compact: boolean;
  range: RangeKey;
  from: string;
  to: string;
  chartYear: number;
  chartMonth: string;
  setRange: (r: RangeKey) => void;
  handleCustomDatesChange: (f: string, t: string) => void;
  setChartMonthlyPeriod: (year: number, month: string) => void;
  showSummary: boolean;
  setShowSummary: (v: boolean) => void;
  startISO: string;
  endISO: string;
  startKey: string;
  endKey: string;
  rangeDays: number;
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  handleGranularityChange: (g: Granularity) => void;
  viewBreakdown: 'total' | 'by-locator' | 'by-source';
  setViewBreakdown: (v: 'total' | 'by-locator' | 'by-source') => void;
  drillMode: 'default' | 'drilldown';
  prodDrillSource: 'locator' | 'source';
  rawwaterBreakdown: 'total' | 'by-well';
  setRawwaterBreakdown: (v: 'total' | 'by-well') => void;
  selectedWellIds: Set<string> | null;
  setSelectedWellIds: (v: Set<string> | null) => void;
  stackMode: StackMode;
  setStackMode: (m: StackMode) => void;
  drillFocus: DrillFocus | null;
  setDrillFocus: (v: DrillFocus | null) => void;
  selectedLocatorIds: Set<string> | null;
  setSelectedLocatorIds: (v: Set<string> | null) => void;
  locatorSearch: string;
  setLocatorSearch: (v: string) => void;
  showLocatorFilter: boolean;
  setShowLocatorFilter: (v: boolean) => void;
  wellSearch: string;
  setWellSearch: (v: string) => void;
  showWellFilter: boolean;
  setShowWellFilter: (v: boolean) => void;
  showPowerCostLine: boolean;
  setShowPowerCostLine: (v: boolean) => void;
  showChemCostLine: boolean;
  setShowChemCostLine: (v: boolean) => void;
  showTotalCostLine: boolean;
  setShowTotalCostLine: (v: boolean) => void;
  kwhSource: 'both' | 'solar' | 'grid';
  setKwhSource: (v: 'both' | 'solar' | 'grid') => void;
  roDrillMode: 'default' | 'by-train' | 'by-hour';
  setRoDrillMode: (v: 'default' | 'by-train' | 'by-hour') => void;
  selectedTrainIds: Set<string> | null;
  setSelectedTrainIds: (v: Set<string> | null) => void;
  trainSearch: string;
  setTrainSearch: (v: string) => void;
  showTrainFilter: boolean;
  setShowTrainFilter: (v: boolean) => void;
  phDrillMode: 'daily' | 'hourly' | 'weekly' | 'monthly';
  setPhDrillMode: (v: 'daily' | 'hourly' | 'weekly' | 'monthly') => void;
  hasPlantHealth: boolean;
  phDayFocus: string | null;
  setPhDayFocus: (v: string | null) => void;
  hasConsumptionDrill: boolean;
  hasRoDrill: boolean;
  usesSharedGranularity: boolean;
}

export function useTrendChartState(metric: string, plantIds: string[]): Omit<TrendChartState, 'metric' | 'plantIds' | 'compact'> {
  const range = useAppStore((s) => s.chartRange);
  const from = useAppStore((s) => s.chartFrom);
  const to = useAppStore((s) => s.chartTo);
  const chartYear = useAppStore((s) => s.chartYear);
  const chartMonth = useAppStore((s) => s.chartMonth);
  const setRange = useAppStore((s) => s.setChartRange);
  const setChartCustomDates = useAppStore((s) => s.setChartCustomDates);
  const setChartMonthlyPeriod = useAppStore((s) => s.setChartMonthlyPeriod);

  const handleCustomDatesChange = useCallback((f: string, t: string) => setChartCustomDates(f, t), [setChartCustomDates]);

  const [showSummary, setShowSummary] = useState(false);

  const queryClient = useQueryClient();
  const plantIdsKey = plantIds.join(',');
  useEffect(() => {
    if (!plantIds.length) return;
    const uid = Math.random().toString(36).slice(2, 9);
    const powerCh = supabase
      .channel(`trend-rt-power-${plantIdsKey}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'power_readings' }, () => {
        queryClient.invalidateQueries({ queryKey: ['trend-power'] });
        queryClient.invalidateQueries({ queryKey: ['trend-bill-multipliers'] });
        queryClient.invalidateQueries({ queryKey: ['trend-power-config'] });
      })
      .subscribe();
    const chemCh = supabase
      .channel(`trend-rt-chem-${plantIdsKey}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chemical_dosing_logs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['trend-cost'] });
      })
      .subscribe();
    const costCh = supabase
      .channel(`trend-rt-cost-${plantIdsKey}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_costs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['trend-cost'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(powerCh);
      supabase.removeChannel(chemCh);
      supabase.removeChannel(costCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantIdsKey, queryClient]);

  const [viewGran, setViewGran] = useState<Granularity>(range === 'MONTHLY' && chartMonth === 'YTD' ? 'monthly' : 'daily');
  useEffect(() => {
    if (range === 'MONTHLY') {
      setViewGran(chartMonth === 'YTD' ? 'monthly' : 'daily');
    }
  }, [range, chartMonth]);

  const [viewBreakdown, setViewBreakdown] = useState<'total' | 'by-locator' | 'by-source'>('total');
  const hasConsumptionDrill = metric === 'production' || metric === 'nrw';
  const usesSharedGranularity =
    hasConsumptionDrill || metric === 'rawwater' || metric === 'productionCost'
    || metric === 'pv' || metric === 'kwh' || metric === 'tds' || metric === 'recovery';

  const drillMode = viewBreakdown !== 'total' ? 'drilldown' : 'default';
  const prodDrillSource = viewBreakdown === 'by-source' ? 'source' : 'locator';

  const [rawwaterBreakdown, setRawwaterBreakdown] = useState<'total' | 'by-well'>('total');
  const [selectedWellIds, setSelectedWellIds] = useState<Set<string> | null>(null);
  useEffect(() => { if (metric !== 'rawwater') { setRawwaterBreakdown('total'); setSelectedWellIds(null); } }, [metric]);

  const defaultStackModeFor = useCallback((m: string): StackMode => (m === 'kwh' ? 'stacked' : 'grouped'), []);
  const [stackMode, setStackModeState] = useState<StackMode>(() => readStackMode(metric, defaultStackModeFor(metric)));
  useEffect(() => { setStackModeState(readStackMode(metric, defaultStackModeFor(metric))); }, [metric, defaultStackModeFor]);
  const setStackMode = useCallback((m: StackMode) => { setStackModeState(m); writeStackMode(metric, m); }, [metric]);

  const [drillFocus, setDrillFocus] = useState<DrillFocus | null>(null);
  useEffect(() => { setDrillFocus(null); }, [range, chartMonth]);

  const handleGranularityChange = useCallback((g: Granularity) => { setViewGran(g); setDrillFocus(null); }, []);

  const [selectedLocatorIds, setSelectedLocatorIds] = useState<Set<string> | null>(null);
  const [locatorSearch, setLocatorSearch] = useState('');
  const [showLocatorFilter, setShowLocatorFilter] = useState(false);

  const [wellSearch, setWellSearch] = useState('');
  const [showWellFilter, setShowWellFilter] = useState(false);

  const [showPowerCostLine, setShowPowerCostLine] = useState(true);
  const [showChemCostLine, setShowChemCostLine] = useState(true);
  const [showTotalCostLine, setShowTotalCostLine] = useState(true);

  const [kwhSource, setKwhSource] = useState<'both' | 'solar' | 'grid'>('both');
  useEffect(() => { if (metric !== 'kwh') setKwhSource('both'); }, [metric]);

  const [roDrillMode, setRoDrillMode] = useState<'default' | 'by-train' | 'by-hour'>('default');
  useEffect(() => { setDrillFocus(null); }, [metric, viewBreakdown, roDrillMode, rawwaterBreakdown]);
  const hasRoDrill = metric === 'tds' || metric === 'recovery';
  const [selectedTrainIds, setSelectedTrainIds] = useState<Set<string> | null>(null);
  const [trainSearch, setTrainSearch] = useState('');
  const [showTrainFilter, setShowTrainFilter] = useState(false);

  const [phDrillMode, setPhDrillMode] = useState<'daily' | 'hourly' | 'weekly' | 'monthly'>('daily');
  const hasPlantHealth = metric === 'plantHealth';

  const [phDayFocus, setPhDayFocus] = useState<string | null>(null);
  useEffect(() => { if (!hasPlantHealth) setPhDayFocus(null); }, [hasPlantHealth]);

  const { startISO, endISO, startKey, endKey } = useMemo(() => {
    if (range === 'CUSTOM' || range === 'MONTHLY') {
      const s = new Date(`${from}T00:00:00`);
      const e = new Date(`${to}T23:59:59`);
      return { startISO: s.toISOString(), endISO: e.toISOString(), startKey: from, endKey: to };
    }
    const days = RANGE_DAYS[range];
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const start = startOfDay(subDays(today, days));
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startKey: format(start, 'yyyy-MM-dd'),
      endKey: format(today, 'yyyy-MM-dd'),
    };
  }, [range, from, to]);

  const rangeDays = useMemo(() => rangeDaysBetween(startKey, endKey), [startKey, endKey]);

  return {
    range, from, to, chartYear, chartMonth,
    setRange, handleCustomDatesChange, setChartMonthlyPeriod,
    showSummary, setShowSummary,
    startISO, endISO, startKey, endKey, rangeDays,
    viewGran, setViewGran, handleGranularityChange,
    viewBreakdown, setViewBreakdown, drillMode, prodDrillSource,
    rawwaterBreakdown, setRawwaterBreakdown,
    selectedWellIds, setSelectedWellIds,
    stackMode, setStackMode,
    drillFocus, setDrillFocus,
    selectedLocatorIds, setSelectedLocatorIds, locatorSearch, setLocatorSearch,
    showLocatorFilter, setShowLocatorFilter,
    wellSearch, setWellSearch, showWellFilter, setShowWellFilter,
    showPowerCostLine, setShowPowerCostLine, showChemCostLine, setShowChemCostLine,
    showTotalCostLine, setShowTotalCostLine,
    kwhSource, setKwhSource,
    roDrillMode, setRoDrillMode,
    selectedTrainIds, setSelectedTrainIds, trainSearch, setTrainSearch,
    showTrainFilter, setShowTrainFilter,
    phDrillMode, setPhDrillMode, hasPlantHealth,
    phDayFocus, setPhDayFocus,
    hasConsumptionDrill, hasRoDrill, usesSharedGranularity,
  };
}
