import { useState, useCallback } from 'react';
import { SourceTable } from '../types';

export interface RecentCorrection {
  key: string;
  label: string;
  plantName: string;
  sourceTable: SourceTable;
  oldValue: number;
  newValue: number;
  correctedAt: string;
}

export function useRecentCorrections() {
  const [items, setItems] = useState<RecentCorrection[]>([]);
  const add = useCallback((c: Omit<RecentCorrection, 'key' | 'correctedAt'>) => {
    if (c.oldValue === c.newValue) return;
    setItems(prev => [
      { ...c, key: `${c.sourceTable}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, correctedAt: new Date().toISOString() },
      ...prev,
    ].slice(0, 8));
  }, []);
  const clear = useCallback(() => setItems([]), []);
  return { items, add, clear };
}
