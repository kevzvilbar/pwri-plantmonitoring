import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ComputedInput } from '@/components/ComputedInput';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';

export interface MeterColumnProps {
  label: string;
  stream: 'feed' | 'permeate' | 'reject';
  f: (key: string) => { value: string; onChange: (e: any) => void };
  prevReading: number | null;
  prevId: string;
  currentRawValue: string;
  currentOnChange: { value: string; onChange: (e: any) => void };
  currentId: string;
  negWarn: boolean;
  spike: any;
  needsRemark: boolean;
  remark: string;
  onRemarkChange: (v: string) => void;
  volume: number | null;
  inferred: boolean;
  volId: string;
  flowrate: number | null;
  flowId: string;
  meterCfg?: {
    ro_production_source?: string;
    permeate_is_production?: boolean;
  };
}

export function MeterColumn({
  label,
  stream,
  f,
  prevReading,
  prevId,
  currentRawValue,
  currentOnChange,
  currentId,
  negWarn,
  spike,
  needsRemark,
  remark,
  onRemarkChange,
  volume,
  inferred,
  volId,
  flowrate,
  flowId,
  meterCfg,
}: MeterColumnProps) {
  const isPermeate = stream === 'permeate';

  const inputClass = cn(
    "placeholder:text-2xs placeholder:text-muted-foreground/50",
    negWarn && "border-danger bg-danger-soft text-danger focus-visible:ring-danger",
    !negWarn && spike && spike.tier === 'critical' && "border-destructive bg-destructive/10 focus-visible:ring-destructive",
    !negWarn && spike && spike.tier === 'needs_remark' && "border-warn bg-warn-soft focus-visible:ring-warn"
  );

  return (
    <div className="space-y-1">
      <div>
        <Label htmlFor={prevId} className="text-xs text-muted-foreground">Previous {label} Meter Reading</Label>
        {prevReading != null
          ? <ComputedInput value={String(prevReading)} className="text-foreground font-semibold bg-muted/40" id={prevId}/>
          : <div className="h-9 rounded-md border border-dashed border-border/50 px-3 flex items-center">
              <span className="text-xs text-muted-foreground/50 italic">No prior reading</span>
            </div>
        }
      </div>
      <div>
        <Label htmlFor={currentId} className="text-xs text-muted-foreground">{label} Meter Reading</Label>
        <Input type="number" step="any" {...currentOnChange} placeholder={`Input current ${stream} reading`} className={inputClass} id={currentId}/>
        {negWarn && (
          <p className="text-xs text-danger flex items-center gap-1 mt-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Reading ({Number(currentRawValue)}) is below previous ({prevReading}) — meter rollback or typo.
          </p>
        )}
        {needsRemark && spike && (
          <div className="mt-1">
            <AnomalyRemarkBanner
              result={spike}
              label={label}
              unit="m3/hr"
              windowDays={10}
              remark={remark}
              onRemarkChange={onRemarkChange}
            />
          </div>
        )}
      </div>
      <div>
        <Label htmlFor={volId} className={cn('text-xs', inferred ? 'text-info' : 'text-muted-foreground')}>
          {isPermeate && meterCfg?.ro_production_source === 'permeate' ? 'Production (Permeate)' : `${label} Volume`}{inferred ? ' (inferred)' : ''} (m³)
        </Label>
        <ComputedInput 
          value={volume != null ? String(volume) : ''} 
          className={cn(inferred ? 'border-info text-info font-medium' : 'text-foreground font-medium', volume != null && volume < 0 && 'border-destructive bg-destructive/10 text-destructive font-semibold')} 
          id={volId}
        />
      </div>
      <div>
        <Label htmlFor={flowId} className="text-xs text-muted-foreground">{label} Flowrate (m³/hr)</Label>
        <ComputedInput value={flowrate != null ? String(flowrate) : ''} className="text-foreground font-medium" id={flowId}/>
      </div>
    </div>
  );
}
