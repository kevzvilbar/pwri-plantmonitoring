import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DateTimePicker } from '@/components/ui/date-picker';
import { cn } from '@/lib/utils';

interface FlowQSectionProps {
  qPrevMeter: string;
  setQPrevMeter: (v: string) => void;
  qCurrMeter: string;
  setQCurrMeter: (v: string) => void;
  qPrevTime: string;
  setQPrevTime: (v: string) => void;
  qCurrTime: string;
  setQCurrTime: (v: string) => void;
  deltaV: number | null;
  deltaT_hr: number | null;
  flowQ: number | null;
}

export function FlowQSection({
  qPrevMeter, setQPrevMeter, qCurrMeter, setQCurrMeter,
  qPrevTime, setQPrevTime, qCurrTime, setQCurrTime,
  deltaV, deltaT_hr, flowQ,
}: FlowQSectionProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 space-y-0.5">
        <p className="text-xs font-semibold text-foreground font-mono">Q = ΔV ÷ Δt</p>
        <p className="text-2xs text-muted-foreground">ΔV = Curr meter − Prev meter (m³) &nbsp;·&nbsp; Δt = elapsed time (hr)</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meter Readings (m³)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="cipvolumetric-previous-reading" className="text-xs text-muted-foreground">Previous reading</Label>
            <Input type="number" step="any" value={qPrevMeter} onChange={e => setQPrevMeter(e.target.value)}
              placeholder="e.g. 1024.50" className="h-9 text-sm" id="cipvolumetric-previous-reading"/>
          </div>
          <div>
            <Label htmlFor="cipvolumetric-current-reading" className="text-xs text-muted-foreground">Current reading</Label>
            <Input type="number" step="any" value={qCurrMeter} onChange={e => setQCurrMeter(e.target.value)}
              placeholder="e.g. 1087.30" className="h-9 text-sm" id="cipvolumetric-current-reading"/>
          </div>
        </div>
        <div className={cn('rounded-md border px-3 py-2 flex items-center justify-between',
          deltaV !== null ? 'bg-accent-soft border-accent'
                         : 'bg-muted/30 border-border')}>
          <span className="text-xs text-muted-foreground font-medium">ΔV (volume produced)</span>
          <span className={cn('text-sm font-bold font-mono-num', deltaV !== null ? 'text-accent' : 'text-muted-foreground')}>
            {deltaV !== null ? `${deltaV} m³` : '—'}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time Interval</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="cipvolumetric-previous-date-time" className="text-xs text-muted-foreground">Previous date & time</Label>
            <DateTimePicker
              value={qPrevTime}
              onChange={(val) => setQPrevTime(val)}
              placeholder="Select previous time..."
              size="sm"
              className="w-full font-mono-num"
              id="cipvolumetric-previous-date-time"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cipvolumetric-current-date-time" className="text-xs text-muted-foreground">Current date & time</Label>
            <DateTimePicker
              value={qCurrTime}
              onChange={(val) => setQCurrTime(val)}
              placeholder="Select current time..."
              size="sm"
              className="w-full font-mono-num"
              id="cipvolumetric-current-date-time"
            />
          </div>
        </div>
        <div className={cn('rounded-md border px-3 py-2 flex items-center justify-between',
          deltaT_hr !== null ? 'bg-muted/40 border-border' : 'bg-muted/20 border-border')}>
          <span className="text-xs text-muted-foreground font-medium">Δt (elapsed)</span>
          <span className="text-sm font-bold font-mono-num text-foreground">
            {deltaT_hr !== null ? `${deltaT_hr} hr` : '—'}
          </span>
        </div>
      </div>

      <div className={cn(
        'rounded-xl border-2 p-3 flex items-center justify-between gap-3',
        flowQ !== null
          ? 'bg-accent-soft border-accent'
          : 'bg-muted/20 border-dashed border-border'
      )}>
        <div>
          <p className="text-2xs font-bold uppercase tracking-wider text-accent">
            Volumetric Flow Rate
          </p>
          <p className="text-3xs text-muted-foreground font-mono">Q = ΔV ÷ Δt</p>
        </div>
        <div className="text-right">
          <p className={cn('text-2xl font-bold font-mono-num leading-none',
            flowQ !== null ? 'text-accent' : 'text-muted-foreground/40')}>
            {flowQ !== null ? flowQ : '—'}
          </p>
          {flowQ !== null && <p className="text-2xs text-muted-foreground mt-0.5">m³/hr</p>}
        </div>
      </div>
    </div>
  );
}
