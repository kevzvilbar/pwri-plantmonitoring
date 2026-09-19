import React from 'react';
import type { TopoNode, TopoLink, DragItem, NodeType } from '../shared';
import {
  NODE_H, COLORS, withAlpha, getNodeIcon, getSymbolDimensions,
  getNodeStatusInfo, TOPO_FONT_SANS, TOPO_FONT_MONO,
} from '../shared';

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

function formatVolume(m3: number): string {
  if (!Number.isFinite(m3)) return '—';
  if (Math.abs(m3) >= 1_000_000) return `${(m3 / 1_000_000).toFixed(2)}M`;
  if (Math.abs(m3) >= 1_000) return `${(m3 / 1_000).toFixed(1)}k`;
  return m3.toFixed(m3 % 1 === 0 ? 0 : 1);
}

export function TopoNodeRenderer({
  node, positions, linkCounts, pendingFrom, hovered, inspectNode,
  editMode, canEdit, dragItem, startDrag, handleNodeClick, setHovered,
  nodeVolume, overlayMode,
}: NodeRendererProps) {
  const pos = positions.get(node.id);
  if (!pos) return null;

  const c = COLORS[node.type] ?? COLORS.customNode;
  const dims = getSymbolDimensions(node.type);
  // Nodes carrying an equipment detail line reserve an extra strip beneath the
  // symbol — TopoLinkRenderer applies the same NODE_H + 18 so pipes land on the
  // body of the symbol rather than on the label.
  const h = node.detail ? NODE_H + 18 : NODE_H;
  // The symbol variant lets one NodeType render two ways: a bag-filter *bank*
  // vs a single cartridge housing, or an electromagnetic vs mechanical meter.
  const variant = node.symbolVariant ?? node.meterVariant;
  const Icon = getNodeIcon(node.type, variant);
  const status = getNodeStatusInfo(node.status);

  const isPending  = pendingFrom?.id === node.id;
  const isHovered  = hovered === node.id;
  const isInspect  = inspectNode?.id === node.id;
  const isOrphan   = (linkCounts[node.id] ?? 0) === 0;
  const interactive = canEdit && !dragItem;
  const connections = linkCounts[node.id] ?? 0;

  const halo = isPending
    ? 'hsl(var(--primary))'
    : isInspect
      ? c.accent
      : isHovered
        ? withAlpha(c.accent, 0.7)
        : null;

  const showVolume = overlayMode === 'waterBalance' && nodeVolume !== undefined;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      style={{ cursor: interactive ? (editMode ? 'crosshair' : 'grab') : 'default' }}
      onMouseEnter={() => setHovered(node.id)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => handleNodeClick(node)}
      onPointerDown={(e) => {
        // Only custom nodes are repositionable; derived nodes follow their
        // stage column so the line always reads left-to-right.
        if (!interactive || editMode || !node.custom) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        startDrag({ nodeId: node.id, nodeType: node.type, label: node.label, colId: node.colId, skipRename: true }, e);
      }}
    >
      {halo && (
        <rect
          x={-8} y={-8}
          width={dims.w + 16} height={h + 16}
          rx={10}
          fill="none"
          stroke={halo}
          strokeWidth={isPending ? 2.5 : 1.5}
          strokeDasharray={isPending ? '5,3' : undefined}
          opacity={isPending ? 0.95 : 0.7}
        />
      )}

      <rect
        x={-4} y={-4}
        width={dims.w + 8} height={h + 8}
        rx={8}
        fill={c.bg}
        stroke={withAlpha(c.border, isHovered || isInspect ? 0.9 : 0.5)}
        strokeWidth={1.2}
        strokeDasharray={isOrphan ? '4,3' : undefined}
        opacity={dragItem ? 0.5 : 1}
        style={{ transition: 'stroke 0.2s, opacity 0.2s' }}
      />

      <g style={{ color: c.accent, pointerEvents: 'none' }}>
        {Icon
          ? <foreignObject x={0} y={0} width={dims.w} height={dims.h}>
              <div style={{ color: c.accent, width: dims.w, height: dims.h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {React.createElement(Icon, { size: Math.min(dims.w, dims.h), status: node.status })}
              </div>
            </foreignObject>
          : <>
              <rect x={4} y={6} width={dims.w - 8} height={dims.h - 12} rx={5}
                fill="none" stroke={c.accent} strokeWidth={1.4} strokeDasharray="4,3" opacity={0.8} />
              <text x={dims.w / 2} y={dims.h / 2 + 3} textAnchor="middle"
                fill={c.text} fontSize={8} fontFamily={TOPO_FONT_MONO} fontWeight={700}>
                {node.label.slice(0, 6).toUpperCase()}
              </text>
            </>}
      </g>

      <text
        x={dims.w / 2} y={dims.h + 11}
        textAnchor="middle"
        fill={c.text}
        fontSize={8.5}
        fontFamily={TOPO_FONT_SANS}
        fontWeight={600}
        style={{ pointerEvents: 'none' }}
      >
        {node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}
      </text>

      {node.detail && (
        <text
          x={dims.w / 2} y={dims.h + 22}
          textAnchor="middle"
          fill={c.text}
          fontSize={7}
          fontFamily={TOPO_FONT_MONO}
          opacity={0.7}
          style={{ pointerEvents: 'none' }}
        >
          {node.detail}
        </text>
      )}

      {showVolume && (
        <g style={{ pointerEvents: 'none' }}>
          <rect x={dims.w / 2 - 26} y={-20} width={52} height={14} rx={7}
            fill="hsl(var(--card))" stroke={withAlpha(c.border, 0.6)} strokeWidth={1} />
          <text x={dims.w / 2} y={-9.5} textAnchor="middle"
            fill={c.text} fontSize={7.5} fontFamily={TOPO_FONT_MONO} fontWeight={700}>
            {formatVolume(nodeVolume!)} m³
          </text>
        </g>
      )}

      {connections > 0 && (
        <g style={{ pointerEvents: 'none' }} opacity={isHovered ? 1 : 0.55}>
          <circle cx={dims.w - 2} cy={-2} r={6} fill={c.bg} stroke={withAlpha(c.border, 0.7)} strokeWidth={1} />
          <text x={dims.w - 2} y={0.5} textAnchor="middle"
            fill={c.text} fontSize={6.5} fontFamily={TOPO_FONT_MONO} fontWeight={700}>
            {connections}
          </text>
        </g>
      )}

      <title>
        {isOrphan
          ? `${node.label} — not connected to anything`
          : `${node.label} · ${status.label} · ${connections} connection${connections === 1 ? '' : 's'}`}
      </title>
    </g>
  );
}
