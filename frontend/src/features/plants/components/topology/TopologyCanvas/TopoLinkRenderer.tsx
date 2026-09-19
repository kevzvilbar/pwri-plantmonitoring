import React from 'react';
import type { TopoNode, TopoLink } from '../shared';
import { NODE_W, NODE_H, COLORS, cubicPath, getStreamType, STREAM_COLORS, getSymbolDimensions } from '../shared';
import type { NodePositionOverride } from '../shared';

export interface LinkRendererProps {
  link: TopoLink;
  idx: number;
  topoState: { nodes: TopoNode[]; fixedLinks: TopoLink[]; editLinks: TopoLink[] };
  positions: Map<string, { x: number; y: number; zone: string }>;
  hoveredLink: number | null;
  setHoveredLink: (idx: number | null) => void;
  animatedFlow?: boolean;
}

export function TopoLinkRenderer({ link, idx, topoState, positions, hoveredLink, setHoveredLink, animatedFlow = true }: LinkRendererProps) {
  const f = positions.get(link.from);
  const t = positions.get(link.to);
  if (!f || !t) return null;

  const fromNode = topoState.nodes.find((n) => n.id === link.from);
  const toNode   = topoState.nodes.find((n) => n.id === link.to);
  const fh = fromNode?.detail ? NODE_H + 18 : NODE_H;
  const th = toNode?.detail   ? NODE_H + 18 : NODE_H;

  const fromDims = fromNode ? getSymbolDimensions(fromNode.type) : { w: NODE_W, h: NODE_H };
  const toDims   = toNode   ? getSymbolDimensions(toNode.type)   : { w: NODE_W, h: NODE_H };

  // Calculate clean port coordinates so links start at source connection port and end at target port
  let x1: number, y1: number, x2: number, y2: number;

  if (t.x >= f.x + fromDims.w) {
    // Normal forward flow (left to right): from source right port to target left port
    x1 = f.x + fromDims.w;
    y1 = f.y + fh / 2;
    x2 = t.x;
    y2 = t.y + th / 2;
  } else if (t.x + toDims.w <= f.x) {
    // Backward flow (recycle/bypass): from source left port to target right port
    x1 = f.x;
    y1 = f.y + fh / 2;
    x2 = t.x + toDims.w;
    y2 = t.y + th / 2;
  } else {
    // Same column / vertical flow
    x1 = f.x + fromDims.w / 2;
    y1 = f.y < t.y ? f.y + fh : f.y;
    x2 = t.x + toDims.w / 2;
    y2 = f.y < t.y ? t.y : t.y + th;
  }

  // Determine stream type for pipe coloring
  const streamType = getStreamType(link, topoState.nodes);
  const streamColor = STREAM_COLORS[streamType];
  // Fallback to source node accent if stream type is general
  const fallbackColor = fromNode ? COLORS[fromNode.type].accent : 'hsl(var(--muted-foreground))';
  const color = streamType === 'general' ? fallbackColor : streamColor;

  const isHov = hoveredLink === idx;
  const markerId = isHov ? `topo-arrow-${streamType}-hover` : `topo-arrow-${streamType}`;

  // Check if either end of the link is explicitly offline
  const fromStatus = fromNode?.status?.toLowerCase() || '';
  const toStatus = toNode?.status?.toLowerCase() || '';
  const isOffline = fromStatus === 'offline' || fromStatus === 'inactive' || toStatus === 'offline' || toStatus === 'inactive';

  return (
    <g key={`link-${idx}`}>
      {/* Invisible larger hit area for easier interaction */}
      <path
        d={cubicPath(x1, y1, x2, y2)}
        fill="none" stroke="transparent" strokeWidth={20}
        style={{ cursor: 'crosshair' }}
        onMouseEnter={() => setHoveredLink(idx)}
        onMouseLeave={() => setHoveredLink(null)}
      />

      {/* Glow effect on hover */}
      {isHov && (
        <path
          d={cubicPath(x1, y1, x2, y2)}
          fill="none"
          stroke={color}
          strokeWidth={8}
          opacity={0.25}
          style={{ transition: 'opacity 0.2s' }}
        />
      )}

      {/* Main pipe - thicker with rounded caps */}
      <path
        d={cubicPath(x1, y1, x2, y2)}
        fill="none"
        stroke={color}
        strokeWidth={isHov ? 3.5 : link.editable ? 2.5 : 3}
        strokeLinecap="round"
        opacity={isHov ? 1 : 0.75}
        style={{ transition: 'stroke 0.2s, stroke-width 0.2s, opacity 0.2s' }}
      />

      {/* Animated fluid flow pulses for active process streams */}
      {animatedFlow && !isOffline && (
        <path
          d={cubicPath(x1, y1, x2, y2)}
          fill="none"
          stroke={color}
          strokeWidth={link.editable ? 2 : 2.5}
          strokeDasharray="6,8"
          style={{
            animation: 'topo-dash-flow 1.8s linear infinite',
            opacity: isHov ? 0.95 : 0.65,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* End arrow marker referencing consolidated marker in root SVG defs */}
      <path
        d={cubicPath(x1, y1, x2, y2)}
        fill="none"
        stroke="transparent"
        strokeWidth={3}
        markerEnd={`url(#${markerId})`}
      />

      {/* Dashed overlay for editable links */}
      {link.editable && (
        <path
          d={cubicPath(x1, y1, x2, y2)}
          fill="none"
          stroke={color}
          strokeWidth={isHov ? 1.5 : 1}
          strokeDasharray={isHov ? '10,4' : '7,4'}
          opacity={isHov ? 0.9 : 0.6}
          style={{ transition: 'stroke-dasharray 0.2s, opacity 0.2s' }}
        />
      )}
    </g>
  );
}

