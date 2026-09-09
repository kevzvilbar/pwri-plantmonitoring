/**
 * data/hooks/useChartSettings.ts — Chart settings state management
 * (roadmap Phase 3). Split from the massive chart controls into focused hooks.
 * 
 * Decomposition targets (per critique):
 * - ChartSettings: granularity, breakdown, stack mode
 * - SeriesSelector: locator/well/train selection, filtering
 * - AxisConfig: KWH source, cost lines, drill modes
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

// ─── ChartSettings ──────────────────────────────────────────────────────────────

interface ChartSettingsState {
  viewGran: string;
  setViewGran: (g: string) => void;
  viewBreakdown: string;
  setViewBreakdown: (b: string) => void;
  stackMode: string;
  setStackMode: (m: string) => void;
  rawwaterBreakdown: string;
  setRawwaterBreakdown: (b: string) => void;
  phDrillMode: string;
  setPhDrillMode: (m: string) => void;
  phDayFocus: string | null;
  setPhDayFocus: (d: string | null) => void;
  rangeDays: number;
}

const ChartSettingsContext = createContext<ChartSettingsState | null>(null);

export function ChartSettingsProvider({ 
  children, 
  initialGran = 'auto',
  initialBreakdown = 'total',
  initialStackMode = 'stacked',
  initialRawwaterBreakdown = 'total',
  initialPhDrillMode = 'turbidity',
  initialRangeDays = 30,
}: { 
  children: ReactNode;
  initialGran?: string;
  initialBreakdown?: string;
  initialStackMode?: string;
  initialRawwaterBreakdown?: string;
  initialPhDrillMode?: string;
  initialRangeDays?: number;
}) {
  const [viewGran, setViewGran] = useState(initialGran);
  const [viewBreakdown, setViewBreakdown] = useState(initialBreakdown);
  const [stackMode, setStackMode] = useState(initialStackMode);
  const [rawwaterBreakdown, setRawwaterBreakdown] = useState(initialRawwaterBreakdown);
  const [phDrillMode, setPhDrillMode] = useState(initialPhDrillMode);
  const [phDayFocus, setPhDayFocus] = useState<string | null>(null);
  const [rangeDays] = useState(initialRangeDays);

  const value = useMemo(() => ({
    viewGran, setViewGran,
    viewBreakdown, setViewBreakdown,
    stackMode, setStackMode,
    rawwaterBreakdown, setRawwaterBreakdown,
    phDrillMode, setPhDrillMode,
    phDayFocus, setPhDayFocus,
    rangeDays,
  }), [viewGran, viewBreakdown, stackMode, rawwaterBreakdown, phDrillMode, phDayFocus, rangeDays]);

  return (
    <ChartSettingsContext.Provider value={value}>
      {children}
    </ChartSettingsContext.Provider>
  );
}

export function useChartSettings(): ChartSettingsState {
  const context = useContext(ChartSettingsContext);
  if (!context) {
    throw new Error('useChartSettings must be used within a ChartSettingsProvider');
  }
  return context;
}

// ─── SeriesSelector ────────────────────────────────────────────────────────────

interface SeriesSelectorState {
  // Locator selection
  selectedLocatorIds: Set<string> | null;
  setSelectedLocatorIds: (ids: Set<string> | null) => void;
  showLocatorFilter: boolean;
  setShowLocatorFilter: (v: boolean) => void;
  allSelected: boolean;
  noneSelected: boolean;
  selectAllLocators: () => void;
  clearAllLocators: () => void;
  toggleLocator: (id: string) => void;
  locatorSearch: string;
  setLocatorSearch: (s: string) => void;
  filteredLocatorList: any[];
  locatorTotals: any;
  drillEntities: any[];
  selectTopNLocators: (n: number) => void;
  
  // Well selection
  selectedWellIds: Set<string>;
  setSelectedWellIds: (ids: Set<string>) => void;
  showWellFilter: boolean;
  setShowWellFilter: (v: boolean) => void;
  allWellsSelected: boolean;
  noneWellsSelected: boolean;
  selectAllWells: () => void;
  clearAllWells: () => void;
  toggleWell: (id: string) => void;
  wellSearch: string;
  setWellSearch: (s: string) => void;
  filteredWellList: any[];
  wellTotals: any;
  wellEntities: any[];
  selectTopNWells: (n: number) => void;
  
  // Train selection
  selectedTrainIds: Set<string>;
  setSelectedTrainIds: (ids: Set<string>) => void;
  showTrainFilter: boolean;
  setShowTrainFilter: (v: boolean) => void;
  allTrainsSelected: boolean;
  noTrainsSelected: boolean;
  selectAllTrains: () => void;
  clearAllTrains: () => void;
  toggleTrain: (id: string) => void;
  trainSearch: string;
  setTrainSearch: (s: string) => void;
  filteredTrainList: any[];
  roTrainEntities: any[];
}

const SeriesSelectorContext = createContext<SeriesSelectorState | null>(null);

export function SeriesSelectorProvider({ 
  children, 
  initialEntities = { drill: [], roTrain: [], well: [] }
}: { 
  children: ReactNode;
  initialEntities?: { drill: any[]; roTrain: any[]; well: any[] };
}) {
  const [selectedLocatorIds, setSelectedLocatorIds] = useState<Set<string> | null>(null);
  const [showLocatorFilter, setShowLocatorFilter] = useState(false);
  const [allSelected, setAllSelected] = useState(true);
  const [noneSelected, setNoneSelected] = useState(false);
  const [locatorSearch, setLocatorSearch] = useState('');
  
  const [selectedWellIds, setSelectedWellIds] = useState<Set<string>>(new Set());
  const [showWellFilter, setShowWellFilter] = useState(false);
  const [allWellsSelected, setAllWellsSelected] = useState(true);
  const [noneWellsSelected, setNoneWellsSelected] = useState(false);
  const [wellSearch, setWellSearch] = useState('');
  
  const [selectedTrainIds, setSelectedTrainIds] = useState<Set<string>>(new Set());
  const [showTrainFilter, setShowTrainFilter] = useState(false);
  const [allTrainsSelected, setAllTrainsSelected] = useState(true);
  const [noTrainsSelected, setNoTrainsSelected] = useState(false);
  const [trainSearch, setTrainSearch] = useState('');

  // These would come from parent or be computed
  const { drill, roTrain, well } = initialEntities;

  const selectAllLocators = useCallback(() => {
    setAllSelected(true);
    setNoneSelected(false);
  }, []);
  
  const clearAllLocators = useCallback(() => {
    setSelectedLocatorIds(null);
    setAllSelected(false);
    setNoneSelected(true);
  }, [setSelectedLocatorIds]);
  
  const toggleLocator = useCallback((id: string) => {
    setSelectedLocatorIds(prev => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [setSelectedLocatorIds]);
  
  const selectAllWells = useCallback(() => {
    setAllWellsSelected(true);
    setNoneWellsSelected(false);
  }, []);
  
  const clearAllWells = useCallback(() => {
    setSelectedWellIds(new Set());
    setAllWellsSelected(false);
    setNoneWellsSelected(true);
  }, [setSelectedWellIds]);
  
  const toggleWell = useCallback((id: string) => {
    setSelectedWellIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [setSelectedWellIds]);
  
  const selectAllTrains = useCallback(() => {
    setAllTrainsSelected(true);
    setNoTrainsSelected(false);
  }, []);
  
  const clearAllTrains = useCallback(() => {
    setSelectedTrainIds(new Set());
    setAllTrainsSelected(false);
    setNoTrainsSelected(true);
  }, [setSelectedTrainIds]);
  
  const toggleTrain = useCallback((id: string) => {
    setSelectedTrainIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [setSelectedTrainIds]);

  const selectTopNLocators = useCallback((n: number) => {
    // Implementation would filter drill entities
    console.log('selectTopNLocators', n);
  }, [drill]);
  
  const selectTopNWells = useCallback((n: number) => {
    console.log('selectTopNWells', n);
  }, [well]);

  const value = useMemo(() => ({
    // Locator
    selectedLocatorIds, setSelectedLocatorIds,
    showLocatorFilter, setShowLocatorFilter,
    allSelected, noneSelected,
    selectAllLocators, clearAllLocators, toggleLocator,
    locatorSearch, setLocatorSearch,
    filteredLocatorList: drill,
    locatorTotals: null,
    drillEntities: drill,
    selectTopNLocators,
    // Well
    selectedWellIds, setSelectedWellIds,
    showWellFilter, setShowWellFilter,
    allWellsSelected, noneWellsSelected,
    selectAllWells, clearAllWells, toggleWell,
    wellSearch, setWellSearch,
    filteredWellList: well,
    wellTotals: null,
    wellEntities: well,
    selectTopNWells,
    // Train
    selectedTrainIds, setSelectedTrainIds,
    showTrainFilter, setShowTrainFilter,
    allTrainsSelected, noTrainsSelected,
    selectAllTrains, clearAllTrains, toggleTrain,
    trainSearch, setTrainSearch,
    filteredTrainList: roTrain,
    roTrainEntities: roTrain,
  }), [
    selectedLocatorIds, showLocatorFilter, allSelected, noneSelected,
    locatorSearch, selectedWellIds, showWellFilter, allWellsSelected, noneWellsSelected,
    wellSearch, selectedTrainIds, showTrainFilter, allTrainsSelected, noTrainsSelected,
    trainSearch, drill, roTrain, well,
  ]);

  return (
    <SeriesSelectorContext.Provider value={value}>
      {children}
    </SeriesSelectorContext.Provider>
  );
}

export function useSeriesSelector(): SeriesSelectorState {
  const context = useContext(SeriesSelectorContext);
  if (!context) {
    throw new Error('useSeriesSelector must be used within a SeriesSelectorProvider');
  }
  return context;
}

// ─── AxisConfig ────────────────────────────────────────────────────────────────

interface AxisConfigState {
  kwhSource: string;
  setKwhSource: (s: string) => void;
  roDrillMode: string;
  setRoDrillMode: (m: string) => void;
  showTotalCostLine: boolean;
  setShowTotalCostLine: (v: boolean) => void;
  showPowerCostLine: boolean;
  setShowPowerCostLine: (v: boolean) => void;
  showChemCostLine: boolean;
  setShowChemCostLine: (v: boolean) => void;
  prodDrillSource: string;
  setProdDrillSource: (s: string) => void;
  usePermeateForSource: boolean;
  setUsePermeateForSource: (v: boolean) => void;
}

const AxisConfigContext = createContext<AxisConfigState | null>(null);

export function AxisConfigProvider({ 
  children, 
  initialKwhSource = 'auto',
  initialRoDrillMode = 'permeate',
}: { 
  children: ReactNode;
  initialKwhSource?: string;
  initialRoDrillMode?: string;
}) {
  const [kwhSource, setKwhSource] = useState(initialKwhSource);
  const [roDrillMode, setRoDrillMode] = useState(initialRoDrillMode);
  const [showTotalCostLine, setShowTotalCostLine] = useState(true);
  const [showPowerCostLine, setShowPowerCostLine] = useState(false);
  const [showChemCostLine, setShowChemCostLine] = useState(false);
  const [prodDrillSource, setProdDrillSource] = useState('permeate');
  const [usePermeateForSource, setUsePermeateForSource] = useState(true);

  const value = useMemo(() => ({
    kwhSource, setKwhSource,
    roDrillMode, setRoDrillMode,
    showTotalCostLine, setShowTotalCostLine,
    showPowerCostLine, setShowPowerCostLine,
    showChemCostLine, setShowChemCostLine,
    prodDrillSource, setProdDrillSource,
    usePermeateForSource, setUsePermeateForSource,
  }), [
    kwhSource, roDrillMode,
    showTotalCostLine, showPowerCostLine, showChemCostLine,
    prodDrillSource, usePermeateForSource,
  ]);

  return (
    <AxisConfigContext.Provider value={value}>
      {children}
    </AxisConfigContext.Provider>
  );
}

export function useAxisConfig(): AxisConfigState {
  const context = useContext(AxisConfigContext);
  if (!context) {
    throw new Error('useAxisConfig must be used within an AxisConfigProvider');
  }
  return context;
}