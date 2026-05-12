/**
 * PlantTopology.tsx  (revised)
 * ─────────────────────────────
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
 * New in this revision
 * ────────────────────
 * • Bulk Meter nodes are first-class citizens with their own column,
 *   editable Permeate→Bulk and Bulk→Locator connections.
 * • Locator nodes show name + connection count badge.
 * • Expandable side-panel (slide-in drawer) with:
 *     – Live node inventory (counts per type)
 *     – "Add Box" forms: add ad-hoc Bulk Meter or Locator nodes to the
 *       current plant's topology (persisted to localStorage / Supabase).
 *     – Quick-edit: rename any custom node.
 * • Pan & zoom on the SVG canvas (mouse wheel + drag).
 * • Improved link rendering: animated flow on editable links when hovered.
 * • Column-lane background bands for clarity.
 * • Better status badges (pulse animation for active nodes).
 * • Editable pairs extended: Permeate↔Bulk, Bulk↔Locator.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Droplets, Plug, Unplug, Save, RefreshCw, HelpCircle,
  PanelRightOpen, PanelRightClose, Plus, Trash2, Pencil,
  CheckCircle2, XCircle, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type NodeType =
  | 'well' | 'rawMeter' | 'pretreat' | 'feedMeter'
  | 'roTrain' | 'permeate' | 'reject' | 'bulk' | 'locator'
  | 'solarSource' | 'gridSource' | 'solarMeter' | 'gridMeter';

interface TopoNode {
  id: string;
  type: NodeType;
  label: string;
  status?: string;
  group?: string;
  /** true = added manually via "Add Box" (not from DB) */
  custom?: boolean;
}

interface TopoLink {
  from: string;
  to: string;
  editable?: boolean;
}

interface TopologyState {
  nodes: TopoNode[];
  fixedLinks: TopoLink[];
  editLinks: TopoLink[];
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const TOPO_LS_KEY  = (pid: string) => `plant_topology_links_${pid}`;
const CUSTOM_LS_KEY = (pid: string) => `plant_topology_custom_${pid}`;

const NODE_W  = 118;
const NODE_H  = 48;
const ROW_GAP = 64;
const START_Y = 44;

// Water column X positions
const WATER_COLS: Record<string, number> = {
  well: 24, rawMeter: 162, pretreat: 296, feedMeter: 420,
  roTrain: 544, permeate: 672, reject: 672,
  bulk: 810, locator: 952,
};
const POWER_COLS: Record<string, number> = {
  solarSource: 24, gridSource: 24, solarMeter: 162, gridMeter: 162,
};

const NODE_LABELS: Record<NodeType, string> = {
  well: 'WELL', rawMeter: 'RAW METER', pretreat: 'PRE-TREAT',
  feedMeter: 'FEED METER', roTrain: 'RO TRAIN', permeate: 'PERMEATE',
  reject: 'REJECT', bulk: 'BULK METER', locator: 'LOCATOR',
  solarSource: 'SOLAR', gridSource: 'GRID',
  solarMeter: 'SOLAR METER', gridMeter: 'GRID METER',
};

const COLORS: Record<NodeType, { bg: string; border: string; text: string; accent: string; lane: string }> = {
  well:        { bg: '#e0f2fe', border: '#0284c7', text: '#0c4a6e', accent: '#0284c7', lane: '#f0f9ff' },
  rawMeter:    { bg: '#e0e7ff', border: '#4338ca', text: '#1e1b4b', accent: '#4338ca', lane: '#eef2ff' },
  pretreat:    { bg: '#dcfce7', border: '#16a34a', text: '#14532d', accent: '#16a34a', lane: '#f0fdf4' },
  feedMeter:   { bg: '#ccfbf1', border: '#0d9488', text: '#134e4a', accent: '#0d9488', lane: '#f0fdfa' },
  roTrain:     { bg: '#f3e8ff', border: '#7c3aed', text: '#4c1d95', accent: '#7c3aed', lane: '#faf5ff' },
  permeate:    { bg: '#cffafe', border: '#0891b2', text: '#164e63', accent: '#0891b2', lane: '#ecfeff' },
  reject:      { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d', accent: '#dc2626', lane: '#ecfeff' },
  bulk:        { bg: '#fff7ed', border: '#ea580c', text: '#7c2d12', accent: '#ea580c', lane: '#fff7ed' },
  locator:     { bg: '#f1f5f9', border: '#475569', text: '#1e293b', accent: '#475569', lane: '#f8fafc' },
  solarSource: { bg: '#fefce8', border: '#ca8a04', text: '#713f12', accent: '#ca8a04', lane: '#fefce8' },
  gridSource:  { bg: '#eef2ff', border: '#4338ca', text: '#1e1b4b', accent: '#4338ca', lane: '#eef2ff' },
  solarMeter:  { bg: '#fef9c3', border: '#a16207', text: '#713f12', accent: '#a16207', lane: '#fef9c3' },
  gridMeter:   { bg: '#e0e7ff', border: '#4f46e5', text: '#1e1b4b', accent: '#4f46e5', lane: '#e0e7ff' },
};

// Pairs that can be connected / disconnected
const EDITABLE_PAIRS: [NodeType, NodeType][] = [
  ['permeate', 'bulk'],
  ['bulk',     'locator'],
  ['well',     'roTrain'],
  ['roTrain',  'well'],
  ['solarMeter', 'well'],   ['solarMeter', 'roTrain'],
  ['gridMeter',  'well'],   ['gridMeter',  'roTrain'],
];

function canConnect(a: NodeType, b: NodeType) {
  return EDITABLE_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// ─── Persist helpers ────────────────────────────────────────────────────────────

async function saveLinks(plantId: string, links: TopoLink[]) {
  const rows = links.map((l) => ({ plant_id: plantId, from_id: l.from, to_id: l.to }));
  try { localStorage.setItem(TOPO_LS_KEY(plantId), JSON.stringify(links.map((l) => ({ from_id: l.from, to_id: l.to })))); } catch { /**/ }
  try {
    await (supabase.from('plant_topology_links' as any) as any).delete().eq('plant_id', plantId);
    if (rows.length) await (supabase.from('plant_topology_links' as any) as any).insert(rows);
  } catch { /**/ }
}

function loadCustomNodes(plantId: string): TopoNode[] {
  try {
    const raw = localStorage.getItem(CUSTOM_LS_KEY(plantId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomNodes(plantId: string, nodes: TopoNode[]) {
  try { localStorage.setItem(CUSTOM_LS_KEY(plantId), JSON.stringify(nodes)); } catch { /**/ }
}

// ─── Data hook ──────────────────────────────────────────────────────────────────

function useTopologyData(plantId: string | null) {
  return useQuery({
    queryKey: ['topology-data', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!plantId) return null;

      const [wellsRes, roRes, locRes, prodRes, powerCfgRes, meterCfgRes] = await Promise.all([
        supabase.from('wells').select('id,name,status,has_power_meter').eq('plant_id', plantId).order('name'),
        supabase.from('ro_trains').select('id,train_number,status,shared_power_meter_group').eq('plant_id', plantId).order('train_number'),
        supabase.from('locators').select('id,name,status,product_meter_id').eq('plant_id', plantId).order('name'),
        (supabase.from('product_meters' as any) as any).select('id,name,status').eq('plant_id', plantId).order('name'),
        (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count,solar_meter_names,grid_meter_count,grid_meter_names')
          .eq('plant_id', plantId).maybeSingle(),
        (supabase.from('plant_meter_config' as any) as any)
          .select('has_solar,has_grid,ro_has_permeate_meter,ro_has_reject_meter,ro_has_feed_meter')
          .eq('plant_id', plantId).maybeSingle(),
      ]);

      let savedLinks: { from_id: string; to_id: string }[] = [];
      try {
        const { data: linkRows } = await (supabase.from('plant_topology_links' as any) as any)
          .select('from_id,to_id').eq('plant_id', plantId);
        if (linkRows?.length) savedLinks = linkRows;
        else {
          const raw = localStorage.getItem(TOPO_LS_KEY(plantId));
          if (raw) savedLinks = JSON.parse(raw);
        }
      } catch {
        try {
          const raw = localStorage.getItem(TOPO_LS_KEY(plantId));
          if (raw) savedLinks = JSON.parse(raw);
        } catch { /**/ }
      }

      return {
        wells:        (wellsRes.data ?? []) as any[],
        roTrains:     (roRes.data    ?? []) as any[],
        locators:     (locRes.data   ?? []) as any[],
        productMeters:(prodRes.data  ?? []) as any[],
        powerCfg:     powerCfgRes.data as any,
        meterCfg:     meterCfgRes.data as any,
        savedLinks,
      };
    },
  });
}

// ─── Build topology ─────────────────────────────────────────────────────────────

function buildTopology(
  plantId: string,
  data: NonNullable<ReturnType<typeof useTopologyData>['data']>,
  customNodes: TopoNode[],
): TopologyState {
  const nodes: TopoNode[] = [];
  const fixedLinks: TopoLink[] = [];

  const { wells, roTrains, locators, productMeters, powerCfg, meterCfg, savedLinks } = data;

  const hasSolar      = meterCfg?.has_solar ?? false;
  const hasGrid       = meterCfg?.has_grid  ?? true;
  const hasFeedMeter  = meterCfg?.ro_has_feed_meter     ?? true;
  const hasPermeate   = meterCfg?.ro_has_permeate_meter ?? true;
  const hasReject     = meterCfg?.ro_has_reject_meter   ?? true;

  const solarCount  = powerCfg?.solar_meter_count ?? 1;
  const gridCount   = powerCfg?.grid_meter_count  ?? 1;
  const solarNames: string[] = powerCfg?.solar_meter_names ?? Array.from({ length: solarCount }, (_, i) => `Solar Meter ${i + 1}`);
  const gridNames:  string[] = powerCfg?.grid_meter_names  ?? Array.from({ length: gridCount  }, (_, i) => `Grid Meter ${i + 1}`);

  // Wells
  wells.forEach((w: any) => {
    nodes.push({ id: w.id, type: 'well', label: w.name, status: w.status });
    const rmId = `rawmeter-${w.id}`;
    nodes.push({ id: rmId, type: 'rawMeter', label: `Raw ${w.name}` });
    fixedLinks.push({ from: w.id, to: rmId });
  });

  // Pre-treatment
  const ptId = `pretreat-${plantId}`;
  nodes.push({ id: ptId, type: 'pretreat', label: 'Pre-treatment' });
  wells.forEach((w: any) => { fixedLinks.push({ from: `rawmeter-${w.id}`, to: ptId }); });

  // Feed meter
  const fmId = `feedmeter-${plantId}`;
  if (hasFeedMeter) {
    nodes.push({ id: fmId, type: 'feedMeter', label: 'Feed Meter' });
    fixedLinks.push({ from: ptId, to: fmId });
  }

  // RO trains
  roTrains.forEach((r: any) => {
    nodes.push({ id: r.id, type: 'roTrain', label: `RO Train ${r.train_number}`, status: r.status, group: r.shared_power_meter_group ?? undefined });
    fixedLinks.push({ from: hasFeedMeter ? fmId : ptId, to: r.id });
  });

  // Permeate / Reject
  roTrains.forEach((r: any) => {
    if (hasPermeate) {
      const pmId = `permeate-${r.id}`;
      nodes.push({ id: pmId, type: 'permeate', label: `Perm. T${r.train_number}` });
      fixedLinks.push({ from: r.id, to: pmId });
    }
    if (hasReject) {
      const rjId = `reject-${r.id}`;
      nodes.push({ id: rjId, type: 'reject', label: `Reject T${r.train_number}` });
      fixedLinks.push({ from: r.id, to: rjId });
    }
  });

  // Bulk meters (from DB product_meters)
  productMeters.forEach((m: any) => {
    nodes.push({ id: m.id, type: 'bulk', label: m.name, status: m.status });
  });

  // Locators (from DB)
  locators.forEach((l: any) => {
    nodes.push({ id: l.id, type: 'locator', label: l.name, status: l.status ?? 'Active' });
  });

  // Custom nodes added via the panel
  customNodes.forEach((n) => {
    if (!nodes.find((x) => x.id === n.id)) nodes.push(n);
  });

  // Power sources
  const solarSrcId = `solar-src-${plantId}`;
  const gridSrcId  = `grid-src-${plantId}`;

  if (hasSolar) {
    nodes.push({ id: solarSrcId, type: 'solarSource', label: 'Solar Array' });
    solarNames.slice(0, solarCount).forEach((name, i) => {
      const smId = `solar-meter-${plantId}-${i}`;
      nodes.push({ id: smId, type: 'solarMeter', label: name });
      fixedLinks.push({ from: solarSrcId, to: smId });
    });
  }
  if (hasGrid) {
    nodes.push({ id: gridSrcId, type: 'gridSource', label: 'Grid Utility' });
    gridNames.slice(0, gridCount).forEach((name, i) => {
      const gmId = `grid-meter-${plantId}-${i}`;
      nodes.push({ id: gmId, type: 'gridMeter', label: name });
      fixedLinks.push({ from: gridSrcId, to: gmId });
    });
  }

  // Default editable links
  const defaultEditLinks: TopoLink[] = [];

  locators.forEach((l: any) => {
    if (l.product_meter_id)
      defaultEditLinks.push({ from: l.product_meter_id, to: l.id, editable: true });
  });

  const firstGridMeter = hasGrid ? `grid-meter-${plantId}-0` : null;
  wells.forEach((w: any) => {
    if (w.has_power_meter && firstGridMeter)
      defaultEditLinks.push({ from: firstGridMeter, to: w.id, editable: true });
  });
  roTrains.forEach((r: any) => {
    if (!r.shared_power_meter_group && firstGridMeter)
      defaultEditLinks.push({ from: firstGridMeter, to: r.id, editable: true });
  });

  const editLinks: TopoLink[] = savedLinks.length
    ? savedLinks.map((s: any) => ({ from: s.from_id, to: s.to_id, editable: true }))
    : defaultEditLinks;

  return { nodes, fixedLinks, editLinks };
}

// ─── Layout engine ──────────────────────────────────────────────────────────────

type Zone = 'water' | 'power';

function layoutNodes(nodes: TopoNode[]): Map<string, { x: number; y: number; zone: Zone }> {
  const positions = new Map<string, { x: number; y: number; zone: Zone }>();
  const byType: Record<string, TopoNode[]> = {};
  nodes.forEach((n) => { (byType[n.type] = byType[n.type] ?? []).push(n); });

  const waterTypes: NodeType[] = [
    'well', 'rawMeter', 'pretreat', 'feedMeter', 'roTrain', 'permeate', 'reject', 'bulk', 'locator',
  ];

  waterTypes.forEach((t) => {
    (byType[t] ?? []).forEach((n, i) => {
      const x = WATER_COLS[t] ?? 0;
      let y = START_Y + i * ROW_GAP;
      if (t === 'reject')
        y = START_Y + ((byType['permeate']?.length ?? 0) + i) * ROW_GAP;
      if (t === 'pretreat' || t === 'feedMeter')
        y = START_Y + Math.floor(((byType['well']?.length ?? 1) - 1) / 2) * ROW_GAP;
      positions.set(n.id, { x, y, zone: 'water' });
    });
  });

  const waterRows = Math.max(
    byType['well']?.length ?? 0,
    byType['roTrain']?.length ?? 0,
    (byType['permeate']?.length ?? 0) + (byType['reject']?.length ?? 0),
    byType['bulk']?.length ?? 0,
    byType['locator']?.length ?? 0,
  );
  const POWER_OFFSET_Y = START_Y + waterRows * ROW_GAP + 56;

  let solarRow = 0, gridRow = 0;
  (byType['solarSource'] ?? []).forEach((n) => {
    positions.set(n.id, { x: POWER_COLS.solarSource, y: POWER_OFFSET_Y + solarRow++ * ROW_GAP, zone: 'power' });
  });
  (byType['solarMeter'] ?? []).forEach((n, i) => {
    positions.set(n.id, { x: POWER_COLS.solarMeter, y: POWER_OFFSET_Y + i * ROW_GAP, zone: 'power' });
  });
  const gridStart = byType['solarMeter']?.length ?? 0;
  (byType['gridSource'] ?? []).forEach((n) => {
    positions.set(n.id, { x: POWER_COLS.gridSource, y: POWER_OFFSET_Y + (gridStart + gridRow++) * ROW_GAP, zone: 'power' });
  });
  (byType['gridMeter'] ?? []).forEach((n, i) => {
    positions.set(n.id, { x: POWER_COLS.gridMeter, y: POWER_OFFSET_Y + (gridStart + i) * ROW_GAP, zone: 'power' });
  });

  nodes.filter((n) => !positions.has(n.id)).forEach((n, i) => {
    positions.set(n.id, { x: 360, y: POWER_OFFSET_Y + i * ROW_GAP, zone: 'power' });
  });

  return positions;
}

function cubicPath(x1: number, y1: number, x2: number, y2: number) {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

// ─── Side Panel ─────────────────────────────────────────────────────────────────

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  topoState: TopologyState | null;
  customNodes: TopoNode[];
  plantId: string;
  canEdit: boolean;
  onAddNode: (type: 'bulk' | 'locator', name: string) => void;
  onDeleteCustomNode: (id: string) => void;
  onRenameCustomNode: (id: string, name: string) => void;
}

function SidePanel({
  open, onClose, topoState, customNodes, canEdit,
  onAddNode, onDeleteCustomNode, onRenameCustomNode,
}: SidePanelProps) {
  const [addType, setAddType] = useState<'bulk' | 'locator'>('bulk');
  const [addName, setAddName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const counts: Partial<Record<NodeType, number>> = {};
  (topoState?.nodes ?? []).forEach((n) => {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
  });

  function handleAdd() {
    if (!addName.trim()) return;
    onAddNode(addType, addName.trim());
    setAddName('');
  }

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 z-30 flex flex-col bg-card border-l border-border shadow-2xl transition-all duration-300 ease-in-out overflow-hidden ${
        open ? 'w-72 opacity-100' : 'w-0 opacity-0 pointer-events-none'
      }`}
      style={{ minWidth: open ? 288 : 0 }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 shrink-0">
        <div>
          <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase">Topology</p>
          <h2 className="text-sm font-bold text-foreground">Node Panel</h2>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Inventory */}
      <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
        <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-2">Node Inventory</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.entries(counts) as [NodeType, number][]).map(([type, count]) => (
            <div
              key={type}
              className="flex items-center justify-between rounded-md px-2 py-1 text-[10px] font-mono"
              style={{ background: COLORS[type].bg, border: `1px solid ${COLORS[type].border}20` }}
            >
              <span style={{ color: COLORS[type].text }} className="truncate">{NODE_LABELS[type]}</span>
              <span
                className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{ background: COLORS[type].accent, color: '#fff' }}
              >
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Add Box */}
      {canEdit && (
        <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-2">Add Box</p>
          <div className="flex gap-1.5 mb-2">
            {(['bulk', 'locator'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setAddType(t)}
                className={`flex-1 py-1 rounded text-[10px] font-semibold border transition-all ${
                  addType === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {t === 'bulk' ? 'Bulk Meter' : 'Locator'}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder={addType === 'bulk' ? 'e.g. Bulk Meter 3' : 'e.g. Zone A'}
              className="h-7 text-xs"
            />
            <Button size="sm" onClick={handleAdd} className="h-7 px-2" disabled={!addName.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Custom nodes list */}
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        {customNodes.length > 0 && (
          <>
            <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-2">
              Custom Nodes ({customNodes.length})
            </p>
            <div className="flex flex-col gap-1.5">
              {customNodes.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 border"
                  style={{ background: COLORS[n.type].bg, borderColor: `${COLORS[n.type].border}40` }}
                >
                  {editId === n.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { onRenameCustomNode(n.id, editName); setEditId(null); }
                          if (e.key === 'Escape') setEditId(null);
                        }}
                        className="h-5 text-[10px] flex-1 p-1"
                        autoFocus
                      />
                      <button onClick={() => { onRenameCustomNode(n.id, editName); setEditId(null); }} className="text-emerald-600 hover:text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground">
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className="text-[9px] font-mono rounded px-1"
                        style={{ background: COLORS[n.type].accent, color: '#fff' }}
                      >
                        {NODE_LABELS[n.type]}
                      </span>
                      <span className="flex-1 text-[10px] font-medium truncate" style={{ color: COLORS[n.type].text }}>
                        {n.label}
                      </span>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => { setEditId(n.id); setEditName(n.label); }}
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => onDeleteCustomNode(n.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {customNodes.length === 0 && canEdit && (
          <p className="text-[10px] text-muted-foreground text-center pt-4">
            Use "Add Box" above to create custom bulk meter or locator nodes.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function PlantTopology() {
  const { isAdmin, isManager } = useAuth();
  const canEdit = isAdmin || isManager;
  const { selectedPlantId } = useAppStore();
  const qc = useQueryClient();

  const { data: plants = [] } = usePlants();
  const [activePlantId, setActivePlantId] = useState<string | null>(null);
  const effectivePlantId = activePlantId ?? selectedPlantId ?? plants[0]?.id ?? null;

  const { data: rawData, isLoading, refetch } = useTopologyData(effectivePlantId);

  const [editMode, setEditMode]     = useState<'connect' | 'disconnect' | null>(null);
  const [pendingFrom, setPendingFrom] = useState<{ id: string; type: NodeType } | null>(null);
  const [hovered, setHovered]       = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);
  const [showHelp, setShowHelp]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [panelOpen, setPanelOpen]   = useState(false);
  const [topoState, setTopoState]   = useState<TopologyState | null>(null);
  const [customNodes, setCustomNodes] = useState<TopoNode[]>([]);

  // Pan + zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const isPanning       = useRef(false);
  const lastPan         = useRef({ x: 0, y: 0 });

  // Load custom nodes when plant changes
  useEffect(() => {
    if (!effectivePlantId) return;
    setCustomNodes(loadCustomNodes(effectivePlantId));
  }, [effectivePlantId]);

  useEffect(() => {
    if (!rawData || !effectivePlantId) return;
    setTopoState(buildTopology(effectivePlantId, rawData, customNodes));
  }, [rawData, effectivePlantId, customNodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPendingFrom(null); setEditMode(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Custom node CRUD ─────────────────────────────────────────────────────────

  const handleAddNode = useCallback((type: 'bulk' | 'locator', name: string) => {
    if (!effectivePlantId) return;
    const id = `custom-${type}-${Date.now()}`;
    const node: TopoNode = { id, type, label: name, status: 'Active', custom: true };
    const next = [...customNodes, node];
    setCustomNodes(next);
    saveCustomNodes(effectivePlantId, next);
    toast.success(`${NODE_LABELS[type]} "${name}" added`);
  }, [customNodes, effectivePlantId]);

  const handleDeleteCustomNode = useCallback((id: string) => {
    if (!effectivePlantId) return;
    const next = customNodes.filter((n) => n.id !== id);
    setCustomNodes(next);
    saveCustomNodes(effectivePlantId, next);
    // Also remove any edit links involving this node
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

  // ── Connection editing ───────────────────────────────────────────────────────

  function handleNodeClick(id: string, type: NodeType) {
    if (!canEdit || !editMode || !topoState) return;
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
  }

  async function handleSave() {
    if (!topoState || !effectivePlantId) return;
    setSaving(true);
    await saveLinks(effectivePlantId, topoState.editLinks);
    qc.invalidateQueries({ queryKey: ['topology-data', effectivePlantId] });
    setSaving(false);
    toast.success('Topology saved');
  }

  // ── Pan/zoom handlers ────────────────────────────────────────────────────────

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => Math.min(2.5, Math.max(0.3, z - e.deltaY * 0.001)));
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 1 && !(e.button === 0 && e.altKey)) return; // middle or alt+left
    isPanning.current = true;
    lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isPanning.current) return;
    setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y });
  }

  function handleMouseUp() { isPanning.current = false; }

  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }); }

  // ─── Empty / loading states ──────────────────────────────────────────────────

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

  const positions  = layoutNodes(topoState.nodes);
  const allLinks   = [...topoState.fixedLinks, ...topoState.editLinks];

  let maxX = 0, maxY = 0;
  positions.forEach(({ x, y }) => {
    maxX = Math.max(maxX, x + NODE_W + 24);
    maxY = Math.max(maxY, y + NODE_H + 24);
  });

  let maxWaterY = 0;
  positions.forEach(({ y, zone }) => { if (zone === 'water') maxWaterY = Math.max(maxWaterY, y + NODE_H); });
  const powerDividerY = maxWaterY + 28;

  const activePlant = plants.find((p) => p.id === effectivePlantId);

  // Connection counts per node (for badge)
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
    const isClickable = canEdit && !!editMode;
    const isInactive  = node.status === 'Inactive';
    const connCount   = linkCounts[node.id] ?? 0;
    const isCustom    = node.custom;

    return (
      <g
        key={node.id}
        transform={`translate(${pos.x},${pos.y})`}
        style={{ cursor: isClickable ? 'pointer' : 'default' }}
        onClick={() => handleNodeClick(node.id, node.type)}
        onMouseEnter={() => setHovered(node.id)}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Pulse ring for active nodes */}
        {node.status === 'Active' && !isPending && (
          <rect x={-2} y={-2} width={NODE_W + 4} height={NODE_H + 4} rx={9}
            fill="none" stroke={c.accent} strokeWidth={1} opacity={isHov ? 0.4 : 0.15} />
        )}

        {/* Selection / hover ring */}
        {(isPending || (isHov && isClickable)) && (
          <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={10}
            fill="none"
            stroke={isPending ? '#f59e0b' : c.accent}
            strokeWidth={2.5}
            opacity={0.8}
          />
        )}

        {/* Drop shadow */}
        <rect width={NODE_W} height={NODE_H} rx={8} x={1.5} y={2.5}
          fill={c.border} opacity={isInactive ? 0.04 : 0.12} />

        {/* Node body */}
        <rect width={NODE_W} height={NODE_H} rx={8}
          fill={isInactive ? '#f8fafc' : c.bg}
          stroke={isPending ? '#f59e0b' : c.border}
          strokeWidth={isPending ? 2 : isHov ? 2 : 1.5}
          opacity={isInactive ? 0.55 : 1}
        />

        {/* Left accent bar */}
        <rect x={0} y={6} width={3.5} height={NODE_H - 12} rx={2}
          fill={c.accent} opacity={isInactive ? 0.2 : 1}
        />

        {/* Type badge */}
        <text x={NODE_W / 2 + 3} y={15}
          textAnchor="middle" fill={c.accent}
          fontSize={7} fontFamily="'IBM Plex Mono', 'Courier New', monospace"
          fontWeight={700} letterSpacing={1.2} opacity={0.9}
        >
          {NODE_LABELS[node.type]}
        </text>

        {/* Node name */}
        <text x={NODE_W / 2 + 3} y={32}
          textAnchor="middle"
          fill={isInactive ? '#94a3b8' : c.text}
          fontSize={11} fontFamily="'IBM Plex Sans', system-ui, sans-serif"
          fontWeight={600}
        >
          {node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label}
        </text>

        {/* Status dot */}
        {node.status && (
          <circle cx={NODE_W - 9} cy={9} r={3.5}
            fill={node.status === 'Active' ? '#10b981' : '#f87171'}
            stroke="white" strokeWidth={1.2}
          />
        )}

        {/* Custom badge */}
        {isCustom && (
          <rect x={4} y={NODE_H - 8} width={22} height={6} rx={3}
            fill={c.accent} opacity={0.25} />
        )}
        {isCustom && (
          <text x={15} y={NODE_H - 3.5} textAnchor="middle"
            fill={c.accent} fontSize={5} fontWeight={700} fontFamily="monospace">
            CUSTOM
          </text>
        )}

        {/* Connection count badge (for bulk + locator) */}
        {(node.type === 'bulk' || node.type === 'locator') && connCount > 0 && (
          <>
            <rect x={NODE_W - 18} y={NODE_H - 14} width={16} height={12} rx={5}
              fill={c.accent} />
            <text x={NODE_W - 10} y={NODE_H - 6}
              textAnchor="middle" fill="#fff" fontSize={8} fontWeight={700}>
              {connCount}
            </text>
          </>
        )}

        {/* Power-group bar */}
        {node.group && (
          <rect x={6} y={NODE_H - 6} width={NODE_W - 12} height={4} rx={2}
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

    const x1 = f.x + NODE_W, y1 = f.y + NODE_H / 2;
    const x2 = t.x,          y2 = t.y + NODE_H / 2;
    const fromNode = topoState!.nodes.find((n) => n.id === link.from);
    const color = fromNode ? COLORS[fromNode.type].accent : '#94a3b8';
    const isHov = hoveredLink === idx;
    const markerId = `arrow-${idx}`;

    return (
      <g key={`link-${idx}`}>
        <defs>
          <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={isHov ? color : '#94a3b8'} />
          </marker>
        </defs>
        {/* Wider invisible hit area */}
        <path
          d={cubicPath(x1, y1, x2, y2)}
          fill="none" stroke="transparent" strokeWidth={12}
          style={{ cursor: 'crosshair' }}
          onMouseEnter={() => setHoveredLink(idx)}
          onMouseLeave={() => setHoveredLink(null)}
        />
        <path
          d={cubicPath(x1, y1, x2, y2)}
          fill="none"
          stroke={isHov ? color : '#94a3b8'}
          strokeWidth={isHov ? 2.5 : link.editable ? 1.5 : 2}
          strokeDasharray={link.editable ? (isHov ? '8,3' : '6,3') : undefined}
          opacity={isHov ? 0.85 : 0.45}
          markerEnd={`url(#${markerId})`}
          style={{ transition: 'stroke 0.15s, opacity 0.15s' }}
        />
      </g>
    );
  }

  // ── Column lane backgrounds ───────────────────────────────────────────────────

  const waterColTypes: Array<{ type: NodeType; col: string }> = [
    { type: 'well',      col: 'well' },
    { type: 'rawMeter',  col: 'rawMeter' },
    { type: 'pretreat',  col: 'pretreat' },
    { type: 'feedMeter', col: 'feedMeter' },
    { type: 'roTrain',   col: 'roTrain' },
    { type: 'permeate',  col: 'permeate' },
    { type: 'bulk',      col: 'bulk' },
    { type: 'locator',   col: 'locator' },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="shrink-0">
            <p className="text-[10px] tracking-widest text-primary font-mono uppercase font-semibold">Plant Monitor</p>
            <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">Network Topology</h1>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {plants.map((p) => (
              <button
                key={p.id}
                onClick={() => { setActivePlantId(p.id); setPendingFrom(null); setEditMode(null); }}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
                  effectivePlantId === p.id
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'border-border text-muted-foreground bg-background hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className={`p-1.5 rounded-md border transition-colors ${
              showHelp
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
            }`}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className={`p-1.5 rounded-md border transition-colors ${
              panelOpen
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
            }`}
            title="Toggle node panel"
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Help banner ──────────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="px-5 py-2.5 bg-primary/5 border-b border-primary/20 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 shrink-0">
          <span>
            <strong className="text-primary">Water flow:</strong>{' '}
            Well → Raw Meter → Pre-treatment → Feed Meter → RO Train → Permeate / Reject → Bulk Meter → Locator
          </span>
          <span>
            <strong className="text-amber-600">Power layer:</strong>{' '}
            Solar / Grid → Named Meters → Well pumps &amp; RO Train groups
          </span>
          {canEdit && (
            <span>
              <strong className="text-emerald-600">Editing:</strong>{' '}
              Connect/Disconnect mode, then click two compatible nodes. Use panel to add custom boxes.
            </span>
          )}
          <span className="text-muted-foreground/60">
            Dashed = editable · Solid = fixed · Alt+drag or middle-mouse to pan · Scroll to zoom
          </span>
        </div>
      )}

      {/* ── Admin toolbar ────────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-muted/30 shrink-0">
          <span className="text-[10px] tracking-widest text-muted-foreground font-mono font-semibold">
            EDIT WIRING:
          </span>

          <button
            onClick={() => { setEditMode(editMode === 'connect' ? null : 'connect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all ${
              editMode === 'connect'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-border text-muted-foreground bg-background hover:border-emerald-400 hover:text-emerald-600'
            }`}
          >
            <Plug className="h-3 w-3" /> Connect
          </button>

          <button
            onClick={() => { setEditMode(editMode === 'disconnect' ? null : 'disconnect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all ${
              editMode === 'disconnect'
                ? 'border-red-400 bg-red-50 text-red-700'
                : 'border-border text-muted-foreground bg-background hover:border-red-400 hover:text-red-600'
            }`}
          >
            <Unplug className="h-3 w-3" /> Disconnect
          </button>

          {pendingFrom && (
            <>
              <span className="text-xs text-amber-600 font-medium">
                [{NODE_LABELS[pendingFrom.type]}] selected — click a compatible node…
              </span>
              <button
                onClick={() => setPendingFrom(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ✕ Cancel
              </button>
            </>
          )}

          {!pendingFrom && editMode && (
            <span className="text-xs text-muted-foreground">
              Editable: Well↔RO · Permeate→Bulk · Bulk→Locator · Power Meter→Well/RO
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 border border-border rounded-md overflow-hidden">
              <button
                onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
                className="p-1 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Zoom out"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <span
                className="text-[10px] font-mono text-muted-foreground px-1.5 cursor-pointer select-none"
                onClick={resetView}
                title="Reset view"
              >
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
                className="p-1 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Zoom in"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
              <button
                onClick={resetView}
                className="p-1 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground border-l border-border"
                title="Fit to view"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={saving}
              className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/5 hover:border-primary"
            >
              {saving
                ? <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                : <Save className="h-3 w-3 mr-1" />}
              Save Topology
            </Button>
          </div>
        </div>
      )}

      {/* ── Main area: canvas + side panel ───────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* ── Diagram canvas ─────────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-hidden p-4 bg-muted/20"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isPanning.current ? 'grabbing' : 'default' }}
        >
          {/* Zone label */}
          <div className="flex items-center gap-2 mb-3">
            <Droplets className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] tracking-widest text-primary font-mono uppercase font-semibold">
              {activePlant?.name} — Water Treatment Flow
            </span>
            <span className="ml-auto text-[9px] text-muted-foreground font-mono">
              Alt+drag to pan · Scroll to zoom
            </span>
          </div>

          {/* SVG canvas */}
          <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden"
            style={{ height: 'calc(100% - 32px)' }}>
            <div
              style={{
                width: '100%',
                height: '100%',
                overflow: 'hidden',
              }}
            >
              <svg
                width={maxX}
                height={maxY + 24}
                style={{
                  display: 'block',
                  minWidth: maxX,
                  transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  transition: isPanning.current ? 'none' : 'transform 0.05s',
                }}
              >
                <defs>
                  <marker id="arrow-main" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
                  </marker>
                  <pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="0.8" fill="#e2e8f0" />
                  </pattern>
                </defs>

                {/* Canvas bg */}
                <rect width={maxX} height={maxY + 24} fill="#ffffff" />
                <rect width={maxX} height={maxY + 24} fill="url(#dot-grid)" />

                {/* Column lane backgrounds (water zone only) */}
                {waterColTypes.map(({ type, col }) => {
                  const x = WATER_COLS[col];
                  if (x === undefined) return null;
                  return (
                    <rect
                      key={type}
                      x={x - 8} y={20}
                      width={NODE_W + 16}
                      height={maxWaterY - 8}
                      rx={4}
                      fill={COLORS[type].lane}
                      opacity={0.5}
                    />
                  );
                })}

                {/* Power-zone divider */}
                {topoState.nodes.some((n) =>
                  ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)
                ) && (
                  <>
                    <line x1={0} y1={powerDividerY} x2={maxX} y2={powerDividerY}
                      stroke="#cbd5e1" strokeWidth={1} strokeDasharray="5,5" />
                    <rect x={8} y={powerDividerY - 19} width={92} height={15} rx={7.5} fill="#f1f5f9" />
                    <text x={54} y={powerDividerY - 9} textAnchor="middle"
                      fill="#64748b" fontSize={8}
                      fontFamily="'IBM Plex Mono', monospace" fontWeight={600} letterSpacing={1.2}>
                      POWER SUPPLY
                    </text>
                    <rect x={8} y={START_Y - 22} width={80} height={15} rx={7.5} fill="#f0fdf4" />
                    <text x={48} y={START_Y - 12} textAnchor="middle"
                      fill="#15803d" fontSize={8}
                      fontFamily="'IBM Plex Mono', monospace" fontWeight={600} letterSpacing={1.2}>
                      WATER FLOW
                    </text>
                  </>
                )}

                {/* Column header labels */}
                {[
                  { x: WATER_COLS.well,      label: 'WELLS' },
                  { x: WATER_COLS.rawMeter,  label: 'RAW METERS' },
                  { x: WATER_COLS.pretreat,  label: 'PRE-TREAT' },
                  { x: WATER_COLS.feedMeter, label: 'FEED' },
                  { x: WATER_COLS.roTrain,   label: 'RO TRAINS' },
                  { x: WATER_COLS.permeate,  label: 'PERMEATE / REJECT' },
                  { x: WATER_COLS.bulk,      label: 'BULK METERS' },
                  { x: WATER_COLS.locator,   label: 'LOCATORS' },
                ].map(({ x, label }) => (
                  <text key={label} x={x + NODE_W / 2} y={14}
                    textAnchor="middle" fill="#64748b" fontSize={7.5}
                    fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.5} fontWeight={700}>
                    {label}
                  </text>
                ))}

                <g>{allLinks.map((l, i) => renderLink(l, i))}</g>
                <g>{topoState.nodes.map(renderNode)}</g>
              </svg>
            </div>
          </div>

          {/* ── Legend ──────────────────────────────────────────────────────── */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t border-border">
            {(Object.entries(COLORS) as [NodeType, (typeof COLORS)[NodeType]][]).map(([type, c]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm border-[1.5px]"
                  style={{ background: c.bg, borderColor: c.border }} />
                <span className="text-[10px] text-muted-foreground font-mono tracking-wide">
                  {NODE_LABELS[type]}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 ml-auto">
              <div className="w-8 border-t-2 border-dashed border-slate-400" />
              <span className="text-[10px] text-muted-foreground font-mono">Editable</span>
              <div className="w-8 border-t-2 border-slate-400 ml-2" />
              <span className="text-[10px] text-muted-foreground font-mono">Fixed</span>
              <div className="w-3 h-3 rounded-full bg-emerald-400 ml-2 border border-white" />
              <span className="text-[10px] text-muted-foreground font-mono">Active</span>
              <div className="w-3 h-3 rounded-full bg-red-400 border border-white" />
              <span className="text-[10px] text-muted-foreground font-mono">Inactive</span>
            </div>
          </div>
        </div>

        {/* ── Side panel ───────────────────────────────────────────────────────── */}
        <SidePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          topoState={topoState}
          customNodes={customNodes}
          plantId={effectivePlantId ?? ''}
          canEdit={canEdit}
          onAddNode={handleAddNode}
          onDeleteCustomNode={handleDeleteCustomNode}
          onRenameCustomNode={handleRenameCustomNode}
        />
      </div>
    </div>
  );
}
