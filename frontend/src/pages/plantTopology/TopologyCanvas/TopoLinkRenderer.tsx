import React from 'react';
import type { TopoNode, TopoLink } from '../shared';
import { NODE_H, COLORS, cubicPath, getStreamType, STREAM_COLORS } from '../shared';
import type { NodePositionOverride } from '../shared';

export interface LinkRendererProps {
  link: TopoLink;
  idx: number;
  topoState: { nodes: TopoNode[]; fixedLinks: TopoLink[]; editLinks: TopoLink[] };
  positions: Map<string, { x: number; y: number; zone: string }>;
  hoveredLink: number | null;
  setHoveredLink: (idx: number | null) => void;
}

export function TopoLinkRenderer({ link, idx, topoState, positions, hoveredLink, setHoveredLink }: LinkRendererProps) {
  const f = positions.get(link.from);
  const t = positions.get(link.to);
  if (!f || !t) return null;

  const fromNode = topoState.nodes.find((n) => n.id === link.from);
  const toNode   = topoState.nodes.find((n) => n.id === link.to);
  const fh = fromNode?.detail ? NODE_H + 18 : NODE_H;
  const th = toNode?.detail   ? NODE_H + 18 : NODE_H;

  const x1 = f.x, y1 = f.y + fh / 2;
  const x2 = t.x, y2 = t.y + th / 2;

  // Determine stream type for pipe coloring
  const streamType = getStreamType(link, topoState.nodes);
  const streamColor = STREAM_COLORS[streamType];
  // Fallback to source node accent if stream type is general
  const fallbackColor = fromNode ? COLORS[fromNode.type].accent : 'hsl(var(--muted-foreground))';
  const color = streamType === 'general' ? fallbackColor : streamColor;

  const isHov = hoveredLink === idx;
  const markerId = `arrow-${idx}`;

  // Calculate bezier control points for cubic path
  const midX = (x1 + x2) / 2;
  const dist = Math.abs(x2 - x1);

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

      {/* Flow direction chevrons for horizontal pipes */}
      {dist > 80 && (
        <g opacity={isHov ? 0.8 : 0.5} style={{ transition: 'opacity 0.2s' }}>
          {/* Calculate positions for chevrons along the path */}
          {[0.25, 0.5, 0.75].map((t) => {
            const px = midX + (x2 - x1) * t - (x2 - x1) * 0.08;
            const py = y1 + (y2 - y1) * t;
            const dir = x2 > x1 ? 1 : -1;
            return (
              <path
                key={t}
                d={`M${px - dir * 6},${py} L${px},${py - 3} L${px},${py + 3} Z`}
                fill={color}
                transform={`scale(${dir}, 1) translate(${-px * dir + px}, 0)`}
              />
            );
          })}
        </g>
      )}

      {/* Arrow marker definition.
          markerUnits defaults to "strokeWidth", which scales the marker by
          the stroke-width of whatever element references it via marker-end —
          here that's the invisible strokeWidth={20} hit-path below, not the
          ~3px visible pipe. That mismatch is what blew the arrowheads up to
          several times the pipe width. markerUnits="userSpaceOnUse" plus an
          explicit viewBox decouples the two, so markerWidth/markerHeight are
          the actual rendered size regardless of which path's marker-end
          triggers them. */}
      <defs>
        <marker
          id={markerId}
          markerUnits="userSpaceOnUse"
          markerWidth={isHov ? 8 : 6.5}
          markerHeight={isHov ? 8 : 6.5}
          viewBox="0 0 10 10"
          refX={7}
          refY={5}
          orient="auto"
        >
          <path
            d="M0,0 L0,10 L10,5 Z"
            fill={isHov ? color : 'hsl(var(--muted-foreground))'}
            opacity={isHov ? 1 : 0.85}
          />
        </marker>
      </defs>

      {/* End arrow marker — drawn on its own thin path (matching the visible
          pipe width) rather than the fat invisible hit-path, now that marker
          sizing no longer depends on which one it's attached to. */}
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
