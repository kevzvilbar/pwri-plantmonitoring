import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePlants } from '@/hooks/usePlants';

/**
 * Shared plant selector used across the Costs page tabs (Rollup, Budget, …).
 * Extracted from Costs.tsx so it can be imported by components/costs/* without
 * creating a circular import back into the page file.
 */
export function PlantPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>{plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}
