/**
 * referenceData.ts
 *
 * One-fetch-per-catalog helpers for the slow-changing reference tables
 * (wells, locators, ro_trains). FREE-PLAN-BUDGET-PLAN.md, Phase 1.
 *
 * WHY: on 2026-10-03 the live edge logs showed the same catalog URLs fetched
 * 7-16x per hour from ~10 different components (each with its own query key and
 * its own column list), and every request costs log-ingestion quota plus a
 * CORS preflight row. These helpers read through the SAME cache entry the
 * shared hooks use (`['wells', ids]`, `['locators', ids]`, `['ro_trains', ids]`),
 * so a catalog is fetched once per 30 min no matter how many components need it.
 *
 * Implemented with fetchQuery (not ensureQueryData) on purpose: fetchQuery honours
 * both staleTime and invalidateQueries(), so an add/edit mutation that invalidates
 * ['wells'] still forces exactly one fresh fetch on next read.
 *
 * Use inside a queryFn (or event handler) when a hook is not an option.
 * Components that can use a hook should call useWells/useLocators/useROTrains.
 */
import type { QueryClient } from '@tanstack/react-query';
import { fetchWells, type Well } from '@/features/wells/hooks/useWells';
import { fetchLocators, type Locator } from '@/hooks/useLocators';
import { fetchROTrains, type ROTrain } from '@/hooks/useROTrains';

export const REFERENCE_STALE_MS = 30 * 60_000;

/** Stable, order-independent plant list so ['wells',[a,b]] and ['wells',[b,a]] share an entry. */
function norm(plantIds: string[]): string[] {
  return [...plantIds].sort();
}

/**
 * An empty selection means "no plants" and must never fall through to an
 * unscoped fetch (see the P5-1 note in useROTrains).
 */
export async function ensureWells(qc: QueryClient, plantIds: string[]): Promise<Well[]> {
  if (!plantIds.length) return [];
  const ids = norm(plantIds);
  return qc.fetchQuery({
    queryKey: ['wells', ids],
    queryFn: () => fetchWells(ids),
    staleTime: REFERENCE_STALE_MS,
  });
}

export async function ensureLocators(qc: QueryClient, plantIds: string[]): Promise<Locator[]> {
  if (!plantIds.length) return [];
  const ids = norm(plantIds);
  return qc.fetchQuery({
    queryKey: ['locators', ids],
    queryFn: () => fetchLocators(ids),
    staleTime: REFERENCE_STALE_MS,
  });
}

export async function ensureROTrains(qc: QueryClient, plantIds: string[]): Promise<ROTrain[]> {
  if (!plantIds.length) return [];
  const ids = norm(plantIds);
  return qc.fetchQuery({
    queryKey: ['ro_trains', ids],
    queryFn: () => fetchROTrains(ids),
    staleTime: REFERENCE_STALE_MS,
  });
}
