import React from 'react';
import type { TopoNode, TopoLink, DragItem } from '../shared';
import { NODE_LABELS, COLORS, TOPO_FONT_SANS, TOPO_FONT_MONO, getNodeStatusInfo, getNodeIcon, getStreamType, STREAM_COLORS, getSymbolDimensions } from '../shared';
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

  // Resolve the P&ID symbol for this node type
  const iconVariant = node.type === 'bulk' && node.detail?.includes('Tank') ? 'tank' : undefined;
  const SymbolComp = getNodeIcon(node.type, iconVariant);

  // Determine stream badge for meter/single-stream nodes (feed/permeate/reject)
  // — the product tank rides the permeate/product line, so it carries one too.
  const meterTypes = ['rawMeter', 'feedMeter', 'permeate', 'reject', 'productTank', 'bulk', 'locator'];
  const showStreamBadge = meterTypes.includes(node.type);
  const incomingLink = topoState.fixedLinks.concat(topoState.editLinks).find(l => l.to === node.id);
  const streamType = incomingLink ? getStreamType(incomingLink, topoState.nodes) : null;
  const streamColor = streamType ? STREAM_COLORS[streamType] : null;

  // Get symbol dimensions for this node type
  const symDims = getSymbolDimensions(node.type);
  const symW = symDims.w;
  const symH = symDims.h;

  // Calculate total node height (symbol + label tag + detail + overlay)
  const labelTagH = 18;
  const detailH = hasDetail ? 14 : 0;
  const overlayH = isOverlay ? 16 : 0;
  const totalH = symH + labelTagH + detailH + overlayH;

  const symbolX = 0;
  const symbolY = 0;
  const labelY = symH + 12;

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

      {/* Hover/selection highlight background */}
      {(isHov || isInspected || isPending) && (
        <rect
          x={-6} y={-6}
          width={symW + 12} height={totalH + 12}
          rx={8}
          fill={c.accent}
          opacity={isInspected ? 0.12 : isPending ? 0.15 : 0.06}
          stroke={isInspected || isPending ? c.accent : 'none'}
          strokeWidth={isInspected || isPending ? 1.5 : 0}
          strokeDasharray={isPending ? '4 2' : undefined}
        />
      )}

      {/* Active glow effect */}
      {node.status === 'Active' && !isPending && !isInspected && (
        <rect
          x={-4} y={-4}
          width={symW + 8} height={totalH + 8}
          rx={6} fill={c.accent} opacity={0.04}
        />
      )}

      {/* Stream color indicator bar (left edge) */}
      {showStreamBadge && streamColor && (
        <rect x={-2} y={4} width={3} height={symH - 8} rx={1.5} fill={streamColor} opacity={0.7} />
      )}

      {/* P&ID Symbol */}
      {SymbolComp && (
        <g transform={`translate(${symbolX},${symbolY})`} style={{ color: isInactive ? 'hsl(var(--muted-foreground))' : c.accent }}>
          {React.createElement(SymbolComp, { size: Math.max(symW, symH), status: node.status })}
        </g>
      )}

      {/* Custom node fallback (no symbol) */}
      {!SymbolComp && (
        <g transform={`translate(${symbolX},${symbolY})`}>
          <rect x={0} y={0} width={symW} height={symH} rx={6} fill={c.accent} opacity={0.1} stroke={c.accent} strokeWidth={1.5} />
          <text x={symW / 2} y={symH / 2 + 4} textAnchor="middle" fill={c.accent} fontSize={9} fontWeight={700} fontFamily={TOPO_FONT_MONO}>
            {NODE_LABELS[node.type]}
          </text>
        </g>
      )}

      {/* P&ID Label Tag (below symbol) */}
      <g transform={`translate(${symW / 2}, ${labelY})`}>
        <rect
          x={-(Math.min(node.label.length * 4.2 + 10, symW + 20)) / 2}
          y={-8}
          width={Math.min(node.label.length * 4.2 + 10, symW + 20)}
          height={14}
          rx={3}
          fill={isInactive ? 'hsl(var(--muted))' : c.bg}
          stroke={isInactive ? 'hsl(var(--border))' : c.border}
          strokeWidth={0.8}
          opacity={0.9}
        />
        <text x={0} y={2} textAnchor="middle" fill={isInactive ? 'hsl(var(--muted-foreground))' : c.text} fontSize={7} fontWeight={600} fontFamily={TOPO_FONT_MONO} letterSpacing={0.3}>
          {node.label.length > 18 ? node.label.slice(0, 17) + '...' : node.label}
        </text>
      </g>

      {/* Equipment detail line */}
      {hasDetail && (
        <text x={symW / 2} y={labelY + 14} textAnchor="middle" fill={isInactive ? 'hsl(var(--muted-foreground))' : c.accent} fontSize={6.5} fontFamily={TOPO_FONT_MONO} opacity={0.7}>
          {(node.detail ?? '').length > 28 ? (node.detail ?? '').slice(0, 27) + '...' : node.detail}
        </text>
      )}

      {/* Water balance overlay volume display */}
      {isOverlay && (
        <g transform={`translate(${symW / 2}, ${labelY + (hasDetail ? 26 : 14)})`}>
          <rect x={-30} y={-7} width={60} height={12} rx={3} fill={nodeVolume && nodeVolume > 0 ? c.accent : 'hsl(var(--muted))'} opacity={nodeVolume && nodeVolume > 0 ? 0.18 : 0.12} />
          <text x={0} y={2} textAnchor="middle" fill={nodeVolume && nodeVolume > 0 ? c.accent : 'hsl(var(--muted-foreground))'} fontSize={7} fontFamily={TOPO_FONT_MONO} fontWeight={700}>
            {nodeVolume != null && nodeVolume > 0 ? `${fmtNum(nodeVolume, 0)} m³` : '0 m³'}
          </text>
        </g>
      )}

      {/* Custom node badge */}
      {isCustom && (
        <g transform={`translate(${symW / 2 - 16}, ${totalH - 4})`}>
          <rect x={0} y={0} width={32} height={8} rx={4} fill={c.accent} opacity={0.2} />
          <text x={16} y={6} textAnchor="middle" fill={c.accent} fontSize={5} fontWeight={700} fontFamily={TOPO_FONT_MONO}>CUSTOM</text>
        </g>
      )}

      {/* Drag handle for custom nodes */}
      {isCustom && canEdit && isHov && !editMode && (
        <g transform={`translate(${symW - 8}, ${symH / 2 - 10})`} style={{ cursor: 'grab' }}
          onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); startDrag({ nodeId: node.id, nodeType: node.type, label: node.label, colId: node.colId }, e as unknown as React.PointerEvent); }}>
          <rect x={-2} y={-2} width={14} height={22} rx={3} fill={c.accent} opacity={0.12} />
          <rect x={1} y={1} width={2} height={2} rx={1} fill={c.accent} opacity={0.6} />
          <rect x={5} y={1} width={2} height={2} rx={1} fill={c.accent} opacity={0.6} />
          <rect x={1} y={5} width={2} height={2} rx={1} fill={c.accent} opacity={0.6} />
          <rect x={5} y={5} width={2} height={2} rx={1} fill={c.accent} opacity={0.6} />
          <rect x={1} y={9} width={2} height={2} rx={1} fill={c.accent} opacity={0.6} />
          <rect x={5} y={9} width={2} height={2} rx={1} fill={c.accent} opacity={0.6} />
        </g>
      )}

      {/* Connection count badge for bulk/locator */}
      {(node.type === 'bulk' || node.type === 'locator') && connCount > 0 && (
        <g transform={`translate(${symW - 4}, ${totalH - 8})`}>
          <rect x={-9} y={-7} width={18} height={12} rx={6} fill={c.accent} />
          <text x={0} y={2} textAnchor="middle" fill="#fff" fontSize={7} fontWeight={700}>{connCount}</text>
        </g>
      )}

      {/* Group indicator bar */}
      {node.group && (
        <rect x={4} y={totalH - 2} width={symW - 8} height={3} rx={1.5} fill={c.accent} opacity={0.25} />
      )}
    </g>
  );
}
