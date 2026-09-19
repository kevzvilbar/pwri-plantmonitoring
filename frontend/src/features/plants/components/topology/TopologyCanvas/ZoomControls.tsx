import React from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export interface ZoomControlsProps {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  resetView: () => void;
}

export function ZoomControls({ zoom, setZoom, resetView }: ZoomControlsProps) {
  return (
    <div className="absolute bottom-3 right-3 z-30 flex items-center gap-1 p-1 rounded-lg bg-card/90 backdrop-blur-md border border-border shadow-md select-none">
      <button
        onClick={() => setZoom((z: number) => Math.min(2.5, z + 0.15))}
        aria-label="Zoom in"
        title="Zoom In (+)"
        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <span className="text-2xs font-mono font-bold text-foreground px-1.5 min-w-[38px] text-center">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => setZoom((z: number) => Math.max(0.3, z - 0.15))}
        aria-label="Zoom out"
        title="Zoom Out (-)"
        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={resetView}
        aria-label="Reset view"
        title="Reset Zoom to 100%"
        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border-l border-border/60 ml-0.5"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
