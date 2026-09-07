import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ComputedInput } from '@/components/ComputedInput';

export interface PowerMeterSectionProps {
  autoDurationMin: number | null;
  isSharedPowerMeter: boolean;
  sharedPowerGroup: string | null;
  siblingTrains: any[];
  f: (key: string) => { value: string; onChange: (e: any) => void };
  prevPowerMeter: number | null;
  pwrDelta: number | null;
  pwrKw: number | null;
  secEnergy: number | null;
}

export function PowerMeterSection({
  autoDurationMin,
  isSharedPowerMeter,
  sharedPowerGroup,
  siblingTrains,
  f,
  prevPowerMeter,
  pwrDelta,
  pwrKw,
  secEnergy,
}: PowerMeterSectionProps) {
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Power Meter (per train)</h4>
        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/70">
          <span>Duration:</span>
          <span className="font-mono font-medium">{autoDurationMin != null ? `${autoDurationMin} min` : '—'}</span>
        </div>
      </div>

      {isSharedPowerMeter && (
        <div className="rounded-md bg-warn-soft border border-warn px-2.5 py-2 text-xs text-warn space-y-0.5">
          <div className="flex items-center gap-1.5 font-semibold">
            <span>⚡ Shared power meter</span>
            <span className="font-mono text-2xs bg-warn-soft px-1.5 py-0.5 rounded">
              group: {sharedPowerGroup}
            </span>
          </div>
          <p className="opacity-80">
            This train shares one physical meter with{' '}
            {siblingTrains?.length
              ? siblingTrains.map((t: any) => `Train ${t.train_number}${t.name ? ` (${t.name})` : ''}`).join(', ')
              : 'other trains in this group'}.
            Enter the <strong>same meter reading</strong> on each train.
            The full kWh delta is saved here — volume-weighted allocation happens in reports.
          </p>
          <p className="opacity-60 italic">
            Specific energy shown below is an estimate (full meter ÷ this train's permeate only).
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="pretreat-prev-reading-kwh" className="text-xs text-muted-foreground">
            Prev reading (kWh){prevPowerMeter != null ? ' — auto' : ' — enter manually (first reading)'}
          </Label>
          <ComputedInput value={prevPowerMeter != null ? String(prevPowerMeter) : ''} className="text-foreground font-medium" id="pretreat-prev-reading-kwh"/>
        </div>
        <div>
          <Label htmlFor="pretreat-current-reading-kwh" className="text-xs text-muted-foreground">Current reading (kWh)</Label>
          <Input type="number" step="any" {...f('power_meter_curr')} placeholder="e.g. 12456.8" id="pretreat-current-reading-kwh"/>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor="pretreat-consumption-kwh" className="text-xs text-muted-foreground">Δ Consumption (kWh)</Label>
          <ComputedInput value={pwrDelta ?? ''} className="text-foreground font-medium" id="pretreat-consumption-kwh"/>
        </div>
        <div>
          <Label htmlFor="pretreat-avg-power-kw" className="text-xs text-muted-foreground">Avg power (kW)</Label>
          <ComputedInput value={pwrKw ?? ''} className="text-foreground font-medium" id="pretreat-avg-power-kw"/>
        </div>
        <div>
          <Label htmlFor="pretreat-specific-energy-kwh-m" className={cn('text-xs', isSharedPowerMeter ? 'text-warn' : 'text-muted-foreground')}>
            Specific energy (kWh/m³){isSharedPowerMeter ? ' ≈ est.' : ''}
          </Label>
          <ComputedInput
            value={secEnergy ?? ''}
            className={isSharedPowerMeter ? 'border-warn text-warn font-medium' : 'text-foreground font-medium'}
            id="pretreat-specific-energy-kwh-m"
          />
        </div>
      </div>
    </Card>
  );
}
