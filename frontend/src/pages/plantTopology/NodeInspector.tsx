import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ExternalLink, ArrowRight, ArrowLeft, Activity, Info, Wrench, ShieldAlert, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Lamp } from '@/components/ui/Lamp';
import {
  TopoNode,
  TopoLink,
  NodeType,
  NODE_LABELS,
  COLORS,
  getNodeStatusInfo,
} from './shared';

export interface NodeInspectorProps {
  node: TopoNode | null;
  onClose: () => void;
  allNodes: TopoNode[];
  allLinks: TopoLink[];
  plantId?: string;
  plantName?: string;
  onSelectNode?: (nodeId: string) => void;
}

export function NodeInspector({
  node,
  onClose,
  allNodes,
  allLinks,
  plantId,
  plantName,
  onSelectNode,
}: NodeInspectorProps) {
  const navigate = useNavigate();

  const nodeMap = useMemo(() => {
    const map = new Map<string, TopoNode>();
    allNodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [allNodes]);

  // Find upstream (nodes that point TO this node)
  const upstreamNodes = useMemo(() => {
    if (!node) return [];
    const results: { node: TopoNode; editable?: boolean }[] = [];
    for (const l of allLinks) {
      if (l.to === node.id) {
        const found = nodeMap.get(l.from);
        if (found) results.push({ node: found, editable: l.editable });
      }
    }
    return results;
  }, [node, allLinks, nodeMap]);

  // Find downstream (nodes that point FROM this node)
  const downstreamNodes = useMemo(() => {
    if (!node) return [];
    const results: { node: TopoNode; editable?: boolean }[] = [];
    for (const l of allLinks) {
      if (l.from === node.id) {
        const found = nodeMap.get(l.to);
        if (found) results.push({ node: found, editable: l.editable });
      }
    }
    return results;
  }, [node, allLinks, nodeMap]);

  if (!node) return null;

  const color = COLORS[node.type];
  const statusInfo = getNodeStatusInfo(node.status);

  // Determine deep-link route based on node type
  const getDeepLink = (): { label: string; path: string } | null => {
    switch (node.type) {
      case 'well':
        return { label: 'Open in Operations (Wells)', path: `/operations${plantId ? `?plant=${plantId}` : ''}` };
      case 'roTrain':
        return { label: 'Open in Operations (RO Trains)', path: `/operations${plantId ? `?plant=${plantId}` : ''}` };
      case 'rawMeter':
      case 'feedMeter':
      case 'permeate':
      case 'reject':
      case 'bulk':
        return { label: 'Open in Operations (Meters)', path: `/operations${plantId ? `?plant=${plantId}` : ''}` };
      case 'solarSource':
      case 'gridSource':
      case 'solarMeter':
      case 'gridMeter':
        return { label: 'Open in Power & Energy', path: `/power-meters${plantId ? `?plant=${plantId}` : ''}` };
      case 'locator':
        return { label: 'Open in Plants & Facilities', path: `/plants${plantId ? `?plant=${plantId}` : ''}` };
      default:
        return null;
    }
  };

  const deepLink = getDeepLink();

  return (
    <div
      className="absolute top-4 right-4 z-40 w-84 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-xl text-foreground font-sans animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[calc(100%-2rem)] overflow-hidden"
      role="dialog"
      aria-label="Node Inspector"
    >
      {/* Header bar */}
      <div className="flex items-start justify-between gap-3 p-3.5 border-b border-border/70 bg-muted/30">
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className="w-3.5 h-3.5 rounded-md mt-0.5 shrink-0 border"
            style={{ backgroundColor: color.bg, borderColor: color.border }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="text-3xs font-mono font-bold tracking-wider px-1.5 py-0.5 rounded border"
                style={{
                  color: color.accent,
                  backgroundColor: color.bg,
                  borderColor: color.border,
                }}
              >
                {NODE_LABELS[node.type]}
              </span>
              {node.custom && (
                <span className="text-3xs font-mono font-bold bg-muted px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                  CUSTOM
                </span>
              )}
            </div>
            <h3 className="font-bold text-sm text-foreground break-words mt-1 leading-snug">
              {node.label}
            </h3>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
          aria-label="Close inspector"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body content */}
      <div className="p-3.5 space-y-3.5 overflow-y-auto min-h-0 text-xs">
        {/* Status and Facility Row */}
        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border/50">
          <div className="flex items-center gap-1.5">
            <Lamp tone={statusInfo.tone} size={7} />
            <span className="font-medium text-2xs text-muted-foreground">Status:</span>
            <span className="font-bold text-2xs text-foreground">{statusInfo.label}</span>
          </div>
          {plantName && (
            <span className="text-3xs font-mono text-muted-foreground truncate max-w-[120px]" title={plantName}>
              {plantName}
            </span>
          )}
        </div>

        {/* Equipment Detail Specs (e.g. RO trains) */}
        {node.detail && (
          <div className="p-2.5 rounded-lg bg-muted/30 border border-border/50 space-y-1">
            <div className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              <Cpu className="h-3.5 w-3.5 text-primary" />
              <span>Equipment Configuration</span>
            </div>
            <p className="font-mono text-xs text-foreground break-words leading-relaxed pl-5">
              {node.detail}
            </p>
          </div>
        )}

        {/* Connections Section */}
        <div className="space-y-2">
          <span className="text-3xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
            Wiring &amp; Stream Topology
          </span>

          {/* Upstream / Inputs */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-2xs text-muted-foreground font-semibold">
              <ArrowLeft className="h-3 w-3 text-primary" />
              <span>Upstream Sources ({upstreamNodes.length})</span>
            </div>
            {upstreamNodes.length === 0 ? (
              <p className="text-2xs text-muted-foreground/70 italic pl-4">No upstream connections (Process Start)</p>
            ) : (
              <div className="space-y-1 pl-2">
                {upstreamNodes.map(({ node: upNode, editable }) => {
                  const upColor = COLORS[upNode.type];
                  return (
                    <button
                      key={upNode.id}
                      onClick={() => onSelectNode?.(upNode.id)}
                      className="w-full flex items-center justify-between p-1.5 rounded-md bg-muted/40 hover:bg-muted border border-border/40 text-left transition-colors group"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: upColor.accent }}
                        />
                        <span className="font-medium text-2xs text-foreground truncate group-hover:text-primary">
                          {upNode.label}
                        </span>
                      </div>
                      <span className="text-3xs font-mono text-muted-foreground shrink-0 ml-1">
                        {editable ? 'editable' : 'fixed'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Downstream / Outputs */}
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-1 text-2xs text-muted-foreground font-semibold">
              <ArrowRight className="h-3 w-3 text-accent" />
              <span>Downstream Destinations ({downstreamNodes.length})</span>
            </div>
            {downstreamNodes.length === 0 ? (
              <p className="text-2xs text-muted-foreground/70 italic pl-4">No downstream connections (Process End)</p>
            ) : (
              <div className="space-y-1 pl-2">
                {downstreamNodes.map(({ node: downNode, editable }) => {
                  const downColor = COLORS[downNode.type];
                  return (
                    <button
                      key={downNode.id}
                      onClick={() => onSelectNode?.(downNode.id)}
                      className="w-full flex items-center justify-between p-1.5 rounded-md bg-muted/40 hover:bg-muted border border-border/40 text-left transition-colors group"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: downColor.accent }}
                        />
                        <span className="font-medium text-2xs text-foreground truncate group-hover:text-primary">
                          {downNode.label}
                        </span>
                      </div>
                      <span className="text-3xs font-mono text-muted-foreground shrink-0 ml-1">
                        {editable ? 'editable' : 'fixed'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Deep-Link Action */}
      {deepLink && (
        <div className="p-3 border-t border-border/70 bg-muted/20">
          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs font-semibold gap-1.5 bg-background hover:bg-primary hover:text-primary-foreground border-primary/40 transition-all justify-center"
            onClick={() => navigate(deepLink.path)}
          >
            <span>{deepLink.label}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </Button>
        </div>
      )}
    </div>
  );
}

