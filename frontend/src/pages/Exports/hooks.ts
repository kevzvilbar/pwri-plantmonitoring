import React, { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { runExport } from './engine';
import { ALL_TABLES, EXPORT_CATEGORIES } from './constants';

export function useExportActions(
  plantId: string,
  from: string,
  to: string,
  selectedTableIds: Set<string>,
  setSelectedTableIds: React.Dispatch<React.SetStateAction<Set<string>>>,
  setExportState: (s: 'idle' | 'busy' | 'done') => void,
) {
  const toggleSelectTable = useCallback((id: string) => {
    setSelectedTableIds(prev => {
      const next = new Set<string>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedTableIds(new Set(ALL_TABLES.map(t => t.id)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTableIds(new Set());
  }, []);

  const selectCuratedPackage = useCallback((pkgType: 'ops' | 'ro' | 'chem' | 'power') => {
    const pkgMap: Record<string, string[]> = {
      ops: ['daily_plant_summary', 'locator_readings', 'well_readings', 'product_meter_readings'],
      ro: ['ro_train_readings', 'ro_pretreatment_readings', 'pump_readings', 'afm_readings', 'cip_logs'],
      chem: ['chemical_dosing_logs', 'chemical_deliveries', 'chemical_inventory', 'chemical_residual_samples'],
      power: ['power_readings', 'electric_bills', 'power_tariffs', 'production_costs'],
    };
    setSelectedTableIds(new Set(pkgMap[pkgType] || []));
    toast.success(`Selected ${pkgType.toUpperCase()} table package (${(pkgMap[pkgType] || []).length} tables)`);
  }, []);

  const exportAll = useCallback(async () => {
    setExportState('busy');
    let total = 0;
    let failed = 0;
    for (const table of ALL_TABLES) {
      try {
        const res = await runExport(table, plantId, from, to);
        if (res) total += res.count;
      } catch {
        failed++;
      }
    }
    setExportState('done');
    if (failed) toast.info(`Export complete — ${failed} table(s) had errors`);
    else toast.success(`All tables exported — ${total.toLocaleString()} total rows`);
    setTimeout(() => setExportState('idle'), 3000);
  }, [plantId, from, to]);

  const exportSelected = useCallback(async () => {
    if (selectedTableIds.size === 0) {
      toast.error('Select at least one table to export');
      return;
    }
    setExportState('busy');
    let total = 0;
    let failed = 0;
    const targetTables = ALL_TABLES.filter(t => selectedTableIds.has(t.id));
    for (const table of targetTables) {
      try {
        const res = await runExport(table, plantId, from, to);
        if (res) total += res.count;
      } catch {
        failed++;
      }
    }
    setExportState('done');
    if (failed) toast.info(`Export complete — ${failed} table(s) had errors`);
    else toast.success(`Exported ${total.toLocaleString()} rows across ${targetTables.length} selected tables`);
    setTimeout(() => setExportState('idle'), 3000);
  }, [selectedTableIds, plantId, from, to]);

  return {
    toggleSelectTable,
    selectAll,
    clearSelection,
    selectCuratedPackage,
    exportAll,
    exportSelected,
  };
}

export function useTableSearch(searchQuery: string) {
  return useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return EXPORT_CATEGORIES;
    return EXPORT_CATEGORIES.map(cat => ({
      ...cat,
      tables: cat.tables.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.tables.length > 0);
  }, [searchQuery]);
}
