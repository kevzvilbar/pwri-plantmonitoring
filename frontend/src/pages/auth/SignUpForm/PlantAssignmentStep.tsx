import { Checkbox } from '@/components/ui/checkbox';

interface PlantAssignmentStepProps {
  isOperator: boolean;
  designation: string;
  plants: { id: string; name: string; address?: string }[];
  plantId: string;
  plantIds: string[];
  onPlantIdChange: (id: string) => void;
  onTogglePlantId: (id: string) => void;
}

export function PlantAssignmentStep({
  isOperator, designation, plants, plantId, plantIds,
  onPlantIdChange, onTogglePlantId,
}: PlantAssignmentStepProps) {
  return (
    <div className="space-y-2">
      {isOperator ? (
        <>
          <p className="text-xs text-muted-foreground">Operators are limited to a <strong>single plant</strong>.</p>
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
            {(plants ?? []).map((p) => (
              <label key={p.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${plantId === p.id ? 'border-accent bg-accent/5' : 'hover:bg-muted/60'}`}>
                <input type="radio" name="op-plant" value={p.id} checked={plantId === p.id} onChange={() => onPlantIdChange(p.id)} className="accent-accent" />
                <div><div className="text-sm font-medium">{p.name}</div>{p.address && <div className="text-xs text-muted-foreground">{p.address}</div>}</div>
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground"><strong>{designation}</strong> can be assigned to multiple plants.</p>
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
            {(plants ?? []).map((p) => {
              const checked = plantIds.includes(p.id);
              return (
                <label key={p.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${checked ? 'border-accent bg-accent/5' : 'hover:bg-muted/60'}`}>
                  <Checkbox checked={checked} onCheckedChange={() => onTogglePlantId(p.id)} />
                  <div><div className="text-sm font-medium">{p.name}</div>{p.address && <div className="text-xs text-muted-foreground">{p.address}</div>}</div>
                </label>
              );
            })}
          </div>
        </>
      )}
      {!(plants ?? []).length && <p className="text-xs text-muted-foreground text-center py-4">No plants available — an Admin will assign plants after approval.</p>}
    </div>
  );
}
