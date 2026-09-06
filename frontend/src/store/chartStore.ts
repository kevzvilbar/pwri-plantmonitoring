import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format, subDays } from 'date-fns';

export type RangeKey = '7D' | '14D' | '30D' | '60D' | '90D' | 'CUSTOM' | 'MONTHLY';

export function isValidDateStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && !isNaN(new Date(`${v}T00:00:00`).getTime());
}

export const defaultChartFrom = () => format(subDays(new Date(), 7), 'yyyy-MM-dd');
export const defaultChartTo = () => format(new Date(), 'yyyy-MM-dd');

export interface ChartState {
  chartRange: RangeKey;
  chartFrom: string;
  chartTo: string;
  chartYear: number;
  chartMonth: string;
  setChartRange: (range: RangeKey) => void;
  setChartCustomDates: (from: string, to: string) => void;
  setChartMonthlyPeriod: (year: number, month: string) => void;
}

export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      chartRange: '7D',
      chartFrom: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
      chartTo: format(new Date(), 'yyyy-MM-dd'),
      chartYear: new Date().getFullYear(),
      chartMonth: 'YTD',
      setChartRange: (range) =>
        set((state) => {
          if (range === 'MONTHLY') {
            const year = state.chartYear || new Date().getFullYear();
            const month = state.chartMonth || 'YTD';
            let fromStr: string;
            let toStr: string;
            if (month === 'YTD') {
              fromStr = `${year}-01-01`;
              toStr = `${year}-12-31`;
            } else {
              const m = parseInt(month, 10);
              const mPad = String(m).padStart(2, '0');
              fromStr = `${year}-${mPad}-01`;
              const lastDay = new Date(year, m, 0).getDate();
              toStr = `${year}-${mPad}-${String(lastDay).padStart(2, '0')}`;
            }
            return {
              chartRange: 'MONTHLY',
              chartFrom: fromStr,
              chartTo: toStr,
            };
          }
          return { chartRange: range };
        }),
      setChartCustomDates: (from, to) =>
        set((state) => ({
          chartFrom: isValidDateStr(from) ? from : state.chartFrom,
          chartTo: isValidDateStr(to) ? to : state.chartTo,
        })),
      setChartMonthlyPeriod: (year, month) =>
        set(() => {
          let fromStr: string;
          let toStr: string;
          if (month === 'YTD') {
            fromStr = `${year}-01-01`;
            toStr = `${year}-12-31`;
          } else {
            const m = parseInt(month, 10);
            const mPad = String(m).padStart(2, '0');
            fromStr = `${year}-${mPad}-01`;
            const lastDay = new Date(year, m, 0).getDate();
            toStr = `${year}-${mPad}-${String(lastDay).padStart(2, '0')}`;
          }
          return {
            chartRange: 'MONTHLY',
            chartYear: year,
            chartMonth: month,
            chartFrom: fromStr,
            chartTo: toStr,
          };
        }),
    }),
    {
      name: 'pwri-chart-state',
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as Partial<ChartState>) };
        return {
          ...merged,
          chartFrom: isValidDateStr(merged.chartFrom) ? merged.chartFrom : defaultChartFrom(),
          chartTo: isValidDateStr(merged.chartTo) ? merged.chartTo : defaultChartTo(),
        };
      },
      partialize: (s) => ({
        chartRange: s.chartRange,
        chartFrom: s.chartFrom,
        chartTo: s.chartTo,
        chartYear: s.chartYear,
        chartMonth: s.chartMonth,
      }),
    }
  )
);
