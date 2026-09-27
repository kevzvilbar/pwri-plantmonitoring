import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PlantPowerConfig {
  grid_meter_count: number;
  grid_meter_names: string[];
  grid_meter_multipliers: number[];
  grid_meter_multipliers_enabled: boolean[];
  solar_meter_count: number;
  solar_meter_names: string[];
  solar_meter_multipliers: number[];
  solar_meter_multipliers_enabled: boolean[];
}

export const DEFAULT_POWER_CONFIG: PlantPowerConfig = {
  grid_meter_count: 1,
  grid_meter_names: ['Grid Meter 1'],
  grid_meter_multipliers: [1],
  grid_meter_multipliers_enabled: [false],
  solar_meter_count: 1,
  solar_meter_names: ['Solar Meter 1'],
  solar_meter_multipliers: [1],
  solar_meter_multipliers_enabled: [false],
};

export const POWER_CONFIG_LS = (plantId: string) => `power_config_${plantId}`;
export const UNSYNCED_POWER_CONFIG_LS = (plantId: string) => `plant_power_config_unsynced_${plantId}`;

export function normalizePowerConfig(raw: any): PlantPowerConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POWER_CONFIG };

  const gridCount = typeof raw.grid_meter_count === 'number' && raw.grid_meter_count > 0
    ? Math.min(20, Math.max(1, raw.grid_meter_count))
    : DEFAULT_POWER_CONFIG.grid_meter_count;

  const solarCount = typeof raw.solar_meter_count === 'number' && raw.solar_meter_count > 0
    ? Math.min(20, Math.max(1, raw.solar_meter_count))
    : DEFAULT_POWER_CONFIG.solar_meter_count;

  const rawGridNames = Array.isArray(raw.grid_meter_names) ? raw.grid_meter_names : [];
  const gridNames: string[] = Array.from({ length: gridCount }, (_, i) => {
    return rawGridNames[i] || (gridCount === 1 ? 'Grid Meter' : `Grid Meter ${i + 1}`);
  });

  const rawSolarNames = Array.isArray(raw.solar_meter_names) ? raw.solar_meter_names : [];
  const solarNames: string[] = Array.from({ length: solarCount }, (_, i) => {
    return rawSolarNames[i] || (solarCount === 1 ? 'Solar Meter' : `Solar Meter ${i + 1}`);
  });

  const rawGridMults = Array.isArray(raw.grid_meter_multipliers) ? raw.grid_meter_multipliers : [];
  const gridMultipliers: number[] = Array.from({ length: gridCount }, (_, i) => {
    const val = Number(rawGridMults[i]);
    return Number.isFinite(val) && val > 0 ? val : 1;
  });

  const rawGridEnabled = Array.isArray(raw.grid_meter_multipliers_enabled) ? raw.grid_meter_multipliers_enabled : [];
  const gridMultipliersEnabled: boolean[] = Array.from({ length: gridCount }, (_, i) => {
    if (rawGridEnabled[i] != null) return Boolean(rawGridEnabled[i]);
    return gridMultipliers[i] > 1;
  });

  const rawSolarMults = Array.isArray(raw.solar_meter_multipliers) ? raw.solar_meter_multipliers : [];
  const solarMultipliers: number[] = Array.from({ length: solarCount }, (_, i) => {
    const val = Number(rawSolarMults[i]);
    return Number.isFinite(val) && val > 0 ? val : 1;
  });

  const rawSolarEnabled = Array.isArray(raw.solar_meter_multipliers_enabled) ? raw.solar_meter_multipliers_enabled : [];
  const solarMultipliersEnabled: boolean[] = Array.from({ length: solarCount }, (_, i) => {
    if (rawSolarEnabled[i] != null) return Boolean(rawSolarEnabled[i]);
    return solarMultipliers[i] > 1;
  });

  return {
    grid_meter_count: gridCount,
    grid_meter_names: gridNames,
    grid_meter_multipliers: gridMultipliers,
    grid_meter_multipliers_enabled: gridMultipliersEnabled,
    solar_meter_count: solarCount,
    solar_meter_names: solarNames,
    solar_meter_multipliers: solarMultipliers,
    solar_meter_multipliers_enabled: solarMultipliersEnabled,
  };
}

export function usePlantPowerConfig(plantId: string | null | undefined) {
  const qc = useQueryClient();

  const { data: powerConfig, isLoading } = useQuery<PlantPowerConfig>({
    queryKey: ['plant-power-config', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      // 1. Try Supabase DB first
      try {
        const { data, error } = await (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count, solar_meter_names, solar_meter_multipliers, solar_meter_multipliers_enabled, grid_meter_count, grid_meter_names, grid_meter_multipliers, grid_meter_multipliers_enabled')
          .eq('plant_id', plantId)
          .maybeSingle();

        if (!error && data) {
          return normalizePowerConfig(data);
        }
      } catch {
        /* table may not exist yet or query failed */
      }

      // 2. Fall back to localStorage (unsynced or standard key)
      try {
        const unsyncedRaw = localStorage.getItem(UNSYNCED_POWER_CONFIG_LS(plantId!));
        if (unsyncedRaw) return normalizePowerConfig(JSON.parse(unsyncedRaw));

        const standardRaw = localStorage.getItem(POWER_CONFIG_LS(plantId!));
        if (standardRaw) return normalizePowerConfig(JSON.parse(standardRaw));
      } catch {
        /* ignore localStorage parse issues */
      }

      return { ...DEFAULT_POWER_CONFIG };
    },
  });

  const [isLocalOnly, setIsLocalOnly] = useState(false);

  useEffect(() => {
    if (!plantId) {
      setIsLocalOnly(false);
      return;
    }
    try {
      setIsLocalOnly(localStorage.getItem(UNSYNCED_POWER_CONFIG_LS(plantId)) !== null);
    } catch {
      setIsLocalOnly(false);
    }
  }, [plantId]);

  const pushToDb = useCallback(
    async (cfg: PlantPowerConfig) => {
      if (!plantId) return false;
      const payload = {
        plant_id: plantId,
        grid_meter_count: cfg.grid_meter_count,
        grid_meter_names: cfg.grid_meter_names,
        grid_meter_multipliers: cfg.grid_meter_multipliers,
        grid_meter_multipliers_enabled: cfg.grid_meter_multipliers_enabled,
        solar_meter_count: cfg.solar_meter_count,
        solar_meter_names: cfg.solar_meter_names,
        solar_meter_multipliers: cfg.solar_meter_multipliers,
        solar_meter_multipliers_enabled: cfg.solar_meter_multipliers_enabled,
        updated_at: new Date().toISOString(),
      };

      const { error } = await (supabase.from('plant_power_config' as any) as any).upsert(payload, {
        onConflict: 'plant_id',
      });
      return !error;
    },
    [plantId]
  );

  // ── Retry-on-load / Self-healing sync ─────────────────────────────────────
  // If a previous savePowerConfig() failed to reach DB, or if legacy local-only
  // configuration exists on this device, push to Supabase on mount.
  useEffect(() => {
    if (!plantId) return;
    let cancelled = false;

    (async () => {
      let pendingRaw: string | null = null;
      try {
        pendingRaw = localStorage.getItem(UNSYNCED_POWER_CONFIG_LS(plantId));
      } catch {
        /* ignore */
      }

      // If no unsynced marker, check for local storage configuration that needs syncing
      if (!pendingRaw) {
        try {
          const localRaw = localStorage.getItem(POWER_CONFIG_LS(plantId));
          if (localRaw) {
            // Check if DB lacks multi-meter configuration
            const parsed = JSON.parse(localRaw);
            if (
              parsed &&
              (parsed.grid_meter_count > 1 ||
                parsed.solar_meter_count > 1 ||
                (Array.isArray(parsed.grid_meter_names) && parsed.grid_meter_names.length > 1) ||
                (Array.isArray(parsed.grid_meter_multipliers) && parsed.grid_meter_multipliers.length > 1))
            ) {
              pendingRaw = localRaw;
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (!pendingRaw) return;

      try {
        const pending = normalizePowerConfig(JSON.parse(pendingRaw));
        const ok = await pushToDb(pending);
        if (ok && !cancelled) {
          try {
            localStorage.removeItem(UNSYNCED_POWER_CONFIG_LS(plantId));
            localStorage.setItem(POWER_CONFIG_LS(plantId), JSON.stringify(pending));
          } catch {
            /* ignore */
          }
          setIsLocalOnly(false);
          qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
          qc.invalidateQueries({ queryKey: ['power-meter-changes', plantId] });
          qc.invalidateQueries();
          toast.success('Power meter configuration synced to database.');
        }
      } catch {
        /* unreachable — retry next time */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plantId, qc, pushToDb]);

  const savePowerConfig = async (next: PlantPowerConfig) => {
    if (!plantId) return false;
    const normalized = normalizePowerConfig(next);
    let savedToDb = false;

    try {
      savedToDb = await pushToDb(normalized);
    } catch {
      /* DB call failed */
    }

    try {
      localStorage.setItem(POWER_CONFIG_LS(plantId), JSON.stringify(normalized));
      if (savedToDb) {
        localStorage.removeItem(UNSYNCED_POWER_CONFIG_LS(plantId));
      } else {
        localStorage.setItem(UNSYNCED_POWER_CONFIG_LS(plantId), JSON.stringify(normalized));
      }
    } catch {
      /* ignore */
    }

    setIsLocalOnly(!savedToDb);
    qc.setQueryData(['plant-power-config', plantId], normalized);
    qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
    qc.invalidateQueries({ queryKey: ['power-meter-changes', plantId] });
    qc.invalidateQueries();
    return savedToDb;
  };

  return {
    powerConfig: powerConfig ?? DEFAULT_POWER_CONFIG,
    isLoading,
    savePowerConfig,
    isLocalOnly,
  };
}
