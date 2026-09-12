export interface OverviewChartRowForStats {
  production?: number | null;
  consumption?: number | null;
  rawwater?: number | null;
  solarKwh?: number | null;
  kwh?: number | null;
  totalCost?: number | null;
  powerCost?: number | null;
  chemCost?: number | null;
  recovery?: number | null;
  tds?: number | null;
  date?: string;
  [key: string]: unknown;
}

export interface PlantHealthDayEntry {
  trainOnline: Record<string, boolean>;
  trainHours: Record<string, number>;
  onlineCount: number;
  offlineCount: number;
  healthPct: number | null;
  totalTrains: number;
}

export interface PlantHealthTrainReliability {
  id: string;
  label: string;
  uptimePct: number;
}

export interface PlantHealthStatsResult {
  avgHealthPct: number | null;
  avgOnlineCount: number | null;
  totalTrains: number;
  totalDays: number;
  fullyOnlineDays: number;
  mostReliableTrain: PlantHealthTrainReliability | null;
  leastReliableTrain: PlantHealthTrainReliability | null;
}

export interface SummaryStatsResult {
  totalProd: number;
  totalCons: number;
  totalRaw: number;
  avgDailyProd: number;
  avgDailyCons: number;
  avgDailyRaw: number;
  peakProd: number;
  peakDate: string;
  peakRaw: number;
  nrwPct: number;
  totalSolar: number;
  totalGrid: number;
  totalKwh: number;
  solarPct: number;
  gridPvRatio: number | null;
  totalPvRatio: number | null;
  avgProdCost: number | null;
  avgPowerCost: number | null;
  avgChemCost: number | null;
  totalCostOutput: number;
  avgRecovery: number | null;
  minRecovery: number | null;
  maxRecovery: number | null;
  recoveryDays: number;
  avgTds: number | null;
  minTds: number | null;
  maxTds: number | null;
  tdsDays: number;
}

/**
 * Computes rollups and metrics for the Data Summary modal / popup tabs.
 */
export function calculateDataSummaryStats(
  overviewChartRows: OverviewChartRowForStats[],
  tabDates: string[],
): SummaryStatsResult {
  const totalProd = overviewChartRows.reduce((s, r) => s + (r.production ?? 0), 0);
  const totalCons = overviewChartRows.reduce((s, r) => s + (r.consumption ?? 0), 0);
  const totalRaw = overviewChartRows.reduce((s, r) => s + (r.rawwater ?? 0), 0);
  const daysCount = Math.max(1, tabDates.length);
  const avgDailyProd = totalProd / daysCount;
  const avgDailyCons = totalCons / daysCount;
  const avgDailyRaw = totalRaw / daysCount;
  const peakRow = overviewChartRows.reduce(
    (max, r) => ((r.production ?? 0) > (max?.production ?? 0) ? r : max),
    null as OverviewChartRowForStats | null,
  );
  const peakRaw = overviewChartRows.reduce(
    (max, r) => ((r.rawwater ?? 0) > max ? (r.rawwater ?? 0) : max),
    0,
  );
  const nrwPct = totalProd > 0 ? Math.max(0, ((totalProd - totalCons) / totalProd) * 100) : 0;

  const totalSolar = overviewChartRows.reduce((s, r) => s + (r.solarKwh ?? 0), 0);
  const totalGrid = overviewChartRows.reduce((s, r) => s + (r.kwh ?? 0), 0);
  const totalKwh = totalSolar + totalGrid;
  const solarPct = totalKwh > 0 ? (totalSolar / totalKwh) * 100 : 0;
  const gridPvRatio = totalProd > 0 && totalGrid > 0 ? totalGrid / totalProd : null;
  const totalPvRatio = totalProd > 0 && totalKwh > 0 ? totalKwh / totalProd : null;

  const prodCostRows = overviewChartRows.filter((r) => r.totalCost != null);
  const powerCostRows = overviewChartRows.filter((r) => r.powerCost != null);
  const chemCostRows = overviewChartRows.filter((r) => r.chemCost != null);
  const avgProdCost =
    prodCostRows.length > 0
      ? prodCostRows.reduce((s, r) => s + (r.totalCost ?? 0), 0) / prodCostRows.length
      : null;
  const avgPowerCost =
    powerCostRows.length > 0
      ? powerCostRows.reduce((s, r) => s + (r.powerCost ?? 0), 0) / powerCostRows.length
      : null;
  const avgChemCost =
    chemCostRows.length > 0
      ? chemCostRows.reduce((s, r) => s + (r.chemCost ?? 0), 0) / chemCostRows.length
      : null;
  const totalCostOutput = totalProd > 0 ? totalProd : totalRaw;

  const recoveryRows = overviewChartRows.filter(
    (r): r is OverviewChartRowForStats & { recovery: number } =>
      r.recovery != null && r.recovery > 0,
  );
  const avgRecovery =
    recoveryRows.length > 0
      ? recoveryRows.reduce((s, r) => s + r.recovery, 0) / recoveryRows.length
      : null;
  const minRecovery =
    recoveryRows.length > 0 ? Math.min(...recoveryRows.map((r) => r.recovery)) : null;
  const maxRecovery =
    recoveryRows.length > 0 ? Math.max(...recoveryRows.map((r) => r.recovery)) : null;
  const recoveryDays = recoveryRows.length;

  const tdsRows = overviewChartRows.filter(
    (r): r is OverviewChartRowForStats & { tds: number } => r.tds != null && r.tds > 0,
  );
  const avgTds =
    tdsRows.length > 0 ? tdsRows.reduce((s, r) => s + r.tds, 0) / tdsRows.length : null;
  const minTds = tdsRows.length > 0 ? Math.min(...tdsRows.map((r) => r.tds)) : null;
  const maxTds = tdsRows.length > 0 ? Math.max(...tdsRows.map((r) => r.tds)) : null;
  const tdsDays = tdsRows.length;

  return {
    totalProd,
    totalCons,
    totalRaw,
    avgDailyProd,
    avgDailyCons,
    avgDailyRaw,
    peakProd: peakRow?.production ?? 0,
    peakDate: peakRow?.date ?? '—',
    peakRaw,
    nrwPct,
    totalSolar,
    totalGrid,
    totalKwh,
    solarPct,
    gridPvRatio,
    totalPvRatio,
    avgProdCost,
    avgPowerCost,
    avgChemCost,
    totalCostOutput,
    avgRecovery,
    minRecovery,
    maxRecovery,
    recoveryDays,
    avgTds,
    minTds,
    maxTds,
    tdsDays,
  };
}

/**
 * Computes period-level rollups for the plantHealth Data Summary cards
 * (Overview tab RO1..RO7 online/offline board) from the same per-day,
 * per-train map that drives the OverviewTable rows.
 */
export function calculatePlantHealthStats(
  phHealthByDate: Map<string, PlantHealthDayEntry>,
  roTrainEntities: { id: string; label: string }[],
): PlantHealthStatsResult {
  const days = Array.from(phHealthByDate.values());
  const totalDays = days.length;
  const totalTrains = roTrainEntities.length;

  if (totalDays === 0 || totalTrains === 0) {
    return {
      avgHealthPct: null,
      avgOnlineCount: null,
      totalTrains,
      totalDays,
      fullyOnlineDays: 0,
      mostReliableTrain: null,
      leastReliableTrain: null,
    };
  }

  const healthDays = days.filter((d) => d.healthPct != null);
  const avgHealthPct = healthDays.length > 0
    ? healthDays.reduce((s, d) => s + (d.healthPct ?? 0), 0) / healthDays.length
    : null;

  const avgOnlineCount = days.reduce((s, d) => s + d.onlineCount, 0) / totalDays;

  const fullyOnlineDays = days.filter(
    (d) => d.totalTrains > 0 && d.onlineCount === d.totalTrains,
  ).length;

  // Uptime per train = total observed hours / total possible hours in range.
  const trainHoursTotal = new Map<string, number>();
  roTrainEntities.forEach((t) => trainHoursTotal.set(t.id, 0));
  days.forEach((d) => {
    roTrainEntities.forEach((t) => {
      trainHoursTotal.set(t.id, (trainHoursTotal.get(t.id) ?? 0) + (d.trainHours[t.id] ?? 0));
    });
  });

  const maxPossibleHours = totalDays * 24;
  const uptimeByTrain: PlantHealthTrainReliability[] = roTrainEntities.map((t) => ({
    id: t.id,
    label: t.label,
    uptimePct: maxPossibleHours > 0
      ? ((trainHoursTotal.get(t.id) ?? 0) / maxPossibleHours) * 100
      : 0,
  }));

  const mostReliableTrain = uptimeByTrain.reduce<PlantHealthTrainReliability | null>(
    (best, t) => (!best || t.uptimePct > best.uptimePct ? t : best),
    null,
  );
  const leastReliableTrain = uptimeByTrain.reduce<PlantHealthTrainReliability | null>(
    (worst, t) => (!worst || t.uptimePct < worst.uptimePct ? t : worst),
    null,
  );

  return {
    avgHealthPct,
    avgOnlineCount,
    totalTrains,
    totalDays,
    fullyOnlineDays,
    mostReliableTrain,
    leastReliableTrain,
  };
}
