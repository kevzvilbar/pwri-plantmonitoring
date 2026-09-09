import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ScoreMatrix, ScoreMap2, EntityTypeScore, DayScore2, KpiRange2 } from './constants';
import type { StaffMember } from '../../types';
import { generateDays2, SHARED_COLS, DEFAULT_RO_OPERATOR_SHIFT_TARGET, roTargetForPlant, computeEntityOverallScore } from './constants';
import {
  usePlantFlags,
  useEntityCountsPerPlant,
  useWellsConfig,
  useLocatorsConfig,
  useTrainsConfig,
  useMetersConfig,
  useWellReadings,
  useLocatorReadings,
  useRoTrainReadings,
  useProductMeterReadings,
  usePowerReadings,
  useChemReadings,
  useBlendingReadings,
  type PlantFlags,
  type EntityCountsPerPlant,
} from '@/data/hooks/useKpi';

export type UseKpiDataOptions = {
  staff: StaffMember[];
  roles: any[];
  plants: any[];
  range: KpiRange2;
  refreshKey: number;
  viewMode: 'team' | 'individual';
};

export type UseKpiDataResult = {
  days: string[];
  since: string;
  todayStr: string;
  elapsedFraction: number;
  operators: StaffMember[];
  plantsWithOps: any[];
  plantFlags: Record<string, { has_solar: boolean; has_grid: boolean }>;
  plantById: Record<string, { ro_hourly_target?: number | string | null }>;
  wellsPerPlant: Record<string, number>;
  locatorsPerPlant: Record<string, number>;
  trainsPerPlant: Record<string, string[]>;
  metersPerPlant: Record<string, number>;
  wellReadings: any[];
  locReadings: any[];
  roReadings: any[];
  meterReadings: any[];
  powerReadings: any[];
  chemReadings: any[];
  blendingReadings: any[];
  isLoading: boolean;
  kpiError: any;
  retryKpiQueries: () => void;
  individual: ScoreMatrix;
  teamCoverage: ScoreMatrix;
  activeMatrix: ScoreMatrix;
  summary: { pct: number; complete: number; total: number; missed: number; pending: number };
  appraisalStats: { outstanding: number; exceeds: number; meets: number; needsImp: number; unsat: number; avgScore: number; totalEvaluated: number };
};

function buildTeamMatrix(
  plantsWithOps: any[],
  days: string[],
  todayStr: string,
  elapsedFraction: number,
  wellsPerPlant: Record<string, number>,
  locatorsPerPlant: Record<string, number>,
  trainsPerPlant: Record<string, string[]>,
  metersPerPlant: Record<string, number>,
  plantFlags: Record<string, { has_solar: boolean; has_grid: boolean }>,
  plantById: Record<string, { ro_hourly_target?: number | string | null }>,
  wellReadings: any[],
  locReadings: any[],
  roReadings: any[],
  meterReadings: any[],
  powerReadings: any[],
  chemReadings: any[],
  blendingReadings: any[],
): ScoreMatrix {
  const team: ScoreMatrix = {};
  const daySet = new Set(days);

  const twellMap:  Record<string, Set<string>> = {};
  const tlocMap:   Record<string, Set<string>> = {};
  const troMap:    Record<string, number>       = {};
  const tmeterMap: Record<string, Set<string>> = {};
  const tsolarMap: Record<string, number>       = {};
  const tgridMap:  Record<string, number>       = {};
  const tchemMap:  Record<string, number>       = {};

  wellReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    const tk = `${r.plant_id}:${day}`;
    (twellMap[tk] = twellMap[tk] ?? new Set()).add(r.well_id);
  });

  locReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    const tk = `${r.plant_id}:${day}`;
    (tlocMap[tk] = tlocMap[tk] ?? new Set()).add(r.locator_id);
  });

  roReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    const tk = `${r.plant_id}:${day}:${r.train_id}`;
    troMap[tk] = (troMap[tk] ?? 0) + 1;
  });

  meterReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    const tk = `${r.plant_id}:${day}`;
    (tmeterMap[tk] = tmeterMap[tk] ?? new Set()).add(r.meter_id);
  });

  powerReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    const tk = `${r.plant_id}:${day}`;
    if (r.daily_solar_kwh !== null) tsolarMap[tk] = (tsolarMap[tk] ?? 0) + 1;
    if (r.daily_grid_kwh  !== null) tgridMap[tk]  = (tgridMap[tk]  ?? 0) + 1;
  });

  chemReadings.forEach((r) => {
    const day = r.log_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    const tk = `${r.plant_id}:${day}`;
    tchemMap[tk] = (tchemMap[tk] ?? 0) + 1;
  });

  blendingReadings.forEach((r) => {
    const day = r.event_date;
    if (!daySet.has(day)) return;
    const tk = `${r.plant_id}:${day}`;
    (twellMap[tk] = twellMap[tk] ?? new Set()).add(r.well_id);
  });

  plantsWithOps.forEach((plant) => {
    const plantId = plant.id;
    const numWells  = wellsPerPlant[plantId]    ?? 0;
    const numLocs   = locatorsPerPlant[plantId] ?? 0;
    const trainIds  = trainsPerPlant[plantId]   ?? [];
    const numMeters = metersPerPlant[plantId]   ?? 0;
    const hasSolar  = plantFlags[plantId]?.has_solar ?? false;
    const hasGrid   = plantFlags[plantId]?.has_grid  ?? true;
    const roTarget  = roTargetForPlant(plant);

    const ts: EntityTypeScore = { wells: {}, locator: {}, ro_train: {}, product_meter: {}, solar: {}, grid: {}, chemicals: {} };

    days.forEach((day) => {
      const isToday = day === todayStr;
      const tk = `${plantId}:${day}`;

      ts.wells![day]   = numWells  === 0 ? null : Math.min(1, (twellMap[tk]?.size  ?? 0) / numWells);
      ts.locator![day] = numLocs   === 0 ? null : Math.min(1, (tlocMap[tk]?.size   ?? 0) / numLocs);

      if (trainIds.length === 0) {
        ts.ro_train![day] = null;
      } else {
        const target = isToday ? Math.max(1, Math.ceil(roTarget * elapsedFraction)) : roTarget;
        const perTrain = trainIds.map((tid) => Math.min(1, (troMap[`${tk}:${tid}`] ?? 0) / target));
        ts.ro_train![day] = perTrain.reduce((a, b) => a + b, 0) / perTrain.length;
      }

      ts.product_meter![day] = numMeters === 0 ? null : Math.min(1, (tmeterMap[tk]?.size ?? 0) / numMeters);
      ts.solar![day] = !hasSolar ? null : (tsolarMap[tk] ?? 0) >= 1 ? 1 : 0;
      ts.grid![day]  = !hasGrid  ? null : (tgridMap[tk]  ?? 0) >= 1 ? 1 : 0;
      ts.chemicals![day] = (tchemMap[tk] ?? 0) >= 1 ? 1 : 0;
    });

    team[plantId] = ts;
  });

  return team;
}

function buildIndividualMatrix(
  operators: StaffMember[],
  plantsWithOps: any[],
  days: string[],
  todayStr: string,
  elapsedFraction: number,
  wellsPerPlant: Record<string, number>,
  locatorsPerPlant: Record<string, number>,
  trainsPerPlant: Record<string, string[]>,
  metersPerPlant: Record<string, number>,
  plantFlags: Record<string, { has_solar: boolean; has_grid: boolean }>,
  plantById: Record<string, { ro_hourly_target?: number | string | null }>,
  teamCoverage: ScoreMatrix,
  wellReadings: any[],
  locReadings: any[],
  roReadings: any[],
  meterReadings: any[],
  powerReadings: any[],
  chemReadings: any[],
  blendingReadings: any[],
): ScoreMatrix {
  const indiv: ScoreMatrix = {};
  const daySet = new Set(days);

  const opDutySet = new Set<string>();
  const roMap: Record<string, number> = {};

  wellReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    if (r.recorded_by) {
      opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
    }
  });

  locReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    if (r.recorded_by) {
      opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
    }
  });

  roReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    if (r.recorded_by) {
      opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
      const k = `${r.recorded_by}:${r.plant_id}:${day}:${r.train_id}`;
      roMap[k] = (roMap[k] ?? 0) + 1;
    }
  });

  meterReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    if (r.recorded_by) {
      opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
    }
  });

  powerReadings.forEach((r) => {
    const day = r.reading_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    if (r.recorded_by) {
      opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
    }
  });

  chemReadings.forEach((r) => {
    const day = r.log_datetime.slice(0, 10);
    if (!daySet.has(day)) return;
    if (r.recorded_by) {
      opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
    }
  });

  blendingReadings.forEach((r) => {
    const day = r.event_date;
    if (!daySet.has(day)) return;
    if (r.recorded_by) {
      opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
    }
  });

  operators.forEach((op) => {
    (op.plant_assignments ?? []).forEach((plantId) => {
      const matKey = `${op.id}:${plantId}`;
      const trainIds  = trainsPerPlant[plantId]   ?? [];
      const plantTeam = teamCoverage[plantId];

      const ts: EntityTypeScore = {
        wells: {}, locator: {}, ro_train: {}, product_meter: {}, solar: {}, grid: {}, chemicals: {},
      };

      days.forEach((day) => {
        const isToday = day === todayStr;
        const dutyKey = `${op.id}:${plantId}:${day}`;
        const isOnDuty = opDutySet.has(dutyKey);

        if (!isOnDuty) {
          SHARED_COLS.forEach((col) => {
            ts[col]![day] = null;
          });
          ts.ro_train![day] = null;
          return;
        }

        SHARED_COLS.forEach((col) => {
          ts[col]![day] = plantTeam?.[col]?.[day] ?? null;
        });

        if (trainIds.length === 0) {
          ts.ro_train![day] = null;
        } else {
          const shiftTarget = isToday
            ? Math.max(1, Math.ceil(DEFAULT_RO_OPERATOR_SHIFT_TARGET * elapsedFraction))
            : DEFAULT_RO_OPERATOR_SHIFT_TARGET;
          const perTrain = trainIds.map((tid) => {
            const count = roMap[`${dutyKey}:${tid}`] ?? 0;
            return Math.min(1, count / shiftTarget);
          });
          ts.ro_train![day] = perTrain.reduce((a, b) => a + b, 0) / perTrain.length;
        }
      });

      indiv[matKey] = ts;
    });
  });

  return indiv;
}

function buildSummary(activeMatrix: ScoreMatrix, todayStr: string) {
  let total = 0, complete = 0, missed = 0, pending = 0;
  Object.values(activeMatrix).forEach((ts) =>
    Object.values(ts).forEach((dm) =>
      Object.entries(dm as ScoreMap2).forEach(([day, s]) => {
        if (s === null) return;
        const isToday = day === todayStr;
        if (isToday && s === 0) { pending++; return; }
        total++;
        if ((s as number) >= 1) complete++;
        if ((s as number) === 0) missed++;
      })
    )
  );
  return { pct: total > 0 ? Math.round((complete / total) * 100) : 0, complete, total, missed, pending };
}

function buildAppraisalStats(
  plantsWithOps: any[],
  operators: StaffMember[],
  individual: ScoreMatrix,
  days: string[],
  todayStr: string,
) {
  let outstanding = 0, exceeds = 0, meets = 0, needsImp = 0, unsat = 0;
  const operatorScores: { op: StaffMember; plantName: string; scorePct: number }[] = [];

  plantsWithOps.forEach((plant) => {
    const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
    plantOps.forEach((op) => {
      const matKey = `${op.id}:${plant.id}`;
      const ts = individual[matKey] ?? {};
      const overall = computeEntityOverallScore(ts, days, todayStr);
      if (overall.totalValid === 0) return;
      operatorScores.push({ op, plantName: plant.name, scorePct: overall.scorePct });

      if (overall.scorePct >= 90) outstanding++;
      else if (overall.scorePct >= 80) exceeds++;
      else if (overall.scorePct >= 70) meets++;
      else if (overall.scorePct >= 50) needsImp++;
      else unsat++;
    });
  });

  const avgScore = operatorScores.length > 0
    ? Math.round(operatorScores.reduce((a, b) => a + b.scorePct, 0) / operatorScores.length)
    : 0;

  return { outstanding, exceeds, meets, needsImp, unsat, avgScore, totalEvaluated: operatorScores.length };
}

export function useKpiData(opts: UseKpiDataOptions): UseKpiDataResult {
  const { staff, roles, plants, range, refreshKey, viewMode } = opts;
  const queryClient = useQueryClient();

  const days = useMemo(() => generateDays2(range), [range, refreshKey]);
  const since = useMemo(() => days[0] + 'T00:00:00+08:00', [days]);
  const todayStr = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);
  const now = new Date();
  const nowManila = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const elapsedFraction = Math.min(1, Math.max(0, (nowManila.getHours() + nowManila.getMinutes() / 60) / 24));

  const operators = useMemo(() => {
    const opIds = new Set(
      (roles as any[]).filter((r) => r.role === 'Operator').map((r) => r.user_id)
    );
    return staff.filter((s) => opIds.has(s.id) && s.status === 'Active');
  }, [staff, roles]);

  const plantsWithOps = useMemo(() =>
    plants.filter((p) => operators.some((op) => op.plant_assignments?.includes(p.id))),
    [plants, operators]
  );

  // Use data layer hooks instead of inline queries
  const { data: plantFlagsData = {}, isLoading: plantFlagsLoading } = usePlantFlags();
  const plantFlags = plantFlagsData as Record<string, { has_solar: boolean; has_grid: boolean }>;

  const { data: entityCountsData = { wellsPerPlant: {}, locatorsPerPlant: {}, trainsPerPlant: {}, metersPerPlant: {} }, isLoading: entityCountsLoading } = useEntityCountsPerPlant();
  const wellsPerPlant = entityCountsData.wellsPerPlant;
  const locatorsPerPlant = entityCountsData.locatorsPerPlant;
  const trainsPerPlant = entityCountsData.trainsPerPlant;
  const metersPerPlant = entityCountsData.metersPerPlant;

  const plantById = useMemo(() => {
    const m: Record<string, { ro_hourly_target?: number | string | null }> = {};
    plants.forEach((p) => { m[p.id] = p; });
    return m;
  }, [plants]);

  // Config queries (can be cached longer)
  const { data: wellsCfg = [] } = useWellsConfig();
  const { data: locatorsCfg = [] } = useLocatorsConfig();
  const { data: trainsCfg = [] } = useTrainsConfig();
  const { data: metersCfg = [] } = useMetersConfig();

  // Reading queries
  const { data: wellReadings = [], isLoading: l1, error: e1, refetch: r1 } = useWellReadings(since, refreshKey);
  const { data: locReadings = [], isLoading: l2, error: e2, refetch: r2 } = useLocatorReadings(since, refreshKey);
  const { data: roReadings = [], isLoading: l3, error: e3, refetch: r3 } = useRoTrainReadings(since, refreshKey);
  const { data: meterReadings = [], isLoading: l4, error: e4, refetch: r4 } = useProductMeterReadings(since, refreshKey);
  const { data: powerReadings = [], isLoading: l5, error: e5, refetch: r5 } = usePowerReadings(since, refreshKey);
  const { data: chemReadings = [], isLoading: l6, error: e6, refetch: r6 } = useChemReadings(since, refreshKey);
  const { data: blendingReadings = [], isLoading: l7, error: e7, refetch: r7 } = useBlendingReadings(since, refreshKey);

  const isLoading = plantFlagsLoading || entityCountsLoading || l1 || l2 || l3 || l4 || l5 || l6 || l7;
  const kpiError = e1 || e2 || e3 || e4 || e5 || e6 || e7;

  const retryKpiQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['kpi'] });
  };

  const teamCoverage = useMemo(
    () => buildTeamMatrix(plantsWithOps, days, todayStr, elapsedFraction, wellsPerPlant, locatorsPerPlant,
      trainsPerPlant, metersPerPlant, plantFlags, plantById,
      wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings, blendingReadings),
    [plantsWithOps, days, todayStr, elapsedFraction, wellsPerPlant, locatorsPerPlant, trainsPerPlant,
     metersPerPlant, plantFlags, plantById, wellReadings, locReadings, roReadings, meterReadings,
     powerReadings, chemReadings, blendingReadings],
  );

  const individual = useMemo(
    () => buildIndividualMatrix(operators, plantsWithOps, days, todayStr, elapsedFraction,
      wellsPerPlant, locatorsPerPlant, trainsPerPlant, metersPerPlant, plantFlags, plantById, teamCoverage,
      wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings, blendingReadings),
    [operators, plantsWithOps, days, todayStr, elapsedFraction, wellsPerPlant, locatorsPerPlant,
     trainsPerPlant, metersPerPlant, plantFlags, plantById, teamCoverage,
     wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings, blendingReadings],
  );

  const activeMatrix = viewMode === 'team' ? teamCoverage : individual;

  const summary = useMemo(() => buildSummary(activeMatrix, todayStr), [activeMatrix, todayStr]);

  const appraisalStats = useMemo(
    () => buildAppraisalStats(plantsWithOps, operators, individual, days, todayStr),
    [plantsWithOps, operators, individual, days, todayStr],
  );

  return {
    days, since, todayStr, elapsedFraction,
    operators, plantsWithOps, plantFlags, plantById,
    wellsPerPlant, locatorsPerPlant, trainsPerPlant, metersPerPlant,
    wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings, blendingReadings,
    isLoading, kpiError, retryKpiQueries,
    individual, teamCoverage, activeMatrix,
    summary, appraisalStats,
  };
}
