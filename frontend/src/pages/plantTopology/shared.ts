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
  DegasifierSymbol,
  BagFilterBankSymbol,
  DosingPumpSymbol,
  RefillStationSymbol,
  TransferPumpSymbol,
} from '@/components/icons/topology-symbols';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'well' | 'rawMeter' | 'rawTank' | 'rawWaterPump' | 'mediaFilter'
  | 'bagCartridge' | 'hpPump' | 'pretreat' | 'feedMeter'
  | 'roTrain' | 'permeate' | 'reject' | 'productTank' | 'bulk' | 'locator'
  | 'degasifier' | 'dosingPump' | 'refillStation' | 'transferPump'
  | 'solarSource' | 'gridSource' | 'solarMeter' | 'gridMeter'
  | 'customNode';

export type StreamType = 'feed' | 'permeate' | 'reject' | 'chemical' | 'power' | 'general';

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

// ─── Process stage template ─────────────────────────────────────────────────
// A plant's process line is an ordered list of stages. `scope` decides whether
// a stage is one shared unit on the plant intake line ('plant') or replicated
// once per primary RO train ('train').
//
// Not every line has the same shape. A plant can sit its media filter and a
// first bag-filter bank UPSTREAM of the raw tank, run a degasifier between
// them, and carry a second bank on the tank discharge — none of which the old
// single hard-coded order could express. Templates live in
// `plant_process_stages`; a plant with no rows falls back to
// DEFAULT_PROCESS_STAGES, which reproduces the previous behaviour exactly.

export interface ProcessStage {
  key: string;
  label: string;
  type: NodeType;
  /** 'plant' = one shared unit; 'train' = one per primary RO train */
  scope: 'plant' | 'train';
  /** render this stage's nodes as a grid N wide instead of one per row */
  wrapCols?: number;
  /** equipment detail line for plant-scope stages */
  detail?: string;
}

/** The legacy order — every plant without a template keeps exactly this. */
export const DEFAULT_PROCESS_STAGES: ProcessStage[] = [
  { key: 'well',         label: 'WELLS',             type: 'well',         scope: 'plant' },
  { key: 'rawMeter',     label: 'RAW METERS',        type: 'rawMeter',     scope: 'plant' },
  { key: 'rawTank',      label: 'RAW TANK',          type: 'rawTank',      scope: 'plant' },
  { key: 'rawWaterPump', label: 'RAW PUMP',          type: 'rawWaterPump', scope: 'train' },
  { key: 'mediaFilter',  label: 'AFM / MMF',         type: 'mediaFilter',  scope: 'train' },
  { key: 'bagCartridge', label: 'BAG / CF',          type: 'bagCartridge', scope: 'train' },
  { key: 'hpPump',       label: 'HPP',               type: 'hpPump',       scope: 'train' },
  { key: 'feedMeter',    label: 'FEED',              type: 'feedMeter',    scope: 'train' },
  { key: 'roTrain',      label: 'RO TRAINS',         type: 'roTrain',      scope: 'train' },
  { key: 'permeate',     label: 'PERMEATE / REJECT', type: 'permeate',     scope: 'train' },
  { key: 'productTank',  label: 'PRODUCT TANK',      type: 'productTank',  scope: 'plant' },
  { key: 'bulk',         label: 'BULK METERS',       type: 'bulk',         scope: 'plant' },
  { key: 'locator',      label: 'LOCATORS',          type: 'locator',      scope: 'plant' },
];

/** Stage types that form the feed chain between the raw meters and the RO. */
export const CHAIN_STAGE_TYPES: NodeType[] = [
  'rawTank', 'rawWaterPump', 'mediaFilter', 'bagCartridge',
  'degasifier', 'pretreat', 'hpPump', 'feedMeter',
];

/** Rows from `plant_process_stages` → ProcessStage[], falling back to default. */
export function resolveStages(rows?: any[] | null): ProcessStage[] {
  if (!rows?.length) return DEFAULT_PROCESS_STAGES;
  const mapped = rows
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((r) => ({
      key:      r.stage_key as string,
      label:    r.label as string,
      type:     r.node_type as NodeType,
      scope:    (r.scope === 'plant' ? 'plant' : 'train') as 'plant' | 'train',
      wrapCols: r.wrap_cols ?? undefined,
      detail:   r.detail ?? undefined,
    }))
    .filter((s) => s.key && s.type);
  // A template that never reaches the RO would strand every train, so treat a
  // malformed template as "not configured" rather than rendering a broken line.
  return mapped.some((s) => s.type === 'roTrain') ? mapped : DEFAULT_PROCESS_STAGES;
}

// ─── Stage zone definitions for visual grouping ────────────────────────────────────
// Colored background bands grouping related process stages, P&ID style. Zones
// are derived from the active template so a reordered line still bands
// correctly; STAGE_ZONES is the default-template result.

export interface StageZone {
  id: string;
  label: string;
  startCol: string;
  endCol: string;
  color: string;
  yOffset: number;
}

/** Which zone each stage type belongs to — drives buildStageZones(). */
const ZONE_OF_TYPE: Partial<Record<NodeType, 'intake' | 'pretreat' | 'ro' | 'product'>> = {
  well: 'intake', rawMeter: 'intake', rawTank: 'intake',
  rawWaterPump: 'pretreat', mediaFilter: 'pretreat', bagCartridge: 'pretreat',
  degasifier: 'pretreat', pretreat: 'pretreat', hpPump: 'pretreat',
  feedMeter: 'pretreat', dosingPump: 'pretreat',
  roTrain: 'ro',
  permeate: 'product', reject: 'product', productTank: 'product',
  refillStation: 'product', transferPump: 'product', bulk: 'product', locator: 'product',
};

const ZONE_META = {
  intake:   { id: 'raw-water-intake', label: 'RAW WATER INTAKE',              color: 'hsl(var(--topo-well-lane))' },
  pretreat: { id: 'pretreatment',     label: 'PRE-TREATMENT',                 color: 'hsl(var(--topo-pretreat-lane))' },
  ro:       { id: 'ro-system',        label: 'RO SYSTEM',                     color: 'hsl(var(--topo-roTrain-lane))' },
  product:  { id: 'post-treatment',   label: 'PRODUCT WATER & DISTRIBUTION',  color: 'hsl(var(--topo-permeate-lane))' },
} as const;

/** Builds contiguous zone bands for a template. A stage type that moves to the
 *  other side of the line (e.g. a media filter ahead of the raw tank) moves its
 *  band with it instead of leaving a zone straddling unrelated columns. */
export function buildStageZones(stages: ProcessStage[] = DEFAULT_PROCESS_STAGES): StageZone[] {
  const zones: StageZone[] = [];
  const counts: Record<string, number> = {};
  let runKind: keyof typeof ZONE_META | null = null;
  let runStart = '';
  let runEnd = '';

  const flush = () => {
    if (!runKind) return;
    const meta = ZONE_META[runKind];
    const n = counts[runKind] ?? 0;
    counts[runKind] = n + 1;
    zones.push({
      id: `${meta.id}${n > 0 ? `-${n + 1}` : ''}`,
      label: n > 0 ? `${meta.label} ${n + 1}` : meta.label,
      startCol: runStart,
      endCol: runEnd,
      color: meta.color,
      yOffset: -6,
    });
  };

  stages.forEach((s) => {
    const kind = ZONE_OF_TYPE[s.type];
    if (!kind) return;
    if (kind !== runKind) {
      flush();
      runKind = kind;
      runStart = s.key;
    }
    runEnd = s.key;
  });
  flush();
  return zones;
}

export const STAGE_ZONES: StageZone[] = buildStageZones(DEFAULT_PROCESS_STAGES);

export interface ColSlot {
  key: string;
  label: string;
  type?: NodeType;       // set for base cols
  customCol?: CustomColumn; // set for custom cols
  isCustom: boolean;
}

/** Builds the full ordered column sequence, interleaving custom cols into the
 *  active template's stages. */
export function buildColSequence(
  customColumns: CustomColumn[],
  stages: ProcessStage[] = DEFAULT_PROCESS_STAGES,
): ColSlot[] {
  const result: ColSlot[] = [];
  for (const base of stages) {
    result.push({ key: base.key, label: base.label, type: base.type, isCustom: false });
    customColumns
      .filter((c) => c.insertAfter === base.key)
      .forEach((cc) =>
        result.push({ key: cc.id, label: cc.label, customCol: cc, isCustom: true })
      );
  }
  return result;
}

/**
 * Returns the stage zone that contains the given column key.
 * Used for rendering zone backgrounds and labels.
 */
export function getStageZoneForColumn(
  colKey: string,
  stages: ProcessStage[] = DEFAULT_PROCESS_STAGES,
): StageZone | undefined {
  const zones = stages === DEFAULT_PROCESS_STAGES ? STAGE_ZONES : buildStageZones(stages);
  return zones.find((zone) => {
    const startIdx = stages.findIndex((s) => s.key === zone.startCol);
    const endIdx = stages.findIndex((s) => s.key === zone.endCol);
    const colIdx = stages.findIndex((s) => s.key === colKey);
    if (startIdx === -1 || endIdx === -1 || colIdx === -1) return false;
    return colIdx >= startIdx && colIdx <= endIdx;
  });
}

/** Natural width of a column: wrapped stages (e.g. a bank of six product
 *  tanks drawn 3×2) need room for `wrapCols` symbols side by side. */
export function stageColWidth(stage?: ProcessStage): number {
  if (stage?.wrapCols && stage.wrapCols > 1) return stage.wrapCols * WRAP_COL_GAP;
  return COL_GAP;
}

/** Returns a map of column key → x position based on the ordered sequence + per-column widths. */
export function buildColXMap(
  customColumns: CustomColumn[],
  colWidths: Record<string, number> = {},
  stages: ProcessStage[] = DEFAULT_PROCESS_STAGES,
): Record<string, number> {
  const seq = buildColSequence(customColumns, stages);
  const stageByKey = new Map(stages.map((s) => [s.key, s]));
  const map: Record<string, number> = {};
  let cursor = 28;
  seq.forEach((slot) => {
    map[slot.key] = cursor;
    cursor += colWidths[slot.key] ?? stageColWidth(stageByKey.get(slot.key));
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
  /** process-stage key this node occupies — lets two stages share a NodeType
   *  (e.g. a bag-filter bank each side of the raw tank) without colliding */
  stageKey?: string;
  /** dosing pumps only: the stage key this pump injects into */
  attachStage?: string;
  /** picks an alternate symbol for the same NodeType (e.g. 'bank' renders a
   *  multi-housing bag-filter bank rather than one cartridge housing) */
  symbolVariant?: string;
  /** explicit stream override for nodes whose colour can't be inferred from
   *  their own type (a refilling bay fed off the reject line, say) */
  stream?: StreamType;
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
export const WRAP_COL_GAP = 96;  // horizontal gap inside a wrapped stage (tank banks)

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
  degasifier:  'DEGASIFIER',
  dosingPump:  'DOSING PUMP',
  refillStation: 'REFILLING',
  transferPump:  'TRANSFER PUMP',
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
  degasifier:  { bg: 'hsl(var(--topo-degasifier-bg))',  border: 'hsl(var(--topo-degasifier-border))',  text: 'hsl(var(--topo-degasifier-text))',  accent: 'hsl(var(--topo-degasifier-border))',  lane: 'hsl(var(--topo-degasifier-lane))' },
  dosingPump:  { bg: 'hsl(var(--topo-dosingPump-bg))',  border: 'hsl(var(--topo-dosingPump-border))',  text: 'hsl(var(--topo-dosingPump-text))',  accent: 'hsl(var(--topo-dosingPump-border))',  lane: 'hsl(var(--topo-dosingPump-lane))' },
  refillStation:{ bg: 'hsl(var(--topo-refillStation-bg))', border: 'hsl(var(--topo-refillStation-border))', text: 'hsl(var(--topo-refillStation-text))', accent: 'hsl(var(--topo-refillStation-border))', lane: 'hsl(var(--topo-refillStation-lane))' },
  transferPump:{ bg: 'hsl(var(--topo-transferPump-bg))', border: 'hsl(var(--topo-transferPump-border))', text: 'hsl(var(--topo-transferPump-text))', accent: 'hsl(var(--topo-transferPump-border))', lane: 'hsl(var(--topo-transferPump-lane))' },
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
  // Blending bypass: a blending well's raw meter injects straight into the
  // product-water line (product tank), skipping the raw tank / RO entirely.
  ['rawMeter',   'productTank'],
  ['bulk',       'locator'],
  ['well',       'roTrain'],
  ['roTrain',    'well'],
  // Which wells feed the shared raw tank (raw meter → raw tank).
  // By default every well feeds the single shared tank; kept connectable
  // so custom / rewired topologies can still attach to it in Connect mode.
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
  // A reject line reused for tanker refilling: reject → bay → transfer pump →
  // load-out meters. This water leaves the plant but was never permeate, so it
  // is kept on the reject stream (see getStreamType) and must not be counted
  // as production.
  ['reject',        'refillStation'],
  ['refillStation', 'transferPump'],
  ['transferPump',  'bulk'],
  ['transferPump',  'locator'],
  ['productTank',   'refillStation'],
  // Tank banks sitting on a common header can be cross-connected.
  ['productTank',   'productTank'],
  // Dosing pumps inject into the line rather than carrying flow, but the
  // injection point is rewirable.
  ['dosingPump',    'hpPump'],
  ['dosingPump',    'bagCartridge'],
  ['dosingPump',    'mediaFilter'],
  ['dosingPump',    'degasifier'],
  ['dosingPump',    'rawTank'],
  ['dosingPump',    'roTrain'],
  ['dosingPump',    'bulk'],
  ['dosingPump',    'productTank'],
  // Stages that can now sit either side of the raw tank.
  ['rawMeter',      'mediaFilter'],
  ['mediaFilter',   'bagCartridge'],
  ['bagCartridge',  'degasifier'],
  ['degasifier',    'rawTank'],
  ['rawTank',       'bagCartridge'],
  ['bagCartridge',  'hpPump'],
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
      return variant === 'bank' ? BagFilterBankSymbol : CartridgeFilterSymbol;
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
    case 'degasifier':
      return DegasifierSymbol;
    case 'dosingPump':
      return DosingPumpSymbol;
    case 'refillStation':
      return RefillStationSymbol;
    case 'transferPump':
      return TransferPumpSymbol;
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
    case 'degasifier':
      return { w: 48, h: 56 };
    case 'dosingPump':
      return { w: 48, h: 52 };
    case 'refillStation':
      return { w: 56, h: 48 };
    case 'transferPump':
      return { w: 56, h: 44 };
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

  // Chemical injection — a dosing pump adds reagent to a line, it does not
  // carry process water, so it never colours as feed or permeate.
  if (fromNode.type === 'dosingPump' || toNode.type === 'dosingPump') {
    return 'chemical';
  }

  // Explicit stream override — used by the reject-fed refilling bay and its
  // transfer pump, whose own types say nothing about which stream they sit on.
  if (fromNode.stream) return fromNode.stream;
  if (toNode.stream)   return toNode.stream;

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
  chemical:  'hsl(291 64% 52%)',   // magenta — dosing / injection lines
  power:     'hsl(45 95% 55%)',   // yellow/gold
  general:   'hsl(var(--muted-foreground))',
};

/** Stream type labels for legend */
export const STREAM_LABELS: Record<StreamType, string> = {
  feed:      'Feed / Raw Water',
  permeate:  'Permeate (Product)',
  reject:    'Reject / Concentrate',
  chemical:  'Chemical Dosing',
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

      const [wellsRes, roRes, locRes, prodRes, powerCfgRes, meterCfgRes,
             stagesRes, tanksRes, dosingRes] = await Promise.all([
        supabase.from('wells').select('id,name,status,has_power_meter,is_blending_well').eq('plant_id', plantId).order('name'),
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
        // Optional topology extensions — a plant with none of these rows keeps
        // the legacy line shape untouched (see resolveStages / buildTopology).
        // Wrapped so a project that hasn't run 20260916000001 yet still loads.
        (supabase.from('plant_process_stages' as any) as any)
          .select('stage_key,label,node_type,scope,sort_order,detail,wrap_cols')
          .eq('plant_id', plantId).order('sort_order')
          .then((r: any) => r, () => ({ data: null })),
        (supabase.from('product_tanks' as any) as any)
          .select('id,name,tank_number,status,capacity_m3,product_meter_id')
          .eq('plant_id', plantId).order('tank_number')
          .then((r: any) => r, () => ({ data: null })),
        (supabase.from('dosing_points' as any) as any)
          .select('id,chemical,label,injects_into_stage_key,pump_hp,status')
          .eq('plant_id', plantId)
          .then((r: any) => r, () => ({ data: null })),
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
        processStages: (stagesRes?.data ?? null) as any[] | null,
        productTanks:  (tanksRes?.data  ?? []) as any[],
        dosingPoints:  (dosingRes?.data ?? []) as any[],
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
  // A single-array unit is described by its vessel geometry ("15 vessels
  // 6 elements") rather than by filter counts. 0 = not configured, so existing
  // trains render exactly as before.
  if ((t.num_vessels ?? 0) > 0) {
    parts.push((t.elements_per_vessel ?? 0) > 0
      ? `${t.num_vessels}V×${t.elements_per_vessel}E`
      : `${t.num_vessels}V`);
  }
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
  const productTankRows = ((data as any).productTanks ?? []) as any[];
  const dosingRows      = ((data as any).dosingPoints ?? []) as any[];
  const stages          = resolveStages((data as any).processStages);

  const cfg = (meterCfg?.config ?? meterCfg ?? {}) as any;
  const hasSolar     = cfg?.has_solar ?? false;
  const hasGrid      = cfg?.has_grid  ?? true;
  const hasFeedMeter = cfg?.ro_has_feed_meter     ?? true;
  const hasPermeate  = cfg?.ro_has_permeate_meter ?? true;
  const hasReject    = cfg?.ro_has_reject_meter   ?? true;

  const permeateIsProduction =
    (meterCfg as any)?.permeate_is_production === true || cfg?.permeate_is_production === true;

  const productTankId = `producttank-${plantId}`;
  const rawTankId     = `rawtank-${plantId}`;

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

  const primaryTrains = roTrains.filter((r: any) => r.unit_type !== 'secondary');

  // ── Feed chain stages ──
  // Everything the template places between the raw meters and the RO. A stage
  // scoped 'plant' is one shared unit on the intake line; a stage scoped
  // 'train' is replicated per primary train, which is what every plant on the
  // default template gets.
  const roStageIdx       = stages.findIndex((s) => s.type === 'roTrain');
  const rawMeterStageIdx = stages.findIndex((s) => s.type === 'rawMeter');
  const chainStages = stages.filter((s, i) =>
    CHAIN_STAGE_TYPES.includes(s.type) &&
    (rawMeterStageIdx === -1 || i > rawMeterStageIdx) &&
    (roStageIdx === -1 || i < roStageIdx) &&
    (s.type !== 'feedMeter' || hasFeedMeter)
  );

  // Legacy node-id prefixes. Kept so saved plant_topology_links and position
  // overrides survive: a plant on the default template produces exactly the
  // same ids it produced before templates existed. A template that uses a type
  // twice (two bag-filter banks, say) falls back to the stage key instead.
  const LEGACY_PREFIX: Partial<Record<NodeType, string>> = {
    rawWaterPump: 'rwp', mediaFilter: 'mf', bagCartridge: 'bcf',
    hpPump: 'hpp', feedMeter: 'feedmeter', pretreat: 'pretreat',
  };
  const typeUses = new Map<NodeType, number>();
  stages.forEach((s) => typeUses.set(s.type, (typeUses.get(s.type) ?? 0) + 1));
  const stagePrefix = (stage: ProcessStage): string =>
    (typeUses.get(stage.type) === 1 && LEGACY_PREFIX[stage.type]) || stage.key;

  const plantStageNodeId = (stage: ProcessStage): string =>
    stage.type === 'rawTank' ? rawTankId : `stage-${stage.key}-${plantId}`;
  const trainStageNodeId = (stage: ProcessStage, trainId: string): string =>
    `${stagePrefix(stage)}-${trainId}`;

  /** Label + detail for a chain node, preserving the pre-template strings. */
  function chainNodeMeta(stage: ProcessStage, r?: any): Partial<TopoNode> {
    if (!r) {
      return {
        label: stage.label,
        detail: stage.detail,
        symbolVariant: stage.type === 'bagCartridge' ? 'bank' : undefined,
      };
    }
    const t = r.train_number;
    const mediaType   = (r.filter_media_type   ?? 'AFM') as string;
    const housingType = (r.filter_housing_type ?? 'Cartridge Filter') as string;
    const housingAbbr = housingType === 'Bag Filter' ? 'BF' : 'CF';
    const housingLbl  = housingType === 'Bag Filter' ? 'Bag Filter' : 'Cartridge';
    const em = trainEM.get(r.id) ?? { feed: false, permeate: false, reject: false };
    switch (stage.type) {
      case 'rawWaterPump':
        return { label: `Raw Water Pump T${t}`, detail: `RWP×${r.num_booster_pumps ?? 0}` };
      case 'mediaFilter':
        return { label: `${mediaType.toUpperCase()} Filter T${t}`, detail: `${mediaType.toUpperCase()}×${r.num_afm ?? 0}` };
      case 'bagCartridge':
        return {
          label: `${housingLbl} T${t}`,
          detail: `${housingAbbr}×${r.num_cartridge_filters ?? 0}`,
          symbolVariant: (r.num_cartridge_filters ?? 0) > 1 ? 'bank' : undefined,
        };
      case 'hpPump':
        return { label: `HP Pump T${t}`, detail: `HPP×${r.num_hp_pumps ?? 0}` };
      case 'feedMeter':
        return { label: `Feed Meter T${t}`, meterVariant: em.feed ? 'electromagnetic' : 'mechanical' };
      case 'rawTank':
        return { label: `Raw Tank T${t}` };
      default:
        return { label: `${stage.label} T${t}` };
    }
  }

  // ── Plant-scope chain ──
  const plantChainIds: string[] = [];
  const plantStageIdByKey = new Map<string, string>();
  chainStages.filter((s) => s.scope === 'plant').forEach((stage) => {
    const id = plantStageNodeId(stage);
    const meta = chainNodeMeta(stage);
    nodes.push({
      id,
      type: stage.type,
      stageKey: stage.key,
      label: stage.type === 'rawTank' ? 'Raw Tank' : (meta.label ?? stage.label),
      detail: stage.type === 'rawTank'
        ? `${primaryTrains.length} outlets`
        : meta.detail,
      symbolVariant: meta.symbolVariant,
    });
    const prev = plantChainIds[plantChainIds.length - 1];
    if (prev) fixedLinks.push({ from: prev, to: id });
    plantChainIds.push(id);
    plantStageIdByKey.set(stage.key, id);
  });
  const plantChainStart = plantChainIds[0] ?? null;
  const plantChainEnd   = plantChainIds[plantChainIds.length - 1] ?? null;

  // ── Wells ──
  // Blending wells keep their raw meter (blending volumes are meter deltas)
  // but that meter discharges straight into the product line — a metered
  // bypass from the raw side, skipping the intake chain and the RO.
  wells.forEach((w: any) => {
    nodes.push({ id: w.id, type: 'well', stageKey: 'well', label: w.name, status: w.status });
    const rmId = `rawmeter-${w.id}`;
    nodes.push({ id: rmId, type: 'rawMeter', stageKey: 'rawMeter', label: `Raw ${w.name}` });
    fixedLinks.push({ from: w.id, to: rmId });
    if ((w as any).is_blending_well) {
      fixedLinks.push({ from: rmId, to: productTankId, bypass: true });
      return;
    }
    // Every well discharges into the head of the shared intake chain (the raw
    // tank on the default template; whatever the template puts first otherwise).
    if (plantChainStart) fixedLinks.push({ from: rmId, to: plantChainStart });
  });

  // ── Train-scope chain, one set per primary RO train ──
  const trainChainEnd = new Map<string, string>();
  const trainStageIdsByKey = new Map<string, string[]>();
  primaryTrains.forEach((r: any) => {
    let prev: string | null = plantChainEnd;
    chainStages.filter((s) => s.scope === 'train').forEach((stage) => {
      const id = trainStageNodeId(stage, r.id);
      const meta = chainNodeMeta(stage, r);
      nodes.push({
        id,
        type: stage.type,
        stageKey: stage.key,
        label: meta.label ?? stage.label,
        detail: meta.detail,
        meterVariant: meta.meterVariant,
        symbolVariant: meta.symbolVariant,
      });
      if (prev) fixedLinks.push({ from: prev, to: id });
      prev = id;
      const list = trainStageIdsByKey.get(stage.key) ?? [];
      list.push(id);
      trainStageIdsByKey.set(stage.key, list);
    });
    if (prev) trainChainEnd.set(r.id, prev);
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
      stageKey: 'roTrain',
      label: trainLabel,
      status: r.status,
      group: r.shared_power_meter_group ?? undefined,
      detail,
    });
    // Primary trains are fed by the tail of their own chain (or straight off
    // the shared intake chain when the template has no train-scoped stages).
    // Secondary units are fed by an upstream train's permeate via an editable
    // link seeded below from feed_source_train_id.
    if (!isSecondary) {
      const chainEnd = trainChainEnd.get(r.id) ?? plantChainEnd;
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
        stageKey: 'permeate',
        label: `Perm. T${r.train_number}`,
        detail: r.permeate_meter_size ? `${r.permeate_meter_size}` : undefined,
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
        detail: r.reject_meter_size ? `${r.reject_meter_size}` : undefined,
        meterVariant: em.reject ? 'electromagnetic' : 'mechanical',
      });
      fixedLinks.push({ from: r.id, to: rjId });
    }
  });

  // ── Product tanks ──
  // A configured bank of tanks replaces the synthetic single tank. Every
  // primary train's permeate discharges into the bank (common inlet header, as
  // drawn); on the outlet side a tank goes to its own product meter where one
  // is assigned, otherwise to the first meter — and any meter left unfed is
  // picked up by the last tank so no meter dangles.
  const tankIds: string[] = [];
  if (productTankRows.length) {
    productTankRows.forEach((t: any) => {
      nodes.push({
        id: t.id,
        type: 'productTank',
        stageKey: 'productTank',
        label: t.name,
        status: t.status,
        detail: t.capacity_m3 ? `${t.capacity_m3} m³` : undefined,
      });
      tankIds.push(t.id);
    });
  } else {
    nodes.push({
      id: productTankId,
      type: 'productTank',
      stageKey: 'productTank',
      label: 'Product Tank',
      detail: `${primaryTrains.length} in`
        + (productMeters.length ? ` · ${productMeters.length} out` : ''),
    });
    tankIds.push(productTankId);
  }

  primaryTrains.forEach((r: any) => {
    const src = hasPermeate ? `permeate-${r.id}` : r.id;
    tankIds.forEach((tid) => fixedLinks.push({ from: src, to: tid }));
  });

  // ── Bulk meters (product_meters from DB — exactly as configured in Plants) ──
  productMeters.forEach((m: any) => {
    nodes.push({ id: m.id, type: 'bulk', stageKey: 'bulk', label: m.name, status: m.status });
  });

  if (productMeters.length) {
    const fedMeters = new Set<string>();
    if (productTankRows.length) {
      productTankRows.forEach((t: any) => {
        const target = t.product_meter_id && productMeters.some((m: any) => m.id === t.product_meter_id)
          ? t.product_meter_id
          : productMeters[0].id;
        fixedLinks.push({ from: t.id, to: target });
        fedMeters.add(target);
      });
      const lastTank = tankIds[tankIds.length - 1];
      productMeters
        .filter((m: any) => !fedMeters.has(m.id))
        .forEach((m: any) => fixedLinks.push({ from: lastTank, to: m.id }));
    } else {
      productMeters.forEach((m: any) => fixedLinks.push({ from: productTankId, to: m.id }));
    }
  }

  // ── Locators (exactly as configured in Plants) ──
  locators.forEach((l: any) => {
    nodes.push({ id: l.id, type: 'locator', stageKey: 'locator', label: l.name, status: l.status ?? 'Active' });
  });

  // ── Reject reuse: tanker refilling bay ──
  // A train with reject_routing = 'reuse' sends its concentrate to a refilling
  // bay rather than to drain. That water leaves the plant but was never
  // permeate, so the bay and its transfer pump carry an explicit `reject`
  // stream and must never be counted as production.
  const reuseTrains = roTrains.filter((r: any) => r.reject_routing === 'reuse');
  if (reuseTrains.length && hasReject) {
    const bayId  = `refill-${plantId}`;
    const pumpId = `transferpump-${plantId}`;
    nodes.push({
      id: bayId, type: 'refillStation', stageKey: 'refillStation',
      label: 'R.O. Refilling', stream: 'reject',
      detail: `${reuseTrains.length} reject in`,
    });
    nodes.push({
      id: pumpId, type: 'transferPump', stageKey: 'refillStation',
      label: 'Transfer Pump', stream: 'reject',
    });
    reuseTrains.forEach((r: any) => fixedLinks.push({ from: `reject-${r.id}`, to: bayId }));
    fixedLinks.push({ from: bayId, to: pumpId });
  }

  // ── Chemical dosing points ──
  // A dosing pump injects into a stage rather than carrying process flow. The
  // link is drawn on its own `chemical` stream so it never reads as water.
  dosingRows.forEach((d: any) => {
    const stageKey = d.injects_into_stage_key as string;
    const id = `dosing-${d.id}`;
    nodes.push({
      id,
      type: 'dosingPump',
      stageKey: 'dosingPump',
      attachStage: stageKey,
      label: d.label ?? `${d.chemical} Dosing`,
      status: d.status,
      detail: d.pump_hp ? `${d.chemical} · ${d.pump_hp} HP` : d.chemical,
    });

    const targets: string[] = [];
    if (plantStageIdByKey.has(stageKey)) targets.push(plantStageIdByKey.get(stageKey)!);
    else if (trainStageIdsByKey.has(stageKey)) targets.push(...trainStageIdsByKey.get(stageKey)!);
    else if (stageKey === 'roTrain') targets.push(...primaryTrains.map((r: any) => r.id));
    else if (stageKey === 'bulk') targets.push(...productMeters.map((m: any) => m.id));
    else if (stageKey === 'productTank') targets.push(...tankIds);
    targets.forEach((t) => fixedLinks.push({ from: id, to: t }));
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
    primaryTrains.forEach((r: any) => {
      locators.forEach((l: any) => {
        defaultEditLinks.push({ from: `permeate-${r.id}`, to: l.id, editable: true });
      });
    });
  }

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
      tankIds.forEach((tid) => defaultEditLinks.push({ from: tid, to: l.id, editable: true }));
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
  // (e.g. retired shared pretreat/feedmeter nodes, per-train raw tanks, or a
  // stage removed from the plant's template) so old saved topologies don't
  // render dangling pipes. If nothing survives, fall back to fresh defaults.
  const knownIds = new Set(nodes.map((n) => n.id));
  // A saved link duplicating a fixedLink pair would render the pipe twice.
  const fixedPairs = new Set(fixedLinks.map((l) => `${l.from}→${l.to}`));
  const sanitizedSaved = savedLinks.filter(
    (s: any) => {
      if (!knownIds.has(s.from_id) || !knownIds.has(s.to_id)) return false;
      if (fixedPairs.has(`${s.from_id}→${s.to_id}`)) return false;
      return true;
    }
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
  stages: ProcessStage[] = DEFAULT_PROCESS_STAGES,
): Map<string, { x: number; y: number; zone: Zone }> {
  const colXMap = buildColXMap(customColumns, colWidths, stages);
  const positions = new Map<string, { x: number; y: number; zone: Zone }>();
  const stageByKey = new Map(stages.map((s) => [s.key, s]));

  const POWER_TYPES: NodeType[] = ['solarSource', 'gridSource', 'solarMeter', 'gridMeter'];

  // Which column a node sits in. An explicit stageKey wins so two stages can
  // share a NodeType (a bag-filter bank each side of the raw tank); otherwise
  // fall back to the type, which is what every pre-template node used.
  const colKeyOf = (n: TopoNode): string => n.colId ?? n.stageKey ?? n.type;

  const waterNodes = nodes.filter(
    (n) => !POWER_TYPES.includes(n.type) && n.type !== 'dosingPump' && !n.colId
  );

  const byCol: Record<string, TopoNode[]> = {};
  waterNodes.forEach((n) => {
    const k = colKeyOf(n);
    (byCol[k] = byCol[k] ?? []).push(n);
  });

  // Per-train chain stages ride on their train's row so each train forms one
  // horizontal lane (ids are `<prefix>-<trainId>`).
  const chainTypes: NodeType[] = ['rawWaterPump', 'mediaFilter', 'bagCartridge', 'hpPump', 'degasifier', 'pretreat'];
  const trainRowById = new Map<string, number>();
  (byCol['roTrain'] ?? []).forEach((n, i) => trainRowById.set(n.id, i));

  const trainCount = Math.max(1, byCol['roTrain']?.length ?? 1);
  const permeateCount = byCol['permeate']?.length ?? 0;

  Object.entries(byCol).forEach(([colKey, list]) => {
    const stage = stageByKey.get(colKey);
    const x = colXMap[colKey] ?? 0;
    const wrap = stage?.wrapCols && stage.wrapCols > 1 ? stage.wrapCols : 0;

    list.forEach((n, i) => {
      let nx = x;
      let y = START_Y + i * ROW_GAP;

      if (wrap) {
        // Tank banks and similar render as a grid rather than one tall column.
        nx = x + (i % wrap) * WRAP_COL_GAP;
        y  = START_Y + Math.floor(i / wrap) * ROW_GAP;
      } else if (chainTypes.includes(n.type) || n.type === 'feedMeter') {
        const trainId = n.id.slice(n.id.indexOf('-') + 1);
        if (trainRowById.has(trainId)) y = START_Y + (trainRowById.get(trainId) as number) * ROW_GAP;
      }

      // A single shared unit on the intake or product line (raw tank, product
      // tank, degasifier…) centres against the train rows so it reads as the
      // common collector/supply for every train.
      if (!wrap && list.length === 1 && stage?.scope === 'plant' &&
          (CHAIN_STAGE_TYPES.includes(n.type) || n.type === 'productTank')) {
        y = START_Y + Math.floor(Math.max(0, trainCount - 1) / 2) * ROW_GAP;
      }

      // Reject rows start below permeate rows (they share the permeate column).
      if (colKey === 'reject') y = START_Y + (permeateCount + i) * ROW_GAP;

      positions.set(n.id, { x: nx, y, zone: 'water' });
    });
  });

  const wrappedRows = (colKey: string) => {
    const stage = stageByKey.get(colKey);
    const n = byCol[colKey]?.length ?? 0;
    if (stage?.wrapCols && stage.wrapCols > 1) return Math.ceil(n / stage.wrapCols);
    return n;
  };

  let waterRows = 0;
  Object.keys(byCol).forEach((k) => {
    const rows = k === 'reject'
      ? permeateCount + (byCol['reject']?.length ?? 0)
      : wrappedRows(k);
    waterRows = Math.max(waterRows, rows);
  });
  waterRows = Math.max(waterRows, 1);

  // ── Dosing risers ──
  // A dosing pump injects into a stage rather than occupying a lane, so it
  // sits under its injection point on a band of its own.
  const dosingNodes = nodes.filter((n) => n.type === 'dosingPump' && !n.colId);
  if (dosingNodes.length) {
    const dosingY = START_Y + waterRows * ROW_GAP;
    const perColumn: Record<string, number> = {};
    dosingNodes.forEach((n) => {
      const key = n.attachStage ?? 'hpPump';
      const x = colXMap[key] ?? colXMap[colKeyOf(n)] ?? 0;
      const slot = perColumn[key] ?? 0;
      perColumn[key] = slot + 1;
      positions.set(n.id, { x, y: dosingY + slot * ROW_GAP, zone: 'water' });
    });
    waterRows += Math.max(...Object.values(perColumn));
  }

  const POWER_OFFSET_Y = START_Y + waterRows * ROW_GAP + 80;

  // Solar source + meters
  const byType: Record<string, TopoNode[]> = {};
  nodes.forEach((n) => { (byType[n.type] = byType[n.type] ?? []).push(n); });

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

