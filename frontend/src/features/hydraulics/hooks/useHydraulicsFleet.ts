import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  computeDrawdown,
  computeSurveyDelta,
  getHydraulicStatus,
  getHydraulicStatusMeta,
  getMissingCoreFields,
  getSurveyAgeDays,
  isSurveyDue,
  type WellHydraulicSummary,
  type HydraulicStatus,
  type PmsSurveyRecord,
} from '@/features/wells/lib/hydraulics';

export interface UseHydraulicsFleetOptions {
  plantId?: string | 'ALL';
  statusFilter?: HydraulicStatus | 'ALL';
  search?: string;
}

export function useHydraulicsFleet(options: UseHydraulicsFleetOptions = {}) {
  const { plantId, statusFilter = 'ALL', search = '' } = options;

  // 1. Fetch wells with their plant metadata
  const wellsQuery = useQuery({
    queryKey: ['hydraulics-fleet-wells'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wells')
        .select(`
          id,
          name,
          plant_id,
          drilling_depth_m,
          meter_brand,
          meter_size,
          plants (
            id,
            name,
            code
          )
        `)
        .order('name', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  // 2. Fetch all PMS records
  const pmsQuery = useQuery({
    queryKey: ['hydraulics-fleet-pms'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('well_pms_records')
        .select('*')
        .order('date_gathered', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  // 3. Fetch latest live telemetry readings for pressure & TDS
  const readingsQuery = useQuery({
    queryKey: ['hydraulics-fleet-readings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('well_readings')
        .select('well_id, reading_datetime, pressure_psi, tds_ppm')
        .order('reading_datetime', { ascending: false })
        .limit(2000);

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const isLoading = wellsQuery.isLoading || pmsQuery.isLoading || readingsQuery.isLoading;
  const isError = wellsQuery.isError || pmsQuery.isError || readingsQuery.isError;
  const error = wellsQuery.error || pmsQuery.error || readingsQuery.error;

  const refetch = async () => {
    await Promise.all([
      wellsQuery.refetch(),
      pmsQuery.refetch(),
      readingsQuery.refetch(),
    ]);
  };

  const summaries = useMemo<WellHydraulicSummary[]>(() => {
    if (!wellsQuery.data) return [];

    // Group PMS surveys by well_id
    const pmsByWell = new Map<string, PmsSurveyRecord[]>();
    for (const record of pmsQuery.data ?? []) {
      const list = pmsByWell.get(record.well_id) ?? [];
      list.push(record);
      pmsByWell.set(record.well_id, list);
    }

    // Group latest pressure and TDS by well_id
    const latestPressureByWell = new Map<string, { value: number; date: string }>();
    const latestTdsByWell = new Map<string, { value: number; date: string }>();
    for (const r of readingsQuery.data ?? []) {
      if (r.pressure_psi != null && !latestPressureByWell.has(r.well_id)) {
        latestPressureByWell.set(r.well_id, {
          value: r.pressure_psi,
          date: r.reading_datetime,
        });
      }
      if (r.tds_ppm != null && !latestTdsByWell.has(r.well_id)) {
        latestTdsByWell.set(r.well_id, {
          value: r.tds_ppm,
          date: r.reading_datetime,
        });
      }
    }

    const now = new Date();

    return wellsQuery.data.map((well): WellHydraulicSummary => {
      const surveys = pmsByWell.get(well.id) ?? [];
      const latestSurvey = surveys[0] ?? null;
      const previousSurvey = surveys[1] ?? null;

      const drillingDepth = latestSurvey?.drilling_depth_m ?? well.drilling_depth_m;
      const swl = latestSurvey?.static_water_level_m ?? null;
      const pwl = latestSurvey?.pumping_water_level_m ?? null;
      const drawdown = computeDrawdown(pwl, swl);

      const daysSinceSurvey = getSurveyAgeDays(latestSurvey?.date_gathered, now);
      const due = isSurveyDue(latestSurvey?.date_gathered, undefined, now);
      const missingCoreFields = getMissingCoreFields(latestSurvey, drillingDepth);
      const status = getHydraulicStatus(latestSurvey, drillingDepth, now);
      const statusMeta = getHydraulicStatusMeta(status, daysSinceSurvey, missingCoreFields.length);
      const delta = computeSurveyDelta(latestSurvey, previousSurvey);

      const liveP = latestPressureByWell.get(well.id);
      const liveT = latestTdsByWell.get(well.id);

      const plantData = Array.isArray(well.plants) ? well.plants[0] : well.plants;
      const plantName = plantData?.name ?? 'Unknown Plant';
      const wellPlantId = well.plant_id ?? '';

      return {
        wellId: well.id,
        wellName: well.name,
        plantId: wellPlantId,
        plantName,
        drillingDepth,
        latestSurvey,
        previousSurvey,
        allSurveysCount: surveys.length,
        daysSinceSurvey,
        isSurveyDue: due,
        drawdown,
        swl,
        pwl,
        pumpSetting: latestSurvey?.pump_setting ?? null,
        motorHp: latestSurvey?.motor_hp ?? null,
        surveyTds: latestSurvey?.tds_ppm ?? null,
        surveyTurbidity: latestSurvey?.turbidity_ntu ?? null,
        surveyDate: latestSurvey?.date_gathered ?? null,
        missingCoreFields,
        status,
        statusMeta,
        delta,
        livePressure: liveP?.value ?? null,
        livePressureDate: liveP?.date ?? null,
        liveTds: liveT?.value ?? null,
        liveTdsDate: liveT?.date ?? null,
      };
    });
  }, [wellsQuery.data, pmsQuery.data, readingsQuery.data]);

  // Status breakdown counts across whole fleet (or plant scoped)
  const counts = useMemo(() => {
    const res = {
      total: 0,
      ok: 0,
      overdue: 0,
      incomplete: 0,
      no_survey: 0,
    };

    const plantScoped = plantId && plantId !== 'ALL'
      ? summaries.filter((s) => s.plantId === plantId)
      : summaries;

    res.total = plantScoped.length;
    for (const s of plantScoped) {
      res[s.status]++;
    }

    return res;
  }, [summaries, plantId]);

  // Filtered dataset for UI table view
  const filteredSummaries = useMemo(() => {
    return summaries.filter((item) => {
      // 1. Plant filter
      if (plantId && plantId !== 'ALL' && item.plantId !== plantId) {
        return false;
      }
      // 2. Status filter
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }
      // 3. Search filter
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const matchName = item.wellName.toLowerCase().includes(query);
        const matchPlant = item.plantName.toLowerCase().includes(query);
        const matchPumpSetting = item.pumpSetting?.toLowerCase().includes(query) ?? false;
        if (!matchName && !matchPlant && !matchPumpSetting) {
          return false;
        }
      }
      return true;
    });
  }, [summaries, plantId, statusFilter, search]);

  return {
    summaries: filteredSummaries,
    allSummaries: summaries,
    counts,
    isLoading,
    isError,
    error,
    refetch,
  };
}
