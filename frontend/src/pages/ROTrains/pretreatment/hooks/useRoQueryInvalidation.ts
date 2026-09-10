import type { QueryClient } from '@tanstack/react-query';

export function invalidateAllRoQueries(qc: QueryClient) {
  const keys = [
    'ro-overview',
    'ro-last-all',
    'ro-spark',
    'ro-prev',
    'dash-ro-recent',
    'dash-ro-permeate-today',
    'dash-ro-permeate-yest',
    'dash-product-meters-today',
    'dash-product-meters-yest',
    'dash-power-today',
    'dash-power-yest',
    'dash-costs-today',
    'dash-summary-recent',
    'dash-chem',
    'alerts-feed',
    'trend-ro',
    'trend-ro-train-ids',
    'trend-product',
    'trend-power',
    'trend-cost',
    'dsm-ro-readings',
    'dsm-ro-trains',
  ];
  for (const key of keys) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  qc.invalidateQueries();
}

