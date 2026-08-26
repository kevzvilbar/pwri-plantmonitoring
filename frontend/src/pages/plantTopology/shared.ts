import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'well' | 'rawMeter' | 'pretreat' | 'feedMeter'
  | 'roTrain' | 'permeate' | 'reject' | 'bulk' | 'locator'
  | 'solarSource' | 'gridSource' | 'solarMeter' | 'gridMeter'
  | 'customNode';

export interface CustomColumn {
  id: string;
  label: string;
  /** which base column key to insert this column after */
  insertAfter: string;
}

// ─── Base column definitions (ordered) ──────────────────────────────────────────

export interface BaseColSlot {
  key: string;
  label: string;
  type: NodeType;
}

export const BASE_COL_SLOTS: BaseColSlot[] = [
  { key: 'well',      label: 'WELLS',              type: 'well' },
  { key: 'rawMeter',  label: 'RAW METERS',         type: 'rawMeter' },
  { key: 'pretreat',  label: 'PRE-TREAT',          type: 'pretreat' },
  { key: 'feedMeter', label: 'FEED',               type: 'feedMeter' },
  { key: 'roTrain',   label: 'RO TRAINS',          type: 'roTrain' },
  { key: 'permeate',  label: 'PERMEATE / REJECT',  type: 'permeate' },
  { key: 'bulk',      label: 'BULK METERS',        type: 'bulk' },
  { key: 'locator',   label: 'LOCATORS',           type: 'locator' },
];

export interface ColSlot {
  key: string;
  label: string;
  type?: NodeType;       // set for base cols
  customCol?: CustomColumn; // set for custom cols
  isCustom: boolean;
}

/** Builds the full ordered column sequence, interleaving custom cols into base cols. */
export function buildColSequence(customColumns: CustomColumn[]): ColSlot[] {
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
export function buildColXMap(customColumns: CustomColumn[], colWidths: Record<string, number> = {}): Record<string, number> {
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

export interface TopoNode {
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

export interface TopoLink {
  from: string;
  to: string;
  editable?: boolean;
}

export interface NodePositionOverride {
  colKey: string;
  rowIdx: number;
}

export interface DragItem {
  nodeId?: string;       // undefined = new node from palette
  nodeType: NodeType;
  label: string;
  colId?: string;
  skipRename?: boolean;  // true = palette item already has a name
}

export interface PaletteItem {
  id: string;
  label: string;
}

export interface TopologyState {
  nodes: TopoNode[];
  fixedLinks: TopoLink[];
  editLinks: TopoLink[];
}

// ─── Constants ──────────────────────────────────────────────────────────────────

export const TOPO_LS_KEY       = (pid: string) => `plant_topology_links_${pid}`;
export const CUSTOM_LS_KEY     = (pid: string) => `plant_topology_custom_${pid}`;
export const CUSTOM_COLS_KEY   = (pid: string) => `plant_topology_cols_${pid}`;
export const POS_OVERRIDES_KEY = (pid: string) => `plant_topology_pos_${pid}`;
export const PALETTE_ITEMS_KEY = (pid: string) => `plant_topology_palette_${pid}`;
export const COL_WIDTHS_KEY    = (pid: string) => `plant_topology_colwidths_${pid}`;

// ── Node dimensions (larger for readability) ──
export const NODE_W  = 148;
export const NODE_H  = 62;
export const ROW_GAP = 90;   // vertical gap between rows
export const START_Y = 52;
export const COL_GAP = 164;  // horizontal gap between column centers

export const POWER_COLS: Record<string, number> = {
  solarSource: 28,
  gridSource:  28,
  solarMeter:  28 + COL_GAP,
  gridMeter:   28 + COL_GAP,
};

export const NODE_LABELS: Record<NodeType, string> = {
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

// Values are `hsl(var(--topo-<kind>-<prop>))` refs into index.css, not literal
// hex, so this object automatically tracks light/dark mode (and any future
// data-theme) with zero changes here — see index.css's "Plant Topology node
// colors" sections (:root and .dark) for the actual values.
export const COLORS: Record<NodeType, { bg: string; border: string; text: string; accent: string; lane: string }> = {
  well:        { bg: 'hsl(var(--topo-well-bg))',        border: 'hsl(var(--topo-well-border))',        text: 'hsl(var(--topo-well-text))',        accent: 'hsl(var(--topo-well-border))',        lane: 'hsl(var(--topo-well-lane))' },
  rawMeter:    { bg: 'hsl(var(--topo-rawMeter-bg))',    border: 'hsl(var(--topo-rawMeter-border))',    text: 'hsl(var(--topo-rawMeter-text))',    accent: 'hsl(var(--topo-rawMeter-border))',    lane: 'hsl(var(--topo-rawMeter-lane))' },
  pretreat:    { bg: 'hsl(var(--topo-pretreat-bg))',    border: 'hsl(var(--topo-pretreat-border))',    text: 'hsl(var(--topo-pretreat-text))',    accent: 'hsl(var(--topo-pretreat-border))',    lane: 'hsl(var(--topo-pretreat-lane))' },
  feedMeter:   { bg: 'hsl(var(--topo-feedMeter-bg))',   border: 'hsl(var(--topo-feedMeter-border))',   text: 'hsl(var(--topo-feedMeter-text))',   accent: 'hsl(var(--topo-feedMeter-border))',   lane: 'hsl(var(--topo-feedMeter-lane))' },
  roTrain:     { bg: 'hsl(var(--topo-roTrain-bg))',     border: 'hsl(var(--topo-roTrain-border))',     text: 'hsl(var(--topo-roTrain-text))',     accent: 'hsl(var(--topo-roTrain-border))',     lane: 'hsl(var(--topo-roTrain-lane))' },
  permeate:    { bg: 'hsl(var(--topo-permeate-bg))',    border: 'hsl(var(--topo-permeate-border))',    text: 'hsl(var(--topo-permeate-text))',    accent: 'hsl(var(--topo-permeate-border))',    lane: 'hsl(var(--topo-permeate-lane))' },
  reject:      { bg: 'hsl(var(--topo-reject-bg))',      border: 'hsl(var(--topo-reject-border))',      text: 'hsl(var(--topo-reject-text))',      accent: 'hsl(var(--topo-reject-border))',      lane: 'hsl(var(--topo-reject-lane))' },
  bulk:        { bg: 'hsl(var(--topo-bulk-bg))',        border: 'hsl(var(--topo-bulk-border))',        text: 'hsl(var(--topo-bulk-text))',        accent: 'hsl(var(--topo-bulk-border))',        lane: 'hsl(var(--topo-bulk-lane))' },
  locator:     { bg: 'hsl(var(--topo-locator-bg))',     border: 'hsl(var(--topo-locator-border))',     text: 'hsl(var(--topo-locator-text))',     accent: 'hsl(var(--topo-locator-border))',     lane: 'hsl(var(--topo-locator-lane))' },
  solarSource: { bg: 'hsl(var(--topo-solarSource-bg))', border: 'hsl(var(--topo-solarSource-border))', text: 'hsl(var(--topo-solarSource-text))', accent: 'hsl(var(--topo-solarSource-border))', lane: 'hsl(var(--topo-solarSource-lane))' },
  gridSource:  { bg: 'hsl(var(--topo-gridSource-bg))',  border: 'hsl(var(--topo-gridSource-border))',  text: 'hsl(var(--topo-gridSource-text))',  accent: 'hsl(var(--topo-gridSource-border))',  lane: 'hsl(var(--topo-gridSource-lane))' },
  solarMeter:  { bg: 'hsl(var(--topo-solarMeter-bg))',  border: 'hsl(var(--topo-solarMeter-border))',  text: 'hsl(var(--topo-solarMeter-text))',  accent: 'hsl(var(--topo-solarMeter-border))',  lane: 'hsl(var(--topo-solarMeter-lane))' },
  gridMeter:   { bg: 'hsl(var(--topo-gridMeter-bg))',   border: 'hsl(var(--topo-gridMeter-border))',   text: 'hsl(var(--topo-gridMeter-text))',   accent: 'hsl(var(--topo-gridMeter-border))',   lane: 'hsl(var(--topo-gridMeter-lane))' },
  customNode:  { bg: 'hsl(var(--topo-customNode-bg))',  border: 'hsl(var(--topo-customNode-border))',  text: 'hsl(var(--topo-customNode-text))',  accent: 'hsl(var(--topo-customNode-accent))', lane: 'hsl(var(--topo-customNode-lane))' },
};

// c.border/c.accent are now `hsl(var(--x))` strings, not hex, so the old
// `c.border + '80'` hex-alpha-suffix trick no longer produces a valid CSS
// color. This does the equivalent with the CSS Color 4 `hsl(... / alpha)`
// syntax the rest of the design system already uses (see ThemeSelector.tsx).
// alpha is 0-1; the three call sites below preserve their original opacity
// (hex '80' ≈ 0.5, hex 'aa' ≈ 0.67, hex '33' ≈ 0.2).
export function withAlpha(hslColor: string, alpha: number): string {
  return hslColor.replace(/\)$/, ` / ${alpha})`);
}

export const EDITABLE_PAIRS: [NodeType, NodeType][] = [
  ['permeate',   'bulk'],
  ['bulk',       'locator'],
  ['well',       'roTrain'],
  ['roTrain',    'well'],
  // A primary train's permeate can feed a secondary (2nd-pass) RO train —
  // e.g. Train 1's permeate -> Potable-RO. See unit_type/feed_source_train_id
  // on ro_trains (20260813_secondary_ro_train_wiring.sql).
  ['permeate',   'roTrain'],
  // A secondary unit's reject can recirculate back into an upstream
  // permeate stream instead of discharging to waste. See reject_routing on
  // ro_trains — a recirculate reject was already counted once inside the
  // upstream train's own permeate meter and must never be double-counted.
  ['reject',     'permeate'],
  ['solarMeter', 'well'],   ['solarMeter', 'roTrain'],
  ['gridMeter',  'well'],   ['gridMeter',  'roTrain'],
];

export function canConnect(a: NodeType, b: NodeType) {
  return EDITABLE_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// ─── Persist helpers ────────────────────────────────────────────────────────────

export async function saveLinks(plantId: string, links: TopoLink[]) {
  const rows = links.map((l) => ({ plant_id: plantId, from_id: l.from, to_id: l.to }));
  try { localStorage.setItem(TOPO_LS_KEY(plantId), JSON.stringify(links.map((l) => ({ from_id: l.from, to_id: l.to })))); } catch { /**/ }
  try {
    await (supabase.from('plant_topology_links' as any) as any).delete().eq('plant_id', plantId);
    if (rows.length) await (supabase.from('plant_topology_links' as any) as any).insert(rows);
  } catch { /**/ }
}

export function loadCustomNodes(plantId: string): TopoNode[] {
  try {
    const raw = localStorage.getItem(CUSTOM_LS_KEY(plantId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveCustomNodes(plantId: string, nodes: TopoNode[]) {
  try { localStorage.setItem(CUSTOM_LS_KEY(plantId), JSON.stringify(nodes)); } catch { /**/ }
}

export function loadCustomColumns(plantId: string): CustomColumn[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COLS_KEY(plantId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveCustomColumns(plantId: string, cols: CustomColumn[]) {
  try { localStorage.setItem(CUSTOM_COLS_KEY(plantId), JSON.stringify(cols)); } catch { /**/ }
}

export function loadPosOverrides(plantId: string): Record<string, NodePositionOverride> {
  try {
    const raw = localStorage.getItem(POS_OVERRIDES_KEY(plantId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function savePosOverrides(plantId: string, overrides: Record<string, NodePositionOverride>) {
  try { localStorage.setItem(POS_OVERRIDES_KEY(plantId), JSON.stringify(overrides)); } catch { /**/ }
}

export function loadPaletteItems(plantId: string): PaletteItem[] {
  try {
    const raw = localStorage.getItem(PALETTE_ITEMS_KEY(plantId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function savePaletteItems(plantId: string, items: PaletteItem[]) {
  try { localStorage.setItem(PALETTE_ITEMS_KEY(plantId), JSON.stringify(items)); } catch { /**/ }
}

export function loadColWidths(plantId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY(plantId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveColWidths(plantId: string, widths: Record<string, number>) {
  try { localStorage.setItem(COL_WIDTHS_KEY(plantId), JSON.stringify(widths)); } catch { /**/ }
}

// ─── Data hook ──────────────────────────────────────────────────────────────────

export function useTopologyData(plantId: string | null) {
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
          'filter_media_type,filter_housing_type,' +
          'unit_type,feed_source_train_id,reject_routing'
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

export function buildTrainDetail(t: any): string {
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

export function buildTopology(
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
    const isSecondary = r.unit_type === 'secondary';
    const trainLabel = (r.name ? `Train ${r.train_number} · ${r.name}` : `RO Train ${r.train_number}`)
      + (isSecondary ? ' (2nd pass)' : '');
    nodes.push({
      id: r.id,
      type: 'roTrain',
      label: trainLabel,
      status: r.status,
      group: r.shared_power_meter_group ?? undefined,
      detail,
    });
    // Secondary units are fed by an upstream train's permeate (an editable
    // link, seeded as a default below from feed_source_train_id) — not by
    // the plant's shared feed meter, so skip the usual fixed link for them.
    if (!isSecondary) {
      fixedLinks.push({ from: hasFeedMeter ? fmId : ptId, to: r.id });
    }
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

  roTrains.forEach((r: any) => {
    if (r.unit_type === 'secondary' && r.feed_source_train_id) {
      defaultEditLinks.push({ from: `permeate-${r.feed_source_train_id}`, to: r.id, editable: true });
      if (r.reject_routing === 'recirculate') {
        defaultEditLinks.push({ from: `reject-${r.id}`, to: `permeate-${r.feed_source_train_id}`, editable: true });
      }
    }
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

export type Zone = 'water' | 'power';

export function layoutNodes(
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

export function cubicPath(x1: number, y1: number, x2: number, y2: number) {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

