import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useCIPVolumetric } from './useCIPVolumetric';
import { VesselFlowSection } from './VesselFlowSection';
import { FlowQSection } from './FlowQSection';
import { ComparativeSection } from './ComparativeSection';

export function CIPVolumetric({ numVessels = 4 }: { numVessels?: number }) {
  const cip = useCIPVolumetric(numVessels);

  return (
    <Card className="p-3 space-y-3">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Volumetric & Analytics</h4>
        <p className="text-2xs text-muted-foreground mt-0.5">Per-vessel flow rate · Global Q=ΔV/Δt · Pre/Post CIP comparison</p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {cip.TABS.map(t => (
          <button key={t.key} onClick={() => cip.setActiveTab(t.key)}
            className={cn(
              'text-xs px-3 py-1 rounded-full border font-medium transition-colors',
              cip.activeTab === t.key
                ? 'bg-accent text-accent-foreground border-accent'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {cip.activeTab === 'vessel' && <VesselFlowSection {...cip} />}
      {cip.activeTab === 'flow' && <FlowQSection {...cip} />}
      {cip.activeTab === 'compare' && <ComparativeSection {...cip} />}
    </Card>
  );
}
