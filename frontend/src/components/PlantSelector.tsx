import React, { useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';

export function PlantSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  // Keep the same behaviour as before: auto-select global plant when component mounts
  // but intentionally exclude onChange from deps to avoid infinite loops when parents
  // pass inline callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPlantId && !value) onChange(selectedPlantId); }, [selectedPlantId, value]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>
        {plants?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
