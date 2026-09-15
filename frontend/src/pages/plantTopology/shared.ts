import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  RawWaterIcon,
  MediaFilterIcon,
  CartridgeFilterIcon,
  BoosterPumpIcon,
  HighPressurePumpIcon,
  ROTrainIcon,
  MembranePerformanceIcon,
  PermeateIcon,
  RejectIcon,
  TankIcon,
  PowerMeterIcon,
  SolarPanelIcon,
  GridPylonIcon,
  MeterOdometerIcon,
  WaterMeterIcon,
  WaterMeterElectromagIcon,
} from '@/components/icons/water-icons';
import {
  WellSymbol,
  RawMeterSymbol,
  FeedMeterSymbol,
  PretreatSymbol,
  ROTrainSymbol,
  PermeateSymbol,
  RejectSymbol,
  BulkMeterSymbol,
  TankSymbol,
  SolarSymbol,
  GridSymbol,
  PowerMeterSymbol,
  LocatorSymbol,
  RawTankSymbol,
  RawWaterPumpSymbol,
  MediaFilterSymbol,
  CartridgeFilterSymbol,
  HPPumpSymbol,
  ProductTankSymbol,
} from '@/components/icons/topology-symbols';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'well' | 'rawMeter' | 'rawTank' | 'rawWaterPump' | 'mediaFilter'
  | 'bagCartridge' | 'hpPump' | 'pretreat' | 'feedMeter'
  | 'roTrain' | 'permeate' | 'reject' | 'productTank' | 'bulk' | 'locator'
  | 'solarSource' | 'gridSource' | 'solarMeter' | 'gridMeter'
  | 'customNode';

export type StreamType = 'feed' | 'permeate' | 'reject' | 'power' | 'general';

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
  { key: 'well',         label: 'WELLS',        type: 'well' },
  { key: 'rawMeter',     label: 'RAW METERS',   type: 'rawMeter' },
  { key: 'rawTank',      label: 'RAW TANK',     type: 'rawTank' },
  { key: 'rawWaterPump', label: 'RAW PUMP',     type: 'rawWaterPump' },
  { key: 'mediaFilter',  label: 'AFM / MMF',    type: 'mediaFilter' },
  { key: 'bagCartridge', label: 'BAG / CF',     type: 'bagCartridge' },
  { key: 'hpPump',       label: 'HPP',          type: 'hpPump' },
  { key: 'feedMeter',    label: 'FEED',         type: 'feedMeter' },
  { key: 'roTrain',      label: 'RO TRAINS',    type: 'roTrain' },
  { key: 'permeate',     label: 'PERMEATE / REJECT', type: 'permeate' },
  { key: 'productTank',  label: 'PRODUCT TANK', type: 'productTank' },
  { key: 'bulk',         label: 'BULK METERS',  type: 'bulk' },
  { key: 'locator',      label: 'LOCATORS',     type: 'locator' },
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
  /** For meter nodes tied to a train: 'mechanical' or 'electromagnetic' — resolved from train EM config */
  meterVariant?: 'mechanical' | 'electromagnetic';
}

export interface TopoLink {
  from: string;
  to: string;
  editable?: boolean;
  /** Blending-well bypass: links directly to product line, skips RO */
  bypass?: boolean;
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

// ── Node dimensions (for symbol-based layout) ──
// These are fallback values; actual sizes come from getSymbolDimensions()
export const NODE_W  = 64;   // average symbol width
export const NODE_H  = 56;   // average symbol height
export const ROW_GAP = 100;  // vertical gap between rows (increased for label tags)
export const START_Y = 52;
export const COL_GAP = 120;  // horizontal gap between column centers (adjusted for symbols)

// ── Typography constants ──
export const TOPO_FONT_SANS = "var(--font-sans, 'Inter', system-ui, sans-serif)";
export const TOPO_FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";

// ── Safe status color helper (with non-alarm default fallback) ──
export function getNodeStatusInfo(status?: string): {
  fill: string;
  tone: 'good' | 'warn' | 'danger' | 'muted';
  label: string;
} {
  const s = status?.toLowerCase() || '';
  if (s === 'active' || s === 'running' || s === 'online') {
    return { fill: 'hsl(var(--accent))', tone: 'good', label: status || 'Active' };
  }
  if (s === 'maintenance' || s === 'standby' || s === 'warning') {
    return { fill: 'hsl(var(--warn))', tone: 'warn', label: status || 'Maintenance' };
  }
  if (s === 'error' || s === 'alarm' || s === 'fault') {
    return { fill: 'hsl(var(--danger))', tone: 'danger', label: status || 'Fault' };
  }
  if (s === 'inactive' || s === 'offline' || s === 'disabled') {
    return { fill: 'hsl(var(--muted-foreground))', tone: 'muted', label: status || 'Inactive' };
  }
  // Safe default: neutral muted gray (never masquerades as an alarm!)
  return { fill: 'hsl(var(--muted-foreground))', tone: 'muted', label: status || 'Unknown' };
}

export const POWER_COLS: Record<string, number> = {
  solarSource: 28,
  gridSource:  28,
  solarMeter:  28 + COL_GAP,
  gridMeter:   28 + COL_GAP,
};

// Canvas ref placeholder for drag-drop calculations
export const CANVAS_REF = { current: null as HTMLDivElement | null };

export const NODE_LABELS: Record<NodeType, string> = {
  well:        'WELL',
  rawMeter:    'RAW METER',
  rawTank:     'RAW TANK',
  rawWaterPump:'RAW PUMP',
  mediaFilter: 'AFM/MMF',
  bagCartridge:'BAG/CF',
  hpPump:      'HPP',
  pretreat:    'PRE-TREAT',
  feedMeter:   'FEED METER',
  roTrain:     'RO TRAIN',
  permeate:    'PERMEATE',
  reject:      'REJECT',
  productTank: 'PRODUCT TANK',
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
  rawTank:     { bg: 'hsl(var(--topo-rawTank-bg))',     border: 'hsl(var(--topo-rawTank-border))',     text: 'hsl(var(--topo-rawTank-text))',     accent: 'hsl(var(--topo-rawTank-border))',     lane: 'hsl(var(--topo-rawTank-lane))' },
  rawWaterPump:{ bg: 'hsl(var(--topo-rawWaterPump-bg))',border: 'hsl(var(--topo-rawWaterPump-border))',text: 'hsl(var(--topo-rawWaterPump-text))',accent: 'hsl(var(--topo-rawWaterPump-border))',lane: 'hsl(var(--topo-rawWaterPump-lane))' },
  mediaFilter: { bg: 'hsl(var(--topo-mediaFilter-bg))', border: 'hsl(var(--topo-mediaFilter-border))', text: 'hsl(var(--topo-mediaFilter-text))', accent: 'hsl(var(--topo-mediaFilter-border))', lane: 'hsl(var(--topo-mediaFilter-lane))' },
  bagCartridge:{ bg: 'hsl(var(--topo-bagCartridge-bg))',border: 'hsl(var(--topo-bagCartridge-border))',text: 'hsl(var(--topo-bagCartridge-text))',accent: 'hsl(var(--topo-bagCartridge-border))',lane: 'hsl(var(--topo-bagCartridge-lane))' },
  hpPump:      { bg: 'hsl(var(--topo-hpPump-bg))',      border: 'hsl(var(--topo-hpPump-border))',      text: 'hsl(var(--topo-hpPump-text))',      accent: 'hsl(var(--topo-hpPump-border))',      lane: 'hsl(var(--topo-hpPump-lane))' },
  pretreat:    { bg: 'hsl(var(--topo-pretreat-bg))',    border: 'hsl(var(--topo-pretreat-border))',    text: 'hsl(var(--topo-pretreat-text))',    accent: 'hsl(var(--topo-pretreat-border))',    lane: 'hsl(var(--topo-pretreat-lane))' },
  feedMeter:   { bg: 'hsl(var(--topo-feedMeter-bg))',   border: 'hsl(var(--topo-feedMeter-border))',   text: 'hsl(var(--topo-feedMeter-text))',   accent: 'hsl(var(--topo-feedMeter-border))',   lane: 'hsl(var(--topo-feedMeter-lane))' },
  roTrain:     { bg: 'hsl(var(--topo-roTrain-bg))',     border: 'hsl(var(--topo-roTrain-border))',     text: 'hsl(var(--topo-roTrain-text))',     accent: 'hsl(var(--topo-roTrain-border))',     lane: 'hsl(var(--topo-roTrain-lane))' },
  permeate:    { bg: 'hsl(var(--topo-permeate-bg))',    border: 'hsl(var(--topo-permeate-border))',    text: 'hsl(var(--topo-permeate-text))',    accent: 'hsl(var(--topo-permeate-border))',    lane: 'hsl(var(--topo-permeate-lane))' },
  reject:      { bg: 'hsl(var(--topo-reject-bg))',      border: 'hsl(var(--topo-reject-border))',      text: 'hsl(var(--topo-reject-text))',      accent: 'hsl(var(--topo-reject-border))',      lane: 'hsl(var(--topo-reject-lane))' },
  productTank: { bg: 'hsl(var(--topo-productTank-bg))', border: 'hsl(var(--topo-productTank-border))', text: 'hsl(var(--topo-productTank-text))', accent: 'hsl(var(--topo-productTank-border))', lane: 'hsl(var(--topo-productTank-lane))' },
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
  // Plants where permeate IS a production source (e.g. Mambaling: 'both'
  // mode — permeate + product meter summed) can also feed locators directly
  // off the permeate line, alongside their product meter.
  ['permeate',   'locator'],
  // The product tank is fed by permeate and discharges to the product/bulk
  // meters, so it can be rewired against either side (plus the locators where
  // it feeds distribution directly).
  ['permeate',   'productTank'],
  ['productTank','bulk'],
  ['productTank','locator'],
  ['bulk',       'locator'],
  ['well',       'roTrain'],
  ['roTrain',    'well'],
  // Which wells feed which train's pre-treatment set (raw meter → raw tank).
  ['rawMeter',   'rawTank'],
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

// ─── Icon imports and node → icon mapping ───────────────────────────────────

/** Maps each NodeType to its P&ID symbol component.
 *  Returns null for custom nodes (no symbol — rendered as text badge).
 *  Meter nodes accept a `variant` prop ('mechanical' | 'electromagnetic')
 *  resolved from train EM config.
 */
export function getNodeIcon(type: NodeType, variant?: string): React.ComponentType<any> | null {
  switch (type) {
    case 'well':
      return WellSymbol;
    case 'rawMeter':
      return RawMeterSymbol;
    case 'rawTank':
      return RawTankSymbol;
    case 'rawWaterPump':
      return RawWaterPumpSymbol;
    case 'mediaFilter':
      return MediaFilterSymbol;
    case 'bagCartridge':
      return CartridgeFilterSymbol;
    case 'hpPump':
      return HPPumpSymbol;
    case 'pretreat':
      return PretreatSymbol;
    case 'feedMeter':
      return FeedMeterSymbol;
    case 'roTrain':
      return ROTrainSymbol;
    case 'permeate':
      return variant === 'tank' ? TankSymbol : PermeateSymbol;
    case 'reject':
      return RejectSymbol;
    case 'productTank':
      return ProductTankSymbol;
    case 'bulk':
      return variant === 'tank' ? TankSymbol : BulkMeterSymbol;
    case 'locator':
      return LocatorSymbol;
    case 'solarSource':
      return SolarSymbol;
    case 'solarMeter':
    case 'gridMeter':
      return PowerMeterSymbol;
    case 'gridSource':
      return GridSymbol;
    case 'customNode':
    default:
      return null;
  }
}

/** Returns the natural dimensions for each node type's symbol.
 *  Used for layout calculations and lane widths.
 */
export function getSymbolDimensions(type: NodeType): { w: number; h: number } {
  switch (type) {
    case 'well':
      return { w: 48, h: 48 };
    case 'rawMeter':
      return { w: 48, h: 48 };
    case 'rawTank':
      return { w: 48, h: 56 };
    case 'rawWaterPump':
      return { w: 48, h: 48 };
    case 'mediaFilter':
      return { w: 48, h: 56 };
    case 'bagCartridge':
      return { w: 48, h: 56 };
    case 'hpPump':
      return { w: 56, h: 44 };
    case 'pretreat':
      return { w: 48, h: 56 };
    case 'feedMeter':
      return { w: 56, h: 40 };
    case 'roTrain':
      return { w: 80, h: 44 };
    case 'permeate':
      return { w: 48, h: 48 };
    case 'reject':
      return { w: 48, h: 48 };
    case 'productTank':
      return { w: 48, h: 56 };
    case 'bulk':
      return { w: 48, h: 48 };
    case 'locator':
      return { w: 48, h: 48 };
    case 'solarSource':
      return { w: 56, h: 44 };
    case 'gridSource':
      return { w: 40, h: 52 };
    case 'solarMeter':
    case 'gridMeter':
      return { w: 48, h: 48 };
    case 'customNode':
    default:
      return { w: 48, h: 48 };
  }
}

// ─── Stream type determination for links ───────────────────────────────────

/** Determines the stream type of a link based on its endpoint node types.
 *  Used to color pipes appropriately (feed=blue, permeate=green, reject=orange, power=yellow).
 */
export function getStreamType(link: TopoLink, nodes: TopoNode[]): StreamType {
  const fromNode = nodes.find((n) => n.id === link.from);
  const toNode = nodes.find((n) => n.id === link.to);
  if (!fromNode || !toNode) return 'general';

  // Power links
  if (['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(fromNode.type) ||
      ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'].includes(toNode.type)) {
    return 'power';
  }

  // Reject flows
  if (toNode.type === 'reject' || fromNode.type === 'reject') {
    return 'reject';
  }

  // Permeate flows (permeate/productTank → bulk/locator/roTrain) — the
  // product tank sits on the permeate/product water line, so pipes touching
  // it render in permeate green.
  if (fromNode.type === 'permeate' || fromNode.type === 'productTank' ||
      toNode.type === 'productTank') {
    return 'permeate';
  }

  // Feed flows (well → rawMeter → rawTank → rawWaterPump → mediaFilter →
  // bagCartridge → hpPump → feedMeter → roTrain)
  if (['well', 'rawMeter', 'rawTank', 'rawWaterPump', 'mediaFilter', 'bagCartridge', 'hpPump', 'pretreat', 'feedMeter'].includes(fromNode.type) ||
      ['rawMeter', 'rawTank', 'rawWaterPump', 'mediaFilter', 'bagCartridge', 'hpPump', 'pretreat', 'feedMeter', 'roTrain'].includes(toNode.type)) {
    return 'feed';
  }

  return 'general';
}

/** Stream colors for link/pipe rendering — uses HSL tokens.
 *  feed      = blue accent   (raw water / feed to RO)
 *  permeate  = green accent  (product water)
 *  reject    = orange/warn   (waste concentrate)
 *  power     = yellow/warn   (electrical)
 *  general   = muted         (unclassified)
 */
export const STREAM_COLORS: Record<StreamType, string> = {
  feed:      'hsl(var(--primary))',
  permeate:  'hsl(142 70% 45%)',   // green
  reject:    'hsl(var(--warn))',   // orange
  power:     'hsl(45 95% 55%)',   // yellow/gold
  general:   'hsl(var(--muted-foreground))',
};

/** Stream type labels for legend */
export const STREAM_LABELS: Record<StreamType, string> = {
  feed:      'Feed / Raw Water',
  permeate:  'Permeate (Product)',
  reject:    'Reject / Concentrate',
  power:     'Power / Electrical',
  general:   'General Connection',
};

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
          .select('config,permeate_is_production')
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
  if (t.uses_em_meter !== false) parts.push('EM');
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

  const cfg = (meterCfg?.config ?? meterCfg ?? {}) as any;
  const hasSolar     = cfg?.has_solar ?? false;
  const hasGrid      = cfg?.has_grid  ?? true;
  const hasFeedMeter = cfg?.ro_has_feed_meter     ?? true;
  const hasPermeate  = cfg?.ro_has_permeate_meter ?? true;
  const hasReject    = cfg?.ro_has_reject_meter   ?? true;

  // Plants where permeate IS a production source (permeate_is_production on
  // plant_meter_config; e.g. Mambaling runs 'both' mode — permeate + product
  // meter summed). Drives the permeate → locator default routings further down.
  const permeateIsProduction =
    (meterCfg as any)?.permeate_is_production === true || cfg?.permeate_is_production === true;

  // ── Product tank ──
  // The product tank sits on the product-water line between PERMEATE and BULK
  // METERS: it collects each train's permeate (plus any blending-well water)
  // and feeds the plant's product meters out to the locators. It is part of the
  // standard plant set-up, so it is always drawn.
  const productTankId = `producttank-${plantId}`;

  const solarCount = powerCfg?.solar_meter_count ?? 1;
  const gridCount  = powerCfg?.grid_meter_count  ?? 1;
  const solarNames: string[] = powerCfg?.solar_meter_names ?? Array.from({ length: solarCount }, (_: any, i: number) => `Solar Meter ${i + 1}`);
  const gridNames:  string[] = powerCfg?.grid_meter_names  ?? Array.from({ length: gridCount  }, (_: any, i: number) => `Grid Meter ${i + 1}`);

  // Per-train EM-meter resolution: which streams on this train use electromagnetic
  // magmeters instead of mechanical register meters. Drawn from the ro_trains EM
  // fields directly; the config-level `em_all_streams` acts as a blanket override
  // only for trains that have NO per-stream EM flags set at all.
  const trainEM = new Map<string, { feed: boolean; permeate: boolean; reject: boolean }>();
  roTrains.forEach((r: any) => {
    const hasAny = !!(r.em_stream_feed || r.em_stream_permeate || r.em_stream_reject);
    if (hasAny) {
      trainEM.set(r.id, {
        feed:    !!r.em_stream_feed,
        permeate:!!r.em_stream_permeate,
        reject:  !!r.em_stream_reject,
      });
    } else if (r.em_all_streams) {
      trainEM.set(r.id, { feed: true, permeate: true, reject: true });
    }
  });

  // ── Wells ──
  // Blending wells inject directly into the Product Water line (bypass RO).
  // They skip rawMeter + pretreat entirely, with a distinct bypass visual on the link.
  wells.forEach((w: any) => {
    nodes.push({ id: w.id, type: 'well', label: w.name, status: w.status });
    if ((w as any).is_blending_well) {
      // Blending well injects directly into the Product Water line (bypasses
      // RO) — into the plant's product tank. Node ids are the raw
      // product_meters / locators row ids, so the old `bulk-`/
      // `locator-<plant>-product-line` prefixes produced dangling links.
      fixedLinks.push({ from: w.id, to: productTankId, bypass: true });
      return;
    }
    const rmId = `rawmeter-${w.id}`;
    nodes.push({ id: rmId, type: 'rawMeter', label: `Raw ${w.name}` });
    fixedLinks.push({ from: w.id, to: rmId });
  });

  // ── Pre-treatment chain — one set per primary RO train ──
  // Each train has its own line: Raw Tank → Raw Water Pump → AFM/MMF →
  // Bag/Cartridge Filter → High Pressure Pump → (Feed Meter) → RO Train.
  // Equipment counts/labels come straight from the ro_trains row
  // (filter_media_type, filter_housing_type, num_* columns). Secondary
  // (2nd-pass) units are skipped — they're fed by upstream permeate.
  const trainChainEnd = new Map<string, string>(); // trainId → last chain node feeding the train
  roTrains.forEach((r: any) => {
    if (r.unit_type === 'secondary') return;
    const t = r.train_number;
    const mediaType   = (r.filter_media_type   ?? 'AFM') as string;
    const housingType = (r.filter_housing_type ?? 'Cartridge Filter') as string;
    const housingAbbr = housingType === 'Bag Filter' ? 'BF' : 'CF';
    const housingLbl  = housingType === 'Bag Filter' ? 'Bag Filter' : 'Cartridge';
    const em = trainEM.get(r.id) ?? { feed: false, permeate: false, reject: false };

    const tankId = `rawtank-${r.id}`;
    nodes.push({ id: tankId, type: 'rawTank', label: `Raw Tank T${t}` });
    const rwpId = `rwp-${r.id}`;
    nodes.push({
      id: rwpId, type: 'rawWaterPump', label: `Raw Water Pump T${t}`,
      detail: `RWP×${r.num_booster_pumps ?? 0}`,
    });
    fixedLinks.push({ from: tankId, to: rwpId });

    const mfId = `mf-${r.id}`;
    nodes.push({
      id: mfId, type: 'mediaFilter', label: `${mediaType.toUpperCase()} Filter T${t}`,
      detail: `${mediaType.toUpperCase()}×${r.num_afm ?? 0}`,
    });
    fixedLinks.push({ from: rwpId, to: mfId });

    const bcfId = `bcf-${r.id}`;
    nodes.push({
      id: bcfId, type: 'bagCartridge', label: `${housingLbl} T${t}`,
      detail: `${housingAbbr}×${r.num_cartridge_filters ?? 0}`,
    });
    fixedLinks.push({ from: mfId, to: bcfId });

    const hppId = `hpp-${r.id}`;
    nodes.push({
      id: hppId, type: 'hpPump', label: `HP Pump T${t}`,
      detail: `HPP×${r.num_hp_pumps ?? 0}`,
    });
    fixedLinks.push({ from: bcfId, to: hppId });

    let chainEnd = hppId;
    if (hasFeedMeter) {
      const fmId = `feedmeter-${r.id}`;
      nodes.push({
        id: fmId, type: 'feedMeter', label: `Feed Meter T${t}`,
        meterVariant: em.feed ? 'electromagnetic' : 'mechanical',
      });
      fixedLinks.push({ from: hppId, to: fmId });
      chainEnd = fmId;
    }
    trainChainEnd.set(r.id, chainEnd);
  });

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
    // Primary trains are fed by the tail of their own pre-treatment chain.
    // Secondary units are fed by an upstream train's permeate (an editable
    // link, seeded as a default below from feed_source_train_id), so they
    // skip the chain link entirely.
    if (!isSecondary) {
      const chainEnd = trainChainEnd.get(r.id);
      if (chainEnd) fixedLinks.push({ from: chainEnd, to: r.id });
    }
  });

  // ── Permeate / Reject — one per train ──
  roTrains.forEach((r: any) => {
    const em = trainEM.get(r.id) ?? { feed: false, permeate: false, reject: false };

    if (hasPermeate) {
      const pmId = `permeate-${r.id}`;
      nodes.push({
        id: pmId,
        type: 'permeate',
        label: `Perm. T${r.train_number}`,
        meterVariant: em.permeate ? 'electromagnetic' : 'mechanical',
      });
      fixedLinks.push({ from: r.id, to: pmId });
    }
    if (hasReject) {
      const rjId = `reject-${r.id}`;
      nodes.push({
        id: rjId,
        type: 'reject',
        label: `Reject T${r.train_number}`,
        meterVariant: em.reject ? 'electromagnetic' : 'mechanical',
      });
      fixedLinks.push({ from: r.id, to: rjId });
    }
  });

  // ── Product tank — plant product-water storage on the permeate line ──
  // Collects every primary train's permeate (or the train itself where no
  // permeate meter is configured) plus any blending-well water, and feeds the
  // plant's product meters. Always present as part of the standard set-up, so
  // the product line is never left dangling.
  nodes.push({
    id: productTankId,
    type: 'productTank',
    label: 'Product Tank',
    detail: `${roTrains.filter((r: any) => r.unit_type !== 'secondary').length} in`
      + (productMeters.length ? ` · ${productMeters.length} out` : ''),
  });
  roTrains.forEach((r: any) => {
    if (r.unit_type === 'secondary') return;
    fixedLinks.push({ from: hasPermeate ? `permeate-${r.id}` : r.id, to: productTankId });
  });
  // Product tank → each configured product meter; those meters then feed
  // their locators via the existing editable `product_meter_id` links.
  productMeters.forEach((m: any) => {
    fixedLinks.push({ from: productTankId, to: m.id });
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

  // Plants where permeate IS a production source (see permeateIsProduction
  // above) draw their locator supply directly off the permeate line as well as
  // via the product tank/meter, so seed permeate → locator defaults.
  if (permeateIsProduction && hasPermeate) {
    roTrains.forEach((r: any) => {
      if (r.unit_type === 'secondary') return;
      locators.forEach((l: any) => {
        defaultEditLinks.push({ from: `permeate-${r.id}`, to: l.id, editable: true });
      });
    });
  }

  // Raw meters feed each primary train's raw tank (which wells feed which
  // train's pre-treatment set is rewirable via Connect mode).
  roTrains.forEach((r: any) => {
    if (r.unit_type === 'secondary') return;
    wells.forEach((w: any) => {
      if ((w as any).is_blending_well) return;
      defaultEditLinks.push({ from: `rawmeter-${w.id}`, to: `rawtank-${r.id}`, editable: true });
    });
  });

  locators.forEach((l: any) => {
    if (l.product_meter_id)
      defaultEditLinks.push({ from: l.product_meter_id, to: l.id, editable: true });
  });

  // Product-tank outlets. Where the plant has product meters, the fixed
  // tank → meter → locator chain already covers distribution; with no product
  // meter configured the tank feeds the locators directly (rewirable in
  // Connect mode).
  if (productMeters.length === 0) {
    locators.forEach((l: any) => {
      defaultEditLinks.push({ from: productTankId, to: l.id, editable: true });
    });
  }

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

  // Sanitize saved links against the current node set — drops stale references
  // (e.g. the retired shared `pretreat-<plantId>` / `feedmeter-<plantId>`
  // nodes) so old saved topologies don't render dangling pipes. If nothing
  // survives, fall back to the fresh defaults.
  const knownIds = new Set(nodes.map((n) => n.id));
  const sanitizedSaved = savedLinks.filter(
    (s: any) => knownIds.has(s.from_id) && knownIds.has(s.to_id)
  );

  const editLinks: TopoLink[] = sanitizedSaved.length
    ? sanitizedSaved.map((s: any) => ({ from: s.from_id, to: s.to_id, editable: true }))
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
    'well', 'rawMeter', 'rawTank', 'rawWaterPump', 'mediaFilter', 'bagCartridge', 'hpPump',
    'pretreat', 'feedMeter', 'roTrain', 'permeate', 'reject', 'productTank', 'bulk', 'locator',
  ];

  // Per-train chain stages ride on their train's row so each train forms one
  // horizontal lane (chain node ids are `<stage>-<trainId>`).
  const chainTypes: NodeType[] = ['rawTank', 'rawWaterPump', 'mediaFilter', 'bagCartridge', 'hpPump'];
  const trainRowById = new Map<string, number>();
  (byType['roTrain'] ?? []).forEach((n, i) => trainRowById.set(n.id, i));

  waterTypes.forEach((t) => {
    (byType[t] ?? []).forEach((n, i) => {
      const x = colXMap[t] ?? 0;
      let y = START_Y + i * ROW_GAP;
      // Chain stages (and the per-train feed meter) align with their train's row
      const trainId = n.id.slice(n.id.indexOf('-') + 1);
      if ((chainTypes.includes(t) || t === 'feedMeter') && trainRowById.has(trainId))
        y = START_Y + (trainRowById.get(trainId) as number) * ROW_GAP;
      // The single plant-wide product tank centres vertically against the
      // train rows (same convention as the old shared pre-treat node), so it
      // reads as the common collector for every train's permeate.
      if (t === 'productTank')
        y = START_Y + Math.floor(Math.max(0, (byType['roTrain']?.length ?? 1) - 1) / 2) * ROW_GAP;
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

