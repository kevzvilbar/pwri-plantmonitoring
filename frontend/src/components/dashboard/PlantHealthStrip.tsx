import { useMemo } from 'react';
import { usePlants } from '@/hooks/usePlants';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';

import { Lamp, type LampTone } from '@/components/ui/Lamp';
import { useFleetStatus, type FleetStatus } from '@/hooks/useFleetStatus';

function statusToLampTone(status: FleetStatus): LampTone {
  switch (status) {
    case 'online':  return 'good';
    case 'stale':   return 'warn';
    case 'offline': return 'muted';
  }
}

interface Props {
  /** Plant IDs currently visible on the dashboard (respects global filter) */
  plantIds: string[];
  onSelectPlant?: (plantId: string) => void;
}

export function PlantHealthStrip({ plantIds, onSelectPlant }: Props) {
  const { data: plants } = usePlants();
  // Shared snapshot with the Hero lamps: wells ∪ locators, one query key.
  const { lastByPlant, statusOf } = useFleetStatus(plantIds);

  const visiblePlants = useMemo(
    () => (plants ?? []).filter((p) => !plantIds.length || plantIds.includes(p.id)),
    [plants, plantIds],
  );

  if (!visiblePlants.length) return null;

  return (
    <div
      className="overflow-x-auto -mx-1 px-1 py-1 sm:overflow-visible sm:mx-0 sm:px-0"
      aria-label="Per-plant status strip"
    >
      <div className="flex items-center gap-2 sm:flex-wrap min-w-max sm:min-w-0">
        <div className="flex items-center gap-1.5 text-2xs font-bold text-muted-foreground uppercase tracking-wider mr-1 shrink-0">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span>Fleet Telemetry</span>
        </div>

        {visiblePlants.map((plant) => {
          const lastDt    = lastByPlant[plant.id] ?? null;
          const status    = statusOf(plant.id);
          const shortName = plant.name.split(' ')[0];

          return (
            <div
              key={plant.id}
              onClick={() => onSelectPlant?.(plant.id)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1 rounded-[8px] border text-xs font-semibold whitespace-nowrap transition-all duration-150 ease-spring-out active:scale-[0.98] cursor-pointer select-none shrink-0 shadow-2xs',
                status === 'online' && 'bg-card border-border/80 text-foreground hover:border-primary/50',
                status === 'stale' && 'bg-warn-soft/30 border-warn/40 text-warn hover:border-warn',
                status === 'offline' && 'bg-muted/30 border-border/50 text-muted-foreground hover:border-border',
              )}
              title={`${plant.name} · Last reading: ${lastDt ? new Date(lastDt).toLocaleString() : 'none'}`}
            >
              <Lamp
                tone={statusToLampTone(status)}
                pulse={false}
                size={7}
              />
              <span>{shortName}</span>
              {lastDt ? (
                <span className="text-2xs font-normal opacity-75 font-mono">
                  Last seen {formatDistanceToNow(new Date(lastDt), { addSuffix: false })}
                </span>
              ) : (
                <span className="text-2xs font-normal opacity-50 font-mono">Offline</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
