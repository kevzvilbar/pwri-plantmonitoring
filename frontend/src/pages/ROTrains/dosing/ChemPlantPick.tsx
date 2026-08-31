import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ChemPlantPick({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { data: plants } = usePlants();
  const { selectedPlantId, setSelectedPlantId } = useAppStore();

  const lastSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPlantId || selectedPlantId === lastSyncedRef.current) return;
    lastSyncedRef.current = selectedPlantId;
    onChange(selectedPlantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlantId]);

  const handleChange = (v: string) => {
    lastSyncedRef.current = v;
    onChange(v);
    setSelectedPlantId(v === 'all' ? null : v);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger id={id}><SelectValue placeholder="Plant" /></SelectTrigger>
      <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}
