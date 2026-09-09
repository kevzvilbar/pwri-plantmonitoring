/**
 * data/hooks/useChartControls.ts — Centralized state management for trend chart controls
 * (roadmap Phase 3). Replaces massive prop drilling with a single Zustand-like store
 * wrapped in React Context for the chart controls state.
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

interface ChartControlsState {
  // Core chart settings
  viewGran: string;
  setViewGran: (g: string) => void;
  
  viewBreakdown: string;
  setViewBreakdown: (b: string) => void;
  
  stackMode: string;
  setStackMode: (m: string) => void;
  
  // Raw water breakdown
  rawwaterBreakdown: string;
  setRawwaterBreakdown: (b: string) => void;
  
  // KWH source
  kwhSource: string;
  setKwhSource: (s: string) => void;
  
  // RO drill mode
  roDrillMode: string;
  setRoDrillMode: (m: string) => void;
  
  // Plant health drill mode
  phDrillMode: string;
  setPhDrillMode: (m: string) => void;
  phDayFocus: string | null;
  setPhDayFocus: (d: string | null) => void;
  
  // Production cost lines
  showTotalCostLine: boolean;
  setShowTotalCostLine: (v: boolean) => void;
  showPowerCostLine: boolean;
  setShowPowerCostLine: (v: boolean) => void;
  showChemCostLine: boolean;
  setShowChemCostLine: (v: boolean) => void;
  
  // Production drill source
  prodDrillSource: string;
  setProdDrillSource: (s: string) => void;
  usePermeateForSource: boolean;
  setUsePermeateForSource: (v: boolean) => void;
  
  // Filter states
  selectedLocatorIds: Set<string> | null;
  setSelectedLocatorIds: (ids: Set<string> | null) => void;
  showLocatorFilter: boolean;
  setShowLocatorFilter: (v: boolean) => void;
  allSelected: boolean;
  noneSelected: boolean;
  selectAllLocators: () => void;
  clearAllLocators: () => void;
  toggleLocator: (id: string) => void;
  
  selectedWellIds: Set<string>;
  setSelectedWellIds: (ids: Set<string>) => void;
  showWellFilter: boolean;
  setShowWellFilter: (v: boolean) => void;
  allWellsSelected: boolean;
  noneWellsSelected: boolean;
  selectAllWells: () => void;
  clearAllWells: () => void;
  toggleWell: (id: string) => void;
  
  selectedTrainIds: Set<string>;
  setSelectedTrainIds: (ids: Set<string>) => void;
  showTrainFilter: boolean;
  setShowTrainFilter: (v: boolean) => void;
  allTrainsSelected: boolean;
  noTrainsSelected: boolean;
  selectAllTrains: () => void;
  clearAllTrains: () => void;
  toggleTrain: (id: string) => void;
  
  // Search states
  locatorSearch: string;
  setLocatorSearch: (s: string) => void;
  trainSearch: string;
  setTrainSearch: (s: string) => void;
  wellSearch: string;
  setWellSearch: (s: string) => void;
  
  // Entities for filter panels
  drillEntities: any[];
  roTrainEntities: any[];
  wellEntities: any[];
  filteredLocatorList: any[];
  filteredTrainList: any[];
  filteredWellList: any[];
  locatorTotals: any;
  wellTotals: any;
  
  // Helpers
  selectTopNLocators: (n: number) => void;
  selectTopNWells: (n: number) => void;
}

const ChartControlsContext = createContext<ChartControlsState | null>(null);

/** Provider component for chart controls state */
export function ChartControlsProvider({ 
  children, 
  initialState 
}: { 
  children: ReactNode;
  initialState?: Partial<ChartControlsState>;
}) {
  // Initialize state
  const [viewGran, setViewGran] = useState(initialState?.viewGran ?? 'auto');
  const [viewBreakdown, setViewBreakdown] = useState(initialState?.viewBreakdown ?? 'total');
  const [stackMode, setStackMode] = useState(initialState?.stackMode ?? 'stacked');
  const [rawwaterBreakdown, setRawwaterBreakdown] = useState(initialState?.rawwaterBreakdown ?? 'total');
  const [kwhSource, setKwhSource] = useState(initialState?.kwhSource ?? 'auto');
  const [roDrillMode, setRoDrillMode] = useState(initialState?.roDrillMode ?? 'permeate');
  const [phDrillMode, setPhDrillMode] = useState(initialState?.phDrillMode ?? 'turbidity');
  const [phDayFocus, setPhDayFocus] = useState<string | null>(initialState?.phDayFocus ?? null);
  
  const [showTotalCostLine, setShowTotalCostLine] = useState(initialState?.showTotalCostLine ?? true);
  const [showPowerCostLine, setShowPowerCostLine] = useState(initialState?.showPowerCostLine ?? false);
  const [showChemCostLine, setShowChemCostLine] = useState(initialState?.showChemCostLine ?? false);
  
  const [prodDrillSource, setProdDrillSource] = useState(initialState?.prodDrillSource ?? 'permeate');
  const [usePermeateForSource, setUsePermeateForSource] = useState(initialState?.usePermeateForSource ?? true);
  
  const [selectedLocatorIds, setSelectedLocatorIds] = useState<Set<string> | null>(initialState?.selectedLocatorIds ?? null);
  const [showLocatorFilter, setShowLocatorFilter] = useState(initialState?.showLocatorFilter ?? false);
  const [allSelected, setAllSelected] = useState(initialState?.allSelected ?? true);
  const [noneSelected, setNoneSelected] = useState(initialState?.noneSelected ?? false);
  
  const [selectedWellIds, setSelectedWellIds] = useState<Set<string>>(initialState?.selectedWellIds ?? new Set());
  const [showWellFilter, setShowWellFilter] = useState(initialState?.showWellFilter ?? false);
  const [allWellsSelected, setAllWellsSelected] = useState(initialState?.allWellsSelected ?? true);
  const [noneWellsSelected, setNoneWellsSelected] = useState(initialState?.noneWellsSelected ?? false);
  
  const [selectedTrainIds, setSelectedTrainIds] = useState<Set<string>>(initialState?.selectedTrainIds ?? new Set());
  const [showTrainFilter, setShowTrainFilter] = useState(initialState?.showTrainFilter ?? false);
  const [allTrainsSelected, setAllTrainsSelected] = useState(initialState?.allTrainsSelected ?? true);
  const [noTrainsSelected, setNoTrainsSelected] = useState(initialState?.noTrainsSelected ?? false);
  
  const [locatorSearch, setLocatorSearch] = useState(initialState?.locatorSearch ?? '');
  const [trainSearch, setTrainSearch] = useState(initialState?.trainSearch ?? '');
  const [wellSearch, setWellSearch] = useState(initialState?.wellSearch ?? '');
  
  // Memoized helper functions to prevent re-renders
  const selectAllLocators = useCallback(() => {
    // This needs access to drillEntities - would be passed via context or computed
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
    // Implementation would need drillEntities
    console.log('selectTopNLocators', n);
  }, []);
  
  const selectTopNWells = useCallback((n: number) => {
    console.log('selectTopNWells', n);
  }, []);
  
  // These would be provided by parent or computed
  const drillEntities: any[] = initialState?.drillEntities ?? [];
  const roTrainEntities: any[] = initialState?.roTrainEntities ?? [];
  const wellEntities: any[] = initialState?.wellEntities ?? [];
  const filteredLocatorList: any[] = initialState?.filteredLocatorList ?? [];
  const filteredTrainList: any[] = initialState?.filteredTrainList ?? [];
  const filteredWellList: any[] = initialState?.filteredWellList ?? [];
  const locatorTotals: any = initialState?.locatorTotals;
  const wellTotals: any = initialState?.wellTotals;
  
  const value = useMemo(() => ({
    // Core
    viewGran, setViewGran,
    viewBreakdown, setViewBreakdown,
    stackMode, setStackMode,
    // Raw water
    rawwaterBreakdown, setRawwaterBreakdown,
    // KWH
    kwhSource, setKwhSource,
    // RO
    roDrillMode, setRoDrillMode,
    // Plant health
    phDrillMode, setPhDrillMode,
    phDayFocus, setPhDayFocus,
    // Production cost
    showTotalCostLine, setShowTotalCostLine,
    showPowerCostLine, setShowPowerCostLine,
    showChemCostLine, setShowChemCostLine,
    // Production drill
    prodDrillSource, setProdDrillSource: initialState?.setProdDrillSource ?? (() => {}),
    usePermeateForSource, setUsePermeateForSource,
    // Filter states
    selectedLocatorIds, setSelectedLocatorIds,
    showLocatorFilter, setShowLocatorFilter,
    allSelected, noneSelected,
    selectAllLocators, clearAllLocators, toggleLocator,
    selectedWellIds, setSelectedWellIds,
    showWellFilter, setShowWellFilter,
    allWellsSelected, noneWellsSelected,
    selectAllWells, clearAllWells, toggleWell,
    selectedTrainIds, setSelectedTrainIds,
    showTrainFilter, setShowTrainFilter,
    allTrainsSelected, noTrainsSelected,
    selectAllTrains, clearAllTrains, toggleTrain,
    // Search
    locatorSearch, setLocatorSearch,
    trainSearch, setTrainSearch,
    wellSearch, setWellSearch,
    // Entities
    drillEntities,
    roTrainEntities,
    wellEntities,
    filteredLocatorList,
    filteredTrainList,
    filteredWellList,
    locatorTotals,
    wellTotals,
    // Helpers
    selectTopNLocators,
    selectTopNWells,
  }), [
    viewGran, viewBreakdown, stackMode, rawwaterBreakdown, kwhSource,
    roDrillMode, phDrillMode, phDayFocus,
    showTotalCostLine, showPowerCostLine, showChemCostLine,
    prodDrillSource, usePermeateForSource,
    selectedLocatorIds, showLocatorFilter, allSelected, noneSelected,
    selectedWellIds, showWellFilter, allWellsSelected, noneWellsSelected,
    selectedTrainIds, showTrainFilter, allTrainsSelected, noTrainsSelected,
    locatorSearch, trainSearch, wellSearch,
    drillEntities, roTrainEntities, wellEntities,
    filteredLocatorList, filteredTrainList, filteredWellList,
    locatorTotals, wellTotals,
  ]);
  
  return (
    <ChartControlsContext.Provider value={value}>
      {children}
    </ChartControlsContext.Provider>
  );
}

/** Hook to access chart controls state anywhere in the component tree */
export function useChartControls(): ChartControlsState {
  const context = useContext(ChartControlsContext);
  if (!context) {
    throw new Error('useChartControls must be used within a ChartControlsProvider');
  }
  return context;
}

export type { ChartControlsState };