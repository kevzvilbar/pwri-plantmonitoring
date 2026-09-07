import React, { useRef, useCallback, type MutableRefObject } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
import { Droplet, RefreshCw, HelpCircle, PanelRightOpen, PanelRightClose, ZoomIn, ZoomOut, Maximize2, Move, Layers, Plug, Unplug, Save } from 'lucide-react';
import {
  NodeType, CustomColumn, buildColSequence, buildColXMap, TopoNode, TopoLink,
  NodePositionOverride, DragItem, TopologyState, NODE_W, NODE_H, ROW_GAP,
  START_Y, COL_GAP, POWER_COLS, NODE_LABELS, COLORS, canConnect,
  saveLinks, loadCustomNodes, saveCustomNodes, loadCustomColumns, saveCustomColumns,
  loadPosOverrides, savePosOverrides, loadPaletteItems, savePaletteItems,
  loadColWidths, saveColWidths, useTopologyData, buildTopology, Zone,
  layoutNodes, cubicPath, TOPO_FONT_SANS, TOPO_FONT_MONO, getNodeStatusInfo,
} from './shared';
import { NodePalette } from './NodePalette';
import { RenameModal } from './RenameModal';
import { DragGhost } from './DragGhost';
import { SidePanel } from './SidePanel';
import { NodeInspector } from './NodeInspector';
import { TopologyLegend } from './TopologyLegend';
import { TopologyHeader } from './TopologyCanvas/TopologyHeader';
import { TopologySvgCanvas, type TopologySvgCanvasProps } from './TopologyCanvas/TopologySvgCanvas';
import { ZoomControls } from './TopologyCanvas/ZoomControls';

export interface PlantTopologyProps {
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
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: (p: { x: number; y: number }) => void;
  isPanning: MutableRefObject<boolean>;
  lastPan: MutableRefObject<{ x: number; y: number }>;
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
  saveColWidths: (plantId: string, widths: Record<string, number>) => void;
  SidePanelComponent: React.ComponentType<{
    open: boolean;
    onClose: () => void;
    topoState: { nodes: TopoNode[]; fixedLinks: TopoLink[]; editLinks: TopoLink[] };
    customNodes: TopoNode[];
    customColumns: CustomColumn[];
    plantId: string;
    canEdit: boolean;
    onAddNode: (type: 'bulk' | 'locator' | 'customNode', name: string, colId?: string) => void;
    onDeleteCustomNode: (id: string) => void;
    onRenameCustomNode: (id: string, name: string) => void;
    onAddColumn: (label: string, insertAfter: string) => void;
    onDeleteColumn: (colId: string) => void;
  }>;
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
  startDrag, handleRenameConfirm, handleNodeClick, computeSnap, handleDropNode, saveColWidths,
}: PlantTopologyProps) {
  const isMobile = useIsMobile();
  const { selectedPlantId } = useAppStore();
  const { isAdmin, isManager } = useAuth();

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

  const hasPowerNodes = topoState!.nodes.some((n) =>
    ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)
  );
  const waterNodesCount = topoState?.nodes.filter(n => !['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)).length ?? 0;
  const powerNodesCount = topoState?.nodes.filter(n => ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)).length ?? 0;
  const activeLinksCount = topoState?.editLinks.length ?? 0;

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

  const svgCanvasProps: TopologySvgCanvasProps = {
    props: {
      plants, effectivePlantId, setActivePlantId, canEdit, isLoading, rawData, topoState,
      setTopoState, refetch, showHelp, setShowHelp, saving, setSaving, panelOpen, setPanelOpen,
      customNodes, setCustomNodes, customColumns, setCustomColumns, posOverrides, setPosOverrides,
      paletteItems, setPaletteItems, colWidths, setColWidths, dragItem, setDragItem, dragPos, setDragPos,
      snapTarget, setSnapTarget, pendingRename, setPendingRename, hovered, setHovered, hoveredLink,
      setHoveredLink, editMode, setEditMode, pendingFrom, setPendingFrom, inspectNode, setInspectNode,
      resizingCol, setResizingCol, hoveredLaneResizer, setHoveredLaneResizer, zoom, setZoom, pan, setPan,
      isPanning, lastPan, qc, handleAddNode, handleDeleteCustomNode, handleRenameCustomNode, handleAddColumn,
      handleDeleteColumn, handleAddPaletteItem, handleRenamePaletteItem, handleDeletePaletteItem, handleSave,
      startDrag, handleRenameConfirm, handleNodeClick, computeSnap, handleDropNode, saveColWidths,
      SidePanelComponent: SidePanel,
    },
    activePlant,
    hasPowerNodes,
    positions,
    allLinks,
    waterNodesCount,
    powerNodesCount,
    activeLinksCount,
    colSequence,
    colXMap,
    maxX, maxY, maxWaterY, powerDividerY,
    linkCounts,
    dragItem,
    snapTarget,
    hoveredLink,
    hovered,
    inspectNode,
    colWidths,
    resizingCol,
    hoveredLaneResizer,
    zoom,
    topoState: topoState!,
    effectivePlantId,
    isMobile,
    canEdit,
    panelOpen,
    saving,
    showHelp,
    editMode,
    pendingFrom,
    isPanning,
    lastPan,
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden animate-fade-in" data-testid="network-topology-page">

      <TopologyHeader
        activePlant={activePlant}
        plants={plants}
        effectivePlantId={effectivePlantId}
        setActivePlantId={setActivePlantId}
        setShowHelp={setShowHelp}
        showHelp={showHelp}
        refetch={refetch}
        setPanelOpen={setPanelOpen}
        panelOpen={panelOpen}
        canEdit={canEdit}
        saving={saving}
        handleSave={handleSave}
        setEditMode={setEditMode}
        setPendingFrom={setPendingFrom}
        editMode={editMode}
        pendingFrom={pendingFrom}
        waterNodesCount={waterNodesCount}
        powerNodesCount={powerNodesCount}
        activeLinksCount={activeLinksCount}
        isMobile={isMobile}
      />

      <TopologySvgCanvas {...svgCanvasProps} />

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
