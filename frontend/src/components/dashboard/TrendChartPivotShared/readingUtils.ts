import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { sanitizeReadings } from '@/lib/readingSanitizer';

/** Resolve a single reading row → delta volume (m³). */
export function resolveReadingDelta(r: any, multiplier = 1): number {
  const storedMult = r.multiplier_at_reading != null ? Number(r.multiplier_at_reading) : 1;
  if (r.daily_volume != null) {
    return (storedMult === 1 && multiplier !== 1) ? +r.daily_volume * multiplier : +r.daily_volume;
  }
  const mult = r.multiplier_at_reading != null ? Number(r.multiplier_at_reading) : multiplier;
  if (r.current_reading != null && r.previous_reading != null)
    return (+r.current_reading - +r.previous_reading) * mult;
  return 0;
}

export function buildEntityPivot(
  readings: any[],
  entityField: string,
  directModeIds?: Set<string>,
  minDateKey?: string,
  entityMultipliers?: Map<string, number>,
): { pivot: Map<string, Map<string, number>>; dateKeys: string[] } {
  const pivot = new Map<string, Map<string, number>>();
  const lastSeen = new Map<string, number>();
  const afterRepl = new Set<string>();
  const cleanReadings = sanitizeReadings(readings, entityField, directModeIds);

  cleanReadings.forEach((r) => {
    const dateKey  = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    const entityId = r[entityField] ?? '__';
    const mult = entityMultipliers?.get(entityId) ?? 1;
    const storedMult = r.multiplier_at_reading != null ? Number(r.multiplier_at_reading) : 1;
    const effectiveMult = storedMult !== 1 ? storedMult : mult;

    if (minDateKey && dateKey < minDateKey) {
      if (r.is_meter_replacement) {
        if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
        else lastSeen.delete(entityId);
        afterRepl.add(entityId);
      } else if (afterRepl.has(entityId)) {
        afterRepl.delete(entityId);
        if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
      } else if (r.current_reading != null) {
        lastSeen.set(entityId, +r.current_reading);
      }
      return;
    }

    if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());

    if (r.is_meter_replacement) {
      if (r.current_reading != null) {
        lastSeen.set(entityId, +r.current_reading);
      } else {
        lastSeen.delete(entityId);
      }
      afterRepl.add(entityId);
      pivot.get(dateKey)!.set(entityId, (pivot.get(dateKey)!.get(entityId) ?? 0) + 0);
      return;
    }

    let vol: number;
    if (directModeIds?.has(entityId)) {
      vol = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (afterRepl.has(entityId)) {
      afterRepl.delete(entityId);
      if (lastSeen.has(entityId) && r.current_reading != null) {
        vol = Math.max(0, (+r.current_reading - lastSeen.get(entityId)!) * effectiveMult);
      } else if (r.daily_volume != null) {
        vol = (storedMult === 1 && mult !== 1) ? Math.max(0, +r.daily_volume * mult) : Math.max(0, +r.daily_volume);
      } else if (r.previous_reading != null && r.current_reading != null) {
        vol = Math.max(0, (+r.current_reading - +r.previous_reading) * effectiveMult);
      } else {
        vol = 0;
      }
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (lastSeen.has(entityId) && r.current_reading != null) {
      vol = (+r.current_reading - lastSeen.get(entityId)!) * effectiveMult;
      lastSeen.set(entityId, +r.current_reading);
    } else if (r.daily_volume != null) {
      vol = (storedMult === 1 && mult !== 1) ? +r.daily_volume * mult : +r.daily_volume;
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (r.current_reading != null) {
      const prev = r.previous_reading != null ? +r.previous_reading : null;
      vol = prev != null ? (+r.current_reading - prev) * effectiveMult : 0;
      lastSeen.set(entityId, +r.current_reading);
    } else {
      vol = 0;
    }

    pivot.get(dateKey)!.set(entityId, (pivot.get(dateKey)!.get(entityId) ?? 0) + vol);
  });

  const dateKeys = Array.from(pivot.keys()).sort();
  return { pivot, dateKeys };
}
