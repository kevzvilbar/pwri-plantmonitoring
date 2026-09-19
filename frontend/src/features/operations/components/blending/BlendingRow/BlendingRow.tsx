import * as React from 'react';
import { cn } from '@/lib/utils';
import { BlendingRowHeader } from './BlendingRowHeader';
import { BlendingRowTelemetry } from './BlendingRowTelemetry';
import { BlendingRowInput } from './BlendingRowInput';
import { BlendingRowActions } from './BlendingRowActions';
import { useBlendingRow } from './useBlendingRow';
import type { BlendingRowProps } from './types';

export type { BlendingRowProps } from './types';

export function BlendingRow(props: BlendingRowProps) {
  const state = useBlendingRow(props);

  return (
    <div
      className="instrument-housing p-4 space-y-3 border border-border/80 rounded-2xl mb-3 shadow-xs"
      data-testid={`blending-row-${state.well.id}`}
    >
      <BlendingRowHeader state={state} />
      <BlendingRowTelemetry state={state} />
      <BlendingRowInput state={state} />
      <BlendingRowActions state={state} />
    </div>
  );
}
