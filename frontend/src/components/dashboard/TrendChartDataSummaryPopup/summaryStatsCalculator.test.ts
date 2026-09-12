import { describe, it, expect } from 'vitest';
import {
  calculateDataSummaryStats,
  calculatePlantHealthStats,
  type OverviewChartRowForStats,
  type PlantHealthDayEntry,
} from './summaryStatsCalculator';

describe('calculateDataSummaryStats', () => {
  it('handles empty rows gracefully', () => {
    const stats = calculateDataSummaryStats([], []);
    expect(stats.totalProd).toBe(0);
    expect(stats.totalCons).toBe(0);
    expect(stats.totalRaw).toBe(0);
    expect(stats.avgDailyProd).toBe(0);
    expect(stats.avgDailyCons).toBe(0);
    expect(stats.avgDailyRaw).toBe(0);
    expect(stats.peakProd).toBe(0);
    expect(stats.peakDate).toBe('—');
    expect(stats.nrwPct).toBe(0);
    expect(stats.totalSolar).toBe(0);
    expect(stats.totalGrid).toBe(0);
    expect(stats.totalKwh).toBe(0);
    expect(stats.solarPct).toBe(0);
    expect(stats.gridPvRatio).toBeNull();
    expect(stats.totalPvRatio).toBeNull();
    expect(stats.avgProdCost).toBeNull();
    expect(stats.avgPowerCost).toBeNull();
    expect(stats.avgChemCost).toBeNull();
    expect(stats.totalCostOutput).toBe(0);
    expect(stats.avgRecovery).toBeNull();
    expect(stats.recoveryDays).toBe(0);
    expect(stats.avgTds).toBeNull();
    expect(stats.tdsDays).toBe(0);
  });

  it('calculates water production, consumption, raw water, and NRW correctly', () => {
    const rows: OverviewChartRowForStats[] = [
      { date: 'Sep 1', production: 1000, consumption: 800, rawwater: 1200 },
      { date: 'Sep 2', production: 1200, consumption: 900, rawwater: 1400 },
    ];
    const tabDates = ['2026-09-01', '2026-09-02'];
    const stats = calculateDataSummaryStats(rows, tabDates);

    expect(stats.totalProd).toBe(2200);
    expect(stats.totalCons).toBe(1700);
    expect(stats.totalRaw).toBe(2600);
    expect(stats.avgDailyProd).toBe(1100);
    expect(stats.avgDailyCons).toBe(850);
    expect(stats.avgDailyRaw).toBe(1300);
    expect(stats.peakProd).toBe(1200);
    expect(stats.peakDate).toBe('Sep 2');
    expect(stats.peakRaw).toBe(1400);

    // NRW% = (2200 - 1700) / 2200 * 100 = 500 / 2200 * 100 = 22.7272...%
    expect(stats.nrwPct).toBeCloseTo(22.727, 2);
  });

  it('calculates power mix, PV ratios, unit costs, recovery, and TDS correctly', () => {
    const rows: OverviewChartRowForStats[] = [
      {
        date: 'Sep 1',
        production: 1000,
        consumption: 900,
        solarKwh: 200,
        kwh: 800, // grid
        powerCost: 10,
        chemCost: 5,
        totalCost: 15,
        recovery: 75.5,
        tds: 120,
      },
      {
        date: 'Sep 2',
        production: 1000,
        consumption: 900,
        solarKwh: 300,
        kwh: 700, // grid
        powerCost: 12,
        chemCost: 6,
        totalCost: 18,
        recovery: 76.5,
        tds: 130,
      },
    ];
    const tabDates = ['2026-09-01', '2026-09-02'];
    const stats = calculateDataSummaryStats(rows, tabDates);

    // Power
    expect(stats.totalSolar).toBe(500);
    expect(stats.totalGrid).toBe(1500);
    expect(stats.totalKwh).toBe(2000);
    expect(stats.solarPct).toBe(25); // 500 / 2000 * 100
    expect(stats.gridPvRatio).toBe(1500 / 2000); // 0.75 kWh/m³
    expect(stats.totalPvRatio).toBe(2000 / 2000); // 1.0 kWh/m³

    // Costs
    expect(stats.avgPowerCost).toBe(11);
    expect(stats.avgChemCost).toBe(5.5);
    expect(stats.avgProdCost).toBe(16.5);
    expect(stats.totalCostOutput).toBe(2000);

    // Recovery
    expect(stats.avgRecovery).toBe(76.0);
    expect(stats.minRecovery).toBe(75.5);
    expect(stats.maxRecovery).toBe(76.5);
    expect(stats.recoveryDays).toBe(2);

    // TDS
    expect(stats.avgTds).toBe(125);
    expect(stats.minTds).toBe(120);
    expect(stats.maxTds).toBe(130);
    expect(stats.tdsDays).toBe(2);
  });
});

describe('calculatePlantHealthStats', () => {
  const trains = [
    { id: 'ro1', label: 'RO1' },
    { id: 'ro2', label: 'RO2' },
  ];

  it('handles an empty map gracefully', () => {
    const stats = calculatePlantHealthStats(new Map(), trains);
    expect(stats.avgHealthPct).toBeNull();
    expect(stats.avgOnlineCount).toBeNull();
    expect(stats.totalTrains).toBe(2);
    expect(stats.totalDays).toBe(0);
    expect(stats.fullyOnlineDays).toBe(0);
    expect(stats.mostReliableTrain).toBeNull();
    expect(stats.leastReliableTrain).toBeNull();
  });

  it('handles no train entities gracefully', () => {
    const byDate = new Map<string, PlantHealthDayEntry>([
      ['2026-09-01', {
        trainOnline: {}, trainHours: {}, onlineCount: 0, offlineCount: 0, healthPct: null, totalTrains: 0,
      }],
    ]);
    const stats = calculatePlantHealthStats(byDate, []);
    expect(stats.totalTrains).toBe(0);
    expect(stats.mostReliableTrain).toBeNull();
    expect(stats.leastReliableTrain).toBeNull();
  });

  it('averages health %, online count, and ranks train reliability by uptime', () => {
    const byDate = new Map<string, PlantHealthDayEntry>([
      ['2026-09-01', {
        trainOnline: { ro1: false, ro2: true },
        trainHours: { ro1: 0, ro2: 24 },
        onlineCount: 1,
        offlineCount: 1,
        healthPct: 50,
        totalTrains: 2,
      }],
      ['2026-09-02', {
        trainOnline: { ro1: true, ro2: true },
        trainHours: { ro1: 12, ro2: 24 },
        onlineCount: 2,
        offlineCount: 0,
        healthPct: 100,
        totalTrains: 2,
      }],
    ]);
    const stats = calculatePlantHealthStats(byDate, trains);

    expect(stats.totalDays).toBe(2);
    expect(stats.avgHealthPct).toBe(75); // (50 + 100) / 2
    expect(stats.avgOnlineCount).toBe(1.5); // (1 + 2) / 2
    expect(stats.fullyOnlineDays).toBe(1); // only Sep 2 had onlineCount === totalTrains

    // ro1: 12 / 48 hours = 25% uptime, ro2: 48 / 48 hours = 100% uptime
    expect(stats.leastReliableTrain).toEqual({ id: 'ro1', label: 'RO1', uptimePct: 25 });
    expect(stats.mostReliableTrain).toEqual({ id: 'ro2', label: 'RO2', uptimePct: 100 });
  });
});
