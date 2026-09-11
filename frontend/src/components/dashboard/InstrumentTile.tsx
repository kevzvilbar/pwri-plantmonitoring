import React from 'react';
import { cn } from '@/lib/utils';
import type { StatTone } from './types';
import { TONE_BG } from './types';

export interface InstrumentTileProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: StatTone;
  edgeLight?: 'teal' | 'cyan' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet' | 'slate';
  clickable?: boolean;
  children: React.ReactNode;
}

/**
 * InstrumentTile — Unified telemetry card shell.
 * 
 * Implements the nested-housing construction specified in the Operations Telemetry redesign:
 * - Outer shell: 16px radius (rounded-2xl), hairline border, subtle gradient wash.
 * - Inner core: 14px radius (R_in = R_out - P = 16 - 2 = 14px), recessed glass backdrop.
 * - Tactile spring physics: active:scale-[0.99] with ease-spring-out on click.
 * - Semantic tone integration: solid alert wash and top edge-light for warn/danger states.
 */
export const InstrumentTile = React.forwardRef<HTMLDivElement, InstrumentTileProps>(
  ({ className, tone, edgeLight, clickable, children, onClick, ...props }, ref) => {
    const isClickable = clickable || !!onClick;

    return (
      <div
        ref={ref}
        onClick={onClick}
        className={cn(
          'instrument-tile group relative rounded-2xl p-0.5 transition-all duration-150 min-w-0 h-full',
          tone
            ? TONE_BG[tone]
            : 'border border-border/70 bg-gradient-to-b from-card/95 via-card/85 to-card/75 shadow-xs hover:border-border',
          edgeLight ? `edge-light-${edgeLight}` : '',
          isClickable ? 'cursor-pointer hover:shadow-sm active:scale-[0.99] ease-spring-out' : 'cursor-default',
          className
        )}
        {...props}
      >
        <div className="recessed-core w-full h-full rounded-[14px] bg-card/60 backdrop-blur-xs p-3.5 flex flex-col justify-between">
          {children}
        </div>
      </div>
    );
  }
);

InstrumentTile.displayName = 'InstrumentTile';

