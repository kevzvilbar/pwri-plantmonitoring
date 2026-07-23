import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDraft } from '@/hooks/useDraft';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard } from 'lucide-react';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

// Generated from Operations.tsx — do not add logic here
// Provides constants, utility functions, and hooks shared across all Operations tabs

export function GridPylonIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <line x1="4" y1="22" x2="20" y2="22" />
      <line x1="8" y1="22" x2="10" y2="14" />
      <line x1="16" y1="22" x2="14" y2="14" />
      <line x1="8" y1="22" x2="14" y2="14" />
      <line x1="16" y1="22" x2="10" y2="14" />
      <line x1="10" y1="14" x2="11" y2="8" />
      <line x1="14" y1="14" x2="13" y2="8" />
      <line x1="10" y1="14" x2="13" y2="8" />
      <line x1="14" y1="14" x2="11" y2="8" />
      <line x1="11" y1="8" x2="11.8" y2="4" />
      <line x1="13" y1="8" x2="12.2" y2="4" />
      <line x1="11" y1="8" x2="12.2" y2="4" />
      <line x1="13" y1="8" x2="11.8" y2="4" />
      <line x1="7" y1="6" x2="17" y2="6" />
      <line x1="12" y1="4" x2="12" y2="6" />
      <line x1="7" y1="6" x2="7" y2="8" />
      <line x1="17" y1="6" x2="17" y2="8" />
    </svg>
  );
}
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

// Wells keep a fixed default limit; locators use per-plant configurable limit from Plant Configuration.
export const WELL_MAX_READINGS_PER_DAY = 3;
export const BASE = (import.meta.env.VITE_BACKEND_URL as string) || '';

// ─── Shared Dashboard invalidator ────────────────────────────────────────────
// Called after every successful save/import in any Operations sub-form so that
// the Dashboard stat cards, NRW, PV ratio, and TrendChart series all refresh
// immediately — no page reload or 60-second poll wait required.
// The broad qc.invalidateQueries() at the end is a safety-net for any mounted
// queries not listed here (e.g. new keys added in future features).
import type { QueryClient } from '@tanstack/react-query';
// ─── Hybrid Strategy: delta cache invalidation ────────────────────────────────
// After every mutating operation (insert / update / delete / import) we flush the
// in-memory deltaCache for the affected entity IDs so the next render recomputes
// deltas from raw DB rows rather than serving a stale cached value.
// The cache is populated lazily on the next Dashboard/TrendChart render via
// hydrateFromStoredDeltas or the computePivotFromReadings fallback path.
import { flushDeltaCache } from '@/lib/deltaCache';

// ─── Reading guard helpers (inlined — no external dependency) ────────────────
// These mirror the DB trigger logic (fn_locator_reading_integrity) so the UI
// gives immediate feedback before the Supabase round-trip.

export const READING_COOLDOWN_MINUTES = 45;
export const SPIKE_MULTIPLIER = 2.0;

// NOTE: ReadingGuardResult and evaluateReadingGuard were previously duplicated
// here as private (non-exported) copies. They were never called from within
// this file and were never exported, making them completely dead code. The
// canonical implementations live in lib/readingGuards.ts (GuardResult type,
// exported evaluateReadingGuard) — that is what LocatorSection and WellSection
// import. Removed here to close the dead-code gap (Section 4 testing priority
// item 3 — "collapse its two duplicate copies into one shared module").

export function formatCooldown(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

// ─── Typed dashboard invalidators ────────────────────────────────────────────
// Each function only invalidates the query keys that its reading type affects.
// A locator save should not trigger a well/RO/power refetch — that is pure waste.
// The nuclear qc.invalidateQueries() has been REMOVED from all paths.
// If a new query key goes stale after a save, add it to the correct typed
// function below rather than restoring the broadcast.

/** After a locator reading is saved. */
export function invalidateLocatorDash(qc: QueryClient, entityIds?: string[]) {
  qc.invalidateQueries({ queryKey: ['dash-loc-today'] });
  qc.invalidateQueries({ queryKey: ['dash-loc-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
  qc.invalidateQueries({ queryKey: ['alerts-feed'] });
  qc.invalidateQueries({ queryKey: ['trend-loc'] });
  qc.invalidateQueries({ queryKey: ['trend-loc-ids'] });
  qc.invalidateQueries({ queryKey: ['dsm-cons-readings'] });
  qc.invalidateQueries({ queryKey: ['dsm-locators'] });
  flushDeltaCache(entityIds);
}

/** After a well reading is saved. */
export function invalidateWellDash(qc: QueryClient, entityIds?: string[]) {
  qc.invalidateQueries({ queryKey: ['dash-wells-today'] });
  qc.invalidateQueries({ queryKey: ['dash-wells-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
  qc.invalidateQueries({ queryKey: ['alerts-feed'] });
  qc.invalidateQueries({ queryKey: ['trend-well'] });
  qc.invalidateQueries({ queryKey: ['dsm-prod-readings'] });
  qc.invalidateQueries({ queryKey: ['blending-volume'] });
  flushDeltaCache(entityIds);
}

/** After a product meter reading is saved. */
export function invalidateProductMeterDash(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
  qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
  qc.invalidateQueries({ queryKey: ['trend-product'] });
  qc.invalidateQueries({ queryKey: ['dsm-prod-readings'] });
  qc.invalidateQueries({ queryKey: ['dsm-product-meters'] });
  qc.invalidateQueries({ queryKey: ['dsm-meter-configs'] });
}

/** After a power reading is saved. */
export function invalidatePowerDash(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['dash-power-today'] });
  qc.invalidateQueries({ queryKey: ['dash-power-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
  qc.invalidateQueries({ queryKey: ['trend-power'] });
  qc.invalidateQueries({ queryKey: ['trend-cost'] });
  qc.invalidateQueries({ queryKey: ['trend-bill-multipliers'] });
  qc.invalidateQueries({ queryKey: ['trend-power-config'] });
}

/** After an RO train reading is saved. */
export function invalidateRODash(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
  qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
  qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-all-permeate-today'] });
  qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
  qc.invalidateQueries({ queryKey: ['trend-ro'] });
  qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
  qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
  qc.invalidateQueries({ queryKey: ['dsm-ro-trains'] });
}

/** After a chemical dosing entry is saved. */
export function invalidateChemDash(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['dash-chem'] });
  qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
  qc.invalidateQueries({ queryKey: ['trend-cost'] });
}

/**
 * Full invalidation — used only for CSV imports that may touch any table.
 * Does NOT call qc.invalidateQueries() — the targeted keys above are sufficient.
 */
export function invalidateDashboard(qc: QueryClient, entityIds?: string[]) {
  invalidateLocatorDash(qc, entityIds);
  invalidateWellDash(qc, entityIds);
  invalidateProductMeterDash(qc);
  invalidatePowerDash(qc);
  invalidateRODash(qc);
  invalidateChemDash(qc);
  qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
  qc.invalidateQueries({ queryKey: ['alerts-feed'] });
  // ⚠ DO NOT add qc.invalidateQueries() here — it was the source of egress spike.
}

// ─── Production calculation audit logger ─────────────────────────────────────
// Called from ProductSection.tsx after a product-meter reading is saved with a
// computed production volume. Best-effort: silently ignored if table missing.
export async function logProductionCalc(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  entry_name: string;
  production_volume: number;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('production_calc_log' as any) as any).insert([entry]);
  } catch { /* silently ignore if table missing */ }
}

// ─── CSV helpers ────────────────────────────────────────────────────────────

// Fix #6 — RFC-4180 compliant CSV parser. Handles quoted fields that contain
// commas, newlines, or escaped double-quotes (""). Plain split(',') breaks on
// values like "Well #1, North" or plant names with commas.

export function useBlendingWells(plantId: string) {
  return useQuery<{ wells: { well_id: string }[] }>({
    queryKey: ['blending-wells', plantId],
    queryFn: async () => {
      // 1. Try the backend API first (Mongo-backed)
      try {
        const qs = plantId ? `?plant_id=${encodeURIComponent(plantId)}` : '';
        const res = await fetch(`${BASE}/api/blending/wells${qs}`);
        if (res.ok) {
          const json = await res.json();
          // Only trust the result if it actually returned wells data
          if (Array.isArray(json?.wells)) return json;
        }
      } catch {
        // API unavailable — fall through to Supabase
      }

      // 2. Fallback: read directly from the blending_wells Supabase table
      // (same source Plants.tsx uses for the blending checkbox)
      try {
        const { data, error } = await supabase
          .from('blending_wells' as any)
          .select('well_id')
          .eq('plant_id', plantId);
        if (!error && Array.isArray(data) && data.length > 0) {
          return { wells: (data as any[]).map((r) => ({ well_id: r.well_id })) };
        }
      } catch {
        // Table may not exist yet
      }

      return { wells: [] };
    },
    enabled: !!plantId,
    retry: false,
  });
}
