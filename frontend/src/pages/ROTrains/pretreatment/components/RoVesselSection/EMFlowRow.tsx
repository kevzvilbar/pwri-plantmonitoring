import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ComputedInput } from '@/components/ComputedInput';

export interface EMFlowRowProps {
  showFeedMeter: boolean;
  showPermeateMeter: boolean;
  showRejectMeter: boolean;
  feedIsEM: boolean;
  permIsEM: boolean;
  rejIsEM: boolean;
  f: (key: string) => { value: string; onChange: (e: any) => void };
  emEntered: number;
  emFeedInferred: boolean;
  emPermInferred: boolean;
  emRejInferred: boolean;
  effFeedFlow: number | null;
  effPermFlow: number | null;
  effRejFlow: number | null;
  feedFlowMeter: number | null;
  permFlowMeter: number | null;
  rejFlowMeter: number | null;
  recovery: number | null;
  recWarn: boolean;
  meterCfg: {
    ro_production_source?: string;
    permeate_is_production?: boolean;
  };
}

export function EMFlowRow({
  showFeedMeter,
  showPermeateMeter,
  showRejectMeter,
  f,
  emEntered,
  emFeedInferred,
  emPermInferred,
  feedIsEM,
  permIsEM,
  rejIsEM,
  emRejInferred,
  effFeedFlow,
  effPermFlow,
  effRejFlow,
  feedFlowMeter,
  permFlowMeter,
  rejFlowMeter,
  recovery,
  recWarn,
  meterCfg,
}: EMFlowRowProps) {
  // Only show EM input when both the meter exists (plant-wide flag) AND the
  // train is configured as EM-capable for that stream. Manual-only streams
  // render in the WaterMeterSection instead.
  const emFeedShown = showFeedMeter && feedIsEM;
  const emPermShown = showPermeateMeter && permIsEM;
  const emRejShown = showRejectMeter && rejIsEM;
  const activeMeters = [emFeedShown, emPermShown, emRejShown].filter(Boolean).length;
  const meterGridClass = activeMeters === 3 ? 'grid-cols-3' : activeMeters === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">
          Electromagnetic Flowmeter (m³/hr)
        </p>
        <p className="text-2xs text-muted-foreground/60 italic">
          {emEntered === 0 && 'Enter any two — third auto-computes'}
          {emEntered === 1 && 'Enter one more — third will be computed'}
          {emEntered === 2 && 'One value computed from the other two'}
          {emEntered === 3 && 'All three manually entered'}
        </p>
      </div>
      <div className={cn('grid gap-2', meterGridClass)}>
        {emFeedShown && (
          <div className="space-y-1">
            <Label htmlFor="pretreat-feed-flowrate" className={cn('text-xs', emFeedInferred ? 'text-info' : 'text-muted-foreground')}>
              Feed Flowrate{emFeedInferred ? ' (computed)' : ''}
            </Label>
            {emFeedInferred ? (
              <ComputedInput
                value={effFeedFlow != null ? Number(effFeedFlow).toFixed(2) : ''}
                className="border-info text-info font-semibold"
              />
            ) : (
              <Input type="number" step="any" {...f('feed_flow')}
                placeholder={feedFlowMeter != null ? `≈ ${Number(feedFlowMeter).toFixed(2)} (meter)` : 'EM reading'}
                className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-feed-flowrate"/>
            )}
          </div>
        )}
        {emPermShown && (
          <div className="space-y-1">
            <Label htmlFor="pretreat-field-3" className={cn('text-xs', emPermInferred ? 'text-info' : 'text-muted-foreground')}>
              {meterCfg.ro_production_source === 'permeate' ? 'Production Flowrate' : 'Permeate Flowrate'}{emPermInferred ? ' (computed)' : ''}
            </Label>
            {emPermInferred ? (
              <ComputedInput
                value={effPermFlow != null ? Number(effPermFlow).toFixed(2) : ''}
                className="border-info text-info font-semibold"
              />
            ) : (
              <Input type="number" step="any" {...f('permeate_flow')}
                placeholder={permFlowMeter != null ? `≈ ${Number(permFlowMeter).toFixed(2)} (meter)` : 'EM reading'}
                className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-field-3"/>
            )}
            {recovery != null && (
              <div className="mt-1">
                <Label htmlFor="pretreat-recovery" className={cn('text-xs', recWarn ? 'text-warn' : 'text-muted-foreground')}>
                  Recovery %{recWarn ? ' ⚠' : ''}
                </Label>
                <ComputedInput value={String(recovery)} className={recWarn ? 'border-warn text-warn-foreground font-semibold' : 'text-foreground font-medium'} id="pretreat-recovery"/>
              </div>
            )}
          </div>
        )}
        {emRejShown && (
          <div className="space-y-1">
            <Label htmlFor="pretreat-reject-flowrate" className={cn('text-xs', emRejInferred ? 'text-info' : 'text-muted-foreground')}>
              Reject Flowrate{emRejInferred ? ' (computed)' : ''}
            </Label>
            {emRejInferred ? (
              <ComputedInput
                value={effRejFlow != null ? Number(effRejFlow).toFixed(2) : ''}
                className="border-info text-info font-semibold"
              />
            ) : (
              <Input type="number" step="any" {...f('reject_flow')}
                placeholder={rejFlowMeter != null ? `≈ ${Number(rejFlowMeter).toFixed(2)} (meter)` : 'EM reading'}
                className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-reject-flowrate"/>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
