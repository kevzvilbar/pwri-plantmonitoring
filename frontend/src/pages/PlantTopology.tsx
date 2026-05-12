/**
 * PlantTopology.tsx
 * ─────────────────
 * Visual wiring diagram for each plant showing:
 *
 *  WATER FLOW (left → right)
 *    Well → Raw Meter → Pre-treatment → Feed Meter → RO Train
 *        → Permeate Meter → Bulk/Mother Meter → Locator
 *        → Reject Meter
 *
 *  POWER LAYER (below water flow)
 *    Solar Array → Solar Meter(s) ─┐
 *    Grid Utility → Grid Meter(s)  ├──→ Well pumps (has_power_meter)
 *                                  └──→ RO Train groups (shared_power_meter_group)
 *
 * Editable connections (Admin / Manager only).
 * Connection topology is persisted to `plant_topology_links` (Supabase) with
 * localStorage fallback while the migration has not yet run.
 */

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Droplets, Plug, Unplug, Save, RefreshCw, HelpCircle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const TOPO_LS_KEY = (plantId: string) => `plant_topology_links_${plantId}`;

const NODE_W = 112;
const NODE_H = 44;
const ROW_GAP = 60;
const START_Y = 36;

/**
 * Light-theme node palette — tinted fills + saturated borders to match the
 * app's white/teal design system. All nodes stay readable on a white canvas.
 */
const COLORS: Record<NodeType, { bg: string; border: string; text: string; accent: string }> = {
  well:        { bg: '#e0f2fe', border: '#0284c7', text: '#0c4a6e', accent: '#0284c7' },
  rawMeter:    { bg: '#e0e7ff', border: '#4338ca', text: '#1e1b4b', accent: '#4338ca' },
  pretreat:    { bg: '#dcfce7', border: '#16a34a', text: '#14532d', accent: '#16a34a' },
  feedMeter:   { bg: '#ccfbf1', border: '#0d9488', text: '#134e4a', accent: '#0d9488' },
  roTrain:     { bg: '#f3e8ff', border: '#7c3aed', text: '#4c1d95', accent: '#7c3aed' },
  permeate:    { bg: '#cffafe', border: '#0891b2', text: '#164e63', accent: '#0891b2' },
  reject:      { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d', accent: '#dc2626' },
  bulk:        { bg: '#fff7ed', border: '#ea580c', text: '#7c2d12', accent: '#ea580c' },
  locator:     { bg: '#f1f5f9', border: '#475569', text: '#1e293b', accent: '#475569' },
  solarSource: { bg: '#fefce8', border: '#ca8a04', text: '#713f12', accent: '#ca8a04' },
  gridSource:  { bg: '#eef2ff', border: '#4338ca', text: '#1e1b4b', accent: '#4338ca' },
  solarMeter:  { bg: '#fef9c3', border: '#a16207', text: '#713f12', accent: '#a16207' },
  gridMeter:   { bg: '#e0e7ff', border: '#4f46e5', text: '#1e1b4b', accent: '#4f46e5' },
};

const NODE_LABELS: Record<NodeType, string> = {
  well: 'WELL', rawMeter: 'RAW METER', pretreat: 'PRE-TREAT',
  feedMeter: 'FEED METER', roTrain: 'RO TRAIN', permeate: 'PERMEATE',
  reject: 'REJECT', bulk: 'BULK METER', locator: 'LOCATOR',
  solarSource: 'SOLAR', gridSource: 'GRID', solarMeter: 'SOLAR METER', gridMeter: 'GRID METER',
};

// ─── Data hook ────────────────────────────────────────────────────────────────

function useTopologyData(plantId: string | null) {
  return useQuery({
    queryKey: ['topology-data', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!plantId) return null;

      const [
        wellsRes, roRes, locRes, prodRes, powerCfgRes, meterCfgRes,
      ] = await Promise.all([
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
        } catch { /* ignore */ }
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

// ─── Persist editable links ───────────────────────────────────────────────────

async function saveLinks(plantId: string, links: TopoLink[]) {
  const rows = links.map((l) => ({ plant_id: plantId, from_id: l.from, to_id: l.to }));
  try { localStorage.setItem(TOPO_LS_KEY(plantId), JSON.stringify(links.map((l) => ({ from_id: l.from, to_id: l.to })))); } catch { /* ignore */ }
  try {
    await (supabase.from('plant_topology_links' as any) as any).delete().eq('plant_id', plantId);
    if (rows.length) await (supabase.from('plant_topology_links' as any) as any).insert(rows);
  } catch { /* LS fallback sufficient */ }
}

// ─── Build topology from raw data ─────────────────────────────────────────────

function buildTopology(
  plantId: string,
  data: NonNullable<ReturnType<typeof useTopologyData>['data']>,
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
  const solarNames: string[] = powerCfg?.solar_meter_names ?? Array.from({ length: solarCount }, (_, i) => `Solar Meter ${i + 1}`);
  const gridNames:  string[] = powerCfg?.grid_meter_names  ?? Array.from({ length: gridCount },  (_, i) => `Grid Meter ${i + 1}`);

  wells.forEach((w: any) => {
    nodes.push({ id: w.id, type: 'well', label: w.name, status: w.status });
    const rmId = `rawmeter-${w.id}`;
    nodes.push({ id: rmId, type: 'rawMeter', label: `Raw ${w.name}` });
    fixedLinks.push({ from: w.id, to: rmId });
  });

  const ptId = `pretreat-${plantId}`;
  nodes.push({ id: ptId, type: 'pretreat', label: 'Pre-treatment' });
  wells.forEach((w: any) => { fixedLinks.push({ from: `rawmeter-${w.id}`, to: ptId }); });

  const fmId = `feedmeter-${plantId}`;
  if (hasFeedMeter) {
    nodes.push({ id: fmId, type: 'feedMeter', label: 'Feed Meter' });
    fixedLinks.push({ from: ptId, to: fmId });
  }

  roTrains.forEach((r: any) => {
    nodes.push({ id: r.id, type: 'roTrain', label: `RO Train ${r.train_number}`, status: r.status, group: r.shared_power_meter_group ?? undefined });
    fixedLinks.push({ from: hasFeedMeter ? fmId : ptId, to: r.id });
  });

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

  productMeters.forEach((m: any) => { nodes.push({ id: m.id, type: 'bulk',    label: m.name, status: m.status }); });
  locators.forEach((l: any)       => { nodes.push({ id: l.id, type: 'locator', label: l.name, status: l.status ?? 'Active' }); });

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

  const defaultEditLinks: TopoLink[] = [];
  locators.forEach((l: any) => {
    if (l.product_meter_id) defaultEditLinks.push({ from: l.product_meter_id, to: l.id, editable: true });
  });

  const firstGridMeter  = hasGrid  ? `grid-meter-${plantId}-0`  : null;

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

// ─── SVG layout engine ────────────────────────────────────────────────────────

type Zone = 'water' | 'power';

const WATER_COLS: Record<string, number> = {
  well: 20, rawMeter: 150, pretreat: 280, feedMeter: 400,
  roTrain: 520, permeate: 650, reject: 650, bulk: 790, locator: 920,
};
const POWER_COLS: Record<string, number> = {
  solarSource: 20, gridSource: 20, solarMeter: 160, gridMeter: 160,
};

function layoutNodes(nodes: TopoNode[]): Map<string, { x: number; y: number; zone: Zone }> {
  const positions = new Map<string, { x: number; y: number; zone: Zone }>();
  const byType: Record<string, TopoNode[]> = {};
  nodes.forEach((n) => { (byType[n.type] = byType[n.type] ?? []).push(n); });

  const waterTypes: NodeType[] = ['well', 'rawMeter', 'pretreat', 'feedMeter', 'roTrain', 'permeate', 'reject', 'bulk', 'locator'];
  waterTypes.forEach((t) => {
    (byType[t] ?? []).forEach((n, i) => {
      const x = WATER_COLS[t] ?? 0;
      let y   = START_Y + i * ROW_GAP;
      if (t === 'reject') y = START_Y + ((byType['permeate']?.length ?? 0) + i) * ROW_GAP;
      if (t === 'pretreat' || t === 'feedMeter')
        y = START_Y + Math.floor((byType['well']?.length ?? 1) / 2) * ROW_GAP;
      positions.set(n.id, { x, y, zone: 'water' });
    });
  });

  const waterRows = Math.max(
    byType['well']?.length ?? 0,
    byType['roTrain']?.length ?? 0,
    (byType['permeate']?.length ?? 0) + (byType['reject']?.length ?? 0),
    byType['locator']?.length ?? 0,
  );
  const POWER_OFFSET_Y = START_Y + waterRows * ROW_GAP + 48;

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
    positions.set(n.id, { x: 350, y: POWER_OFFSET_Y + i * ROW_GAP, zone: 'power' });
  });

  return positions;
}

function cubicPath(x1: number, y1: number, x2: number, y2: number) {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlantTopology() {
  const { isAdmin, isManager } = useAuth();
  const canEdit = isAdmin || isManager;
  const { selectedPlantId } = useAppStore();
  const qc = useQueryClient();

  const { data: plants = [] } = usePlants();
  const [activePlantId, setActivePlantId] = useState<string | null>(null);
  const effectivePlantId = activePlantId ?? selectedPlantId ?? plants[0]?.id ?? null;

  const { data: rawData, isLoading, refetch } = useTopologyData(effectivePlantId);

  const [editMode, setEditMode] = useState<'connect' | 'disconnect' | null>(null);
  const [pendingFrom, setPendingFrom] = useState<{ id: string; type: NodeType } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [topoState, setTopoState] = useState<TopologyState | null>(null);

  useEffect(() => {
    if (!rawData || !effectivePlantId) return;
    setTopoState(buildTopology(effectivePlantId, rawData));
  }, [rawData, effectivePlantId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPendingFrom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Connection editing ────────────────────────────────────────────────────

  const EDITABLE_PAIRS: [NodeType, NodeType][] = [
    ['permeate', 'bulk'], ['bulk', 'locator'],
    ['solarMeter', 'well'], ['solarMeter', 'roTrain'],
    ['gridMeter',  'well'], ['gridMeter',  'roTrain'],
    ['well', 'roTrain'],    ['roTrain', 'well'],
  ];

  function canConnect(a: NodeType, b: NodeType) {
    return EDITABLE_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

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

  // ── Empty / loading states ─────────────────────────────────────────────────

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

  const positions = layoutNodes(topoState.nodes);
  const allLinks  = [...topoState.fixedLinks, ...topoState.editLinks];

  let maxX = 0, maxY = 0;
  positions.forEach(({ x, y }) => {
    maxX = Math.max(maxX, x + NODE_W + 20);
    maxY = Math.max(maxY, y + NODE_H + 20);
  });

  let maxWaterY = 0;
  positions.forEach(({ y, zone }) => { if (zone === 'water') maxWaterY = Math.max(maxWaterY, y + NODE_H); });
  const powerDividerY = maxWaterY + 24;

  const activePlant = plants.find((p) => p.id === effectivePlantId);

  // ── Node renderer ──────────────────────────────────────────────────────────

  function renderNode(node: TopoNode) {
    const pos = positions.get(node.id);
    if (!pos) return null;
    const c          = COLORS[node.type];
    const isPending  = pendingFrom?.id === node.id;
    const isHov      = hovered === node.id;
    const isClickable= canEdit && !!editMode;
    const isInactive = node.status === 'Inactive';

    return (
      <g
        key={node.id}
        transform={`translate(${pos.x},${pos.y})`}
        style={{ cursor: isClickable ? 'pointer' : 'default' }}
        onClick={() => handleNodeClick(node.id, node.type)}
        onMouseEnter={() => setHovered(node.id)}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Hover / pending selection ring */}
        {(isPending || (isHov && isClickable)) && (
          <rect x={-3} y={-3} width={NODE_W + 6} height={NODE_H + 6} rx={9}
            fill="none"
            stroke={isPending ? '#f59e0b' : c.accent}
            strokeWidth={2.5}
            opacity={0.75}
          />
        )}

        {/* Soft drop shadow */}
        <rect width={NODE_W} height={NODE_H} rx={7} x={1} y={2}
          fill={c.border} opacity={0.1} />

        {/* Node body */}
        <rect width={NODE_W} height={NODE_H} rx={7}
          fill={isInactive ? '#f8fafc' : c.bg}
          stroke={isPending ? '#f59e0b' : c.border}
          strokeWidth={isPending ? 2 : 1.5}
          opacity={isInactive ? 0.6 : 1}
        />

        {/* Left accent bar */}
        <rect x={0} y={5} width={3} height={NODE_H - 10} rx={1.5}
          fill={c.accent} opacity={isInactive ? 0.25 : 1}
        />

        {/* Type badge */}
        <text x={NODE_W / 2 + 2} y={14}
          textAnchor="middle"
          fill={c.accent}
          fontSize={7}
          fontFamily="'IBM Plex Mono', 'Courier New', monospace"
          fontWeight={600}
          letterSpacing={1.1}
          opacity={0.85}
        >
          {NODE_LABELS[node.type]}
        </text>

        {/* Node name */}
        <text x={NODE_W / 2 + 2} y={30}
          textAnchor="middle"
          fill={isInactive ? '#94a3b8' : c.text}
          fontSize={11}
          fontFamily="'IBM Plex Sans', system-ui, sans-serif"
          fontWeight={600}
        >
          {node.label.length > 13 ? node.label.slice(0, 12) + '…' : node.label}
        </text>

        {/* Status dot */}
        {node.status && (
          <circle cx={NODE_W - 8} cy={8} r={3.5}
            fill={node.status === 'Active' ? '#10b981' : '#f87171'}
            stroke="white" strokeWidth={1}
          />
        )}

        {/* Power-group bar */}
        {node.group && (
          <rect x={4} y={NODE_H - 7} width={NODE_W - 8} height={4} rx={2}
            fill={c.accent} opacity={0.3}
          />
        )}
      </g>
    );
  }

  // ── Link renderer ──────────────────────────────────────────────────────────

  function renderLink(link: TopoLink, idx: number) {
    const f = positions.get(link.from);
    const t = positions.get(link.to);
    if (!f || !t) return null;

    const x1 = f.x + NODE_W, y1 = f.y + NODE_H / 2;
    const x2 = t.x,           y2 = t.y + NODE_H / 2;
    const fromNode = topoState!.nodes.find((n) => n.id === link.from);
    const color = fromNode ? COLORS[fromNode.type].accent : '#94a3b8';

    return (
      <path
        key={`link-${idx}`}
        d={cubicPath(x1, y1, x2, y2)}
        fill="none"
        stroke={color}
        strokeWidth={link.editable ? 1.5 : 2}
        strokeDasharray={link.editable ? '6,3' : undefined}
        opacity={0.5}
        markerEnd="url(#arrow)"
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background text-foreground">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] tracking-widest text-primary font-mono uppercase font-semibold">
              Plant Monitor
            </p>
            <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">
              Network Topology
            </h1>
          </div>

          {/* Plant selector — filled pill (active) / ghost pill (inactive) */}
          <div className="flex gap-1.5 flex-wrap">
            {plants.map((p) => (
              <button
                key={p.id}
                onClick={() => { setActivePlantId(p.id); setPendingFrom(null); }}
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

        <div className="flex items-center gap-2">
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
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Help banner ──────────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="px-5 py-2.5 bg-primary/5 border-b border-primary/20 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <strong className="text-primary">Water flow:</strong>{' '}
            Well → Raw Meter → Pre-treatment → Feed Meter → RO Train → Permeate / Reject → Bulk/Mother Meter → Locator
          </span>
          <span>
            <strong className="text-amber-600">Power layer:</strong>{' '}
            Solar Array / Grid Utility → Named meters → Well pumps &amp; RO Train groups
          </span>
          {canEdit && (
            <span>
              <strong className="text-emerald-600">Editing:</strong>{' '}
              Pick Connect or Disconnect, then click two compatible nodes
            </span>
          )}
          <span className="text-muted-foreground/60">
            Dashed = editable · Solid = fixed schema
          </span>
        </div>
      )}

      {/* ── Admin toolbar ────────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-muted/30">
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
              Editable: Well↔RO Train · Permeate→Bulk · Bulk→Locator · Power Meter→Well/RO Train
            </span>
          )}

          <div className="ml-auto">
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

      {/* ── Diagram canvas ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4 bg-muted/20">

        {/* Zone label */}
        <div className="flex items-center gap-2 mb-3">
          <Droplets className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] tracking-widest text-primary font-mono uppercase font-semibold">
            {activePlant?.name} — Water Treatment Flow
          </span>
        </div>

        {/* SVG wrapped in a white card — matches app's card style */}
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-auto">
          <svg
            width={maxX}
            height={maxY + 20}
            style={{ display: 'block', minWidth: maxX }}
          >
            <defs>
              {/* Arrow marker — slate tone, readable on white */}
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
              </marker>

              {/* Light dot-grid background */}
              <pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="#e2e8f0" />
              </pattern>
            </defs>

            {/* Canvas */}
            <rect width={maxX} height={maxY + 20} fill="#ffffff" />
            <rect width={maxX} height={maxY + 20} fill="url(#dot-grid)" />

            {/* Power-zone divider */}
            {topoState.nodes.some((n) =>
              ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(n.type)
            ) && (
              <>
                <line x1={0} y1={powerDividerY} x2={maxX} y2={powerDividerY}
                  stroke="#cbd5e1" strokeWidth={1} strokeDasharray="5,5" />
                {/* Zone pill labels */}
                <rect x={8} y={powerDividerY - 19} width={92} height={15} rx={7.5} fill="#f1f5f9" />
                <text x={54} y={powerDividerY - 9} textAnchor="middle"
                  fill="#64748b" fontSize={8}
                  fontFamily="'IBM Plex Mono', monospace" fontWeight={600} letterSpacing={1.2}>
                  POWER SUPPLY
                </text>
                <rect x={8} y={START_Y - 20} width={80} height={15} rx={7.5} fill="#f0fdf4" />
                <text x={48} y={START_Y - 10} textAnchor="middle"
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
              { x: WATER_COLS.permeate,  label: 'OUTPUT' },
              { x: WATER_COLS.bulk,      label: 'BULK/MOTHER' },
              { x: WATER_COLS.locator,   label: 'LOCATORS' },
            ].map(({ x, label }) => (
              <text key={label} x={x + NODE_W / 2} y={14}
                textAnchor="middle" fill="#94a3b8" fontSize={7.5}
                fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.5} fontWeight={600}>
                {label}
              </text>
            ))}

            <g>{allLinks.map((l, i) => renderLink(l, i))}</g>
            <g>{topoState.nodes.map(renderNode)}</g>
          </svg>
        </div>

        {/* ── Legend ──────────────────────────────────────────────────────── */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 pt-3 border-t border-border">
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
          </div>
        </div>
      </div>
    </div>
  );
}
