import React, { useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';

export function PlantSelector({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  // Mirror the "universal" TopBar plant selection into this page's local
  // value whenever it CHANGES — not just once on mount. The old `!value`
  // guard only auto-selected the first time, so switching the TopBar
  // dropdown after a page already had a local value did nothing until the
  // page/tab remounted (e.g. navigating away and back) — the TopBar looked
  // unresponsive. lastSyncedRef lets a manual local pick still stick
  // between TopBar changes; onChange stays out of the deps array (as
  // before) so parents passing an inline/unstable callback don't loop.
  const lastSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPlantId || selectedPlantId === lastSyncedRef.current) return;
    lastSyncedRef.current = selectedPlantId;
    onChange(selectedPlantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlantId]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>
        {plants?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
