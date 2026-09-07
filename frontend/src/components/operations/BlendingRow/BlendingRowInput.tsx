import * as React from 'react';
import { Input } from '@/components/ui/input';
import { OdometerRollerInput } from '@/components/OdometerRollerInput';
import { Droplet } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import type { BlendingRowLogic } from './useBlendingRow';

interface BlendingRowInputProps {
  state: BlendingRowLogic;
}

export function BlendingRowInput({ state }: BlendingRowInputProps) {
  const { isMobile, volume, setVolume, saving, prevCumulative, blendBelowPrev, blendHighVol, volumeChanged, well } = state;

  if (isMobile) {
    return (
      <div className="space-y-2">
        <OdometerRollerInput
          value={volume} onChange={setVolume}
          alertState={!volumeChanged ? 'neutral' : blendBelowPrev ? 'warn' : blendHighVol ? 'warn' : 'ok'}
          disabled={saving}
          testId={`blending-input-${well.id}`}
        />
        <div className="text-xs text-muted-foreground px-1">
          prev: <span className="font-mono-num font-semibold text-foreground">{prevCumulative != null ? fmtNum(prevCumulative) : '—'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <Droplet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kpi-ro pointer-events-none" />
      <Input type="number" step="any" inputMode="decimal" value={volume}
        onChange={(e) => setVolume(e.target.value)}
        placeholder="Cumulative meter reading"
        className="h-11 pl-9 w-full rounded-xl border-kpi-ro/30 focus-visible:ring-kpi-ro bg-kpi-ro/10 font-mono-num font-medium"
        data-testid={`blending-input-${well.id}`} />
    </div>
  );
}
