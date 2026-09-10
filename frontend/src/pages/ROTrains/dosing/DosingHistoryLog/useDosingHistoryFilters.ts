import { useState, useMemo, useEffect, useRef } from 'react';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';

export function useDosingHistoryFilters(selectedPlantId: string | null | undefined) {
  const [filterPlantId, setFilterPlantId] = useState(selectedPlantId ?? '');
  const [days, setDays] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');

  const lastSyncedPlantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPlantId || selectedPlantId === lastSyncedPlantRef.current) return;
    lastSyncedPlantRef.current = selectedPlantId;
    setFilterPlantId(selectedPlantId);
  }, [selectedPlantId]);

  const { from, to } = useMemo(() => {
    if (days === 'custom') return { from: customFrom, to: customTo };
    const now  = new Date();
    const past = new Date(now); past.setDate(past.getDate() - +days);
    return { from: past.toISOString(), to: now.toISOString() };
  }, [days, customFrom, customTo]);

  return { filterPlantId, setFilterPlantId, days, setDays, customFrom, setCustomFrom, customTo, setCustomTo, from, to, lastSyncedPlantRef };
}
