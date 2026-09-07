import {
  C_RAWWATER, C_RECOVERY, C_BLEND_VOLUME, C_NRW, C_CONSUMPTION,
} from '@/lib/chartColors';
import type { WaterBalanceTotals, BridgeRow } from './types';

const fmtTotal = (v: number) => `${Math.round(v).toLocaleString()} m\u00b3`;
const fmtDelta = (v: number) =>
  `${v >= 0 ? '+' : '\u2212'}${Math.round(Math.abs(v)).toLocaleString()} m\u00b3`;

export function buildBridgeRows(totals: WaterBalanceTotals): BridgeRow[] {
  const treatmentLoss = totals.rawWater - totals.production;
  const distributionInput = totals.production + totals.blending;
  const nrwLoss = distributionInput - totals.locatorConsumption;

  const deltas: { label: string; amount: number; color: string }[] = [
    { label: 'Treatment loss', amount: -treatmentLoss, color: C_RECOVERY },
    { label: 'Blending', amount: totals.blending, color: C_BLEND_VOLUME },
    { label: 'Distribution / NRW', amount: -nrwLoss, color: C_NRW },
  ];

  const rows: BridgeRow[] = [{
    name: 'Raw water in',
    base: 0,
    height: totals.rawWater,
    fill: C_RAWWATER,
    deltaLabel: fmtTotal(totals.rawWater),
    kind: 'start',
  }];

  let cumulative = totals.rawWater;
  for (const d of deltas) {
    const next = cumulative + d.amount;
    rows.push({
      name: d.label,
      base: Math.min(cumulative, next),
      height: Math.abs(d.amount),
      fill: d.color,
      deltaLabel: fmtDelta(d.amount),
      kind: 'delta',
    });
    cumulative = next;
  }

  rows.push({
    name: 'Locator consumption',
    base: 0,
    height: cumulative,
    fill: C_CONSUMPTION,
    deltaLabel: fmtTotal(cumulative),
    kind: 'end',
  });

  return rows;
}
