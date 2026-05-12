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
 * Editable connections (Admin / Manager only):
 *   • Well ↔ RO Train routing
 *   • Permeate Meter → Bulk/Mother Meter
 *   • Bulk/Mother Meter → Locator
 *   • Power Meter → Well pump / RO Train
 *
 * Connection topology is persisted to `plant_topology_links` (Supabase) with
 * localStorage fallback while the migration has not yet run.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Sun, Zap, Droplets, Factory, Gauge, FlaskConical,
  GitBranch, MapPin, Plug, Unplug, Save, RefreshCw, HelpCircle,
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
  /** for power layer: group tag (shared_power_meter_group) */
  group?: string;
}

interface TopoLink {
  from: string;
  to: string;
  editable?: boolean;
}

interface TopologyState {
  nodes: TopoNode[];
  /** Fixed links (derived from schema, not user-editable) */
  fixedLinks: TopoLink[];
  /** Editable links (admin can add/remove) */
  editLinks: TopoLink[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOPO_LS_KEY = (plantId: string) => `plant_topology_links_${plantId}`;

const NODE_W = 112;
const NODE_H = 44;
const ROW_GAP = 60;
const START_Y = 36;

const COLORS: Record<NodeType, { bg: string; border: string; text: string; accent: string }> = {
  well:        { bg: '#0f3460', border: '#1a5276', text: '#7ec8e3', accent: '#3498db' },
  rawMeter:    { bg: '#1a237e', border: '#283593', text: '#90caf9', accent: '#5c6bc0' },
  pretreat:    { bg: '#1b5e20', border: '#2e7d32', text: '#a5d6a7', accent: '#66bb6a' },
  feedMeter:   { bg: '#004d40', border: '#00695c', text: '#80cbc4', accent: '#26a69a' },
  roTrain:     { bg: '#4a148c', border: '#6a1b9a', text: '#ce93d8', accent: '#ab47bc' },
  permeate:    { bg: '#006064', border: '#00838f', text: '#80deea', accent: '#26c6da' },
  reject:      { bg: '#7f0000', border: '#b71c1c', text: '#ef9a9a', accent: '#ef5350' },
  bulk:        { bg: '#e65100', border: '#ef6c00', text: '#ffcc80', accent: '#ffa726' },
  locator:     { bg: '#263238', border: '#37474f', text: '#b0bec5', accent: '#78909c' },
  solarSource: { bg: '#3d2c00', border: '#f59e0b', text: '#fde68a', accent: '#f59e0b' },
  gridSource:  { bg: '#1e1b4b', border: '#4f46e5', text: '#c7d2fe', accent: '#818cf8' },
  solarMeter:  { bg: '#422006', border: '#b45309', text: '#fcd34d', accent: '#f59e0b' },
  gridMeter:   { bg: '#1e1e3f', border: '#6366f1', text: '#a5b4fc', accent: '#6366f1' },
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
        // plant_power_config: solar/grid meter names
        (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count,solar_meter_names,grid_meter_count,grid_meter_names')
          .eq('plant_id', plantId).maybeSingle(),
        // plant_meter_config: has_solar / has_grid flags
        (supabase.from('plant_meter_config' as any) as any)
          .select('has_solar,has_grid,ro_has_permeate_meter,ro_has_reject_meter,ro_has_feed_meter')
          .eq('plant_id', plantId).maybeSingle(),
      ]);

      // Load saved editable links from Supabase or LS fallback
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
        wells: (wellsRes.data ?? []) as any[],
        roTrains: (roRes.data ?? []) as any[],
        locators: (locRes.data ?? []) as any[],
        productMeters: (prodRes.data ?? []) as any[],
        powerCfg: powerCfgRes.data as any,
        meterCfg: meterCfgRes.data as any,
        savedLinks,
      };
    },
  });
}

// ─── Persist editable links ───────────────────────────────────────────────────

async function saveLinks(plantId: string, links: TopoLink[]) {
  const rows = links.map((l) => ({ plant_id: plantId, from_id: l.from, to_id: l.to }));
  // Persist to LS always (fast)
  try { localStorage.setItem(TOPO_LS_KEY(plantId), JSON.stringify(links.map((l) => ({ from_id: l.from, to_id: l.to })))); } catch { /* ignore */ }
  // Best-effort Supabase upsert
  try {
    await (supabase.from('plant_topology_links' as any) as any).delete().eq('plant_id', plantId);
    if (rows.length) await (supabase.from('plant_topology_links' as any) as any).insert(rows);
  } catch { /* table may not exist yet — LS fallback above is sufficient */ }
}

// ─── Build topology from raw data ─────────────────────────────────────────────

function buildTopology(
  plantId: string,
  data: NonNullable<ReturnType<typeof useTopologyData>['data']>,
): TopologyState {
  const nodes: TopoNode[] = [];
  const fixedLinks: TopoLink[] = [];

  const { wells, roTrains, locators, productMeters, powerCfg, meterCfg, savedLinks } = data;

  const hasSolar = meterCfg?.has_solar ?? false;
  const hasGrid  = meterCfg?.has_grid  ?? true;
  const hasFeedMeter     = meterCfg?.ro_has_feed_meter     ?? true;
  const hasPermeate      = meterCfg?.ro_has_permeate_meter ?? true;
  const hasReject        = meterCfg?.ro_has_reject_meter   ?? true;

  const solarCount = powerCfg?.solar_meter_count ?? 1;
  const gridCount  = powerCfg?.grid_meter_count  ?? 1;
  const solarNames: string[] = powerCfg?.solar_meter_names ?? Array.from({ length: solarCount }, (_, i) => `Solar Meter ${i + 1}`);
  const gridNames:  string[] = powerCfg?.grid_meter_names  ?? Array.from({ length: gridCount },  (_, i) => `Grid Meter ${i + 1}`);

  // ── Water flow nodes ──
  wells.forEach((w: any) => {
    nodes.push({ id: w.id, type: 'well', label: w.name, status: w.status });
    // Raw meter — virtual id per well
    const rmId = `rawmeter-${w.id}`;
    nodes.push({ id: rmId, type: 'rawMeter', label: `Raw ${w.name}` });
    fixedLinks.push({ from: w.id, to: rmId });
  });

  // Pre-treatment — one per plant
  const ptId = `pretreat-${plantId}`;
  nodes.push({ id: ptId, type: 'pretreat', label: 'Pre-treatment' });
  wells.forEach((w: any) => {
    fixedLinks.push({ from: `rawmeter-${w.id}`, to: ptId });
  });

  // Feed meter — one per plant (if enabled)
  const fmId = `feedmeter-${plantId}`;
  if (hasFeedMeter) {
    nodes.push({ id: fmId, type: 'feedMeter', label: 'Feed Meter' });
    fixedLinks.push({ from: ptId, to: fmId });
  }

  // RO Trains
  roTrains.forEach((r: any) => {
    nodes.push({
      id: r.id,
      type: 'roTrain',
      label: `RO Train ${r.train_number}`,
      status: r.status,
      group: r.shared_power_meter_group ?? undefined,
    });
    fixedLinks.push({ from: hasFeedMeter ? fmId : ptId, to: r.id });
  });

  // Permeate & Reject meters — one per RO train (if enabled)
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

  // Bulk / Product meters
  productMeters.forEach((m: any) => {
    nodes.push({ id: m.id, type: 'bulk', label: m.name, status: m.status });
  });

  // Locators
  locators.forEach((l: any) => {
    nodes.push({ id: l.id, type: 'locator', label: l.name, status: l.status ?? 'Active' });
  });

  // ── Power layer nodes ──
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

  // ── Editable links from saved data ──
  // Seed defaults: permeate → bulk (from locator.product_meter_id)
  const defaultEditLinks: TopoLink[] = [];

  locators.forEach((l: any) => {
    if (l.product_meter_id) {
      defaultEditLinks.push({ from: l.product_meter_id, to: l.id, editable: true });
    }
  });

  // Power → wells (has_power_meter wells use the first grid meter by default)
  const firstGridMeter = hasGrid ? `grid-meter-${plantId}-0` : null;
  const firstSolarMeter = hasSolar ? `solar-meter-${plantId}-0` : null;

  wells.forEach((w: any) => {
    if (w.has_power_meter && firstGridMeter) {
      defaultEditLinks.push({ from: firstGridMeter, to: w.id, editable: true });
    }
  });

  // Power → RO trains (by shared_power_meter_group)
  const groups = new Map<string, string[]>();
  roTrains.forEach((r: any) => {
    if (r.shared_power_meter_group) {
      const g = groups.get(r.shared_power_meter_group) ?? [];
      g.push(r.id);
      groups.set(r.shared_power_meter_group, g);
    } else if (firstGridMeter) {
      defaultEditLinks.push({ from: firstGridMeter, to: r.id, editable: true });
    }
  });

  // Merge saved links over defaults
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

  // Group by type for Y positioning
  const byType: Record<string, TopoNode[]> = {};
  nodes.forEach((n) => {
    (byType[n.type] = byType[n.type] ?? []).push(n);
  });

  // Water zone
  const waterTypes: NodeType[] = ['well', 'rawMeter', 'pretreat', 'feedMeter', 'roTrain', 'permeate', 'reject', 'bulk', 'locator'];
  waterTypes.forEach((t) => {
    (byType[t] ?? []).forEach((n, i) => {
      let x = WATER_COLS[t] ?? 0;
      // Stagger reject below permeate in same column
      let y = START_Y + i * ROW_GAP;
      if (t === 'reject') y = START_Y + ((byType['permeate']?.length ?? 0) + i) * ROW_GAP;
      if (t === 'pretreat' || t === 'feedMeter') {
        // Centre vertically relative to wells
        const wellCount = byType['well']?.length ?? 1;
        y = START_Y + Math.floor(wellCount / 2) * ROW_GAP;
      }
      positions.set(n.id, { x, y, zone: 'water' });
    });
  });

  // Power zone — starts below water zone
  const waterRows = Math.max(
    byType['well']?.length ?? 0,
    byType['roTrain']?.length ?? 0,
    (byType['permeate']?.length ?? 0) + (byType['reject']?.length ?? 0),
    byType['locator']?.length ?? 0,
  );
  const POWER_OFFSET_Y = START_Y + waterRows * ROW_GAP + 48; // gap between zones

  let solarRow = 0;
  let gridRow = 0;

  (byType['solarSource'] ?? []).forEach((n) => {
    positions.set(n.id, { x: POWER_COLS.solarSource, y: POWER_OFFSET_Y + solarRow * ROW_GAP, zone: 'power' });
    solarRow++;
  });
  (byType['solarMeter'] ?? []).forEach((n, i) => {
    positions.set(n.id, { x: POWER_COLS.solarMeter, y: POWER_OFFSET_Y + i * ROW_GAP, zone: 'power' });
  });

  const gridStart = (byType['solarMeter']?.length ?? 0);
  (byType['gridSource'] ?? []).forEach((n) => {
    positions.set(n.id, { x: POWER_COLS.gridSource, y: POWER_OFFSET_Y + (gridStart + gridRow) * ROW_GAP, zone: 'power' });
    gridRow++;
  });
  (byType['gridMeter'] ?? []).forEach((n, i) => {
    positions.set(n.id, { x: POWER_COLS.gridMeter, y: POWER_OFFSET_Y + (gridStart + i) * ROW_GAP, zone: 'power' });
  });

  // Power consumers (wells / roTrains that are targets of power links)
  // They appear to the right of the grid/solar meters
  const powerConsumerTypes: NodeType[] = [];
  nodes
    .filter((n) => !positions.has(n.id))
    .forEach((n, i) => {
      positions.set(n.id, { x: 350, y: POWER_OFFSET_Y + i * ROW_GAP, zone: 'power' });
    });

  return positions;
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────

function cubicPath(x1: number, y1: number, x2: number, y2: number): string {
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

  // Build topology state from raw data
  const [topoState, setTopoState] = useState<TopologyState | null>(null);

  useEffect(() => {
    if (!rawData || !effectivePlantId) return;
    setTopoState(buildTopology(effectivePlantId, rawData));
  }, [rawData, effectivePlantId]);

  // Cancel pending selection on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPendingFrom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Connection editing ────────────────────────────────────────────────────

  const EDITABLE_PAIRS: [NodeType, NodeType][] = [
    ['permeate', 'bulk'],
    ['bulk', 'locator'],
    ['solarMeter', 'well'], ['solarMeter', 'roTrain'],
    ['gridMeter', 'well'], ['gridMeter', 'roTrain'],
    ['well', 'roTrain'], ['roTrain', 'well'],
  ];

  function canConnect(a: NodeType, b: NodeType): boolean {
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
      const exists = newLinks.some((l) => l.from === pendingFrom.id && l.to === id);
      if (!exists) newLinks.push({ from: pendingFrom.id, to: id, editable: true });
      else toast.info('Connection already exists');
    } else {
      const idx = newLinks.findIndex((l) =>
        (l.from === pendingFrom.id && l.to === id) || (l.from === id && l.to === pendingFrom.id),
      );
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

  // ── Render ─────────────────────────────────────────────────────────────────

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

  const allLinks = [...topoState.fixedLinks, ...topoState.editLinks];

  // Determine SVG dimensions
  let maxX = 0; let maxY = 0;
  positions.forEach(({ x, y }) => { maxX = Math.max(maxX, x + NODE_W + 20); maxY = Math.max(maxY, y + NODE_H + 20); });

  // Find the Y boundary between water and power zones
  let maxWaterY = 0;
  positions.forEach(({ y, zone }) => { if (zone === 'water') maxWaterY = Math.max(maxWaterY, y + NODE_H); });
  const powerDividerY = maxWaterY + 24;

  function renderNode(node: TopoNode) {
    const pos = positions.get(node.id);
    if (!pos) return null;
    const c = COLORS[node.type];
    const isPending = pendingFrom?.id === node.id;
    const isHov = hovered === node.id;
    const isClickable = canEdit && !!editMode;

    return (
      <g
        key={node.id}
        transform={`translate(${pos.x},${pos.y})`}
        style={{ cursor: isClickable ? 'pointer' : 'default' }}
        onClick={() => handleNodeClick(node.id, node.type)}
        onMouseEnter={() => setHovered(node.id)}
        onMouseLeave={() => setHovered(null)}
      >
        {(isPending || (isHov && isClickable)) && (
          <rect x={-3} y={-3} width={NODE_W + 6} height={NODE_H + 6} rx={8}
            fill="none" stroke={isPending ? '#fbbf24' : c.accent} strokeWidth={2} opacity={0.9} />
        )}
        <rect width={NODE_W} height={NODE_H} rx={6}
          fill={node.status === 'Inactive' ? '#1a1a2e' : c.bg}
          stroke={isPending ? '#fbbf24' : c.border}
          strokeWidth={isPending ? 2 : 1}
          opacity={node.status === 'Inactive' ? 0.45 : 1}
        />
        <text x={NODE_W / 2} y={14} textAnchor="middle"
          fill={c.accent} fontSize={7.5} fontFamily="'IBM Plex Mono', monospace" letterSpacing={0.8} opacity={0.9}>
          {NODE_LABELS[node.type]}
        </text>
        <text x={NODE_W / 2} y={30} textAnchor="middle"
          fill={node.status === 'Inactive' ? '#4a5568' : c.text}
          fontSize={11} fontFamily="'IBM Plex Sans', sans-serif" fontWeight={500}>
          {node.label.length > 13 ? node.label.slice(0, 12) + '…' : node.label}
        </text>
        {node.status && (
          <circle cx={NODE_W - 8} cy={8} r={3}
            fill={node.status === 'Active' ? '#34d399' : '#f87171'} />
        )}
        {node.group && (
          <rect x={2} y={NODE_H - 8} width={NODE_W - 4} height={7} rx={2} fill={c.accent} opacity={0.25} />
        )}
      </g>
    );
  }

  function renderLink(link: TopoLink, idx: number) {
    const f = positions.get(link.from);
    const t = positions.get(link.to);
    if (!f || !t) return null;

    const isPower = ['solarSource','gridSource','solarMeter','gridMeter'].includes(
      topoState!.nodes.find((n) => n.id === link.from)?.type ?? ''
    );
    const x1 = f.x + NODE_W;
    const y1 = f.y + NODE_H / 2;
    const x2 = t.x;
    const y2 = t.y + NODE_H / 2;

    const fromNode = topoState!.nodes.find((n) => n.id === link.from);
    const color = fromNode ? COLORS[fromNode.type].accent : '#4a5568';

    return (
      <path
        key={`link-${idx}`}
        d={cubicPath(x1, y1, x2, y2)}
        fill="none"
        stroke={color}
        strokeWidth={link.editable ? 1.5 : 2}
        strokeDasharray={link.editable ? '6,3' : undefined}
        opacity={0.65}
        markerEnd="url(#arrow)"
      />
    );
  }

  const activePlant = plants.find((p) => p.id === effectivePlantId);

  return (
    <div className="flex flex-col h-full bg-[#0a0e1a] text-slate-200" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-800 bg-[#0d1b2a]">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] tracking-widest text-blue-400 font-mono uppercase">Plant Monitor</p>
            <h1 className="text-lg font-bold tracking-tight text-slate-100 leading-tight">Network Topology</h1>
          </div>

          {/* Plant selector */}
          <div className="flex gap-1.5 flex-wrap">
            {plants.map((p) => (
              <button
                key={p.id}
                onClick={() => { setActivePlantId(p.id); setPendingFrom(null); }}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all border ${
                  effectivePlantId === p.id
                    ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                    : 'border-slate-700 text-slate-500 hover:border-slate-500'
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
            className="p-1.5 rounded-md border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-md border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Help banner ────────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="px-5 py-2.5 bg-slate-900/70 border-b border-slate-800 text-xs text-slate-400 flex flex-wrap gap-4">
          <span><strong className="text-blue-300">Water flow:</strong> Well → Raw Meter → Pre-treatment → Feed Meter → RO Train → Permeate / Reject Meter → Bulk/Mother Meter → Locator</span>
          <span><strong className="text-amber-300">Power layer:</strong> Solar Array / Grid Utility → Named meters → Well pumps &amp; RO Train groups</span>
          {canEdit && <span><strong className="text-green-300">Editing:</strong> Enable Admin Mode → pick Connect or Disconnect → click two compatible nodes</span>}
          <span className="text-slate-500">Dashed lines = editable connections &nbsp;·&nbsp; Solid lines = fixed schema links</span>
        </div>
      )}

      {/* ── Admin toolbar ───────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex items-center gap-3 px-5 py-2 border-b border-amber-900/40 bg-amber-950/20">
          <span className="text-[10px] tracking-widest text-amber-400 font-mono">EDIT WIRING:</span>
          <button
            onClick={() => { setEditMode(editMode === 'connect' ? null : 'connect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all ${
              editMode === 'connect'
                ? 'border-green-500 bg-green-500/15 text-green-300'
                : 'border-slate-700 text-slate-500 hover:border-slate-500'
            }`}
          >
            <Plug className="h-3 w-3" /> Connect
          </button>
          <button
            onClick={() => { setEditMode(editMode === 'disconnect' ? null : 'disconnect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all ${
              editMode === 'disconnect'
                ? 'border-red-500 bg-red-500/15 text-red-300'
                : 'border-slate-700 text-slate-500 hover:border-slate-500'
            }`}
          >
            <Unplug className="h-3 w-3" /> Disconnect
          </button>

          {pendingFrom && (
            <>
              <span className="text-xs text-yellow-300 font-mono">
                [{NODE_LABELS[pendingFrom.type]}] selected — click a compatible node…
              </span>
              <button onClick={() => setPendingFrom(null)} className="text-xs text-slate-500 hover:text-slate-300">✕ Cancel</button>
            </>
          )}

          {!pendingFrom && editMode && (
            <span className="text-xs text-slate-500">
              Editable: Well↔RO Train &nbsp;·&nbsp; Permeate→Bulk &nbsp;·&nbsp; Bulk→Locator &nbsp;·&nbsp; Power Meter→Well/RO Train
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={saving}
              className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {saving ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              Save Topology
            </Button>
          </div>
        </div>
      )}

      {/* ── Diagram canvas ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4">

        {/* Zone labels */}
        <div className="flex items-center gap-2 mb-2">
          <Droplets className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-[10px] tracking-widest text-blue-400 font-mono uppercase">{activePlant?.name} — Water Treatment Flow</span>
        </div>

        <svg
          width={maxX}
          height={maxY + 20}
          style={{ display: 'block', minWidth: maxX }}
        >
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="#475569" />
            </marker>
            <pattern id="grid-bg" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#111827" strokeWidth="0.5" />
            </pattern>
          </defs>

          <rect width={maxX} height={maxY + 20} fill="#0a0e1a" />
          <rect width={maxX} height={maxY + 20} fill="url(#grid-bg)" />

          {/* Power zone divider */}
          {topoState.nodes.some((n) => ['solarSource','gridSource','solarMeter','gridMeter'].includes(n.type)) && (
            <>
              <line x1={0} y1={powerDividerY} x2={maxX} y2={powerDividerY}
                stroke="#1e3a5f" strokeWidth={1} strokeDasharray="4,6" />
              <text x={8} y={powerDividerY - 6} fill="#1d4ed8" fontSize={9}
                fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.5}>
                POWER SUPPLY
              </text>
              <text x={8} y={START_Y - 4} fill="#1d4ed8" fontSize={9}
                fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.5}>
                WATER FLOW
              </text>
            </>
          )}

          {/* Column header labels (water zone) */}
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
              textAnchor="middle" fill="#1e3a5f" fontSize={7.5}
              fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.5}>
              {label}
            </text>
          ))}

          {/* Links */}
          <g>{allLinks.map((l, i) => renderLink(l, i))}</g>

          {/* Nodes */}
          <g>{topoState.nodes.map(renderNode)}</g>
        </svg>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-800 pt-3">
          {(Object.entries(COLORS) as [NodeType, (typeof COLORS)[NodeType]][]).map(([type, c]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c.bg, border: `1px solid ${c.border}` }} />
              <span className="text-[10px] text-slate-500 font-mono">{NODE_LABELS[type]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-8 border-t-2 border-dashed border-slate-600" />
            <span className="text-[10px] text-slate-500 font-mono">Editable</span>
            <div className="w-8 border-t-2 border-slate-600 ml-2" />
            <span className="text-[10px] text-slate-500 font-mono">Fixed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
