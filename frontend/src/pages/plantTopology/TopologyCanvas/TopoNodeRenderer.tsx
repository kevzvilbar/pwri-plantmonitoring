import React from 'react';
import type { TopoNode, TopoLink, DragItem } from '../shared';
import { NODE_W, NODE_H, NODE_LABELS, COLORS, TOPO_FONT_SANS, TOPO_FONT_MONO, getNodeStatusInfo } from '../shared';
import type { NodeType } from '../shared';
import { fmtNum } from '@/lib/calculations';

export interface NodeRendererProps {
  node: TopoNode;
  positions: Map<string, { x: number; y: number; zone: string }>;
  linkCounts: Record<string, number>;
  pendingFrom: { id: string; type: NodeType } | null;
  hovered: string | null;
  inspectNode: TopoNode | null;
  editMode: 'connect' | 'disconnect' | null;
  canEdit: boolean;
  dragItem: DragItem | null;
  topoState: { nodes: TopoNode[]; fixedLinks: TopoLink[]; editLinks: TopoLink[] };
  startDrag: (item: DragItem, e: React.PointerEvent) => void;
  handleNodeClick: (node: TopoNode) => void;
  setHovered: (id: string | null) => void;
  nodeVolume?: number;
  overlayMode?: 'schematic' | 'waterBalance';
}

export function TopoNodeRenderer({
  node, positions, linkCounts, pendingFrom, hovered, inspectNode,
  editMode, canEdit, dragItem, topoState, startDrag, handleNodeClick, setHovered,
  nodeVolume, overlayMode,
}: NodeRendererProps) {
  const pos = positions.get(node.id);
  if (!pos) return null;
  const c           = COLORS[node.type];
  const isPending   = pendingFrom?.id === node.id;
  const isHov       = hovered === node.id;
  const isInspected = inspectNode?.id === node.id;
  const isClickable = canEdit && !!editMode;
  const isInactive  = node.status === 'Inactive';
  const connCount   = linkCounts[node.id] ?? 0;
  const isCustom    = node.custom;
  const hasDetail   = !!node.detail;
  const isBeingDragged = dragItem?.nodeId === node.id;
  const statusInfo  = getNodeStatusInfo(node.status);
  const isOverlay   = overlayMode === 'waterBalance';
  const h           = (hasDetail ? NODE_H + 18 : NODE_H) + (isOverlay ? 16 : 0);

  return (
    <g
      key={node.id}
      transform={`translate(${pos.x},${pos.y})`}
      style={{
        cursor: 'pointer',
        opacity: isBeingDragged ? 0.35 : 1,
        transition: 'opacity 0.15s',
      }}
      onClick={() => !isBeingDragged && handleNodeClick(node)}
      onMouseEnter={() => setHovered(node.id)}
      onMouseLeave={() => setHovered(null)}
    >
      <title>{`${node.label} [${NODE_LABELS[node.type]}]${node.detail ? ` (${node.detail})` : ''}${node.status ? ` · ${statusInfo.label}` : ''}`}</title>

      {node.status === 'Active' && !isPending && !isInspected && (
        <rect x={-2} y={-2} width={NODE_W + 4} height={h + 4} rx={10}
          fill="none" stroke={c.accent} strokeWidth={1} opacity={isHov ? 0.4 : 0.15} />
      )}

      {(isPending || isInspected || (isHov && isClickable)) && (
        <rect x={-4} y={-4} width={NODE_W + 8} height={h + 8} rx={11}
          fill="none"
          stroke={isPending ? 'hsl(var(--warn))' : isInspected ? 'hsl(var(--primary))' : c.accent}
          strokeWidth={2.5}
          opacity={0.85}
        />
      )}

      <rect width={NODE_W} height={h} rx={9} x={1.5} y={2.5}
        fill={c.border} opacity={isInactive ? 0.04 : 0.12} />

      <rect width={NODE_W} height={h} rx={9}
        fill={isInactive ? 'hsl(var(--muted))' : c.bg}
        stroke={isPending ? 'hsl(var(--warn))' : isInspected ? 'hsl(var(--primary))' : isHov ? c.accent : c.border}
        strokeWidth={isPending || isInspected ? 2 : isHov ? 2 : 1.5}
        opacity={isInactive ? 0.55 : 1}
      />

      <rect x={0} y={8} width={4} height={h - 16} rx={2}
        fill={c.accent} opacity={isInactive ? 0.2 : 1}
      />

      <text x={NODE_W / 2 + 4} y={17}
        textAnchor="middle" fill={c.accent}
        fontSize={7.5} fontFamily={TOPO_FONT_MONO}
        fontWeight={700} letterSpacing={1.2} opacity={0.9}
      >
        {NODE_LABELS[node.type]}
      </text>

      <text x={NODE_W / 2 + 4} y={35}
        textAnchor="middle"
        fill={isInactive ? 'hsl(var(--muted-foreground))' : c.text}
        fontSize={11.5} fontFamily={TOPO_FONT_SANS}
        fontWeight={600}
      >
        {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
      </text>

      {hasDetail && (
        <text x={NODE_W / 2 + 4} y={50}
          textAnchor="middle"
          fill={isInactive ? 'hsl(var(--muted-foreground))' : c.accent}
          fontSize={8.5}
          fontFamily={TOPO_FONT_MONO}
          opacity={0.85}
        >
          {(node.detail ?? '').length > 22 ? (node.detail ?? '').slice(0, 21) + '…' : node.detail}
        </text>
      )}

      {isOverlay && (
        <g transform={`translate(${NODE_W / 2 + 4}, ${hasDetail ? 64 : 48})`}>
          <rect
            x={-36}
            y={-7}
            width={72}
            height={13}
            rx={3.5}
            fill={nodeVolume && nodeVolume > 0 ? c.accent : 'hsl(var(--muted))'}
            opacity={nodeVolume && nodeVolume > 0 ? 0.22 : 0.15}
          />
          <text
            x={0}
            y={2.5}
            textAnchor="middle"
            fill={nodeVolume && nodeVolume > 0 ? c.accent : 'hsl(var(--muted-foreground))'}
            fontSize={8}
            fontFamily={TOPO_FONT_MONO}
            fontWeight={700}
          >
            {nodeVolume != null && nodeVolume > 0 ? `${fmtNum(nodeVolume, 0)} m³` : '0 m³'}
          </text>
        </g>
      )}

      {node.status && (
        <circle cx={NODE_W - 10} cy={10} r={4}
          fill={statusInfo.fill}
          stroke={c.bg} strokeWidth={1.2}
        />
      )}

      {isCustom && (
        <>
          <rect x={4} y={h - 9} width={26} height={7} rx={3.5}
            fill={c.accent} opacity={0.25} />
          <text x={17} y={h - 4}
            textAnchor="middle" fill={c.accent}
            fontSize={5.5} fontWeight={700} fontFamily={TOPO_FONT_MONO}>
            CUSTOM
          </text>
        </>
      )}

      {isCustom && canEdit && isHov && !editMode && (
        <g
          transform={`translate(${NODE_W - 14}, ${h / 2 - 8})`}
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            startDrag({ nodeId: node.id, nodeType: node.type, label: node.label, colId: node.colId }, e as unknown as React.PointerEvent);
          }}
        >
          <rect x={-2} y={-2} width={16} height={20} rx={3}
            fill={c.accent} opacity={0.15} />
          <rect x={2} y={0}  width={2} height={2} rx={1} fill={c.accent} opacity={0.7} />
          <rect x={6} y={0}  width={2} height={2} rx={1} fill={c.accent} opacity={0.7} />
          <rect x={2} y={5}  width={2} height={2} rx={1} fill={c.accent} opacity={0.7} />
          <rect x={6} y={5}  width={2} height={2} rx={1} fill={c.accent} opacity={0.7} />
          <rect x={2} y={10} width={2} height={2} rx={1} fill={c.accent} opacity={0.7} />
          <rect x={6} y={10} width={2} height={2} rx={1} fill={c.accent} opacity={0.7} />
        </g>
      )}

      {(node.type === 'bulk' || node.type === 'locator') && connCount > 0 && (
        <>
          <rect x={NODE_W - 20} y={h - 16} width={18} height={14} rx={6}
            fill={c.accent} />
          <text x={NODE_W - 11} y={h - 7}
            textAnchor="middle" fill="#fff" fontSize={8.5} fontWeight={700}>
            {connCount}
          </text>
        </>
      )}

      {node.group && (
        <rect x={6} y={h - 6} width={NODE_W - 12} height={4} rx={2}
          fill={c.accent} opacity={0.3} />
      )}
    </g>
  );
}
