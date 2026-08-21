import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ─── PlantPicker ─────────────────────────────────────────────────────────────
// Not extracted to the sub-module because it is only used within this file
// (by Overview below). If a second caller appears, move it to ro-trains/PlantPicker.tsx.
export function PlantPicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  // onChange excluded from deps — including it causes error #300 when the
  // parent passes an inline arrow (new reference every render → effect fires →
  // onChange(selectedPlantId) → re-render → repeat).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPlantId && !value) onChange(selectedPlantId); }, [selectedPlantId, value]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}
