import React from 'react';
import type { TopoNode, TopoLink } from '../shared';
import { NODE_H, COLORS, cubicPath } from '../shared';
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
  const color = fromNode ? COLORS[fromNode.type].accent : 'hsl(var(--muted-foreground))';
  const isHov = hoveredLink === idx;
  const markerId = `arrow-${idx}`;

  return (
    <g key={`link-${idx}`}>
      <defs>
        <marker id={markerId} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L0,7 L7,3.5 z" fill={isHov ? color : 'hsl(var(--muted-foreground))'} />
        </marker>
      </defs>
      <path
        d={cubicPath(x1, y1, x2, y2)}
        fill="none" stroke="transparent" strokeWidth={14}
        style={{ cursor: 'crosshair' }}
        onMouseEnter={() => setHoveredLink(idx)}
        onMouseLeave={() => setHoveredLink(null)}
      />
      <path
        d={cubicPath(x1, y1, x2, y2)}
        fill="none"
        stroke={isHov ? color : 'hsl(var(--muted-foreground))'}
        strokeWidth={isHov ? 2.5 : link.editable ? 1.5 : 2}
        strokeDasharray={link.editable ? (isHov ? '9,4' : '6,3') : undefined}
        opacity={isHov ? 0.9 : 0.45}
        markerEnd={`url(#${markerId})`}
        style={{ transition: 'stroke 0.15s, opacity 0.15s' }}
      />
    </g>
  );
}
