/**
 * PlantTopology.tsx  (revised v2)
 * ─────────────────────────────────
 * Visual wiring diagram for each plant showing:
 *
 *  WATER FLOW (left → right)
 *    Well → Raw Meter → Pre-treatment → Feed Meter → RO Train
 *        → Permeate Meter → Bulk/Mother Meter → Locator
 *        → Reject Meter
 *
 *  POWER LAYER (below water flow)
 *    Solar Array → Solar Meter(s) ─┐
 *    Grid Utility → Grid Meter(s)  ├──→ Well pumps · RO Train groups
 *
 * Changes in v2
 * ──────────────
 * • Ample spacing: larger NODE_W/NODE_H, bigger ROW_GAP, wider column gaps.
 * • Both horizontal AND vertical scrollbars on the SVG canvas (overflow: auto).
 * • RO Train nodes now show equipment breakdown: AFM/MMF × N, BP × N, HPP × N,
 *   CF/Bag Housing × N — pulled directly from ro_trains DB data.
 * • Node counts 1:1 mirror what is entered in Plants.tsx (locators, product
 *   meters, wells) — no off-by-one, no hardcoding.
 * • Solar source / solar meters fully shown in Power layer.
 * • Column headers now reference correct lane labels including SOLAR / GRID.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { usePlants } from '@/hooks/usePlants';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/store/appStore';
import { toast } from 'sonner';
import { 
  NodeType, CustomColumn, buildColSequence, buildColXMap, TopoNode, TopoLink, NodePositionOverride, DragItem, PaletteItem, TopologyState, 
  loadCustomNodes, saveCustomNodes, loadCustomColumns, saveCustomColumns, loadPosOverrides, savePosOverrides, loadPaletteItems, savePaletteItems, loadColWidths, saveColWidths,
  NODE_LABELS, CANVAS_REF, NODE_W, NODE_H, ROW_GAP, START_Y, COL_GAP, canConnect, buildTopology,
} from './plantTopology/shared';
import { useTopologyData, useSaveTopologyLinks } from '@/data/hooks/usePlantTopology';
import PlantTopologyContent from './plantTopology/TopologyCanvas';
import { SidePanel } from './plantTopology/SidePanel';

export default function PlantTopology() {
  const { isAdmin, isManager } = useAuth();
  const canEdit = usePermission('network_topology', 'edit');
  const isMobile = useIsMobile();
  const { selectedPlantId } = useAppStore();
  const qc = useQueryClient();

  const { data: plants = [] } = usePlants();
  const [activePlantId, setActivePlantId] = useState<string | null>(null);
  const effectivePlantId = activePlantId ?? selectedPlantId ?? plants[0]?.id ?? null;

  const { data: rawData, isLoading, refetch } = useTopologyData(effectivePlantId);
  const saveLinksMutation = useSaveTopologyLinks();

  const [editMode, setEditMode]       = useState<'connect' | 'disconnect' | null>(null);
  const [pendingFrom, setPendingFrom] = useState<{ id: string; type: NodeType } | null>(null);
  const [inspectNode, setInspectNode] = useState<TopoNode | null>(null);
  const [hovered, setHovered]         = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);
  const [showHelp, setShowHelp]       = useState(false);
  const [saving, setSaving]           = useState(false);
  const [panelOpen, setPanelOpen]     = useState(false);
  const [topoState, setTopoState]     = useState<TopologyState | null>(null);
  const [customNodes, setCustomNodes] = useState<TopoNode[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [posOverrides, setPosOverrides]   = useState<Record<string, NodePositionOverride>>({});
  const [paletteItems, setPaletteItems]   = useState<PaletteItem[]>([]);
  const [colWidths, setColWidths]         = useState<Record<string, number>>({});

  const [dragItem, setDragItem]       = useState<DragItem | null>(null);
  const [dragPos, setDragPos]         = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget]   = useState<{ colKey: string; rowIdx: number } | null>(null);
  const [pendingRename, setPendingRename] = useState<{ id: string; nodeType: NodeType; defaultName: string } | null>(null);
  const isPanning         = useRef(false);
  const lastPan           = useRef({ x: 0, y: 0 });

  const [resizingCol, setResizingCol]         = useState<{ key: string; startSvgX: number; startWidth: number } | null>(null);
  const [hoveredLaneResizer, setHoveredLaneResizer] = useState<string | null>(null);

  const [zoom, setZoom]   = useState(1);
  const [pan, setPan]     = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!effectivePlantId) return;
    setCustomNodes(loadCustomNodes(effectivePlantId));
    setCustomColumns(loadCustomColumns(effectivePlantId));
    setPosOverrides(loadPosOverrides(effectivePlantId));
    setPaletteItems(loadPaletteItems(effectivePlantId));
    setColWidths(loadColWidths(effectivePlantId));
  }, [effectivePlantId]);

  useEffect(() => {
    if (!rawData || !effectivePlantId) return;
    setTopoState(buildTopology(effectivePlantId, rawData, customNodes));
  }, [rawData, effectivePlantId, customNodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingFrom(null);
        setEditMode(null);
        setInspectNode(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Custom node CRUD ─────────────────────────────────────────────────────────

  const handleAddNode = useCallback((type: 'bulk' | 'locator' | 'customNode', name: string, colId?: string) => {
    if (!effectivePlantId) return;
    const id = `custom-${type}-${Date.now()}`;
    const node: TopoNode = { id, type, label: name, status: 'Active', custom: true, colId };
    const next = [...customNodes, node];
    setCustomNodes(next);
    saveCustomNodes(effectivePlantId, next);
    toast.success(`${colId ? name : NODE_LABELS[type]} "${name}" added`);
  }, [customNodes, effectivePlantId]);

  const handleDeleteCustomNode = useCallback((id: string) => {
    if (!effectivePlantId) return;
    const next = customNodes.filter((n) => n.id !== id);
    setCustomNodes(next);
    saveCustomNodes(effectivePlantId, next);
    if (topoState) {
      setTopoState({
        ...topoState,
        editLinks: topoState.editLinks.filter((l) => l.from !== id && l.to !== id),
      });
    }
    toast.info('Node removed');
  }, [customNodes, effectivePlantId, topoState]);

  const handleRenameCustomNode = useCallback((id: string, name: string) => {
    if (!effectivePlantId || !name.trim()) return;
    const next = customNodes.map((n) => n.id === id ? { ...n, label: name.trim() } : n);
    setCustomNodes(next);
    saveCustomNodes(effectivePlantId, next);
    if (topoState) {
      setTopoState({
        ...topoState,
        nodes: topoState.nodes.map((n) => n.id === id ? { ...n, label: name.trim() } : n),
      });
    }
  }, [customNodes, effectivePlantId, topoState]);

  const handleAddColumn = useCallback((label: string, insertAfter: string) => {
    if (!effectivePlantId) return;
    const col: CustomColumn = { id: `col-${Date.now()}`, label, insertAfter };
    const next = [...customColumns, col];
    setCustomColumns(next);
    saveCustomColumns(effectivePlantId, next);
    toast.success(`Column "${label}" added`);
  }, [customColumns, effectivePlantId]);

  const handleDeleteColumn = useCallback((colId: string) => {
    if (!effectivePlantId) return;
    const nextCols = customColumns.filter((c) => c.id !== colId);
    setCustomColumns(nextCols);
    saveCustomColumns(effectivePlantId, nextCols);
    const nextNodes = customNodes.filter((n) => n.colId !== colId);
    setCustomNodes(nextNodes);
    saveCustomNodes(effectivePlantId, nextNodes);
    toast.info('Column and its nodes removed');
  }, [customColumns, customNodes, effectivePlantId]);

  // ── Palette item CRUD ─────────────────────────────────────────────────────────

  const handleAddPaletteItem = useCallback((label: string) => {
    if (!effectivePlantId) return;
    const item: PaletteItem = { id: `palette-${Date.now()}`, label };
    const next = [...paletteItems, item];
    setPaletteItems(next);
    savePaletteItems(effectivePlantId, next);
  }, [paletteItems, effectivePlantId]);

  const handleRenamePaletteItem = useCallback((id: string, label: string) => {
    if (!effectivePlantId) return;
    const next = paletteItems.map((i) => i.id === id ? { ...i, label } : i);
    setPaletteItems(next);
    savePaletteItems(effectivePlantId, next);
  }, [paletteItems, effectivePlantId]);

  const handleDeletePaletteItem = useCallback((id: string) => {
    if (!effectivePlantId) return;
    const next = paletteItems.filter((i) => i.id !== id);
    setPaletteItems(next);
    savePaletteItems(effectivePlantId, next);
  }, [paletteItems, effectivePlantId]);

  // ── Drag-and-drop ────────────────────────────────────────────────────────────

  const computeSnap = useCallback((clientX: number, clientY: number): { colKey: string; rowIdx: number } | null => {
    const el = CANVAS_REF.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const canvasX = (clientX - rect.left + el.scrollLeft) / zoom;
    const canvasY = (clientY - rect.top  + el.scrollTop)  / zoom;
    const xMap = buildColXMap(customColumns, colWidths);
    const entries = Object.entries(xMap).filter(([k]) => k !== 'reject');
    let nearestKey = entries[0]?.[0] ?? 'well';
    let minDist = Infinity;
    for (const [key, x] of entries) {
      const d = Math.abs(canvasX - (x + NODE_W / 2));
      if (d < minDist) { minDist = d; nearestKey = key; }
    }
    const rowIdx = Math.max(0, Math.round((canvasY - 0) / ROW_GAP));
    return { colKey: nearestKey, rowIdx };
  }, [zoom, customColumns]);

  const handleDropNode = useCallback((item: DragItem, snap: { colKey: string; rowIdx: number }) => {
    if (!effectivePlantId) return;
    const colSeq = buildColSequence(customColumns);
    const colSlot = colSeq.find((s) => s.key === snap.colKey);

    if (item.nodeId) {
      const newOverrides = { ...posOverrides, [item.nodeId]: snap };
      setPosOverrides(newOverrides);
      savePosOverrides(effectivePlantId, newOverrides);
      const newColId = colSlot?.isCustom ? snap.colKey : undefined;
      if (newColId !== item.colId) {
        const nextNodes = customNodes.map((n) =>
          n.id === item.nodeId ? { ...n, colId: newColId } : n
        );
        setCustomNodes(nextNodes);
        saveCustomNodes(effectivePlantId, nextNodes);
      }
      toast.success('Node moved');
    } else {
      const id = `custom-${item.nodeType}-${Date.now()}`;
      const colId = colSlot?.isCustom ? snap.colKey : undefined;
      const newNode: TopoNode = { id, type: item.nodeType, label: item.label, status: 'Active', custom: true, colId };
      const nextNodes = [...customNodes, newNode];
      setCustomNodes(nextNodes);
      saveCustomNodes(effectivePlantId, nextNodes);
      const newOverrides = { ...posOverrides, [id]: snap };
      setPosOverrides(newOverrides);
      savePosOverrides(effectivePlantId, newOverrides);
      if (!item.skipRename) {
        setPendingRename({ id, nodeType: item.nodeType, defaultName: item.label });
      } else {
        toast.success(`"${item.label}" placed on canvas`);
      }
    }
  }, [effectivePlantId, customNodes, customColumns, posOverrides]);

  const startDrag = useCallback((item: DragItem, e: React.PointerEvent) => {
    setDragItem(item);
    setDragPos({ x: e.clientX, y: e.clientY });

    const onMove = (ev: PointerEvent) => {
      setDragPos({ x: ev.clientX, y: ev.clientY });
      const snap = computeSnap(ev.clientX, ev.clientY) ?? null;
      setSnapTarget(snap);
      snapRef.current = snap;
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const snap = snapRef.current ?? computeSnap(ev.clientX, ev.clientY);
      if (snap && dragItemRef.current) handleDropNode(dragItemRef.current, snap);
      setDragItem(null);
      setSnapTarget(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [computeSnap, handleDropNode]);

  const dragItemRef  = useRef<DragItem | null>(null);
  const snapRef      = useRef<{ colKey: string; rowIdx: number } | null>(null);
  dragItemRef.current = dragItem;
  snapRef.current     = snapTarget;

  const handleRenameConfirm = useCallback((id: string, name: string) => {
    if (!effectivePlantId || !name.trim()) return;
    const next = customNodes.map((n) => n.id === id ? { ...n, label: name.trim() } : n);
    setCustomNodes(next);
    saveCustomNodes(effectivePlantId, next);
    if (topoState) setTopoState({ ...topoState, nodes: topoState.nodes.map((n) => n.id === id ? { ...n, label: name.trim() } : n) });
    setPendingRename(null);
  }, [effectivePlantId, customNodes, topoState]);

  // ── Node interaction & Connection editing ───────────────────────────────────

  function handleNodeClick(node: TopoNode) {
    if (canEdit && editMode && topoState) {
      const { id, type } = node;
      if (!pendingFrom) { setPendingFrom({ id, type }); return; }
      if (pendingFrom.id === id) { setPendingFrom(null); return; }
      if (!canConnect(pendingFrom.type, type)) {
        toast.error(`Cannot ${editMode} ${NODE_LABELS[pendingFrom.type]} ↔ ${NODE_LABELS[type]}`);
        setPendingFrom(null);
        return;
      }
      const newLinks = [...topoState.editLinks];
      if (editMode === 'connect') {
        if (!newLinks.some((l) => l.from === pendingFrom.id && l.to === id))
          newLinks.push({ from: pendingFrom.id, to: id, editable: true });
        else toast.info('Connection already exists');
      } else {
        const idx = newLinks.findIndex((l) =>
          (l.from === pendingFrom.id && l.to === id) || (l.from === id && l.to === pendingFrom.id));
        if (idx !== -1) newLinks.splice(idx, 1);
        else toast.info('No connection to remove');
      }
      setTopoState({ ...topoState, editLinks: newLinks });
      setPendingFrom(null);
      return;
    }
    setInspectNode(node);
  }

  async function handleSave() {
    if (!topoState || !effectivePlantId) return;
    setSaving(true);
    try {
      await saveLinksMutation.mutateAsync({
        plantId: effectivePlantId,
        links: topoState.editLinks.map((l) => ({ from_id: l.from, to_id: l.to })),
      });
      qc.invalidateQueries({ queryKey: ['topology-data', effectivePlantId] });
      toast.success('Topology saved');
    } catch {
      toast.error('Failed to save topology');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PlantTopologyContent
      plants={plants}
      effectivePlantId={effectivePlantId}
      setActivePlantId={setActivePlantId}
      canEdit={canEdit}
      isLoading={isLoading}
      rawData={rawData}
      topoState={topoState}
      setTopoState={setTopoState}
      refetch={refetch}
      showHelp={showHelp}
      setShowHelp={setShowHelp}
      saving={saving}
      setSaving={setSaving}
      panelOpen={panelOpen}
      setPanelOpen={setPanelOpen}
      customNodes={customNodes}
      setCustomNodes={setCustomNodes}
      customColumns={customColumns}
      setCustomColumns={setCustomColumns}
      posOverrides={posOverrides}
      setPosOverrides={setPosOverrides}
      paletteItems={paletteItems}
      setPaletteItems={setPaletteItems}
      colWidths={colWidths}
      setColWidths={setColWidths}
      dragItem={dragItem}
      setDragItem={setDragItem}
      dragPos={dragPos}
      setDragPos={setDragPos}
      snapTarget={snapTarget}
      setSnapTarget={setSnapTarget}
      pendingRename={pendingRename}
      setPendingRename={setPendingRename}
      hovered={hovered}
      setHovered={setHovered}
      hoveredLink={hoveredLink}
      setHoveredLink={setHoveredLink}
      editMode={editMode}
      setEditMode={setEditMode}
      pendingFrom={pendingFrom}
      setPendingFrom={setPendingFrom}
      inspectNode={inspectNode}
      setInspectNode={setInspectNode}
      resizingCol={resizingCol}
      setResizingCol={setResizingCol}
      hoveredLaneResizer={hoveredLaneResizer}
      setHoveredLaneResizer={setHoveredLaneResizer}
      zoom={zoom}
      setZoom={setZoom}
      pan={pan}
      setPan={setPan}
      isPanning={isPanning}
      lastPan={lastPan}
      qc={qc}
      handleAddNode={handleAddNode}
      handleDeleteCustomNode={handleDeleteCustomNode}
      handleRenameCustomNode={handleRenameCustomNode}
      handleAddColumn={handleAddColumn}
      handleDeleteColumn={handleDeleteColumn}
      handleAddPaletteItem={handleAddPaletteItem}
      handleRenamePaletteItem={handleRenamePaletteItem}
      handleDeletePaletteItem={handleDeletePaletteItem}
      handleSave={handleSave}
      startDrag={startDrag}
      handleRenameConfirm={handleRenameConfirm}
      handleNodeClick={handleNodeClick}
      computeSnap={computeSnap}
      handleDropNode={handleDropNode}
      saveColWidths={saveColWidths}
      SidePanelComponent={SidePanel}
    />
  );
}
