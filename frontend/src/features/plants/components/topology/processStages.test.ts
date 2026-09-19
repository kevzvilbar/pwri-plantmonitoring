import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROCESS_STAGES,
  resolveStages,
  buildColSequence,
  buildColXMap,
  buildStageZones,
  buildTopology,
  layoutNodes,
  getStreamType,
  buildTrainDetail,
  COL_GAP,
  WRAP_COL_GAP,
  START_Y,
  ROW_GAP,
  type ProcessStage,
  type TopoNode,
} from './shared';

const PLANT = 'plant-1';

/** Minimal shape of what useTopologyData() returns. */
function makeData(over: Partial<Record<string, any>> = {}) {
  return {
    wells: [{ id: 'well-1', name: 'Well 1', status: 'Active' }],
    roTrains: [{
      id: 'train-1', train_number: 1, name: null, status: 'Running',
      num_afm: 1, num_booster_pumps: 0, num_hp_pumps: 1,
      num_cartridge_filters: 4, num_controllers: 0,
      filter_media_type: 'MMF', filter_housing_type: 'Bag Filter',
      unit_type: 'primary', feed_source_train_id: null, reject_routing: 'discharge',
    }],
    locators: [{ id: 'loc-1', name: 'Parkmall', status: 'Active', product_meter_id: 'meter-1' }],
    productMeters: [{ id: 'meter-1', name: 'Parkmall 6"', status: 'Active' }],
    powerCfg: null,
    meterCfg: null,
    processStages: null,
    productTanks: [],
    dosingPoints: [],
    savedLinks: [],
    ...over,
  } as any;
}

/** The P&ID line shape: MMF and a bag-filter bank ahead of the raw tank, a
 *  degasifier between them, a second bank on the tank discharge. */
const SAMPLE_STAGES: ProcessStage[] = [
  { key: 'well',        label: 'WELLS',             type: 'well',         scope: 'plant' },
  { key: 'rawMeter',    label: 'RAW METERS',        type: 'rawMeter',     scope: 'plant' },
  { key: 'mediaFilter', label: 'MMF',               type: 'mediaFilter',  scope: 'plant' },
  { key: 'bagFilterA',  label: 'BAG FILTERS A',     type: 'bagCartridge', scope: 'plant' },
  { key: 'degasifier',  label: 'DEGASIFIER',        type: 'degasifier',   scope: 'plant' },
  { key: 'rawTank',     label: 'RAW TANK',          type: 'rawTank',      scope: 'plant' },
  { key: 'bagFilterB',  label: 'BAG FILTERS B',     type: 'bagCartridge', scope: 'plant' },
  { key: 'hpPump',      label: 'HPP',               type: 'hpPump',       scope: 'train' },
  { key: 'feedMeter',   label: 'FEED',              type: 'feedMeter',    scope: 'train' },
  { key: 'roTrain',     label: 'RO ARRAY',          type: 'roTrain',      scope: 'train' },
  { key: 'permeate',    label: 'PERMEATE / REJECT', type: 'permeate',     scope: 'train' },
  { key: 'productTank', label: 'PRODUCT TANKS',     type: 'productTank',  scope: 'plant', wrapCols: 3 },
  { key: 'bulk',        label: 'BULK METERS',       type: 'bulk',         scope: 'plant' },
  { key: 'locator',     label: 'LOCATORS',          type: 'locator',      scope: 'plant' },
];

const linked = (links: { from: string; to: string }[], from: string, to: string) =>
  links.some((l) => l.from === from && l.to === to);

describe('resolveStages', () => {
  it('falls back to the legacy order when a plant has no template', () => {
    expect(resolveStages(null)).toBe(DEFAULT_PROCESS_STAGES);
    expect(resolveStages([])).toBe(DEFAULT_PROCESS_STAGES);
  });

  it('sorts rows by sort_order', () => {
    const stages = resolveStages([
      { stage_key: 'roTrain', label: 'RO', node_type: 'roTrain', scope: 'train', sort_order: 20 },
      { stage_key: 'well', label: 'WELLS', node_type: 'well', scope: 'plant', sort_order: 10 },
    ]);
    expect(stages.map((s) => s.key)).toEqual(['well', 'roTrain']);
  });

  it('rejects a template that never reaches the RO rather than stranding trains', () => {
    const stages = resolveStages([
      { stage_key: 'well', label: 'WELLS', node_type: 'well', scope: 'plant', sort_order: 10 },
    ]);
    expect(stages).toBe(DEFAULT_PROCESS_STAGES);
  });
});

describe('default template is unchanged (regression)', () => {
  it('keeps the legacy column order and x positions', () => {
    const seq = buildColSequence([]);
    expect(seq.map((s) => s.key)).toEqual([
      'well', 'rawMeter', 'rawTank', 'rawWaterPump', 'mediaFilter', 'bagCartridge',
      'hpPump', 'feedMeter', 'roTrain', 'permeate', 'productTank', 'bulk', 'locator',
    ]);
    const xMap = buildColXMap([]);
    expect(xMap.well).toBe(28);
    expect(xMap.rawMeter).toBe(28 + COL_GAP);
    expect(xMap.reject).toBe(xMap.permeate);
  });

  it('produces the same node ids it produced before templates existed', () => {
    const { nodes, fixedLinks } = buildTopology(PLANT, makeData(), []);
    const ids = nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([
      'well-1', 'rawmeter-well-1', `rawtank-${PLANT}`,
      'rwp-train-1', 'mf-train-1', 'bcf-train-1', 'hpp-train-1', 'feedmeter-train-1',
      'train-1', 'permeate-train-1', 'reject-train-1', `producttank-${PLANT}`,
      'meter-1', 'loc-1',
    ]));
    // …and the same chain order
    expect(linked(fixedLinks, 'rawmeter-well-1', `rawtank-${PLANT}`)).toBe(true);
    expect(linked(fixedLinks, `rawtank-${PLANT}`, 'rwp-train-1')).toBe(true);
    expect(linked(fixedLinks, 'feedmeter-train-1', 'train-1')).toBe(true);
  });
});

describe('sample template: MMF and bag bank ahead of the raw tank', () => {
  const data = makeData({
    processStages: SAMPLE_STAGES.map((s, i) => ({
      stage_key: s.key, label: s.label, node_type: s.type,
      scope: s.scope, sort_order: i * 10, wrap_cols: s.wrapCols ?? null, detail: null,
    })),
  });

  it('chains the intake in template order, not the legacy order', () => {
    const { fixedLinks } = buildTopology(PLANT, data, []);
    const mmf  = `stage-mediaFilter-${PLANT}`;
    const bagA = `stage-bagFilterA-${PLANT}`;
    const deg  = `stage-degasifier-${PLANT}`;
    const tank = `rawtank-${PLANT}`;
    const bagB = `stage-bagFilterB-${PLANT}`;

    expect(linked(fixedLinks, 'rawmeter-well-1', mmf)).toBe(true);
    expect(linked(fixedLinks, mmf, bagA)).toBe(true);
    expect(linked(fixedLinks, bagA, deg)).toBe(true);
    expect(linked(fixedLinks, deg, tank)).toBe(true);
    expect(linked(fixedLinks, tank, bagB)).toBe(true);
    expect(linked(fixedLinks, bagB, 'hpp-train-1')).toBe(true);
    // the raw meter must NOT go straight to the tank any more
    expect(linked(fixedLinks, 'rawmeter-well-1', tank)).toBe(false);
  });

  it('keeps two bag-filter banks as distinct nodes in distinct columns', () => {
    const { nodes } = buildTopology(PLANT, data, []);
    const banks = nodes.filter((n) => n.type === 'bagCartridge');
    expect(banks).toHaveLength(2);
    expect(new Set(banks.map((n) => n.stageKey))).toEqual(new Set(['bagFilterA', 'bagFilterB']));

    const xMap = buildColXMap([], {}, SAMPLE_STAGES);
    expect(xMap.bagFilterA).toBeLessThan(xMap.rawTank);
    expect(xMap.bagFilterB).toBeGreaterThan(xMap.rawTank);
  });

  it('bands the degasifier with pre-treatment and re-opens an intake zone', () => {
    const zones = buildStageZones(SAMPLE_STAGES);
    const pretreat = zones.find((z) => z.startCol === 'mediaFilter');
    // MMF, bank A and the degasifier are all pre-treatment, so the band runs
    // through to the degasifier before the raw tank re-opens the intake band.
    expect(pretreat?.endCol).toBe('degasifier');
    // the raw tank re-enters the intake band after the degasifier
    expect(zones.some((z) => z.startCol === 'rawTank')).toBe(true);
  });
});

describe('product tank bank', () => {
  const tanks = Array.from({ length: 6 }, (_, i) => ({
    id: `tank-${i + 1}`, name: `Product Tank ${i + 1}`,
    tank_number: i + 1, status: 'Active', capacity_m3: null, product_meter_id: null,
  }));
  const data = makeData({
    productTanks: tanks,
    processStages: SAMPLE_STAGES.map((s, i) => ({
      stage_key: s.key, label: s.label, node_type: s.type,
      scope: s.scope, sort_order: i * 10, wrap_cols: s.wrapCols ?? null, detail: null,
    })),
  });

  it('replaces the synthetic single tank with the configured bank', () => {
    const { nodes, fixedLinks } = buildTopology(PLANT, data, []);
    expect(nodes.filter((n) => n.type === 'productTank')).toHaveLength(6);
    expect(nodes.some((n) => n.id === `producttank-${PLANT}`)).toBe(false);
    // permeate feeds every tank on the common inlet header
    tanks.forEach((t) => expect(linked(fixedLinks, 'permeate-train-1', t.id)).toBe(true));
    // every tank discharges to the product meter; no meter left dangling
    tanks.forEach((t) => expect(linked(fixedLinks, t.id, 'meter-1')).toBe(true));
  });

  it('lays a wrapped stage out as a grid instead of one tall column', () => {
    const { nodes } = buildTopology(PLANT, data, []);
    const pos = layoutNodes(nodes, [], {}, {}, SAMPLE_STAGES);
    const xs = tanks.map((t) => pos.get(t.id)!.x);
    const ys = tanks.map((t) => pos.get(t.id)!.y);
    // 3 across, 2 down
    expect(new Set(xs).size).toBe(3);
    expect(new Set(ys).size).toBe(2);
    expect(xs[1] - xs[0]).toBe(WRAP_COL_GAP);
    expect(ys[3] - ys[0]).toBe(ROW_GAP);
  });

  it('reserves column width for the wrapped bank so the next lane clears it', () => {
    const xMap = buildColXMap([], {}, SAMPLE_STAGES);
    expect(xMap.bulk - xMap.productTank).toBe(3 * WRAP_COL_GAP);
  });
});

describe('chemical dosing points', () => {
  const data = makeData({
    dosingPoints: [
      { id: 'd1', chemical: 'Anti Scalant', label: 'Anti-Scalant Dosing Pump', injects_into_stage_key: 'hpPump', pump_hp: null, status: 'Active' },
      { id: 'd2', chemical: 'Chlorine', label: 'Chlorine Dosing Pump', injects_into_stage_key: 'bulk', pump_hp: null, status: 'Active' },
    ],
  });

  it('injects into the named stage on its own chemical stream', () => {
    const { nodes, fixedLinks } = buildTopology(PLANT, data, []);
    expect(linked(fixedLinks, 'dosing-d1', 'hpp-train-1')).toBe(true);
    expect(linked(fixedLinks, 'dosing-d2', 'meter-1')).toBe(true);
    expect(getStreamType({ from: 'dosing-d1', to: 'hpp-train-1' }, nodes)).toBe('chemical');
  });

  it('parks dosing risers below the water rows, clear of the lanes', () => {
    const { nodes } = buildTopology(PLANT, data, []);
    const pos = layoutNodes(nodes, [], {}, {});
    const dosingY = pos.get('dosing-d1')!.y;
    const trainY = pos.get('train-1')!.y;
    expect(dosingY).toBeGreaterThan(trainY);
    // and it sits under its injection point, not in a lane of its own
    expect(pos.get('dosing-d1')!.x).toBe(pos.get('hpp-train-1')!.x);
  });
});

describe('reject reused for tanker refilling', () => {
  const data = makeData({
    roTrains: [{ ...makeData().roTrains[0], reject_routing: 'reuse' }],
  });

  it('routes reject to the bay and keeps it on the reject stream', () => {
    const { nodes, fixedLinks } = buildTopology(PLANT, data, []);
    const bay = `refill-${PLANT}`;
    const pump = `transferpump-${PLANT}`;
    expect(linked(fixedLinks, 'reject-train-1', bay)).toBe(true);
    expect(linked(fixedLinks, bay, pump)).toBe(true);
    // never permeate green: this water left the plant but was never product
    expect(getStreamType({ from: bay, to: pump }, nodes)).toBe('reject');
  });

  it('is absent for a plant that discharges its reject', () => {
    const { nodes } = buildTopology(PLANT, makeData(), []);
    expect(nodes.some((n) => n.type === 'refillStation')).toBe(false);
  });
});

describe('buildTrainDetail', () => {
  it('leads with vessel geometry when the array is configured', () => {
    expect(buildTrainDetail({ num_vessels: 15, elements_per_vessel: 6, num_afm: 0, num_hp_pumps: 1 }))
      .toContain('15V×6E');
  });

  it('omits geometry entirely when unset, leaving legacy labels intact', () => {
    expect(buildTrainDetail({ num_afm: 2, num_hp_pumps: 1 })).not.toContain('V×');
  });
});
