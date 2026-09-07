import { ROTrainIcon } from '@/components/icons/water-icons';
import { Droplet, Gauge, Zap } from 'lucide-react';
import { ProductMetersStat } from '../config/ProductMeters';
import { EnergySourceInline } from '../config/Appearance';
import { fmtNum } from '@/lib/calculations';

export function PlantDetailStats({ plant, trainCounts }: {
  plant: any;
  trainCounts: { active: number; total: number } | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
      <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-cyan-400 space-y-1 shadow-2xs">
        <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-cyan-500 dark:text-cyan-400 font-semibold">
            <Droplet className="h-3.5 w-3.5" />
            <span>Design Cap</span>
          </span>
          <span className="text-3xs font-mono text-muted-foreground">MLD</span>
        </div>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-mono text-xl sm:text-2xl font-bold text-foreground tabular-nums">
            {plant.design_capacity_m3 ? fmtNum(plant.design_capacity_m3) : '—'}
          </span>
          {plant.design_capacity_m3 ? (
            <span className="text-2xs text-muted-foreground font-mono font-medium">
              ({fmtNum(plant.design_capacity_m3 * 1000)} m³/d)
            </span>
          ) : (
            <span className="text-2xs text-muted-foreground italic">Unassigned</span>
          )}
        </div>
        <div className="text-3xs text-muted-foreground">Peak extraction throughput</div>
      </div>

      <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-indigo-400 space-y-1 shadow-2xs">
        <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-indigo-500 dark:text-indigo-400 font-semibold">
            <ROTrainIcon className="h-3.5 w-3.5" />
            <span>RO Fleet</span>
          </span>
          <span className="text-3xs font-mono text-muted-foreground">TRAINS</span>
        </div>
        <div className="font-mono text-xl sm:text-2xl font-bold text-foreground tabular-nums">
          {trainCounts ? (
            <>
              <span className={
                trainCounts.active === trainCounts.total && trainCounts.total > 0
                  ? 'text-accent'
                  : trainCounts.active === 0 && trainCounts.total > 0
                    ? 'text-danger'
                    : 'text-primary'
              }>{trainCounts.active}</span>
              <span className="text-muted-foreground font-normal text-base">/{trainCounts.total}</span>
            </>
          ) : (
            <span>{plant.num_ro_trains ?? '—'}</span>
          )}
        </div>
        <div className="text-3xs text-muted-foreground">
          {trainCounts && trainCounts.total > 0
            ? `${Math.round((trainCounts.active / trainCounts.total) * 100)}% fleet operational`
            : 'Active train telemetry'}
        </div>
      </div>

      <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-amber-400 space-y-1 shadow-2xs">
        <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400 font-semibold">
            <Gauge className="h-3.5 w-3.5" />
            <span>Distribution</span>
          </span>
          <span className="text-3xs font-mono text-muted-foreground">METERS</span>
        </div>
        <div className="font-mono text-xl sm:text-2xl font-bold text-foreground tabular-nums">
          <ProductMetersStat plantId={plant.id} />
        </div>
        <div className="text-3xs text-muted-foreground">Offtake &amp; bulk consumption</div>
      </div>

      <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-teal-400 space-y-1 shadow-2xs">
        <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-teal-500 dark:text-teal-400 font-semibold">
            <Zap className="h-3.5 w-3.5" />
            <span>Power Mix</span>
          </span>
          <span className="text-3xs font-mono text-muted-foreground">ENERGY</span>
        </div>
        <div className="pt-0.5">
          <EnergySourceInline plant={plant} />
        </div>
        <div className="text-3xs text-muted-foreground">Grid / Solar telemetry</div>
      </div>
    </div>
  );
}
