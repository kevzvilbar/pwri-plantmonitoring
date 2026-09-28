/**
 * useChemCatalog.ts
 *
 * React Query hook for loading the active Chemical Catalog,
 * plant-specific conversion units, and day tank configurations.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChemicalCatalogItem {
  id: string;
  name: string;
  price_key: string;
  legacy_name: string | null;
  family: string;
  category: 'process' | 'test_consumable';
  form: string | null;
  base_unit: 'kg' | 'L' | 'pcs' | 'mL';
  strength_pct: number | null;
  strength_basis: 'as_product' | 'w/w' | 'w/v' | null;
  density_kg_per_l: number | null;
  reference_basis: string | null;
  methods: string[] | null;
  sample_volume_ml: number | null;
  qty_per_test: number | null;
  drops_per_test: number | null;
  ml_per_drop: number | null;
  process_stage: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface CatalogUnitItem {
  id: string;
  catalog_id: string;
  plant_id: string | null;
  unit_label: string;
  factor_to_base: number;
  is_default: boolean;
}

export interface PlantDayTank {
  id: string;
  plant_id: string;
  catalog_id: string;
  name: string;
  capacity_l: number | null;
  neat_per_100l: number;
  is_active: boolean;
}

export function useChemCatalog(plantId?: string | null) {
  return useQuery({
    queryKey: ['chemical-catalog', plantId],
    staleTime: 60_000,
    queryFn: async () => {
      // 1. Fetch active catalog products
      const { data: catalog, error: catError } = await (supabase
        .from('chemical_catalog' as any) as any)
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (catError) throw catError;

      // 2. Fetch catalog units (global or plant-scoped)
      const { data: units, error: unitError } = await (supabase
        .from('chemical_catalog_units' as any) as any)
        .select('*');

      if (unitError) throw unitError;

      // 3. Fetch plant day tanks if plantId is provided
      let dayTanks: PlantDayTank[] = [];
      if (plantId) {
        const { data: tanks, error: tankError } = await (supabase
          .from('plant_day_tanks' as any) as any)
          .select('*')
          .eq('plant_id', plantId)
          .eq('is_active', true);

        if (!tankError && tanks) {
          dayTanks = tanks as PlantDayTank[];
        }
      }

      return {
        catalog: (catalog ?? []) as ChemicalCatalogItem[],
        units: (units ?? []) as CatalogUnitItem[],
        dayTanks,
      };
    },
  });
}
