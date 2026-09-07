import { useMemo } from 'react';
import { DOSING_KEYS } from '../../../ro-trains/constants';

export function useDosingHistoryTotals(logs: any[] | undefined, prices: Record<string, number> | undefined) {
  return useMemo(() => {
    if (!logs?.length) return null;
    return logs.reduce((acc: any, r: any) => {
      const storedCost = +r.calculated_cost || 0;
      const liveCost   = DOSING_KEYS.reduce(
        (s: any, c: any) => s + (+r[c.key] || 0) * (prices?.[c.name] ?? 0), 0,
      );
      return {
        chlorine_kg:    acc.chlorine_kg    + (+r.chlorine_kg    || 0),
        smbs_kg:        acc.smbs_kg        + (+r.smbs_kg        || 0),
        anti_scalant_l: acc.anti_scalant_l + (+r.anti_scalant_l || 0),
        soda_ash_kg:    acc.soda_ash_kg    + (+r.soda_ash_kg    || 0),
        cost:           acc.cost           + (storedCost > 0 ? storedCost : liveCost),
      };
    }, { chlorine_kg: 0, smbs_kg: 0, anti_scalant_l: 0, soda_ash_kg: 0, cost: 0 });
  }, [logs, prices]);
}
