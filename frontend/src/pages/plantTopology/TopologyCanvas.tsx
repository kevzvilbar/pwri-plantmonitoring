import React, { useRef, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Droplet, RefreshCw, HelpCircle, PanelRightOpen, PanelRightClose, ZoomIn, ZoomOut, Maximize2, Move, Layers, Plug, Unplug, Save } from 'lucide-react';
import { NodeType, CustomColumn, buildColSequence, buildColXMap, TopoNode, TopoLink, NodePositionOverride, DragItem, TopologyState, NODE_W, NODE_H, ROW_GAP, START_Y, COL_GAP, POWER_COLS, NODE_LABELS, COLORS, canConnect, saveLinks, loadCustomNodes, saveCustomNodes, loadCustomColumns, saveCustomColumns, loadPosOverrides, savePosOverrides, loadPaletteItems, savePaletteItems, loadColWidths, saveColWidths, useTopologyData, buildTopology, Zone, layoutNodes, cubicPath, TOPO_FONT_SANS, TOPO_FONT_MONO, getNodeStatusInfo } from './shared';
import { NodePalette } from './NodePalette';
import { RenameModal } from './RenameModal';
import { DragGhost } from './DragGhost';
import { SidePanel } from './SidePanel';
import { NodeInspector } from './NodeInspector';
import { TopologyLegend } from './TopologyLegend';

interface PlantTopologyProps {
  plants: any[];
  effectivePlantId: string | null;
  setActivePlantId: (id: string) => void;
  canEdit: boolean;
  isLoading: boolean;
  rawData: any;
  topoState: TopologyState | null;
  setTopoState: (s: TopologyState | null) => void;
  refetch: () => void;
  showHelp: boolean;
  setShowHelp: (v: boolean) => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  customNodes: TopoNode[];
  setCustomNodes: (n: TopoNode[]) => void;
  customColumns: CustomColumn[];
  setCustomColumns: (c: CustomColumn[]) => void;
  posOverrides: Record<string, NodePositionOverride>;
  setPosOverrides: (o: Record<string, NodePositionOverride>) => void;
  paletteItems: any[];
  setPaletteItems: (i: any[]) => void;
  colWidths: Record<string, number>;
  setColWidths: (w: Record<string, number>) => void;
  dragItem: DragItem | null;
  setDragItem: (d: DragItem | null) => void;
  dragPos: { x: number; y: number };
  setDragPos: (p: { x: number; y: number }) => void;
  snapTarget: { colKey: string; rowIdx: number } | null;
  setSnapTarget: (s: { colKey: string; rowIdx: number } | null) => void;
  pendingRename: { id: string; nodeType: NodeType; defaultName: string } | null;
  setPendingRename: (r: { id: string; nodeType: NodeType; defaultName: string } | null) => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  hoveredLink: number | null;
  setHoveredLink: (idx: number | null) => void;
  editMode: 'connect' | 'disconnect' | null;
  setEditMode: (m: 'connect' | 'disconnect' | null) => void;
  pendingFrom: { id: string; type: NodeType } | null;
  setPendingFrom: (p: { id: string; type: NodeType } | null) => void;
  inspectNode: TopoNode | null;
  setInspectNode: (n: TopoNode | null) => void;
  resizingCol: { key: string; startSvgX: number; startWidth: number } | null;
  setResizingCol: (r: { key: string; startSvgX: number; startWidth: number } | null) => void;
  hoveredLaneResizer: string | null;
  setHoveredLaneResizer: (k: string | null) => void;
  zoom: number;
  setZoom: (z: number) => void;
  pan: { x: number; y: number };
  setPan: (p: { x: number; y: number }) => void;
  isPanning: React.MutableRefObject<boolean>;
  lastPan: React.MutableRefObject<{ x: number; y: number }>;
  qc: any;
  handleAddNode: (type: 'bulk' | 'locator' | 'customNode', name: string, colId?: string) => void;
  handleDeleteCustomNode: (id: string) => void;
  handleRenameCustomNode: (id: string, name: string) => void;
  handleAddColumn: (label: string, insertAfter: string) => void;
  handleDeleteColumn: (colId: string) => void;
  handleAddPaletteItem: (label: string) => void;
  handleRenamePaletteItem: (id: string, label: string) => void;
  handleDeletePaletteItem: (id: string) => void;
  handleSave: () => void;
  startDrag: (item: DragItem, e: React.PointerEvent) => void;
  handleRenameConfirm: (id: string, name: string) => void;
  handleNodeClick: (node: TopoNode) => void;
  computeSnap: (clientX: number, clientY: number) => { colKey: string; rowIdx: number } | null;
  handleDropNode: (item: DragItem, snap: { colKey: string; rowIdx: number }) => void;
}

export default function PlantTopologyContent({
  plants, effectivePlantId, setActivePlantId, canEdit, isLoading, rawData, topoState,
  setTopoState, refetch, showHelp, setShowHelp, saving, setSaving, panelOpen, setPanelOpen,
  customNodes, setCustomNodes, customColumns, setCustomColumns, posOverrides, setPosOverrides,
  paletteItems, setPaletteItems, colWidths, setColWidths, dragItem, setDragItem, dragPos, setDragPos,
  snapTarget, setSnapTarget, pendingRename, setPendingRename, hovered, setHovered, hoveredLink,
  setHoveredLink, editMode, setEditMode, pendingFrom, setPendingFrom, inspectNode, setInspectNode,
  resizingCol, setResizingCol, hoveredLaneResizer, setHoveredLaneResizer, zoom, setZoom, pan, setPan,
  isPanning, lastPan, qc, handleAddNode, handleDeleteCustomNode, handleRenameCustomNode, handleAddColumn,
  handleDeleteColumn, handleAddPaletteItem, handleRenamePaletteItem, handleDeletePaletteItem, handleSave,
  startDrag, handleRenameConfirm, handleNodeClick, computeSnap, handleDropNode,
}: PlantTopologyProps) {
  const isMobile = useIsMobile();
  const { selectedPlantId } = useAppStore();
  const { isAdmin, isManager } = useAuth();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragItemRef = useRef<DragItem | null>(null);
  const snapRef = useRef<{ colKey: string; rowIdx: number } | null>(null);
  dragItemRef.current = dragItem;
  snapRef.current = snapTarget;

  const activePlant = plants.find((p) => p.id === effectivePlantId);
  const colSequence = buildColSequence(customColumns);
  const colXMap = buildColXMap(customColumns, colWidths);
  const positions  = layoutNodes(topoState!.nodes, customColumns, posOverrides, colWidths);
  const allLinks   = [...topoState!.fixedLinks, ...topoState!.editLinks];

  let maxX = 0, maxY = 0;
  positions.forEach(({ x, y }) => {
    maxX = Math.max(maxX, x + NODE_W + 40);
    maxY = Math.max(maxY, y + NODE_H + 40);
  });
  Object.values(colXMap).forEach((x) => { maxX = Math.max(maxX, x + NODE_W + 60); });

  let maxWaterY = 0;
  positions.forEach(({ y, zone }) => { if (zone === 'water') maxWaterY = Math.max(maxWaterY, y + NODE_H); });
  const powerDividerY = maxWaterY + 36;

  const linkCounts: Record<string, number> = {};
  allLinks.forEach((l) => {
    linkCounts[l.from] = (linkCounts[l.from] ?? 0) + 1;
    linkCounts[l.to]   = (linkCounts[l.to]   ?? 0) + 1;
  });

  // ── Node renderer ─────────────────────────────────────────────────────────────

  function renderNode(node: TopoNode) {
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

    const h = hasDetail ? NODE_H + 18 : NODE_H;

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

  // ── Link renderer ─────────────────────────────────────────────────────────────

  function renderLink(link: TopoLink, idx: number) {
    const f = positions.get(link.from);
    const t = positions.get(link.to);
    if (!f || !t) return null;

    const fromNode = topoState!.nodes.find((n) => n.id === link.from);
    const toNode   = topoState!.nodes.find((n) => n.id === link.to);
    const fh = fromNode?.detail ? NODE_H + 18 : NODE_H;
    const th = toNode?.detail   ? NODE_H + 18 : NODE_H;

    const x1 = f.x + NODE_W, y1 = f.y + fh / 2;
    const x2 = t.x,          y2 = t.y + th / 2;
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

  const hasPowerNodes = topoState!.nodes.some((n) =>
    ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)
  );

  const waterNodesCount = topoState?.nodes.filter(n => !['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)).length ?? 0;
  const powerNodesCount = topoState?.nodes.filter(n => ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)).length ?? 0;
  const activeLinksCount = topoState?.editLinks.length ?? 0;

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => Math.min(2.5, Math.max(0.3, z - e.deltaY * 0.001)));
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 1 && !(e.button === 0 && e.altKey)) return;
    isPanning.current = true;
    lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isPanning.current) return;
    setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y });
  }

  function handleMouseUp() { isPanning.current = false; }
  function resetView()     { setZoom(1); setPan({ x: 0, y: 0 }); }

  if (!plants.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No plants found. Create a plant first.
      </div>
    );
  }

  if (isLoading || !topoState) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" /> Building topology…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden animate-fade-in" data-testid="network-topology-page">

      {/* ── SCADA Header ── */}
      <div className="flex items-center justify-between gap-4 px-5 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="shrink-0 space-y-0.5">
            <h1 className="text-base font-bold tracking-tight text-foreground leading-tight">Network Topology</h1>
            <p className="text-2xs text-muted-foreground hidden xl:block">
              P&amp;ID process flow &amp; power distribution
            </p>
          </div>

          <div className="h-5 w-px bg-border/80 hidden sm:block shrink-0" />

          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border shrink-0 flex-nowrap overflow-x-auto">
            {plants.map((p) => {
              const isActive = effectivePlantId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { setActivePlantId(p.id); setPendingFrom(null); setEditMode(null); }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden lg:flex items-center gap-2 text-2xs font-mono text-muted-foreground">
            <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
              <Droplet className="h-3 w-3 text-primary" />
              <span>{waterNodesCount} Nodes</span>
            </span>
            <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
              <Plug className="h-3 w-3 text-muted-foreground" />
              <span>{powerNodesCount} Feeds</span>
            </span>
            <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
              <span>{activeLinksCount} Links</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 border-l border-border pl-2">
            <button
              onClick={() => setShowHelp((v) => !v)}
              aria-label={showHelp ? 'Hide help' : 'Show help'}
              className={`p-1.5 rounded-md border transition-colors ${
                showHelp
                  ? 'border-primary/50 bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}
              title="Help & Keybindings"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className={`p-1.5 rounded-md border transition-colors ${
                panelOpen
                  ? 'border-primary/50 bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}
              title="Toggle node panel"
              aria-label="Toggle node panel"
            >
              {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Help banner ───────────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="px-5 py-2.5 bg-primary/5 border-b border-primary/20 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 shrink-0">
          <span>
            <strong className="text-primary">Water flow:</strong>{' '}
            Well → Raw Meter → Pre-treatment → Feed Meter → RO Train → Permeate / Reject → Bulk Meter → Locator
          </span>
          <span>
            <strong className="text-primary">Power:</strong>{' '}
            Solar Array → Solar Meter · Grid Utility → Grid Meter → Wells / RO Trains
          </span>
          <span>
            <strong className="text-primary">Inspect:</strong>{' '}
            Click any node to open full specifications, stream analysis, and operational deep-links.
          </span>
          <span>
            <strong className="text-primary">Edit:</strong>{' '}
            Use Connect/Disconnect below, click two compatible nodes, then Save.
          </span>
          <span>
            <strong className="text-primary">Navigate:</strong>{' '}
            {isMobile
              ? 'Drag / scroll to pan · Use floating +/− to zoom · Tap any node to inspect'
              : 'Scroll to pan (H+V) · Alt+drag / middle-click · Ctrl+scroll to zoom · Click node to inspect'}
          </span>
        </div>
      )}

      {/* ── Edit toolbar ──────────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-muted/20 shrink-0 flex-wrap">
          <span className="text-2xs font-mono tracking-widest text-muted-foreground uppercase mr-1">Edit Links:</span>
          <button
            onClick={() => { setEditMode(editMode === 'connect' ? null : 'connect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-all ${
              editMode === 'connect'
                ? 'bg-accent-soft border-accent text-accent shadow-2xs'
                : 'border-border text-muted-foreground hover:border-accent/60 hover:text-accent/90'
            }`}
          >
            <Plug className="h-3.5 w-3.5" />
            {editMode === 'connect' ? (pendingFrom ? 'Pick 2nd node…' : 'Pick node…') : 'Connect'}
          </button>
          <button
            onClick={() => { setEditMode(editMode === 'disconnect' ? null : 'disconnect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-all ${
              editMode === 'disconnect'
                ? 'bg-danger-soft border-danger text-danger shadow-2xs'
                : 'border-border text-muted-foreground hover:border-danger/60 hover:text-danger/90'
            }`}
          >
            <Unplug className="h-3.5 w-3.5" />
            {editMode === 'disconnect' ? (pendingFrom ? 'Pick 2nd node…' : 'Pick node…') : 'Disconnect'}
          </button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={saving}
            className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/5 hover:border-primary ml-auto"
          >
            {saving
              ? <RefreshCw className="h-3 w-3 animate-spin mr-1" />
              : <Save className="h-3 w-3 mr-1" />}
            Save Topology
          </Button>
        </div>
      )}

      {/* ── Main area: canvas + side panel ────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* ── Diagram canvas with BOTH scrollbars ─────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 bg-muted/20 overflow-hidden">

          {/* ── Node Palette ── drag chips onto canvas to create nodes ─────────── */}
          {canEdit && (
            <NodePalette
              onDragStart={startDrag}
              paletteItems={paletteItems}
              onAddPaletteItem={handleAddPaletteItem}
              onRenamePaletteItem={handleRenamePaletteItem}
              onDeletePaletteItem={handleDeletePaletteItem}
            />
          )}

          <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">
            {/* Zone label */}
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

            {/* ── SVG canvas container with relative positioning ─────────────────── */}
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
                onWheel={(e) => {
                  if (e.ctrlKey) {
                    e.preventDefault();
                    setZoom((z) => Math.min(2.5, Math.max(0.3, z - e.deltaY * 0.001)));
                  }
                }}
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

                    {/* Column lane backgrounds — all columns in sequence order */}
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

                    {/* Column resize handles */}
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
                            onPointerEnter={() => setHoveredLaneResizer(slot.key)}
                            onPointerLeave={() => { if (resizingCol?.key !== slot.key) setHoveredLaneResizer(null); }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
                              const svgEl = (e.currentTarget as SVGElement).closest('svg')!;
                              const svgRect = svgEl.getBoundingClientRect();
                              const svgX = (e.clientX - svgRect.left) / zoom;
                              setResizingCol({ key: slot.key, startSvgX: svgX, startWidth: slotW });
                              setHoveredLaneResizer(slot.key);
                            }}
                            onPointerMove={(e) => {
                              if (!resizingCol || resizingCol.key !== slot.key) return;
                              const svgEl = (e.currentTarget as SVGElement).closest('svg')!;
                              const svgRect = svgEl.getBoundingClientRect();
                              const svgX = (e.clientX - svgRect.left) / zoom;
                              const delta = svgX - resizingCol.startSvgX;
                              const newW = Math.max(NODE_W + 20, resizingCol.startWidth + delta);
                              const next = { ...colWidths, [slot.key]: newW };
                              setColWidths(next);
                              if (effectivePlantId) saveColWidths(effectivePlantId, next);
                            }}
                            onPointerUp={() => {
                              setResizingCol(null);
                              setHoveredLaneResizer(null);
                            }}
                          />
                        </g>
                      );
                    })}

                    {/* Drag snap highlight */}
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
                            fontSize={9} fontFamily={TOPO_FONT_MONO} fontWeight={700}>
                            DROP HERE
                          </text>
                        </g>
                      );
                    })()}

                    {/* Power-zone divider */}
                    {hasPowerNodes && (
                      <>
                        <line x1={0} y1={powerDividerY} x2={maxX} y2={powerDividerY}
                          stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="6,5" />
                        <rect x={10} y={powerDividerY - 22} width={104} height={18} rx={9} fill="hsl(var(--muted))" />
                        <text x={62} y={powerDividerY - 11} textAnchor="middle"
                          fill="hsl(var(--muted-foreground))" fontSize={9}
                          fontFamily={TOPO_FONT_MONO} fontWeight={600} letterSpacing={1.2}>
                          POWER SUPPLY
                        </text>
                        <rect x={10} y={START_Y - 26} width={88} height={18} rx={9} fill="hsl(var(--accent-soft))" />
                        <text x={54} y={START_Y - 15} textAnchor="middle"
                          fill="hsl(var(--accent))" fontSize={9}
                          fontFamily={TOPO_FONT_MONO} fontWeight={600} letterSpacing={1.2}>
                          WATER FLOW
                        </text>
                      </>
                    )}

                    {/* Column header labels */}
                    {colSequence.map((slot) => {
                      const x = colXMap[slot.key];
                      if (x === undefined) return null;
                      return (
                        <text key={`hdr-${slot.key}`} x={x + NODE_W / 2} y={16}
                          textAnchor="middle"
                          fill="hsl(var(--muted-foreground))"
                          fontSize={8.5}
                          fontFamily={TOPO_FONT_MONO} letterSpacing={1.5} fontWeight={700}>
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
                        fontFamily={TOPO_FONT_MONO} letterSpacing={1.5} fontWeight={700}>
                        {label}
                      </text>
                    ))}

                    <g>{allLinks.map((l, i) => renderLink(l, i))}</g>
                    <g>{topoState!.nodes.map(renderNode)}</g>
                  </g>
                </svg>
              </div>

              {/* ── Canvas-Anchored Zoom Overlay ── */}
              <div className="absolute bottom-3 right-3 z-30 flex items-center gap-1 p-1 rounded-lg bg-card/90 backdrop-blur-md border border-border shadow-md select-none">
                <button
                  onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
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
                  onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
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

              {/* ── Node Inspector Overlay ── */}
              {inspectNode && (
                <NodeInspector
                  node={inspectNode}
                  onClose={() => setInspectNode(null)}
                  allNodes={topoState!.nodes}
                  allLinks={allLinks}
                  plantId={effectivePlantId ?? undefined}
                  plantName={activePlant?.name}
                  onSelectNode={(nodeId) => {
                    const target = topoState!.nodes.find((n) => n.id === nodeId);
                    if (target) setInspectNode(target);
                  }}
                />
              )}
            </div>

            {/* ── Grouped Collapsible Legend ────────────────────────────────────────── */}
            <TopologyLegend />
          </div>
        </div>

        {/* ── Side panel ────────────────────────────────────────────────────────── */}
        <SidePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          topoState={topoState}
          customNodes={customNodes}
          customColumns={customColumns}
          plantId={effectivePlantId ?? ''}
          canEdit={canEdit}
          onAddNode={handleAddNode}
          onDeleteCustomNode={handleDeleteCustomNode}
          onRenameCustomNode={handleRenameCustomNode}
          onAddColumn={handleAddColumn}
          onDeleteColumn={handleDeleteColumn}
        />
      </div>

      {/* ── Drag Ghost (follows cursor) ─────────────────────────────────────────── */}
      {dragItem && (
        <DragGhost item={dragItem} x={dragPos.x} y={dragPos.y} snapping={!!snapTarget} />
      )}

      {/* ── Rename Modal ─────────────────────────────────────────────────────────── */}
      {pendingRename && (
        <RenameModal
          defaultName={pendingRename.defaultName}
          nodeType={pendingRename.nodeType}
          onConfirm={(name) => handleRenameConfirm(pendingRename.id, name)}
          onCancel={() => {
            if (effectivePlantId) {
              const next = customNodes.filter((n) => n.id !== pendingRename.id);
              setCustomNodes(next);
              saveCustomNodes(effectivePlantId, next);
              const { [pendingRename.id]: _, ...rest } = posOverrides;
              setPosOverrides(rest);
              savePosOverrides(effectivePlantId, rest);
            }
            setPendingRename(null);
          }}
        />
      )}
    </div>
  );
}
