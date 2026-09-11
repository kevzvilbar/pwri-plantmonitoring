import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { sanitizeReadings } from '@/lib/readingSanitizer';

/** Resolve a single reading row → delta volume (m³). */
export function resolveReadingDelta(r: any): number {
  if (r.daily_volume != null) return +r.daily_volume;
  if (r.current_reading != null && r.previous_reading != null)
    return +r.current_reading - +r.previous_reading;
  return 0;
}

export function buildEntityPivot(
  readings: any[],
  entityField: string,
  directModeIds?: Set<string>,
  minDateKey?: string,
): { pivot: Map<string, Map<string, number>>; dateKeys: string[] } {
  const pivot = new Map<string, Map<string, number>>();
  const lastSeen = new Map<string, number>();
  const afterRepl = new Set<string>();
  const cleanReadings = sanitizeReadings(readings, entityField, directModeIds);

  cleanReadings.forEach((r) => {
    const dateKey  = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    const entityId = r[entityField] ?? '__';

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
        vol = Math.max(0, +r.current_reading - lastSeen.get(entityId)!);
      } else if (r.daily_volume != null) {
        vol = Math.max(0, +r.daily_volume);
      } else if (r.previous_reading != null && r.current_reading != null) {
        vol = Math.max(0, +r.current_reading - +r.previous_reading);
      } else {
        vol = 0;
      }
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (lastSeen.has(entityId) && r.current_reading != null) {
      vol = +r.current_reading - lastSeen.get(entityId)!;
      lastSeen.set(entityId, +r.current_reading);
    } else if (r.daily_volume != null) {
      vol = +r.daily_volume;
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (r.current_reading != null) {
      const prev = r.previous_reading != null ? +r.previous_reading : null;
      vol = prev != null ? +r.current_reading - prev : 0;
      lastSeen.set(entityId, +r.current_reading);
    } else {
      vol = 0;
    }

    pivot.get(dateKey)!.set(entityId, (pivot.get(dateKey)!.get(entityId) ?? 0) + vol);
  });

  const dateKeys = Array.from(pivot.keys()).sort();
  return { pivot, dateKeys };
}
