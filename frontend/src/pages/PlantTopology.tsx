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
  GripVertical, Move,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type NodeType =
  | 'well' | 'rawMeter' | 'pretreat' | 'feedMeter'
  | 'roTrain' | 'permeate' | 'reject' | 'bulk' | 'locator'
  | 'solarSource' | 'gridSource' | 'solarMeter' | 'gridMeter'
  | 'customNode';

interface CustomColumn {
  id: string;
  label: string;
  /** which base column key to insert this column after */
  insertAfter: string;
}

// ─── Base column definitions (ordered) ──────────────────────────────────────────

interface BaseColSlot {
  key: string;
  label: string;
  type: NodeType;
}

const BASE_COL_SLOTS: BaseColSlot[] = [
  { key: 'well',      label: 'WELLS',              type: 'well' },
  { key: 'rawMeter',  label: 'RAW METERS',         type: 'rawMeter' },
  { key: 'pretreat',  label: 'PRE-TREAT',          type: 'pretreat' },
  { key: 'feedMeter', label: 'FEED',               type: 'feedMeter' },
  { key: 'roTrain',   label: 'RO TRAINS',          type: 'roTrain' },
  { key: 'permeate',  label: 'PERMEATE / REJECT',  type: 'permeate' },
  { key: 'bulk',      label: 'BULK METERS',        type: 'bulk' },
  { key: 'locator',   label: 'LOCATORS',           type: 'locator' },
];

interface ColSlot {
  key: string;
  label: string;
  type?: NodeType;       // set for base cols
  customCol?: CustomColumn; // set for custom cols
  isCustom: boolean;
}

/** Builds the full ordered column sequence, interleaving custom cols into base cols. */
function buildColSequence(customColumns: CustomColumn[]): ColSlot[] {
  const result: ColSlot[] = [];
  for (const base of BASE_COL_SLOTS) {
    result.push({ key: base.key, label: base.label, type: base.type, isCustom: false });
    customColumns
      .filter((c) => c.insertAfter === base.key)
      .forEach((cc) =>
        result.push({ key: cc.id, label: cc.label, customCol: cc, isCustom: true })
      );
  }
  return result;
}

/** Returns a map of column key → x position based on the ordered sequence + per-column widths. */
function buildColXMap(customColumns: CustomColumn[], colWidths: Record<string, number> = {}): Record<string, number> {
  const seq = buildColSequence(customColumns);
  const map: Record<string, number> = {};
  let cursor = 28;
  seq.forEach((slot) => {
    map[slot.key] = cursor;
    cursor += colWidths[slot.key] ?? COL_GAP;
  });
  // reject shares same x as permeate
  if (map['permeate'] !== undefined) map['reject'] = map['permeate'];
  return map;
}

interface TopoNode {
  id: string;
  type: NodeType;
  label: string;
  status?: string;
  group?: string;
  /** Equipment detail line shown below label (e.g. "AFM×4 BP×3 HPP×1") */
  detail?: string;
  /** true = added manually via "Add Box" */
  custom?: boolean;
  /** custom column id this node belongs to */
  colId?: string;
}

interface TopoLink {
  from: string;
  to: string;
  editable?: boolean;
}

interface NodePositionOverride {
  colKey: string;
  rowIdx: number;
}

interface DragItem {
  nodeId?: string;       // undefined = new node from palette
  nodeType: NodeType;
  label: string;
  colId?: string;
  skipRename?: boolean;  // true = palette item already has a name
}

interface PaletteItem {
  id: string;
  label: string;
}

interface TopologyState {
  nodes: TopoNode[];
  fixedLinks: TopoLink[];
  editLinks: TopoLink[];
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const TOPO_LS_KEY       = (pid: string) => `plant_topology_links_${pid}`;
const CUSTOM_LS_KEY     = (pid: string) => `plant_topology_custom_${pid}`;
const CUSTOM_COLS_KEY   = (pid: string) => `plant_topology_cols_${pid}`;
const POS_OVERRIDES_KEY = (pid: string) => `plant_topology_pos_${pid}`;
const PALETTE_ITEMS_KEY = (pid: string) => `plant_topology_palette_${pid}`;
const COL_WIDTHS_KEY    = (pid: string) => `plant_topology_colwidths_${pid}`;

// ── Node dimensions (larger for readability) ──
const NODE_W  = 148;
const NODE_H  = 62;
const ROW_GAP = 90;   // vertical gap between rows
const START_Y = 52;
const COL_GAP = 164;  // horizontal gap between column centers

const POWER_COLS: Record<string, number> = {
  solarSource: 28,
  gridSource:  28,
  solarMeter:  28 + COL_GAP,
  gridMeter:   28 + COL_GAP,
};

const NODE_LABELS: Record<NodeType, string> = {
  well:        'WELL',
  rawMeter:    'RAW METER',
  pretreat:    'PRE-TREAT',
  feedMeter:   'FEED METER',
  roTrain:     'RO TRAIN',
  permeate:    'PERMEATE',
  reject:      'REJECT',
  bulk:        'BULK METER',
  locator:     'LOCATOR',
  solarSource: 'SOLAR',
  gridSource:  'GRID',
  solarMeter:  'SOLAR METER',
  gridMeter:   'GRID METER',
  customNode:  'CUSTOM',
};

const COLORS: Record<NodeType, { bg: string; border: string; text: string; accent: string; lane: string }> = {
  well:        { bg: '#e0f2fe', border: '#0284c7', text: '#0c4a6e', accent: '#0284c7', lane: '#f0f9ff' },
  rawMeter:    { bg: '#e0e7ff', border: '#4338ca', text: '#1e1b4b', accent: '#4338ca', lane: '#eef2ff' },
  pretreat:    { bg: '#dcfce7', border: '#16a34a', text: '#14532d', accent: '#16a34a', lane: '#f0fdf4' },
  feedMeter:   { bg: '#ccfbf1', border: '#0d9488', text: '#134e4a', accent: '#0d9488', lane: '#f0fdfa' },
  roTrain:     { bg: '#f3e8ff', border: '#7c3aed', text: '#4c1d95', accent: '#7c3aed', lane: '#faf5ff' },
  permeate:    { bg: '#cffafe', border: '#0891b2', text: '#164e63', accent: '#0891b2', lane: '#ecfeff' },
  reject:      { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d', accent: '#dc2626', lane: '#fef2f2' },
  bulk:        { bg: '#fff7ed', border: '#ea580c', text: '#7c2d12', accent: '#ea580c', lane: '#fff7ed' },
  locator:     { bg: '#f1f5f9', border: '#475569', text: '#1e293b', accent: '#475569', lane: '#f8fafc' },
  solarSource: { bg: '#fefce8', border: '#ca8a04', text: '#713f12', accent: '#ca8a04', lane: '#fefce8' },
  gridSource:  { bg: '#eef2ff', border: '#4338ca', text: '#1e1b4b', accent: '#4338ca', lane: '#eef2ff' },
  solarMeter:  { bg: '#fef9c3', border: '#a16207', text: '#713f12', accent: '#a16207', lane: '#fef9c3' },
  gridMeter:   { bg: '#e0e7ff', border: '#4f46e5', text: '#1e1b4b', accent: '#4f46e5', lane: '#e0e7ff' },
  customNode:  { bg: '#f1f5f9', border: '#64748b', text: '#334155', accent: '#475569', lane: '#f8fafc' },
};

const EDITABLE_PAIRS: [NodeType, NodeType][] = [
  ['permeate',   'bulk'],
  ['bulk',       'locator'],
  ['well',       'roTrain'],
  ['roTrain',    'well'],
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

function loadCustomColumns(plantId: string): CustomColumn[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COLS_KEY(plantId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomColumns(plantId: string, cols: CustomColumn[]) {
  try { localStorage.setItem(CUSTOM_COLS_KEY(plantId), JSON.stringify(cols)); } catch { /**/ }
}

function loadPosOverrides(plantId: string): Record<string, NodePositionOverride> {
  try {
    const raw = localStorage.getItem(POS_OVERRIDES_KEY(plantId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePosOverrides(plantId: string, overrides: Record<string, NodePositionOverride>) {
  try { localStorage.setItem(POS_OVERRIDES_KEY(plantId), JSON.stringify(overrides)); } catch { /**/ }
}

function loadPaletteItems(plantId: string): PaletteItem[] {
  try {
    const raw = localStorage.getItem(PALETTE_ITEMS_KEY(plantId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePaletteItems(plantId: string, items: PaletteItem[]) {
  try { localStorage.setItem(PALETTE_ITEMS_KEY(plantId), JSON.stringify(items)); } catch { /**/ }
}

function loadColWidths(plantId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY(plantId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveColWidths(plantId: string, widths: Record<string, number>) {
  try { localStorage.setItem(COL_WIDTHS_KEY(plantId), JSON.stringify(widths)); } catch { /**/ }
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
        supabase.from('ro_trains').select(
          'id,train_number,name,status,shared_power_meter_group,' +
          'num_afm,num_booster_pumps,num_hp_pumps,num_cartridge_filters,num_controllers,' +
          'filter_media_type,filter_housing_type'
        ).eq('plant_id', plantId).order('train_number'),
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
        wells:         (wellsRes.data ?? []) as any[],
        roTrains:      (roRes.data    ?? []) as any[],
        locators:      (locRes.data   ?? []) as any[],
        productMeters: (prodRes.data  ?? []) as any[],
        powerCfg:      powerCfgRes.data as any,
        meterCfg:      meterCfgRes.data as any,
        savedLinks,
      };
    },
  });
}

// ─── Build equipment detail string for RO train ──────────────────────────────

function buildTrainDetail(t: any): string {
  const mediaType  = (t.filter_media_type ?? 'AFM') as string;
  const filterType = (t.filter_housing_type ?? 'Cartridge Filter') as string;
  const filterLabel = filterType === 'Bag Filter' ? 'BF' : 'CF';

  const parts: string[] = [];
  if ((t.num_afm ?? 0) > 0)               parts.push(`${mediaType}×${t.num_afm}`);
  if ((t.num_booster_pumps ?? 0) > 0)     parts.push(`BP×${t.num_booster_pumps}`);
  if ((t.num_hp_pumps ?? 0) > 0)          parts.push(`HPP×${t.num_hp_pumps}`);
  if ((t.num_cartridge_filters ?? 0) > 0) parts.push(`${filterLabel}×${t.num_cartridge_filters}`);
  if ((t.num_controllers ?? 0) > 0)       parts.push(`Ctrl×${t.num_controllers}`);
  return parts.join('  ');
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

  const hasSolar     = meterCfg?.has_solar ?? false;
  const hasGrid      = meterCfg?.has_grid  ?? true;
  const hasFeedMeter = meterCfg?.ro_has_feed_meter     ?? true;
  const hasPermeate  = meterCfg?.ro_has_permeate_meter ?? true;
  const hasReject    = meterCfg?.ro_has_reject_meter   ?? true;

  const solarCount = powerCfg?.solar_meter_count ?? 1;
  const gridCount  = powerCfg?.grid_meter_count  ?? 1;
  const solarNames: string[] = powerCfg?.solar_meter_names ?? Array.from({ length: solarCount }, (_: any, i: number) => `Solar Meter ${i + 1}`);
  const gridNames:  string[] = powerCfg?.grid_meter_names  ?? Array.from({ length: gridCount  }, (_: any, i: number) => `Grid Meter ${i + 1}`);

  // ── Wells ──
  wells.forEach((w: any) => {
    nodes.push({ id: w.id, type: 'well', label: w.name, status: w.status });
    const rmId = `rawmeter-${w.id}`;
    nodes.push({ id: rmId, type: 'rawMeter', label: `Raw ${w.name}` });
    fixedLinks.push({ from: w.id, to: rmId });
  });

  // ── Pre-treatment (one shared node) ──
  const ptId = `pretreat-${plantId}`;
  nodes.push({ id: ptId, type: 'pretreat', label: 'Pre-treatment' });
  wells.forEach((w: any) => { fixedLinks.push({ from: `rawmeter-${w.id}`, to: ptId }); });

  // ── Feed meter ──
  const fmId = `feedmeter-${plantId}`;
  if (hasFeedMeter) {
    nodes.push({ id: fmId, type: 'feedMeter', label: 'Feed Meter' });
    fixedLinks.push({ from: ptId, to: fmId });
  }

  // ── RO trains — with equipment detail ──
  roTrains.forEach((r: any) => {
    const detail = buildTrainDetail(r);
    const trainLabel = r.name ? `Train ${r.train_number} · ${r.name}` : `RO Train ${r.train_number}`;
    nodes.push({
      id: r.id,
      type: 'roTrain',
      label: trainLabel,
      status: r.status,
      group: r.shared_power_meter_group ?? undefined,
      detail,
    });
    fixedLinks.push({ from: hasFeedMeter ? fmId : ptId, to: r.id });
  });

  // ── Permeate / Reject — one per train ──
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

  // ── Bulk meters (product_meters from DB — exactly as configured in Plants) ──
  productMeters.forEach((m: any) => {
    nodes.push({ id: m.id, type: 'bulk', label: m.name, status: m.status });
  });

  // ── Locators (exactly as configured in Plants) ──
  locators.forEach((l: any) => {
    nodes.push({ id: l.id, type: 'locator', label: l.name, status: l.status ?? 'Active' });
  });

  // ── Custom nodes ──
  customNodes.forEach((n) => {
    if (!nodes.find((x) => x.id === n.id)) nodes.push(n);
  });

  // ── Power — Solar ──
  const solarSrcId = `solar-src-${plantId}`;
  if (hasSolar) {
    nodes.push({ id: solarSrcId, type: 'solarSource', label: 'Solar Array' });
    solarNames.slice(0, solarCount).forEach((name: string, i: number) => {
      const smId = `solar-meter-${plantId}-${i}`;
      nodes.push({ id: smId, type: 'solarMeter', label: name });
      fixedLinks.push({ from: solarSrcId, to: smId });
    });
  }

  // ── Power — Grid ──
  const gridSrcId = `grid-src-${plantId}`;
  if (hasGrid) {
    nodes.push({ id: gridSrcId, type: 'gridSource', label: 'Grid Utility' });
    gridNames.slice(0, gridCount).forEach((name: string, i: number) => {
      const gmId = `grid-meter-${plantId}-${i}`;
      nodes.push({ id: gmId, type: 'gridMeter', label: name });
      fixedLinks.push({ from: gridSrcId, to: gmId });
    });
  }

  // ── Default editable links ──
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

function layoutNodes(
  nodes: TopoNode[],
  customColumns: CustomColumn[] = [],
  posOverrides: Record<string, NodePositionOverride> = {},
  colWidths: Record<string, number> = {},
): Map<string, { x: number; y: number; zone: Zone }> {
  const colXMap = buildColXMap(customColumns, colWidths);
  const positions = new Map<string, { x: number; y: number; zone: Zone }>();
  const byType: Record<string, TopoNode[]> = {};
  nodes.forEach((n) => { (byType[n.type] = byType[n.type] ?? []).push(n); });

  const waterTypes: NodeType[] = [
    'well', 'rawMeter', 'pretreat', 'feedMeter', 'roTrain', 'permeate', 'reject', 'bulk', 'locator',
  ];

  waterTypes.forEach((t) => {
    (byType[t] ?? []).forEach((n, i) => {
      const x = colXMap[t] ?? 0;
      let y = START_Y + i * ROW_GAP;
      // Centre single pre-treat / feed meter vertically against the wells
      if (t === 'pretreat' || t === 'feedMeter')
        y = START_Y + Math.floor(((byType['well']?.length ?? 1) - 1) / 2) * ROW_GAP;
      // Reject rows start below permeate rows
      if (t === 'reject')
        y = START_Y + ((byType['permeate']?.length ?? 0) + i) * ROW_GAP;
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
  const POWER_OFFSET_Y = START_Y + waterRows * ROW_GAP + 80;

  // Solar source + meters
  let solarRow = 0, gridRow = 0;
  (byType['solarSource'] ?? []).forEach((n) => {
    positions.set(n.id, { x: POWER_COLS.solarSource, y: POWER_OFFSET_Y + solarRow++ * ROW_GAP, zone: 'power' });
  });
  (byType['solarMeter'] ?? []).forEach((n, i) => {
    positions.set(n.id, { x: POWER_COLS.solarMeter, y: POWER_OFFSET_Y + i * ROW_GAP, zone: 'power' });
  });

  // Grid source + meters (start below solar rows)
  const gridStart = Math.max(byType['solarMeter']?.length ?? 0, byType['solarSource']?.length ?? 0);
  (byType['gridSource'] ?? []).forEach((n) => {
    positions.set(n.id, { x: POWER_COLS.gridSource, y: POWER_OFFSET_Y + (gridStart + gridRow++) * ROW_GAP, zone: 'power' });
  });
  (byType['gridMeter'] ?? []).forEach((n, i) => {
    positions.set(n.id, { x: POWER_COLS.gridMeter, y: POWER_OFFSET_Y + (gridStart + i) * ROW_GAP, zone: 'power' });
  });

  // Custom column nodes — group by colId, use dynamic x from colXMap
  const byColId: Record<string, TopoNode[]> = {};
  nodes.filter((n) => n.colId).forEach((n) => {
    (byColId[n.colId!] = byColId[n.colId!] ?? []).push(n);
  });
  customColumns.forEach((col) => {
    const x = colXMap[col.id] ?? 0;
    (byColId[col.id] ?? []).forEach((n, rowIdx) => {
      positions.set(n.id, { x, y: START_Y + rowIdx * ROW_GAP, zone: 'water' });
    });
  });

  // Orphan nodes not yet placed
  nodes.filter((n) => !positions.has(n.id)).forEach((n, i) => {
    const lastX = Object.values(colXMap).length ? Math.max(...Object.values(colXMap)) : 28;
    positions.set(n.id, { x: lastX + COL_GAP, y: START_Y + i * ROW_GAP, zone: 'water' });
  });

  // Apply position overrides — custom nodes dragged to new slots
  Object.entries(posOverrides).forEach(([nodeId, { colKey, rowIdx }]) => {
    if (!positions.has(nodeId)) return; // node doesn't exist
    const x = colXMap[colKey] ?? 0;
    const y = START_Y + rowIdx * ROW_GAP;
    positions.set(nodeId, { x, y, zone: 'water' });
  });

  return positions;
}

function cubicPath(x1: number, y1: number, x2: number, y2: number) {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

// ─── Node Palette ─────────────────────────────────────────────────────────────
// Draggable chips for creating new nodes on the canvas.

const PALETTE_TYPES: NodeType[] = [
  'well', 'rawMeter', 'pretreat', 'feedMeter', 'roTrain',
  'permeate', 'reject', 'bulk', 'locator',
  // 'customNode' handled by CustomNodePaletteSection below
];

interface NodePaletteProps {
  onDragStart: (item: DragItem, e: React.PointerEvent) => void;
  paletteItems: PaletteItem[];
  onAddPaletteItem: (label: string) => void;
  onRenamePaletteItem: (id: string, label: string) => void;
  onDeletePaletteItem: (id: string) => void;
}

function NodePalette({ onDragStart, paletteItems, onAddPaletteItem, onRenamePaletteItem, onDeletePaletteItem }: NodePaletteProps) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm shrink-0 overflow-x-auto">
      <div className="flex items-center gap-1 mr-2 shrink-0">
        <Move className="h-3 w-3 text-muted-foreground" />
        <span className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase whitespace-nowrap">Drag to canvas:</span>
      </div>
      {PALETTE_TYPES.map((type) => {
        const c = COLORS[type];
        return (
          <div
            key={type}
            className="flex items-center gap-1 px-2 py-1 rounded-md border cursor-grab active:cursor-grabbing select-none shrink-0 transition-all hover:shadow-sm hover:-translate-y-0.5"
            style={{ background: c.bg, borderColor: c.border + '80' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onDragStart({ nodeType: type, label: NODE_LABELS[type] }, e);
            }}
          >
            <GripVertical className="h-2.5 w-2.5 opacity-40" style={{ color: c.accent }} />
            <span className="text-[9px] font-mono font-bold tracking-wide" style={{ color: c.text }}>
              {NODE_LABELS[type]}
            </span>
          </div>
        );
      })}

      {/* Divider */}
      <div className="h-5 w-px bg-border mx-1 shrink-0" />

      {/* Custom node section */}
      <CustomNodePaletteSection
        paletteItems={paletteItems}
        onDragStart={onDragStart}
        onAddPaletteItem={onAddPaletteItem}
        onRenamePaletteItem={onRenamePaletteItem}
        onDeletePaletteItem={onDeletePaletteItem}
      />
    </div>
  );
}

// ─── Custom Node Palette Section ─────────────────────────────────────────────

interface CustomNodePaletteSectionProps {
  paletteItems: PaletteItem[];
  onDragStart: (item: DragItem, e: React.PointerEvent) => void;
  onAddPaletteItem: (label: string) => void;
  onRenamePaletteItem: (id: string, label: string) => void;
  onDeletePaletteItem: (id: string) => void;
}

function CustomNodePaletteSection({
  paletteItems, onDragStart, onAddPaletteItem, onRenamePaletteItem, onDeletePaletteItem,
}: CustomNodePaletteSectionProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const c = COLORS.customNode;

  function confirmAdd() {
    if (newName.trim()) onAddPaletteItem(newName.trim());
    setNewName('');
    setAdding(false);
  }

  function confirmEdit() {
    if (editId && editName.trim()) onRenamePaletteItem(editId, editName.trim());
    setEditId(null);
    setEditName('');
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mr-1 whitespace-nowrap">Custom:</span>

      {/* Existing palette chips */}
      {paletteItems.map((item) => (
        <div key={item.id} className="flex items-center gap-0.5 group shrink-0">
          {editId === item.id ? (
            /* ── Inline edit input ── */
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmEdit();
                if (e.key === 'Escape') { setEditId(null); setEditName(''); }
              }}
              onBlur={confirmEdit}
              className="h-6 w-24 text-[10px] rounded border border-primary px-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            /* ── Draggable chip ── */
            <div
              className="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md border cursor-grab active:cursor-grabbing select-none transition-all hover:shadow-sm hover:-translate-y-0.5"
              style={{ background: c.bg, borderColor: c.border + '80' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onDragStart({ nodeType: 'customNode', label: item.label, skipRename: true }, e);
              }}
            >
              <GripVertical className="h-2.5 w-2.5 opacity-40" style={{ color: c.accent }} />
              <span className="text-[9px] font-mono font-bold tracking-wide max-w-[80px] truncate" style={{ color: c.text }}>
                {item.label}
              </span>
              {/* Edit icon */}
              <button
                className="ml-0.5 p-0.5 rounded hover:bg-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setEditId(item.id); setEditName(item.label); }}
                title="Rename"
              >
                <Pencil className="h-2.5 w-2.5" style={{ color: c.accent }} />
              </button>
              {/* Delete icon */}
              <button
                className="p-0.5 rounded hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onDeletePaletteItem(item.id); }}
                title="Remove from palette"
              >
                <Trash2 className="h-2.5 w-2.5 text-red-400" />
              </button>
            </div>
          )}
        </div>
      ))}

      {/* ── Add new custom chip ── */}
      {adding ? (
        <div className="flex items-center gap-1 shrink-0">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmAdd();
              if (e.key === 'Escape') { setAdding(false); setNewName(''); }
            }}
            onBlur={confirmAdd}
            placeholder="Node name…"
            className="h-6 w-28 text-[10px] rounded border border-primary px-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-slate-400 text-slate-500 hover:border-slate-600 hover:text-slate-700 hover:bg-slate-50 transition-all shrink-0"
          title="Add custom node"
        >
          <Plus className="h-3 w-3" />
          <span className="text-[9px] font-mono font-bold tracking-wide">ADD</span>
        </button>
      )}
    </div>
  );
}

// ─── Rename Modal ─────────────────────────────────────────────────────────────

interface RenameModalProps {
  defaultName: string;
  nodeType: NodeType;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function RenameModal({ defaultName, nodeType, onConfirm, onCancel }: RenameModalProps) {
  const [name, setName] = useState(defaultName);
  const c = COLORS[nodeType];

  useEffect(() => {
    const inp = document.getElementById('rename-modal-input') as HTMLInputElement | null;
    if (inp) { inp.focus(); inp.select(); }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card rounded-xl border border-border shadow-2xl w-80 overflow-hidden">
        <div className="h-1.5 w-full" style={{ background: c.accent }} />
        <div className="px-5 py-4">
          <p className="text-[9px] font-mono tracking-widest uppercase mb-1" style={{ color: c.accent }}>
            {NODE_LABELS[nodeType]}
          </p>
          <h3 className="text-sm font-bold text-foreground mb-3">Name this node</h3>
          <input
            id="rename-modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onConfirm(name.trim());
              if (e.key === 'Escape') onCancel();
            }}
            className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Enter a name…"
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => name.trim() && onConfirm(name.trim())}
              disabled={!name.trim()}
              className="flex-1 h-8 rounded-md text-xs font-semibold text-white transition-all disabled:opacity-40"
              style={{ background: c.accent }}
            >
              Add Node
            </button>
            <button
              onClick={onCancel}
              className="px-3 h-8 rounded-md text-xs font-medium border border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Drag Ghost ───────────────────────────────────────────────────────────────

interface DragGhostProps {
  item: DragItem;
  x: number;
  y: number;
  snapping: boolean;
}

function DragGhost({ item, x, y, snapping }: DragGhostProps) {
  const c = COLORS[item.nodeType];
  return (
    <div
      className="fixed z-50 pointer-events-none select-none"
      style={{ left: x + 16, top: y - 18 }}
    >
      <div
        className="px-3 py-1.5 rounded-lg border-2 text-[10px] font-bold font-mono shadow-xl"
        style={{
          background: c.bg,
          borderColor: snapping ? c.accent : c.border + 'aa',
          color: c.text,
          transform: snapping ? 'scale(1.06)' : 'scale(1)',
          transition: 'transform 0.1s, border-color 0.1s',
          boxShadow: snapping ? `0 0 0 3px ${c.accent}33, 0 8px 24px #0003` : '0 4px 12px #0002',
        }}
      >
        {snapping ? '📌 ' : '✦ '}{NODE_LABELS[item.nodeType]}
      </div>
    </div>
  );
}

// ─── Side Panel ─────────────────────────────────────────────────────────────────

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  topoState: TopologyState | null;
  customNodes: TopoNode[];
  customColumns: CustomColumn[];
  plantId: string;
  canEdit: boolean;
  onAddNode: (type: 'bulk' | 'locator' | 'customNode', name: string, colId?: string) => void;
  onDeleteCustomNode: (id: string) => void;
  onRenameCustomNode: (id: string, name: string) => void;
  onAddColumn: (label: string, insertAfter: string) => void;
  onDeleteColumn: (id: string) => void;
}

function SidePanel({
  open, onClose, topoState, customNodes, customColumns, canEdit,
  onAddNode, onDeleteCustomNode, onRenameCustomNode, onAddColumn, onDeleteColumn,
}: SidePanelProps) {
  const [addType, setAddType] = useState<'bulk' | 'locator' | string>('bulk');
  const [addName, setAddName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newColName, setNewColName] = useState('');
  const [insertAfter, setInsertAfter] = useState<string>('feedMeter');
  const [activeTab, setActiveTab] = useState<'row' | 'column'>('row');

  const counts: Partial<Record<NodeType, number>> = {};
  (topoState?.nodes ?? []).forEach((n) => {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
  });

  function handleAdd() {
    if (!addName.trim()) return;
    const isCustomCol = addType !== 'bulk' && addType !== 'locator';
    if (isCustomCol) {
      onAddNode('customNode', addName.trim(), addType);
    } else {
      onAddNode(addType as 'bulk' | 'locator', addName.trim());
    }
    setAddName('');
  }

  function handleAddColumn() {
    if (!newColName.trim()) return;
    onAddColumn(newColName.trim(), insertAfter);
    setNewColName('');
    setActiveTab('row');
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

      {/* Add Column / Add Row */}
      {canEdit && (
        <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">

          {/* Tabs */}
          <div className="flex gap-0.5 mb-3 bg-muted rounded-md p-0.5">
            {(['row', 'column'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${
                  activeTab === tab
                    ? 'bg-card shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'row' ? '＋ Add Row' : '＋ Add Column'}
              </button>
            ))}
          </div>

          {activeTab === 'column' ? (
            /* ── Add Column ── */
            <div>
              <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-2">Insert After</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {BASE_COL_SLOTS.map((slot) => (
                  <button
                    key={slot.key}
                    onClick={() => setInsertAfter(slot.key)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                      insertAfter === slot.key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {slot.label.replace(' / REJECT', '')}
                  </button>
                ))}
              </div>
              <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-2">Column Name</p>
              <div className="flex gap-1.5">
                <input
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
                  placeholder="e.g. Storage Tank"
                  className="h-7 text-xs flex-1 rounded-md border border-input bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" onClick={handleAddColumn} className="h-7 px-2" disabled={!newColName.trim()}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {customColumns.length > 0 && (
                <div className="mt-3 flex flex-col gap-1">
                  <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-1">Your Columns</p>
                  {customColumns.map((col) => {
                    const after = BASE_COL_SLOTS.find((s) => s.key === col.insertAfter);
                    return (
                      <div key={col.id} className="flex items-center gap-1.5 rounded px-2 py-1.5 bg-muted/50 border border-border">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-semibold text-foreground truncate">{col.label}</div>
                          <div className="text-[9px] text-muted-foreground">after {after?.label ?? col.insertAfter}</div>
                        </div>
                        <button
                          onClick={() => onDeleteColumn(col.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          title="Delete column and its nodes"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Add Row ── */
            <div>
              <p className="text-[9px] font-mono tracking-widest text-muted-foreground uppercase mb-2">Column</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {(['bulk', 'locator'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAddType(t)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                      addType === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {t === 'bulk' ? 'Bulk Meter' : 'Locator'}
                  </button>
                ))}
                {customColumns.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => setAddType(col.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                      addType === col.id
                        ? 'border-slate-500 bg-slate-100 text-slate-700'
                        : 'border-border text-muted-foreground hover:border-slate-400'
                    }`}
                  >
                    {col.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder={
                    addType === 'bulk' ? 'e.g. Bulk Meter 3'
                    : addType === 'locator' ? 'e.g. Zone A'
                    : 'e.g. Tank 1'
                  }
                  className="h-7 text-xs"
                />
                <Button size="sm" onClick={handleAdd} className="h-7 px-2" disabled={!addName.trim()}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
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

  const [editMode, setEditMode]       = useState<'connect' | 'disconnect' | null>(null);
  const [pendingFrom, setPendingFrom] = useState<{ id: string; type: NodeType } | null>(null);
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

  // Drag-and-drop state
  const [dragItem, setDragItem]       = useState<DragItem | null>(null);
  const [dragPos, setDragPos]         = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget]   = useState<{ colKey: string; rowIdx: number } | null>(null);
  const [pendingRename, setPendingRename] = useState<{ id: string; nodeType: NodeType; defaultName: string } | null>(null);
  const canvasRef    = useRef<HTMLDivElement>(null);
  const dragItemRef  = useRef<DragItem | null>(null);
  const snapRef      = useRef<{ colKey: string; rowIdx: number } | null>(null);
  dragItemRef.current = dragItem;
  snapRef.current     = snapTarget;

  // Column resize state
  const [resizingCol, setResizingCol]         = useState<{ key: string; startSvgX: number; startWidth: number } | null>(null);
  const [hoveredLaneResizer, setHoveredLaneResizer] = useState<string | null>(null);

  // Pan + zoom
  const [zoom, setZoom]   = useState(1);
  const [pan, setPan]     = useState({ x: 0, y: 0 });
  const isPanning         = useRef(false);
  const lastPan           = useRef({ x: 0, y: 0 });

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPendingFrom(null); setEditMode(null); } };
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
    // Remove all nodes belonging to this column
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
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const canvasX = (clientX - rect.left + el.scrollLeft) / zoom;
    const canvasY = (clientY - rect.top  + el.scrollTop)  / zoom;
    const xMap = buildColXMap(customColumns, colWidths);
    // Exclude 'reject' (shares x with permeate)
    const entries = Object.entries(xMap).filter(([k]) => k !== 'reject');
    let nearestKey = entries[0]?.[0] ?? 'well';
    let minDist = Infinity;
    for (const [key, x] of entries) {
      const d = Math.abs(canvasX - (x + NODE_W / 2));
      if (d < minDist) { minDist = d; nearestKey = key; }
    }
    const rowIdx = Math.max(0, Math.round((canvasY - START_Y) / ROW_GAP));
    return { colKey: nearestKey, rowIdx };
  }, [zoom, customColumns]);

  const handleDropNode = useCallback((item: DragItem, snap: { colKey: string; rowIdx: number }) => {
    if (!effectivePlantId) return;
    const colSeq = buildColSequence(customColumns);
    const colSlot = colSeq.find((s) => s.key === snap.colKey);

    if (item.nodeId) {
      // ── Move existing custom node ──
      const newOverrides = { ...posOverrides, [item.nodeId]: snap };
      setPosOverrides(newOverrides);
      savePosOverrides(effectivePlantId, newOverrides);
      // Update colId if moved into / out of a custom column
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
      // ── Drop new node from palette ──
      const id = `custom-${item.nodeType}-${Date.now()}`;
      const colId = colSlot?.isCustom ? snap.colKey : undefined;
      const newNode: TopoNode = { id, type: item.nodeType, label: item.label, status: 'Active', custom: true, colId };
      const nextNodes = [...customNodes, newNode];
      setCustomNodes(nextNodes);
      saveCustomNodes(effectivePlantId, nextNodes);
      const newOverrides = { ...posOverrides, [id]: snap };
      setPosOverrides(newOverrides);
      savePosOverrides(effectivePlantId, newOverrides);
      // Show rename dialog only for generic (non-pre-named) drops
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

  const handleRenameConfirm = useCallback((id: string, name: string) => {
    if (!effectivePlantId || !name.trim()) return;
    const next = customNodes.map((n) => n.id === id ? { ...n, label: name.trim() } : n);
    setCustomNodes(next);
    saveCustomNodes(effectivePlantId, next);
    if (topoState) setTopoState({ ...topoState, nodes: topoState.nodes.map((n) => n.id === id ? { ...n, label: name.trim() } : n) });
    setPendingRename(null);
  }, [effectivePlantId, customNodes, topoState]);

  // ── Connection editing ────────────────────────────────────────────────────────

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

  // Dynamic full column sequence (base + custom interleaved) — declared here so
  // colXMap is available for both the maxX calculation below AND the render section.
  const colSequence = buildColSequence(customColumns);
  const colXMap = buildColXMap(customColumns, colWidths);

  const positions  = layoutNodes(topoState.nodes, customColumns, posOverrides, colWidths);
  const allLinks   = [...topoState.fixedLinks, ...topoState.editLinks];

  let maxX = 0, maxY = 0;
  positions.forEach(({ x, y }) => {
    maxX = Math.max(maxX, x + NODE_W + 40);
    maxY = Math.max(maxY, y + NODE_H + 40);
  });
  // Also account for total canvas width from column layout
  Object.values(colXMap).forEach((x) => { maxX = Math.max(maxX, x + NODE_W + 60); });

  let maxWaterY = 0;
  positions.forEach(({ y, zone }) => { if (zone === 'water') maxWaterY = Math.max(maxWaterY, y + NODE_H); });
  const powerDividerY = maxWaterY + 36;

  const activePlant = plants.find((p) => p.id === effectivePlantId);

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
    const hasDetail   = !!node.detail;
    const isBeingDragged = dragItem?.nodeId === node.id;

    // Taller node if it has a detail line
    const h = hasDetail ? NODE_H + 18 : NODE_H;

    return (
      <g
        key={node.id}
        transform={`translate(${pos.x},${pos.y})`}
        style={{
          cursor: isClickable ? 'pointer' : 'default',
          opacity: isBeingDragged ? 0.35 : 1,
          transition: 'opacity 0.15s',
        }}
        onClick={() => !isBeingDragged && handleNodeClick(node.id, node.type)}
        onMouseEnter={() => setHovered(node.id)}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Pulse ring for active nodes */}
        {node.status === 'Active' && !isPending && (
          <rect x={-2} y={-2} width={NODE_W + 4} height={h + 4} rx={10}
            fill="none" stroke={c.accent} strokeWidth={1} opacity={isHov ? 0.4 : 0.15} />
        )}

        {/* Selection / hover ring */}
        {(isPending || (isHov && isClickable)) && (
          <rect x={-4} y={-4} width={NODE_W + 8} height={h + 8} rx={11}
            fill="none"
            stroke={isPending ? '#f59e0b' : c.accent}
            strokeWidth={2.5}
            opacity={0.8}
          />
        )}

        {/* Drop shadow */}
        <rect width={NODE_W} height={h} rx={9} x={1.5} y={2.5}
          fill={c.border} opacity={isInactive ? 0.04 : 0.12} />

        {/* Node body */}
        <rect width={NODE_W} height={h} rx={9}
          fill={isInactive ? '#f8fafc' : c.bg}
          stroke={isPending ? '#f59e0b' : c.border}
          strokeWidth={isPending ? 2 : isHov ? 2 : 1.5}
          opacity={isInactive ? 0.55 : 1}
        />

        {/* Left accent bar */}
        <rect x={0} y={8} width={4} height={h - 16} rx={2}
          fill={c.accent} opacity={isInactive ? 0.2 : 1}
        />

        {/* Type badge */}
        <text x={NODE_W / 2 + 4} y={17}
          textAnchor="middle" fill={c.accent}
          fontSize={7.5} fontFamily="'IBM Plex Mono', 'Courier New', monospace"
          fontWeight={700} letterSpacing={1.2} opacity={0.9}
        >
          {NODE_LABELS[node.type]}
        </text>

        {/* Node label */}
        <text x={NODE_W / 2 + 4} y={35}
          textAnchor="middle"
          fill={isInactive ? '#94a3b8' : c.text}
          fontSize={11.5} fontFamily="'IBM Plex Sans', system-ui, sans-serif"
          fontWeight={600}
        >
          {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
        </text>

        {/* Equipment detail line (RO trains) */}
        {hasDetail && (
          <text x={NODE_W / 2 + 4} y={50}
            textAnchor="middle"
            fill={isInactive ? '#94a3b8' : c.accent}
            fontSize={8.5}
            fontFamily="'IBM Plex Mono', 'Courier New', monospace"
            opacity={0.85}
          >
            {(node.detail ?? '').length > 22 ? (node.detail ?? '').slice(0, 21) + '…' : node.detail}
          </text>
        )}

        {/* Status dot */}
        {node.status && (
          <circle cx={NODE_W - 10} cy={10} r={4}
            fill={node.status === 'Active' ? '#10b981'
                  : node.status === 'Running' ? '#10b981'
                  : node.status === 'Maintenance' ? '#f59e0b'
                  : '#f87171'}
            stroke="white" strokeWidth={1.2}
          />
        )}

        {/* Custom badge */}
        {isCustom && (
          <>
            <rect x={4} y={h - 9} width={26} height={7} rx={3.5}
              fill={c.accent} opacity={0.25} />
            <text x={17} y={h - 4}
              textAnchor="middle" fill={c.accent}
              fontSize={5.5} fontWeight={700} fontFamily="monospace">
              CUSTOM
            </text>
          </>
        )}

        {/* Drag handle — visible on hover for custom nodes (canEdit only) */}
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

        {/* Connection count badge */}
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

        {/* Power group bar */}
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

    // Use dynamic node height for midpoint calculation
    const fromNode = topoState!.nodes.find((n) => n.id === link.from);
    const toNode   = topoState!.nodes.find((n) => n.id === link.to);
    const fh = fromNode?.detail ? NODE_H + 18 : NODE_H;
    const th = toNode?.detail   ? NODE_H + 18 : NODE_H;

    const x1 = f.x + NODE_W, y1 = f.y + fh / 2;
    const x2 = t.x,          y2 = t.y + th / 2;
    const color = fromNode ? COLORS[fromNode.type].accent : '#94a3b8';
    const isHov = hoveredLink === idx;
    const markerId = `arrow-${idx}`;

    return (
      <g key={`link-${idx}`}>
        <defs>
          <marker id={markerId} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L7,3.5 z" fill={isHov ? color : '#94a3b8'} />
          </marker>
        </defs>
        {/* Wide invisible hit area */}
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
          stroke={isHov ? color : '#94a3b8'}
          strokeWidth={isHov ? 2.5 : link.editable ? 1.5 : 2}
          strokeDasharray={link.editable ? (isHov ? '9,4' : '6,3') : undefined}
          opacity={isHov ? 0.9 : 0.45}
          markerEnd={`url(#${markerId})`}
          style={{ transition: 'stroke 0.15s, opacity 0.15s' }}
        />
      </g>
    );
  }

  // ── Column lane backgrounds ───────────────────────────────────────────────────

  const hasPowerNodes = topoState.nodes.some((n) =>
    ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)
  );

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

          {/* Plant selector pills */}
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
            <strong className="text-primary">Edit:</strong>{' '}
            Use Connect/Disconnect below, click two compatible nodes, then Save.
          </span>
          <span>
            <strong className="text-primary">Navigate:</strong>{' '}
            Scroll (H+V) · Alt+drag or middle-click to pan · Scroll to zoom
          </span>
        </div>
      )}

      {/* ── Edit toolbar ──────────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-muted/20 shrink-0 flex-wrap">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase mr-1">Edit Links:</span>
          <button
            onClick={() => { setEditMode(editMode === 'connect' ? null : 'connect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-all ${
              editMode === 'connect'
                ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                : 'border-border text-muted-foreground hover:border-emerald-400/60 hover:text-emerald-700'
            }`}
          >
            <Plug className="h-3.5 w-3.5" />
            {editMode === 'connect' ? (pendingFrom ? 'Pick 2nd node…' : 'Pick node…') : 'Connect'}
          </button>
          <button
            onClick={() => { setEditMode(editMode === 'disconnect' ? null : 'disconnect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-all ${
              editMode === 'disconnect'
                ? 'bg-red-50 border-red-400 text-red-700'
                : 'border-border text-muted-foreground hover:border-red-400/60 hover:text-red-700'
            }`}
          >
            <Unplug className="h-3.5 w-3.5" />
            {editMode === 'disconnect' ? (pendingFrom ? 'Pick 2nd node…' : 'Pick node…') : 'Disconnect'}
          </button>

          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
              className="p-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
              <ZoomIn className="h-3 w-3" />
            </button>
            <span className="text-[10px] font-mono text-muted-foreground w-8 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
              className="p-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
              <ZoomOut className="h-3 w-3" />
            </button>
            <button onClick={resetView}
              className="p-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors ml-0.5">
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>

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
            <Droplets className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] tracking-widest text-primary font-mono uppercase font-semibold">
              {activePlant?.name} — Water Treatment Flow
            </span>
            <span className="ml-auto text-[9px] text-muted-foreground font-mono">
              {dragItem ? '📌 Drop on any column to place node' : 'Scroll to pan · Alt+drag · Ctrl+scroll to zoom'}
            </span>
          </div>

          {/* ── SVG canvas with BOTH scrollbars ────────────────────────────────── */}
          <div
            ref={canvasRef}
            className={`flex-1 min-h-0 rounded-xl border bg-white shadow-sm transition-colors ${
              dragItem && snapTarget ? 'border-primary/60 ring-2 ring-primary/20' : 'border-border'
            }`}
            style={{
              overflow: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e1 #f1f5f9',
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
                  <path d="M0,0 L0,7 L7,3.5 z" fill="#94a3b8" />
                </marker>
                <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#e2e8f0" />
                </pattern>
              </defs>

              {/* Zoom transform wrapper */}
              <g transform={`scale(${zoom})`}>
                {/* Canvas bg */}
                <rect width={maxX} height={maxY + 24} fill="#ffffff" />
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

                {/* Column resize handles — drag right edge to widen/narrow */}
                {colSequence.map((slot) => {
                  const x = colXMap[slot.key];
                  if (x === undefined) return null;
                  const slotW = colWidths[slot.key] ?? COL_GAP;
                  // Handle sits at the boundary between this col and the next
                  const handleX = x + slotW - 8;
                  const isActive = resizingCol?.key === slot.key || hoveredLaneResizer === slot.key;
                  const laneColor = slot.isCustom ? COLORS.customNode.accent : COLORS[slot.type!].accent;
                  return (
                    <g key={`resize-${slot.key}`}>
                      {/* Visual dotted line */}
                      <line
                        x1={handleX} y1={20} x2={handleX} y2={maxWaterY + 10}
                        stroke={isActive ? laneColor : '#cbd5e1'}
                        strokeWidth={isActive ? 2 : 1}
                        strokeDasharray={isActive ? undefined : '3,3'}
                        opacity={isActive ? 0.8 : 0.4}
                        style={{ pointerEvents: 'none' }}
                      />
                      {/* Grip pill icon */}
                      {isActive && (
                        <g transform={`translate(${handleX - 4}, ${(maxWaterY + 20) / 2 - 12})`}>
                          <rect x={0} y={0} width={8} height={24} rx={4}
                            fill={laneColor} opacity={0.15} />
                          <rect x={2} y={5}  width={4} height={2} rx={1} fill={laneColor} opacity={0.7} />
                          <rect x={2} y={10} width={4} height={2} rx={1} fill={laneColor} opacity={0.7} />
                          <rect x={2} y={15} width={4} height={2} rx={1} fill={laneColor} opacity={0.7} />
                        </g>
                      )}
                      {/* Wide invisible hit area for pointer events */}
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

                {/* Drag snap highlight — shows target column + row */}
                {dragItem && snapTarget && (() => {
                  const snapX = colXMap[snapTarget.colKey] ?? 0;
                  const snapY = START_Y + snapTarget.rowIdx * ROW_GAP;
                  const c = COLORS[dragItem.nodeType];
                  return (
                    <g>
                      {/* Column highlight */}
                      <rect
                        x={snapX - 10} y={24}
                        width={NODE_W + 20} height={maxWaterY - 10}
                        rx={6} fill={c.accent} opacity={0.08}
                        stroke={c.accent} strokeWidth={2} strokeDasharray="6,3"
                      />
                      {/* Row slot indicator */}
                      <rect
                        x={snapX} y={snapY}
                        width={NODE_W} height={NODE_H}
                        rx={9} fill={c.accent} opacity={0.12}
                        stroke={c.accent} strokeWidth={2} strokeDasharray="5,3"
                      />
                      {/* Drop label */}
                      <text x={snapX + NODE_W / 2} y={snapY + NODE_H / 2 + 4}
                        textAnchor="middle" fill={c.accent}
                        fontSize={9} fontFamily="'IBM Plex Mono', monospace" fontWeight={700}>
                        DROP HERE
                      </text>
                    </g>
                  );
                })()}

                {/* Power-zone divider */}
                {hasPowerNodes && (
                  <>
                    <line x1={0} y1={powerDividerY} x2={maxX} y2={powerDividerY}
                      stroke="#cbd5e1" strokeWidth={1} strokeDasharray="6,5" />
                    <rect x={10} y={powerDividerY - 22} width={104} height={18} rx={9} fill="#f1f5f9" />
                    <text x={62} y={powerDividerY - 11} textAnchor="middle"
                      fill="#64748b" fontSize={9}
                      fontFamily="'IBM Plex Mono', monospace" fontWeight={600} letterSpacing={1.2}>
                      POWER SUPPLY
                    </text>
                    <rect x={10} y={START_Y - 26} width={88} height={18} rx={9} fill="#f0fdf4" />
                    <text x={54} y={START_Y - 15} textAnchor="middle"
                      fill="#15803d" fontSize={9}
                      fontFamily="'IBM Plex Mono', monospace" fontWeight={600} letterSpacing={1.2}>
                      WATER FLOW
                    </text>
                  </>
                )}

                {/* Column header labels — all columns in sequence order */}
                {colSequence.map((slot) => {
                  const x = colXMap[slot.key];
                  if (x === undefined) return null;
                  return (
                    <text key={`hdr-${slot.key}`} x={x + NODE_W / 2} y={16}
                      textAnchor="middle"
                      fill={slot.isCustom ? '#475569' : '#64748b'}
                      fontSize={8.5}
                      fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.5} fontWeight={700}>
                      {slot.label.toUpperCase()}
                    </text>
                  );
                })}
                {hasPowerNodes && [
                  { x: POWER_COLS.solarSource, label: 'SOURCE' },
                  { x: POWER_COLS.solarMeter,  label: 'SOLAR / GRID METERS' },
                ].map(({ x, label }) => (
                  <text key={`pwr-${label}`} x={x + NODE_W / 2} y={powerDividerY + 16}
                    textAnchor="middle" fill="#92400e" fontSize={8}
                    fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.5} fontWeight={700}>
                    {label}
                  </text>
                ))}

                <g>{allLinks.map((l, i) => renderLink(l, i))}</g>
                <g>{topoState.nodes.map(renderNode)}</g>
              </g>
            </svg>
          </div>

          {/* ── Legend ──────────────────────────────────────────────────────────── */}
          <div className="mt-3 shrink-0 flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t border-border">
            {(Object.entries(COLORS) as [NodeType, (typeof COLORS)[NodeType]][])
              .filter(([type]) => type !== 'customNode')
              .map(([type, c]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded-sm border-[1.5px]"
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
              <div className="w-3.5 h-3.5 rounded-full bg-emerald-400 ml-2 border border-white" />
              <span className="text-[10px] text-muted-foreground font-mono">Active</span>
              <div className="w-3.5 h-3.5 rounded-full bg-red-400 border border-white" />
              <span className="text-[10px] text-muted-foreground font-mono">Inactive</span>
              <div className="w-3.5 h-3.5 rounded-full bg-amber-400 border border-white" />
              <span className="text-[10px] text-muted-foreground font-mono">Maintenance</span>
            </div>
          </div>
          </div>{/* end inner flex-col (zone label + canvas + legend) */}
        </div>{/* end outer flex-col (palette + inner) */}

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

      {/* ── Rename Modal (shown after drop of new node) ─────────────────────────── */}
      {pendingRename && (
        <RenameModal
          defaultName={pendingRename.defaultName}
          nodeType={pendingRename.nodeType}
          onConfirm={(name) => handleRenameConfirm(pendingRename.id, name)}
          onCancel={() => {
            // Remove the node if user cancels rename
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
