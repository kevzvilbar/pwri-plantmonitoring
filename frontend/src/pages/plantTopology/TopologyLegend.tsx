import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Layers, Activity, GitCommit } from 'lucide-react';
import { NodeType, NODE_LABELS, COLORS } from './shared';

export function TopologyLegend() {
  const [expanded, setExpanded] = useState(false);

  const nodeTypes = (Object.entries(COLORS) as [NodeType, (typeof COLORS)[NodeType]][])
    .filter(([type]) => type !== 'customNode');

  return (
    <div className="shrink-0 pt-2 border-t border-border font-sans">
      {/* Compact toggle bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-transparent hover:border-border/60"
        >
          <Layers className="h-3.5 w-3.5 text-primary" />
          <span>Topology Legend &amp; Symbols</span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        {/* Mini quick inline summary when collapsed */}
        {!expanded && (
          <div className="hidden sm:flex items-center gap-4 text-3xs font-mono text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-accent" />
              <span>Active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-warn" />
              <span>Maint</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span>Inactive</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 border-t border-dashed border-muted-foreground" />
              <span>Editable link</span>
            </div>
          </div>
        )}
      </div>

      {/* Expanded 3-section grouped panel */}
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 mt-2 rounded-lg bg-card/80 border border-border/60 text-xs animate-in fade-in duration-150">
          {/* 1. Node Types */}
          <div className="space-y-1.5 md:col-span-2">
            <div className="flex items-center gap-1.5 text-3xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3 w-3 text-primary" />
              <span>Node Taxonomy</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {nodeTypes.map(([type, c]) => (
                <div
                  key={type}
                  className="flex items-center gap-1.5 p-1 rounded bg-muted/30 border border-border/40"
                >
                  <div
                    className="w-3 h-3 rounded-xs shrink-0 border"
                    style={{ backgroundColor: c.bg, borderColor: c.border }}
                  />
                  <span className="text-3xs font-mono text-foreground truncate">
                    {NODE_LABELS[type]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Connections & 3. Status Indicators */}
          <div className="space-y-3">
            {/* Connections */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-3xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
                <GitCommit className="h-3 w-3 text-primary" />
                <span>Pipelines &amp; Wiring</span>
              </div>
              <div className="space-y-1 text-2xs font-mono text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="w-6 border-t-2 border-dashed border-primary" />
                  <span className="text-foreground">Editable Routing (Click to rewire)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 border-t-2 border-border" />
                  <span>Fixed P&amp;ID Pipeline</span>
                </div>
              </div>
            </div>

            {/* Status indicators */}
            <div className="space-y-1.5 pt-1.5 border-t border-border/40">
              <div className="flex items-center gap-1.5 text-3xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3 w-3 text-primary" />
                <span>Operating Status</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-2xs font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-accent/20" />
                  <span className="text-foreground">Active / Running</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-warn ring-2 ring-warn/20" />
                  <span className="text-foreground">Maintenance</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground" />
                  <span className="text-muted-foreground">Inactive / Standby</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-danger ring-2 ring-danger/20" />
                  <span className="text-foreground">Fault / Alarm</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

