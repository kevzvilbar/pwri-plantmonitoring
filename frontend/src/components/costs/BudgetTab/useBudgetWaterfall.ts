import { useMemo } from 'react';
import type { MonthlyOpex } from '@/hooks/useOpexBudget';
import { fmtNum } from '@/lib/calculations';

export type WaterfallItem = {
  name: string;
  base: number;
  height: number;
  fill: string;
  deltaLabel: string;
  rawAmount: number;
  budget: number;
  actual: number;
  kind: 'start' | 'delta' | 'end' | 'variance';
};

type Totals = {
  budget: number;
  actual: number;
  powerBudget: number;
  powerActual: number;
  chemBudget: number;
  chemActual: number;
  solar: number;
  hasBudget: boolean;
};

export function useBudgetWaterfall({
  rows,
  metric,
  waterfallMode,
  selectedMonth,
  activeMonths,
  totals,
}: {
  rows: MonthlyOpex[] | undefined;
  metric: 'total' | 'power' | 'chem';
  waterfallMode: 'cost-breakdown' | 'monthly-steps';
  selectedMonth: string;
  activeMonths: MonthlyOpex[];
  totals: Totals;
}): WaterfallItem[] {
  return useMemo(() => {
    if (!rows || rows.length === 0) return [];

    if (waterfallMode === 'cost-breakdown') {
      let b = 0;
      let p = 0;
      let c = 0;
      let o = 0;
      let a = 0;
      const titlePrefix = selectedMonth === 'YTD' ? 'YTD' : rows.find((r) => r.month === selectedMonth)?.label.split(' ')[0] ?? '';

      if (selectedMonth === 'YTD') {
        b = activeMonths.reduce((sum, r) => sum + (metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget), 0);
        p = activeMonths.reduce((sum, r) => sum + r.powerActual, 0);
        c = activeMonths.reduce((sum, r) => sum + r.chemActual, 0);
        o = activeMonths.reduce((sum, r) => sum + r.otherActual, 0);
        a = metric === 'power' ? p : metric === 'chem' ? c : p + c + o;
      } else {
        const target = rows.find((r) => r.month === selectedMonth);
        if (target) {
          b = metric === 'power' ? target.powerBudget : metric === 'chem' ? target.chemBudget : target.totalBudget;
          p = target.powerActual;
          c = target.chemActual;
          o = target.otherActual;
          a = metric === 'power' ? p : metric === 'chem' ? c : target.totalActual;
        }
      }

      const variance = a - b;
      const items: WaterfallItem[] = [];

      items.push({
        name: `${titlePrefix} Budget`,
        base: 0,
        height: b,
        fill: '#00b4d8',
        deltaLabel: `₱${fmtNum(b, 0)}`,
        rawAmount: b,
        budget: b,
        actual: 0,
        kind: 'start',
      });

      if (metric === 'total') {
        items.push({
          name: 'Power Cost',
          base: 0,
          height: p,
          fill: '#f59e0b',
          deltaLabel: `+₱${fmtNum(p, 0)}`,
          rawAmount: p,
          budget: selectedMonth === 'YTD' ? totals.powerBudget : (rows.find((r) => r.month === selectedMonth)?.powerBudget ?? 0),
          actual: p,
          kind: 'delta',
        });

        items.push({
          name: 'Chemical Cost',
          base: p,
          height: c,
          fill: '#8b5cf6',
          deltaLabel: `+₱${fmtNum(c, 0)}`,
          rawAmount: c,
          budget: selectedMonth === 'YTD' ? totals.chemBudget : (rows.find((r) => r.month === selectedMonth)?.chemBudget ?? 0),
          actual: c,
          kind: 'delta',
        });

        if (o > 0 || selectedMonth === 'YTD') {
          items.push({
            name: 'Other Cost',
            base: p + c,
            height: Math.max(o, 1),
            fill: '#06b6d4',
            deltaLabel: o > 0 ? `+₱${fmtNum(o, 0)}` : '₱0',
            rawAmount: o,
            budget: 0,
            actual: o,
            kind: 'delta',
          });
        }
      }

      items.push({
        name: `${titlePrefix} Actual`,
        base: 0,
        height: a,
        fill: '#3b82f6',
        deltaLabel: `₱${fmtNum(a, 0)}`,
        rawAmount: a,
        budget: b,
        actual: a,
        kind: 'end',
      });

      if (b > 0) {
        items.push({
          name: 'Variance',
          base: variance > 0 ? b : a,
          height: Math.max(Math.abs(variance), 1),
          fill: variance > 0 ? '#ef4444' : '#10b981',
          deltaLabel: `${variance >= 0 ? '+' : '−'}₱${fmtNum(Math.abs(variance), 0)}`,
          rawAmount: variance,
          budget: b,
          actual: a,
          kind: 'variance',
        });
      } else {
        items.push({
          name: 'Variance',
          base: 0,
          height: a,
          fill: '#ef4444',
          deltaLabel: 'Unbudgeted',
          rawAmount: a,
          budget: 0,
          actual: a,
          kind: 'variance',
        });
      }

      return items;
    }

    const totalB = activeMonths.reduce((sum, r) => sum + (metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget), 0);
    const totalA = activeMonths.reduce((sum, r) => sum + (metric === 'power' ? r.powerActual : metric === 'chem' ? r.chemActual : r.totalActual), 0);

    const items: WaterfallItem[] = [];
    items.push({
      name: 'Budget YTD',
      base: 0,
      height: totalB,
      fill: '#00b4d8',
      deltaLabel: `₱${fmtNum(totalB, 0)}`,
      rawAmount: totalB,
      budget: totalB,
      actual: 0,
      kind: 'start',
    });

    let current = totalB;
    for (const r of activeMonths) {
      const monthName = r.label.split(' ')[0];
      const b = metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget;
      const a = metric === 'power' ? r.powerActual : metric === 'chem' ? r.chemActual : r.totalActual;
      const diff = a - b;
      const next = current + diff;

      items.push({
        name: monthName,
        base: Math.min(current, next),
        height: Math.max(Math.abs(diff), 1),
        fill: diff > 0 ? '#f59e0b' : diff < 0 ? '#10b981' : 'hsl(var(--muted-foreground))',
        deltaLabel: diff === 0 ? '₱0' : `${diff > 0 ? '+' : '−'}₱${fmtNum(Math.abs(diff), 0)}`,
        rawAmount: diff,
        budget: b,
        actual: a,
        kind: 'delta',
      });
      current = next;
    }

    items.push({
      name: 'Actual YTD',
      base: 0,
      height: totalA,
      fill: '#3b82f6',
      deltaLabel: `₱${fmtNum(totalA, 0)}`,
      rawAmount: totalA,
      budget: totalB,
      actual: totalA,
      kind: 'end',
    });

    return items;
  }, [rows, metric, waterfallMode, selectedMonth, activeMonths, totals]);
}
