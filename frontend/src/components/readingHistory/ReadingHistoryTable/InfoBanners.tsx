import React from 'react';
import { Droplet, Zap } from 'lucide-react';

interface InfoBannersProps {
  module: string;
  isDirectMode: boolean;
  isSolarDirectMode: boolean;
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number };
}

export function InfoBanners({ module, isDirectMode, isSolarDirectMode, meterFilter }: InfoBannersProps) {
  return (
    <>
      {isDirectMode && (
        <div className="flex items-center gap-1.5 rounded-md bg-primary-soft border border-primary/30 px-2.5 py-1.5 text-xs text-primary">
          <Droplet className="h-3 w-3 shrink-0" />
          This entity&apos;s input is already a period volume, so there&apos;s no Δ to compute — the value below is the volume itself.
        </div>
      )}
      {meterFilter?.type === 'solar' && isSolarDirectMode && (
        <div className="flex items-center gap-1.5 rounded-md bg-warn-soft border border-warn/30 px-2.5 py-1.5 text-xs text-warn">
          <Zap className="h-3 w-3 shrink-0" />
          This plant&apos;s solar input is Direct kWh, so there&apos;s no Δ to compute — each reading is already that day&apos;s power, not a cumulative meter value.
        </div>
      )}
    </>
  );
}
