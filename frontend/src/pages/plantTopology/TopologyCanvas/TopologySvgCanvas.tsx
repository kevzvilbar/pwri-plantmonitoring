import React, { useRef, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { NodeType, NODE_W, NODE_H, START_Y, ROW_GAP, POWER_COLS,
  COLORS, COL_GAP, ColSlot, cubicPath,
} from '../shared';
import { NodePalette } from '../NodePalette';
import { TopologyHeader } from './TopologyHeader';
import { TopoNodeRenderer, type NodeRendererProps } from './TopoNodeRenderer';
import { TopoLinkRenderer, type LinkRendererProps } from './TopoLinkRenderer';
import { ZoomControls } from './ZoomControls';
import { NodeInspector } from '../NodeInspector';
import { TopologyLegend } from '../TopologyLegend';
import { Droplet } from 'lucide-react';
import type { TopoNode, TopoLink, DragItem, NodePositionOverride } from '../shared';
import type { PlantTopologyProps } from '../TopologyCanvas';

export interface TopologySvgCanvasProps {
  props: PlantTopologyProps;
  activePlant: { name: string } | undefined;
  hasPowerNodes: boolean;
  positions: Map<string, { x: number; y: number; zone: string }>;
  allLinks: TopoLink[];
  waterNodesCount: number;
  powerNodesCount: number;
  activeLinksCount: number;
  colSequence: ColSlot[];
  colXMap: Record<string, number>;
  maxX: number;
  maxY: number;
  maxWaterY: number;
  powerDividerY: number;
  linkCounts: Record<string, number>;
  dragItem: DragItem | null;
  snapTarget: { colKey: string; rowIdx: number } | null;
  hoveredLink: number | null;
  inspectNode: TopoNode | null;
  colWidths: Record<string, number>;
  resizingCol: { key: string; startSvgX: number; startWidth: number } | null;
  hoveredLaneResizer: string | null;
  zoom: number;
  topoState: { nodes: TopoNode[]; fixedLinks: TopoLink[]; editLinks: TopoLink[] };
  effectivePlantId: string | null;
  isMobile: boolean;
  canEdit: boolean;
  panelOpen: boolean;
  saving: boolean;
  showHelp: boolean;
  editMode: 'connect' | 'disconnect' | null;
  pendingFrom: { id: string; type: NodeType } | null;
  hovered: string | null;
  isPanning: React.MutableRefObject<boolean>;
  lastPan: React.MutableRefObject<{ x: number; y: number }>;
}

export function TopologySvgCanvas({
  props, activePlant, hasPowerNodes, positions, allLinks, waterNodesCount,
  powerNodesCount, activeLinksCount, colSequence, colXMap, maxX, maxY,
  maxWaterY, powerDividerY, linkCounts, dragItem, snapTarget, hoveredLink,
  inspectNode, colWidths, resizingCol, hoveredLaneResizer, zoom, topoState,
  effectivePlantId, isMobile, canEdit, panelOpen, saving, showHelp,
  editMode, pendingFrom, hovered, isPanning, lastPan,
}: TopologySvgCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const { selectedPlantId } = useAppStore();

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    props.setZoom((z: number) => Math.min(2.5, Math.max(0.3, z - e.deltaY * 0.001)));
  }, [props.setZoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1 && !(e.button === 0 && e.altKey)) return;
    isPanning.current = true;
    lastPan.current = { x: e.clientX - props.pan.x, y: e.clientY - props.pan.y };
  }, [props.pan, isPanning, lastPan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    props.setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y });
  }, [props.setPan, isPanning, lastPan]);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, [isPanning]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <Droplet className="h-3.5 w-3.5 text-primary" />
          <span className="text-2xs tracking-widest text-primary font-mono uppercase font-semibold">
            {activePlant?.name} — Water Treatment Flow
          </span>
          <span className="ml-auto text-3xs text-muted-foreground font-mono">
            {dragItem
              ? '📌 Drop on any column to place node'
              : isMobile ? 'Tap node to inspect · +/− to zoom' : 'Click node to inspect · Scroll / Alt+drag · Ctrl+scroll'}
          </span>
        </div>

        <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
          <div
            ref={canvasRef}
            className={`flex-1 min-h-0 rounded-xl border bg-card shadow-sm transition-colors ${
              dragItem && snapTarget ? 'border-primary/60 ring-2 ring-primary/20' : 'border-border'
            }`}
            style={{
              overflow: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: 'hsl(var(--border)) hsl(var(--muted))',
              cursor: dragItem ? (snapTarget ? 'copy' : 'not-allowed') : undefined,
            }}
            onWheel={handleWheel}
          >
            <svg
              width={Math.max(maxX * zoom, 200)}
              height={Math.max((maxY + 24) * zoom, 200)}
              style={{ display: 'block' }}
            >
              <defs>
                <marker id="arrow-main" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L0,7 L7,3.5 z" fill="hsl(var(--muted-foreground))" />
                </marker>
                <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx={1} cy={1} r={1} fill="hsl(var(--border))" />
                </pattern>
              </defs>

              <g transform={`scale(${zoom})`}>
                <rect width={maxX} height={maxY + 24} fill="hsl(var(--card))" />
                <rect width={maxX} height={maxY + 24} fill="url(#dot-grid)" />

                {colSequence.map((slot) => {
                  const x = colXMap[slot.key];
                  if (x === undefined) return null;
                  const laneColor = slot.isCustom
                    ? COLORS.customNode.lane
                    : COLORS[slot.type!].lane;
                  return (
                    <rect
                      key={`lane-${slot.key}`}
                      x={x - 10} y={24}
                      width={NODE_W + 20}
                      height={maxWaterY - 10}
                      rx={6}
                      fill={laneColor}
                      opacity={0.55}
                    />
                  );
                })}

                {colSequence.map((slot) => {
                  const x = colXMap[slot.key];
                  if (x === undefined) return null;
                  const slotW = colWidths[slot.key] ?? COL_GAP;
                  const handleX = x + slotW - 8;
                  const isActive = resizingCol?.key === slot.key || hoveredLaneResizer === slot.key;
                  const laneColor = slot.isCustom ? COLORS.customNode.accent : COLORS[slot.type!].accent;
                  return (
                    <g key={`resize-${slot.key}`}>
                      <line
                        x1={handleX} y1={20} x2={handleX} y2={maxWaterY + 10}
                        stroke={isActive ? laneColor : 'hsl(var(--border))'}
                        strokeWidth={isActive ? 2 : 1}
                        strokeDasharray={isActive ? undefined : '3,3'}
                        opacity={isActive ? 0.8 : 0.4}
                        style={{ pointerEvents: 'none' }}
                      />
                      {isActive && (
                        <g transform={`translate(${handleX - 4}, ${(maxWaterY + 20) / 2 - 12})`}>
                          <rect x={0} y={0} width={8} height={24} rx={4}
                            fill={laneColor} opacity={0.15} />
                          <rect x={2} y={5}  width={4} height={2} rx={1} fill={laneColor} opacity={0.7} />
                          <rect x={2} y={10} width={4} height={2} rx={1} fill={laneColor} opacity={0.7} />
                          <rect x={2} y={15} width={4} height={2} rx={1} fill={laneColor} opacity={0.7} />
                        </g>
                      )}
                      <rect
                        x={handleX - 6} y={20}
                        width={12} height={maxWaterY - 10}
                        fill="transparent"
                        style={{ cursor: 'col-resize' }}
                        onPointerEnter={() => props.setHoveredLaneResizer(slot.key)}
                        onPointerLeave={() => { if (resizingCol?.key !== slot.key) props.setHoveredLaneResizer(null); }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
                          const svgEl = (e.currentTarget as SVGElement).closest('svg')!;
                          const svgRect = svgEl.getBoundingClientRect();
                          const svgX = (e.clientX - svgRect.left) / zoom;
                          props.setResizingCol({ key: slot.key, startSvgX: svgX, startWidth: slotW });
                          props.setHoveredLaneResizer(slot.key);
                        }}
                        onPointerMove={(e) => {
                          if (!resizingCol || resizingCol.key !== slot.key) return;
                          const svgEl = (e.currentTarget as SVGElement).closest('svg')!;
                          const svgRect = svgEl.getBoundingClientRect();
                          const svgX = (e.clientX - svgRect.left) / zoom;
                          const delta = svgX - resizingCol.startSvgX;
                          const newW = Math.max(NODE_W + 20, resizingCol.startWidth + delta);
                          const next = { ...colWidths, [slot.key]: newW };
                          props.setColWidths(next);
                          if (effectivePlantId) props.saveColWidths(effectivePlantId, next);
                        }}
                        onPointerUp={() => {
                          props.setResizingCol(null);
                          props.setHoveredLaneResizer(null);
                        }}
                      />
                    </g>
                  );
                })}

                {dragItem && snapTarget && (() => {
                  const snapX = colXMap[snapTarget.colKey] ?? 0;
                  const snapY = START_Y + snapTarget.rowIdx * ROW_GAP;
                  const c = COLORS[dragItem.nodeType];
                  return (
                    <g>
                      <rect
                        x={snapX - 10} y={24}
                        width={NODE_W + 20} height={maxWaterY - 10}
                        rx={6} fill={c.accent} opacity={0.08}
                        stroke={c.accent} strokeWidth={2} strokeDasharray="6,3"
                      />
                      <rect
                        x={snapX} y={snapY}
                        width={NODE_W} height={NODE_H}
                        rx={9} fill={c.accent} opacity={0.12}
                        stroke={c.accent} strokeWidth={2} strokeDasharray="5,3"
                      />
                      <text x={snapX + NODE_W / 2} y={snapY + NODE_H / 2 + 4}
                        textAnchor="middle" fill={c.accent}
                        fontSize={9} fontFamily="monospace" fontWeight={700}>
                        DROP HERE
                      </text>
                    </g>
                  );
                })()}

                {hasPowerNodes && (
                  <>
                    <line x1={0} y1={powerDividerY} x2={maxX} y2={powerDividerY}
                      stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="6,5" />
                    <rect x={10} y={powerDividerY - 22} width={104} height={18} rx={9} fill="hsl(var(--muted))" />
                    <text x={62} y={powerDividerY - 11} textAnchor="middle"
                      fill="hsl(var(--muted-foreground))" fontSize={9}
                      fontFamily="monospace" fontWeight={600} letterSpacing={1.2}>
                      POWER SUPPLY
                    </text>
                    <rect x={10} y={START_Y - 26} width={88} height={18} rx={9} fill="hsl(var(--accent-soft))" />
                    <text x={54} y={START_Y - 15} textAnchor="middle"
                      fill="hsl(var(--accent))" fontSize={9}
                      fontFamily="monospace" fontWeight={600} letterSpacing={1.2}>
                      WATER FLOW
                    </text>
                  </>
                )}

                {colSequence.map((slot) => {
                  const x = colXMap[slot.key];
                  if (x === undefined) return null;
                  return (
                    <text key={`hdr-${slot.key}`} x={x + NODE_W / 2} y={16}
                      textAnchor="middle"
                      fill="hsl(var(--muted-foreground))"
                      fontSize={8.5}
                      fontFamily="monospace" letterSpacing={1.5} fontWeight={700}>
                      {slot.label.toUpperCase()}
                    </text>
                  );
                })}
                {hasPowerNodes && [
                  { x: POWER_COLS.solarSource, label: 'SOURCE' },
                  { x: POWER_COLS.solarMeter,  label: 'SOLAR / GRID METERS' },
                ].map(({ x, label }) => (
                  <text key={`pwr-${label}`} x={x + NODE_W / 2} y={powerDividerY + 16}
                    textAnchor="middle" fill="hsl(var(--warn))" fontSize={8}
                    fontFamily="monospace" letterSpacing={1.5} fontWeight={700}>
                    {label}
                  </text>
                ))}

                <g>
                  {allLinks.map((l, i) => (
                    <TopoLinkRenderer
                      key={`link-${i}`}
                      link={l}
                      idx={i}
                      topoState={topoState}
                      positions={positions}
                      hoveredLink={hoveredLink}
                      setHoveredLink={props.setHoveredLink}
                    />
                  ))}
                </g>

                <g>
                  {topoState.nodes.map((node) => (
                    <TopoNodeRenderer
                      key={node.id}
                      node={node}
                      positions={positions}
                      linkCounts={linkCounts}
                      pendingFrom={pendingFrom}
                      hovered={hovered}
                      inspectNode={inspectNode}
                      editMode={editMode}
                      canEdit={canEdit}
                      dragItem={dragItem}
                      topoState={topoState}
                      startDrag={props.startDrag}
                      handleNodeClick={props.handleNodeClick}
                      setHovered={props.setHovered}
                    />
                  ))}
                </g>
              </g>
            </svg>
          </div>

          <ZoomControls
            zoom={zoom}
            setZoom={props.setZoom}
            resetView={() => { props.setZoom(1); props.setPan({ x: 0, y: 0 }); }}
          />

          {inspectNode && (
            <NodeInspector
              node={inspectNode}
              onClose={() => props.setInspectNode(null)}
              allNodes={topoState.nodes}
              allLinks={allLinks}
              plantId={effectivePlantId ?? undefined}
              plantName={activePlant?.name}
              onSelectNode={(nodeId) => {
                const target = topoState.nodes.find((n) => n.id === nodeId);
                if (target) props.setInspectNode(target);
              }}
            />
          )}
        </div>

        <TopologyLegend />
      </div>

      <props.SidePanelComponent
        open={panelOpen}
        onClose={() => props.setPanelOpen(false)}
        topoState={topoState}
        customNodes={props.customNodes}
        customColumns={props.customColumns}
        plantId={effectivePlantId ?? ''}
        canEdit={canEdit}
        onAddNode={props.handleAddNode}
        onDeleteCustomNode={props.handleDeleteCustomNode}
        onRenameCustomNode={props.handleRenameCustomNode}
        onAddColumn={props.handleAddColumn}
        onDeleteColumn={props.handleDeleteColumn}
      />
    </div>
  );
}
