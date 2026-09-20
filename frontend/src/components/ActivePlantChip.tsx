/**
 * ActivePlantChip — P5-2 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * Replaces the per-form <PlantSelector> dropdowns on the Daily Readings tabs.
 * Those were a second, editable copy of the TopBar plant picker, two-way bound
 * to it, so choosing a plant while logging silently re-scoped the Dashboard
 * and Alerts as well.
 *
 * Once a plant is active this is a read-only label: the TopBar picker is the
 * one place to change it. The only interactive state is the moment a plant is
 * genuinely required and there is more than one to pick from. That prompt
 * writes to the same global selection, so nothing here holds its own state.
 */
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useActivePlant } from '@/hooks/useActivePlant';

const CAPTION = 'text-xs font-medium text-muted-foreground uppercase tracking-wide';

export function ActivePlantChip({ className }: { className?: string }) {
  const { plant, plantId, plants, isLoading, needsAssignment, needsSelection, select } = useActivePlant();

  let body: React.ReactNode;

  if (isLoading) {
    body = <div className="h-9 w-40 rounded-md bg-muted animate-pulse" aria-hidden="true" />;
  } else if (needsAssignment) {
    body = (
      <p role="status" className="text-xs text-warn">
        No plants are assigned to you. Ask an admin to assign a plant.
      </p>
    );
  } else if (needsSelection) {
    body = (
      <div role="group" aria-label="Choose a plant" className="space-y-1.5">
        <p role="status" className="text-xs text-muted-foreground">
          Choose a plant to log readings.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {plants.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => select(p.id)}
            >
              {p.name}
            </Button>
          ))}
        </div>
      </div>
    );
  } else if (plant || plantId) {
    // `plant` is null but `plantId` is set only when the plant list could not
    // be read (offline): the stored selection is trusted, its name is unknown.
    const name = plant?.name ?? 'Selected plant';
    body = (
      <div className="flex items-center gap-2 flex-wrap">
        <div
          data-testid="active-plant-chip"
          aria-label={`Active plant: ${name}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-sm font-medium"
        >
          <MapPin className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[16rem]">{name}</span>
        </div>
        <span className="text-2xs text-muted-foreground">Change it from the plant picker in the top bar.</span>
      </div>
    );
  } else {
    body = <p role="status" className="text-xs text-muted-foreground">No plant available.</p>;
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <span className={CAPTION}>Plant</span>
      {body}
    </div>
  );
}
