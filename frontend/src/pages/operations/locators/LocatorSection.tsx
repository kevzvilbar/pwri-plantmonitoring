import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
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
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/StatusPill';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, AlertTriangle, Loader2, History, FlaskConical, Keyboard, MessageCircleOff, CalendarClock, RefreshCw, PencilLine, ShieldAlert } from 'lucide-react';
import { DerivedMeterIcon } from '@/components/icons/water-icons';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { evaluateReadingGuard } from '@/lib/readingGuards';
import {
  parseCSVText, triggerTemplateDownload, normalizeDatetime,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog, resolveImportDuplicate,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, WELL_MAX_READINGS_PER_DAY, READING_COOLDOWN_MINUTES, SPIKE_MULTIPLIER,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../shared';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { DerivedMeterOverrideDialog } from '@/components/DerivedMeterOverrideDialog';
import { logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';

const LOCATOR_SCHEMA = 'locator_name*, current_reading, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading, input_mode (raw|direct), daily_volume';
const LOCATOR_TEMPLATE_ROW = {
  locator_name: 'MCWD - M1',
  current_reading: '1234.56',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '1200.00',
  input_mode: 'raw',
  daily_volume: '',
};

export function validateLocatorReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.locator_name?.trim()) e.push(`Row ${i}: locator_name is required`);
  const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';
  if (isDirect) {
    if (!r.daily_volume?.trim() || isNaN(Number(r.daily_volume)) || Number(r.daily_volume) <= 0)
      e.push(`Row ${i}: daily_volume must be a positive number when input_mode=direct`);
  } else {
    if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
      e.push(`Row ${i}: current_reading must be a number`);
  }
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.daily_volume && !isDirect && isNaN(Number(r.daily_volume)))
    e.push(`Row ${i}: daily_volume must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

// PERFORMANCE FIX: duplicate detection was already batched (one query for the
// whole file instead of one per row), but new-row inserts were still done one
// INSERT at a time. This adds the same chunked bulk-insert pass used in
// WellSection.tsx's importer — new rows are collected up front and inserted
// in batches, falling back to per-row inserts only for a chunk that errors.
const LOCATOR_INSERT_CHUNK_SIZE = 200;

async function insertLocatorReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[]; affectedIds: string[] }> {
  // Resolve locator names → IDs (single query for the whole batch)
  const { data: locators, error: locatorsErr } = await supabase
    .from('locators').select('id, name').eq('plant_id', plantId);
  // Was: error discarded on both queries below. A failed name-resolution
  // would make every row in the CSV fail to match a locator (safe-ish,
  // just an unhelpful "not found" per row). A failed duplicate-check is
  // worse: `existingByKey` would silently stay empty, and every row —
  // including ones already imported — would be treated as new and bulk-
  // inserted. Re-uploading the same file after a network blip on this
  // check could duplicate an entire day's readings across every locator
  // in it. Abort the whole import instead.
  if (locatorsErr) throw locatorsErr;
  const nameToId: Record<string, string> = {};
  (locators ?? []).forEach((l: any) => { nameToId[l.name.trim().toLowerCase()] = l.id; });

  // ── FIX: Batch duplicate check ───────────────────────────────────────────────
  // Old code did one SELECT per row inside the loop → 60 sequential round-trips
  // for a 60-row CSV, causing the import to hang/never finish.
  // New approach: resolve all locator IDs first, then fetch ALL existing readings
  // for those locators in a single query keyed by "locatorId|YYYY-MM-DDTHH:mm".
  const locatorIds = Object.values(nameToId);
  const existingByKey: Record<string, string> = {}; // "locatorId|dtMin" → reading id
  if (locatorIds.length > 0) {
    const { data: existingReadings, error: existingErr } = await supabase
      .from('locator_readings')
      .select('id, locator_id, reading_datetime')
      .in('locator_id', locatorIds);
    if (existingErr) throw existingErr;
    (existingReadings ?? []).forEach((e: any) => {
      const key = `${e.locator_id}|${(e.reading_datetime as string).slice(0, 16)}`;
      existingByKey[key] = e.id;
    });
  }

  let count = 0;
  const errors: string[] = [];
  // ── HYBRID STRATEGY: track mutated entity IDs for targeted cache flush ──────
  const affectedIds = new Set<string>();
  // New rows are collected here instead of inserted immediately, so they can
  // be bulk-inserted in chunks in the final pass.
  const toInsert: { payload: Record<string, any>; locatorId: string }[] = [];

  for (const r of rows) {
    const locatorId = nameToId[r.locator_name?.trim().toLowerCase()];
    if (!locatorId) { errors.push(`Locator not found: "${r.locator_name}"`); continue; }

    const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
    const dtMin = dt.slice(0, 16); // minute-level key e.g. "2026-04-01T00:00"
    const dupKey = `${locatorId}|${dtMin}`;
    const existingId = existingByKey[dupKey];

    const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';

    if (existingId) {
      // ── Duplicate: ask user then overwrite or skip ───────────────────────────
      // Still one UPDATE at a time — this needs a human decision per row and is
      // normally a small minority of rows, so it isn't worth batching.
      const decision = await resolveImportDuplicate(dupKey, `${r.locator_name} @ ${dtMin}`);
      if (decision === 'skip') continue;

      // Build update payload.
      // FIX: daily_volume is a GENERATED ALWAYS column — omit it from UPDATE too;
      //      Postgres recomputes it automatically from current_reading - previous_reading.
      // Clear is_estimated: operator is entering actual data, overriding any regression estimate.
      const updatePayload: Record<string, any> = { reading_datetime: dt, recorded_by: userId, is_estimated: false };
      if (isDirect) {
        updatePayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
        updatePayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
        // daily_volume omitted — generated column
      } else {
        const csvCurLoc  = +r.current_reading;
        const csvPrevLoc = r.previous_reading ? +r.previous_reading : null;
        updatePayload.current_reading  = csvCurLoc;
        updatePayload.previous_reading = csvPrevLoc;
        const rawLocDelta = csvPrevLoc != null ? csvCurLoc - csvPrevLoc : null;
        if (rawLocDelta != null && rawLocDelta < 0)
          errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta.toFixed(2)}) — meter rollback detected.`);
        // daily_volume omitted — generated column
      }
      const { error } = await supabase.from('locator_readings').update(updatePayload as any).eq('id', existingId);
      if (error) errors.push(error.message); else { count++; existingByKey[dupKey] = existingId; }
      continue;
    }

    // ── New row: queue for bulk insert ───────────────────────────────────────
    // FIX: daily_volume removed — it is a GENERATED ALWAYS AS column in Postgres
    //      (auto-computed as current_reading - previous_reading). Supplying it
    //      causes: "cannot insert a non-DEFAULT value into column daily_volume".
    //      plant_id IS required (NOT NULL constraint) — keep it.
    const insertPayload: Record<string, any> = {
      locator_id:       locatorId,
      plant_id:         plantId,
      reading_datetime: dt,
      recorded_by:      userId,
      is_estimated:     false, // operator-entered — never an estimate
    };

    if (isDirect) {
      // Direct m³ mode: user supplied daily volume explicitly.
      // Store current_reading = previous to preserve the cumulative sequence.
      insertPayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
      insertPayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
      // daily_volume intentionally omitted — GENERATED ALWAYS column
    } else {
      // Raw cumulative meter mode
      const csvCurLoc2  = +r.current_reading;
      const csvPrevLoc2 = r.previous_reading ? +r.previous_reading : null;
      insertPayload.current_reading  = csvCurLoc2;
      insertPayload.previous_reading = csvPrevLoc2;
      const rawLocDelta2 = csvPrevLoc2 != null ? csvCurLoc2 - csvPrevLoc2 : null;
      if (rawLocDelta2 != null && rawLocDelta2 < 0)
        errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta2.toFixed(2)}) — meter rollback detected.`);
      // daily_volume intentionally omitted — GENERATED ALWAYS column
    }

    toInsert.push({ payload: insertPayload, locatorId });
    // Mark so a second row later in this same file with the same key is
    // treated as an intra-batch duplicate, even before the DB insert happens.
    existingByKey[dupKey] = 'pending';
  }

  // ── Bulk-insert new rows in chunks instead of one INSERT per row. A chunk
  // that fails falls back to per-row inserts so one bad row in an otherwise-
  // good batch doesn't discard the rest of that chunk. ──
  for (let i = 0; i < toInsert.length; i += LOCATOR_INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + LOCATOR_INSERT_CHUNK_SIZE);
    const { error: chunkError } = await supabase
      .from('locator_readings')
      .insert(chunk.map(c => c.payload) as any);
    if (!chunkError) {
      count += chunk.length;
      chunk.forEach(c => affectedIds.add(c.locatorId));
      continue;
    }
    for (const { payload, locatorId } of chunk) {
      const { error } = await supabase.from('locator_readings').insert(payload as any);
      if (error) errors.push(error.message);
      else { count++; affectedIds.add(locatorId); }
    }
  }

  return { count, errors, affectedIds: Array.from(affectedIds) };
}

// ─── Derived-locator (Hamas-style) bulk override via CSV ─────────────────────
// Bulk sibling of the single-value "Override" dialog (DerivedMeterOverrideDialog
// + saveOverride() in LocatorRow below) — same is_estimated=false + audit-log
// semantics as that dialog, just looped over N (date, value, reason) rows from
// a CSV instead of one value typed into a form. This is what lets a Manager /
// Data Analyst / Admin backfill several days of corrected Hamas values in one
// upload instead of one "Override" click per day.
//
// Scoped to a single locator — the "Import CSV" button lives inside that
// locator's own row (mirroring "Override"), so unlike LOCATOR_SCHEMA above
// there's no locator_name column; the target locator is fixed by the caller
// (see insertRows={(rows, pid) => insertDerivedOverrideRows(rows, pid, locator.id, ...)}).
//
// No new RLS or audit migration is needed: this writes to locator_readings via
// the same supabase-js calls saveOverride() already uses, so it's already
// gated by the Phase 4 RESTRICTIVE policies (is_manager_or_analyst_or_admin),
// and reading_edit_audit_log already accepts table_name='locator_readings'
// (Phase 0). The generic ImportReadingsDialog wrapper also logs file-level
// metadata (file name, row count, schema errors) to import_audit_log for
// every import, this one included.
const HAMAS_OVERRIDE_SCHEMA = 'date* (YYYY-MM-DD), value* (m3), reason*';
const HAMAS_OVERRIDE_TEMPLATE_ROW = {
  date: '2026-07-27',
  value: '250.00',
  reason: 'Corrected from field notebook — sibling meter was misread on this date.',
};

export function validateDerivedOverrideRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.date?.trim() || isNaN(Date.parse(r.date.trim())))
    e.push(`Row ${i}: date must be a valid date (YYYY-MM-DD)`);
  if (!r.value?.trim() || isNaN(Number(r.value)))
    e.push(`Row ${i}: value must be a number`);
  if (!r.reason?.trim())
    e.push(`Row ${i}: reason is required — it's written to the audit log so the override is explained, not just a changed number`);
  return e;
}

async function insertDerivedOverrideRows(
  rows: Record<string, string>[],
  plantId: string,
  locatorId: string,
  userId: string | null,
  actorLabel: string,
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];

  // Rows sharing a date: keep only the LAST occurrence — re-listing a date is
  // treated the same as re-clicking "Override" for it, not as two separate
  // edits. Every earlier occurrence is reported below rather than silently
  // dropped, so a mistakenly-duplicated row in the file doesn't look like it
  // was applied when it wasn't.
  const lastIndexForDate = new Map<string, number>();
  rows.forEach((r, i) => { const d = r.date?.trim(); if (d) lastIndexForDate.set(d, i); });
  rows.forEach((r, i) => {
    const d = r.date?.trim();
    if (d && lastIndexForDate.get(d) !== i)
      errors.push(`Row ${i + 2} (${d}): superseded by a later row in this file for the same date — only the last row per date is applied.`);
  });
  const byDate = new Map<string, { row: Record<string, string>; line: number }>();
  rows.forEach((r, i) => {
    const d = r.date?.trim();
    if (d && lastIndexForDate.get(d) === i) byDate.set(d, { row: r, line: i + 2 });
  });

  // Existing readings for this locator, bucketed by Asia/Manila calendar date
  // — the same bucketing fn_sweep_derived_meters() uses — so a CSV row lands
  // on the reading the sweep considers "that day's" rather than drifting by a
  // UTC-offset mismatch. (latestReading in LocatorRow only tracks the single
  // most-recent row, which isn't enough here since a bulk override can target
  // several different past dates in one file.)
  const { data: existing, error: existingErr } = await supabase
    .from('locator_readings')
    .select('id, reading_datetime, current_reading, is_estimated')
    .eq('locator_id', locatorId);
  // Was: error discarded. If this lookup failed, `existingByDate` stayed
  // empty and every date below took the INSERT branch instead of UPDATE —
  // creating a brand-new duplicate reading for a date that was supposed to
  // be corrected in place, not doubled.
  if (existingErr) throw existingErr;
  const existingByDate: Record<string, any> = {};
  (existing ?? []).forEach((row: any) => {
    const dKey = new Date(row.reading_datetime).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    if (!existingByDate[dKey] || new Date(row.reading_datetime) > new Date(existingByDate[dKey].reading_datetime)) {
      existingByDate[dKey] = row;
    }
  });

  let count = 0;
  for (const [dateKey, { row, line }] of byDate) {
    try {
      const value = Number(row.value);
      const reason = row.reason.trim();
      const existingRow = existingByDate[dateKey];
      const before = existingRow
        ? { current_reading: existingRow.current_reading, is_estimated: existingRow.is_estimated }
        : {};
      const payload: any = {
        locator_id: locatorId, plant_id: plantId,
        current_reading: value, previous_reading: 0, is_estimated: false,
        recorded_by: userId,
      };
      // Editing an existing row (already computed by the sweep, or a prior
      // override) keeps its stored reading_datetime — same as saveOverride().
      // A brand-new row is dated 23:59 Asia/Manila on the CSV's date, matching
      // fn_sweep_derived_meters()'s own v_reading_dt convention.
      const { data: savedRow, error } = existingRow?.id
        ? await supabase.from('locator_readings').update(payload).eq('id', existingRow.id).select().single()
        : await supabase.from('locator_readings')
            .insert({ ...payload, reading_datetime: new Date(`${dateKey}T23:59:00+08:00`).toISOString() })
            .select().single();
      if (error) throw error;

      await logReadingEdit({
        table_name: 'locator_readings',
        record_id: (savedRow as any)?.id ?? null,
        plant_id: plantId,
        actor_user_id: userId,
        actor_label: actorLabel,
        changes: { ...diffFields(before, { current_reading: value, is_estimated: false }), override_reason: { old: null, new: reason } },
      });
      count++;
    } catch (err: any) {
      errors.push(`Row ${line} (${row.date}): ${friendlyError(err)}`);
    }
  }
  return { count, errors };
}

// Well readings:
// well_name*, current_reading*, reading_datetime, previous_reading, power_meter_reading, solar_meter_reading

export function LocatorReadingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Fetch per-plant locator reading limit from Plant Configuration (manager-configurable)
  const { data: locatorReadingLimit } = useQuery({
    queryKey: ['plant-locator-limit', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const { data } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config')
          .eq('plant_id', plantId)
          .maybeSingle();
        if (data?.config?.locator_readings_per_day != null) return data.config.locator_readings_per_day as number;
      } catch { /* table may not exist yet */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg.locator_readings_per_day != null) return cfg.locator_readings_per_day as number;
        }
      } catch { /* ignore */ }
      return 3; // default
    },
  });
  const maxLocatorReadings = locatorReadingLimit ?? 3;

  const { data: locators } = useQuery({
    queryKey: ['op-locators', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await supabase.from('locators').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!plantId,
  });

  // BUG FIX: locator_readings has NO plant_id column — filtering by it returns 0 rows.
  // Two-step query: resolve active locator IDs for this plant, then fetch readings
  // by locator_id. This mirrors the fix already applied in TrendChart and Dashboard.
  const { data: _locatorIds } = useQuery({
    queryKey: ['op-locator-ids', plantId],
    queryFn: async () => {
      if (!plantId) return [] as string[];
      const { data, error } = await supabase
        .from('locators').select('id').eq('plant_id', plantId).eq('status', 'Active');
      if (error) throw error;
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-loc-recent', plantId],
    queryFn: async () => {
      const locatorIds = _locatorIds ?? [];
      if (!locatorIds.length) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      return (await supabase.from('locator_readings')
        .select('*').in('locator_id', locatorIds)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })
        // Safety cap — PostgREST default is 1 000 rows; high-frequency plants
        // (e.g. hourly Mambaling: 24/day × 30d × N locators) can exceed that,
        // causing silent truncation. 5 000 covers even the most aggressive schedule.
        .limit(5000)).data ?? [];
    },
    enabled: !!plantId && (_locatorIds !== undefined),
    staleTime: 0,             // always treat cached data as stale on mount/focus
    // FIX (egress): this is the priciest poller in the file — up to 5000
    // rows, select('*'), every 30s, per open tab. Readings are manually
    // entered, so the underlying data doesn't actually move on a 30s
    // cadence; 2min still surfaces another operator's entry well within
    // the same shift. Bump further (or move to a postgres_changes
    // subscription like TrendChart.tsx already does, so this only refetches
    // when a row actually changes) if egress is still high after this pass.
    refetchInterval: 120_000,
  });

  // ── Dedicated latest-reading query ────────────────────────────────────────
  // Fetches exactly ONE row per locator (the absolute newest), completely
  // independent of the 30-day window above.  This guarantees that `prev` in
  // the entry card always reflects the true latest reading even when the plant
  // has hourly readings and the 30-day dump would otherwise be truncated by
  // PostgREST's row limit.
  const { data: latestReadingsRaw } = useQuery({
    queryKey: ['op-loc-latest', _locatorIds],
    queryFn: async () => {
      const locatorIds = _locatorIds ?? [];
      if (!locatorIds.length) return [];
      // One lightweight query per locator — N is small (typically 1–10)
      const results = await Promise.all(
        locatorIds.map(id =>
          supabase.from('locator_readings')
            .select('*')
            .eq('locator_id', id)
            .order('reading_datetime', { ascending: false })
            .limit(1),
        ),
      );
      return results.flatMap(r => r.data ?? []);
    },
    enabled: !!plantId && !!_locatorIds?.length,
    staleTime: 0,
    // FIX (egress): payload is small (1 row per locator) so this one was
    // never the big cost, but bumped in lockstep with op-loc-recent above
    // so the two queries don't drift out of sync with each other.
    refetchInterval: 120_000,
  });

  // latestByLocator — sourced from the dedicated query above, NOT from the
  // 30-day dump, so it is immune to row-limit truncation.
  const latestByLocator = useMemo(() => {
    const latest: Record<string, any> = {};
    latestReadingsRaw?.forEach((r: any) => { latest[r.locator_id] = r; });
    return latest;
  }, [latestReadingsRaw]);

  const { todayByLocator, avgByLocator } = useMemo(() => {
    const today: Record<string, any[]> = {};
    const avgs: Record<string, number | null> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    // 10-day window for average flow-rate computation (not 30-day raw volume)
    const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const readingsByLocator: Record<string, any[]> = {};
    recentReadings?.forEach((r: any) => {
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.locator_id] ||= []).push(r);
      // Collect readings within the 10-day window for Q=V/t computation
      if (new Date(r.reading_datetime) >= tenDaysAgo)
        (readingsByLocator[r.locator_id] ||= []).push(r);
    });
    // Q = V / t — compute time-normalised flow rate (m³/hr) for each consecutive pair,
    // then average those rates so that readings taken at different intervals are comparable.
    for (const [locId, readings] of Object.entries(readingsByLocator)) {
      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const flowRates: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const vol = sorted[i].current_reading - sorted[i - 1].current_reading;
        const hrs = (new Date(sorted[i].reading_datetime).getTime() - new Date(sorted[i - 1].reading_datetime).getTime()) / 3_600_000;
        if (vol > 0 && hrs > 0) flowRates.push(vol / hrs);
      }
      avgs[locId] = flowRates.length ? flowRates.reduce((s, n) => s + n, 0) / flowRates.length : null;
    }
    return { todayByLocator: today, avgByLocator: avgs };
  }, [recentReadings]);

  // "No reading — why?" gap reasons logged for today, keyed by locator ID.
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const { data: gapReasons } = useQuery({
    queryKey: ['locator-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'locator')
        .eq('gap_date', todayDateStr);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const gapReasonsByLocator = useMemo(() => {
    const m: Record<string, any> = {};
    (gapReasons ?? []).forEach((g: any) => { m[g.entity_id] = g; });
    return m;
  }, [gapReasons]);

  return (
    <div className="space-y-3">
      {/* Plant selector card */}
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 h-10 border-kpi-locator/60 text-kpi-locator hover:bg-kpi-locator/10 hover:border-kpi-locator"
              onClick={() => setImportOpen(true)}
              data-testid="import-locator-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          {/* Section header */}
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-kpi-locator" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Active Locators</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">
              {locators?.length ?? 0} total
            </span>
          </div>
          {locators?.length ? (
            <MobileCarousel
              isMobile={isMobile}
              items={locators ?? []}
              renderItem={(l: any) => (
                <LocatorRow
                  key={l.id}
                  locator={l} plantId={plantId}
                  previous={latestByLocator[l.id]?.current_reading ?? null}
                  previousDt={latestByLocator[l.id]?.reading_datetime ?? null}
                  latestReading={latestByLocator[l.id] ?? null}
                  todayReadings={todayByLocator[l.id] ?? []}
                  avgVol={avgByLocator[l.id] ?? null}
                  userId={user?.id}
                  onSaved={() => invalidateLocatorDash(qc)}
                  isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                  maxReadingsPerDay={maxLocatorReadings}
                  gapReason={gapReasonsByLocator[l.id] ?? null}
                  onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['locator-gap-reasons', plantId, todayDateStr] })}
                />
              )}
            />
          ) : (
            <p className="p-4 text-xs text-muted-foreground text-center">No active locators for this plant</p>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Locator Readings from CSV"
          module="Locator Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={LOCATOR_SCHEMA}
          templateFilename="locator_readings_template.csv"
          templateRow={LOCATOR_TEMPLATE_ROW}
          validateRow={validateLocatorReadingRow}
          insertRows={(rows, pid) => insertLocatorReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); invalidateDashboard(qc); }}
        />
      )}
    </div>
  );
}

function LocatorRow({
  locator, plantId, previous, previousDt, latestReading, todayReadings, avgVol, userId, onSaved, isManagerOrAdmin, maxReadingsPerDay = 3,
  gapReason, onGapReasonSaved,
}: {
  locator: any; plantId: string; previous: number | null; previousDt: string | null;
  latestReading?: any | null;
  todayReadings: any[]; avgVol: number | null;
  userId: string | undefined; onSaved: () => void;
  isManagerOrAdmin: boolean;
  maxReadingsPerDay?: number;
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
}) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();

  const [reading, setReading]     = useState('');
  const lastPrefilledLoc = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt]   = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
  // "Meter replaced" — same two-way wiring fix as WellRow: live at entry time
  // (previously only reachable from Reading History, after the fact), opening
  // the same required ReplaceMeterDialog. Raw-mode only — 'direct' locators
  // (e.g. HAMAS) have no cumulative odometer for a physical meter swap to apply to.
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);

  // Draft recovery — persists the reading input so an accidental navigation
  // or browser crash doesn't lose what the operator was entering.
  const { draft: draftReading, setDraft: setDraftReading, clearDraft: clearDraftReading } =
    useDraft(`loc-reading-${locator.id}`, { value: '' });
  useEffect(() => {
    if (reading === '' && draftReading.value) setReading(draftReading.value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 'raw'  = user enters cumulative meter reading; delta = cur - prev
  // 'direct' = user enters daily m³ directly; stored as daily_volume
  //
  // CHANGED: this used to be a local useState hardcoded to 'raw' with NO
  // persistence at all (reset every remount/navigation — worse than the
  // localStorage-per-device version BlendingSection.tsx has). It's now
  // sourced from locators.default_input_mode, set once per locator by a
  // Manager/Admin in Plant config (Locators tab), so every operator on every
  // device sees the same, deliberately-chosen mode for a given meter.
  // Operators can no longer flip it ad hoc — see the read-only badge below
  // instead of the old clickable Raw/Direct toggle.
  const locInputMode: 'raw' | 'direct' = locator.default_input_mode === 'direct' ? 'direct' : 'raw';

  // Pre-fill the drum with the latest previous reading so the operator
  // starts from the real odometer value and rolls only the changed digits.
  //
  // Race-condition fix — two scenarios both produce stale display:
  //  (A) After save: setReading('') fires synchronously, effect pre-fills with
  //      OLD `previous` before 'op-loc-recent' refetches. When the query later
  //      returns NEW `previous`, reading !== '' so the effect no-ops → stale drum.
  //  (B) The periodic poll (refetchInterval) on op-loc-recent fires and brings in
  //      a newer reading from another session — same no-op because reading !== ''.
  //  Fix: track the last auto-filled value in a ref. If `previous` changes and the
  //  drum still shows that old auto-fill (user hasn't touched it), update to latest.
  useEffect(() => {
    if (locInputMode !== 'raw' || previous == null || editingId) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledLoc.current) {
      setReading(expected);
      lastPrefilledLoc.current = expected;
    }
  }, [previous, locInputMode, editingId, reading]);

  const cur      = +reading || 0;
  // A reading that exactly equals previous is the pre-filled baseline, not a new entry.
  const readingChanged = reading !== '' && (previous == null || cur !== previous);
  const dailyVol = locInputMode === 'direct'
    ? (reading ? +reading : null)                      // entered value IS the delta
    : (readingChanged && previous != null ? cur - previous : null);
  const belowPrev = locInputMode === 'raw' && previous != null && cur > 0 && cur < previous;
  // Q = V / t: compute current flow rate (m³/hr) from delta ÷ hours since last reading.
  // avgVol is the 10-day average flow rate (m³/hr); warn when current rate exceeds avg × multiplier.
  const hoursElapsedLoc = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const currentFlowRateLoc = dailyVol != null && hoursElapsedLoc != null && hoursElapsedLoc > 0
    ? dailyVol / hoursElapsedLoc
    : null;
  const highVol = locInputMode === 'raw' && avgVol != null && currentFlowRateLoc != null
    && currentFlowRateLoc > avgVol * ALERTS.avg_multiplier_warn;
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= maxReadingsPerDay;

  // ── Alert state for odometer drum ─────────────────────────────────────────
  const odometerAlert: OdometerAlertState =
    !readingChanged   ? 'neutral' :
    belowPrev         ? 'warn'    :
    highVol           ? 'warn'    :
    (+reading < 0 && locInputMode === 'raw') ? 'error' :
    'ok';

  // Tracks whether the last save was auto-quarantined as pending_review
  const [lastSavePending, setLastSavePending] = useState(false);
  // Cooldown: minutes left before operator can submit again for this locator
  const [cooldownMinutes, setCooldownMinutes] = useState(0);
  const [cooldownAvailableAt, setCooldownAvailableAt] = useState<Date | null>(null);
  // Item 8: correction request target drives the dialog (replaces window.prompt)
  // HOISTED (2026-07-25): this useState used to sit after the `if (locator.is_derived)
  // return (...)` early-return below. React Hooks must be called unconditionally, in
  // the same order, on every render — a hook declared after a conditional return is a
  // real bug (react-hooks/rules-of-hooks), not just a lint nitpick: if `locator.is_derived`
  // ever flips for an already-mounted row (e.g. an admin toggles it, or a refetch brings
  // in an updated value), React throws "Rendered more hooks than during the previous
  // render" and can crash the whole Operations page. Moved above so it's always called.
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);

  const save = async () => {
    if (!reading) { toast.error(`${locator.name}: enter a reading`); return; }
    if (atLimit) { toast.error(`${locator.name}: max ${maxReadingsPerDay} readings/day reached`); return; }
    if (locInputMode === 'direct' && +reading <= 0) { toast.error(`${locator.name}: enter a positive volume`); return; }

    // ── Pre-flight guard: cooldown + backward/spike detection ────────────────
    // Mirrors the DB trigger logic (fn_locator_reading_integrity) so the UI can
    // give instant feedback before the round-trip. The trigger is the source of
    // truth; this is a UX convenience only.
    if (!editingId && userId) {
      setSaving(true);
      const guard = await evaluateReadingGuard(
        'locator', locator.id, plantId, userId,
        // SUPERSEDES the 2026-07-27 "previous + cur" workaround: that fix
        // tried to make direct-mode readings look like a cumulative value so
        // the (raw-mode-only) generic guard math wouldn't misfire on them.
        // evaluateReadingGuard now branches on inputMode natively, so the
        // real typed volume can be passed straight through.
        cur,
        new Date(customDt), !!meterReplacePending, false, avgVol, false, locInputMode,
      );
      setSaving(false);

      if (guard.status === 'blocked' && guard.reason === 'cooldown') {
        setCooldownMinutes(guard.minutesLeft);
        setCooldownAvailableAt(guard.availableAt);
        toast.error(
          `${locator.name}: cooldown — next reading available in ${formatCooldown(guard.minutesLeft)}.`,
          { duration: 6000 },
        );
        return;
      }
      if (guard.status === 'pending_review') {
        // Save proceeds — DB trigger will also set pending_review independently.
        toast.info(`${locator.name}: ${guard.detail}`, { duration: 8000 });
      }
    }

    setSaving(true);
    let gps_lat = null, gps_lng = null, off = false;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
      if (locator.gps_lat && locator.gps_lng)
        off = isOffLocation(gps_lat, gps_lng, locator.gps_lat, locator.gps_lng, 100);
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    // NOTE: previous_reading is intentionally omitted from the payload.
    // The DB trigger fn_locator_reading_integrity() overwrites it with the last
    // confirmed (non-retracted, non-pending_review) reading. Sending it from
    // the client would be ignored by the trigger; omitting it makes the intent explicit
    // and prevents stale anchor values from leaking through if the trigger is disabled.
    const payload: any = locInputMode === 'direct'
      ? {
          locator_id: locator.id, plant_id: plantId,
          // current_reading IS the typed volume for direct mode — no need to
          // fake a cumulative value. fn_locator_reading_integrity() (as of
          // the 2026-07-28 input-mode-aware fix) and the History view both
          // read locators.default_input_mode directly, so there's no longer
          // any generic cumulative-meter logic here to work around.
          current_reading: cur,
          // previous_reading: owned by DB trigger — DO NOT send from client
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
        }
      : {
          locator_id: locator.id, plant_id: plantId,
          current_reading: cur,
          // previous_reading: owned by DB trigger — DO NOT send from client
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
          is_meter_replacement: !!meterReplacePending,
        };

    const { data: savedRow, error } = editingId
      ? await (supabase.from('locator_readings').update(payload).eq('id', editingId).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any)
      : await (supabase.from('locator_readings').insert(payload).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any);

    setSaving(false);

    if (error) {
      // 23505 = unique_violation: same user already submitted within this clock hour (SRP double-entry)
      if (error.code === '23505') {
        toast.error(
          `${locator.name}: a reading was already submitted within the last hour. Check the log before resubmitting.`,
          { duration: 8000 },
        );
      } else {
        toast.error(friendlyError(error));
      }
      return;
    }

    // Link the replacement record (old final / new initial / date) back to the
    // reading it produced — best-effort, mirrors WellRow's save().
    if (meterReplacePending?.replacementId && savedRow?.id) {
      await (supabase.from('locator_meter_replacements' as any) as any)
        .update({ reading_id: savedRow.id })
        .eq('id', meterReplacePending.replacementId);
    }

    const isPending = savedRow?.norm_status === 'pending_review';
    setLastSavePending(isPending);
    setCooldownMinutes(0);
    setCooldownAvailableAt(null);

    if (isPending) {
      toast.info(`${locator.name}: reading saved and sent to supervisor for review.`, { duration: 6000 });
    } else {
      const curr = savedRow?.current_reading;
      const prev = savedRow?.previous_reading;
      const vol  = savedRow?.daily_volume;
      toast.success(fmtSaveToast(locator.name, editingId ? 'updated' : 'saved', curr, prev, vol), { duration: 5000 });
    }
    setReading(''); clearDraftReading(); setEditingId(null); onSaved();
    setMeterReplacePending(null); setShowReplaceMeter(false);
  };

  // ── Derived locator (no physical meter) — GAP FIX (2026-07-25) ────────────
  // is_derived locators (e.g. Mambaling / Hamas at SRP) have no meter to read.
  // Their volume is computed by fn_sweep_derived_meters() as
  // residual = mother meter − other (non-derived) locators on the same meter.
  // This used to render the exact same enterable input as every other
  // locator, inviting an operator to type in a number that the sweep would
  // then either sit alongside (double-counting) or silently overwrite —
  // and it's the reason Hamas showed an empty "Meter reading" box with a
  // Save button in Operations even though it's supposed to be hands-off.
  // Replace the entry UI with a read-only status row instead; history is
  // still viewable for Managers/Admins so they can see what the sweep has
  // computed so far.
  const { user } = useAuth();
  const actorLabel = user?.email ?? 'Unknown user';

  // ── Derived-locator (Hamas-style) review/override state ────────────────
  // Hooks must stay unconditional (see the HOISTED note above `correctionTarget`),
  // so these live here even though only the is_derived branch below uses them.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [recalcSaving, setRecalcSaving] = useState(false);
  const [importOverrideOpen, setImportOverrideOpen] = useState(false);

  const { data: reviewFlag } = useQuery({
    queryKey: ['derived-review-flag', locator.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from('locator_derived_review_flags' as any) as any)
        .select('id, date_key, flagged_at')
        .eq('locator_id', locator.id)
        .is('resolved_at', null)
        .order('flagged_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; date_key: string; flagged_at: string } | null;
    },
    enabled: !!locator.is_derived,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const recalcNow = async () => {
    setRecalcSaving(true);
    try {
      const p_date = format(new Date(), 'yyyy-MM-dd');
      const { error } = await (supabase.rpc as any)('fn_sweep_derived_meters', { p_date, p_lookback_days: 3 });
      if (error) throw error;
      toast.success(`${locator.name}: recalculated.`);
      qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
      qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setRecalcSaving(false);
    }
  };

  const saveOverride = async (value: number, reason: string) => {
    setOverrideSaving(true);
    try {
      const before = latestReading
        ? { current_reading: latestReading.current_reading, is_estimated: latestReading.is_estimated }
        : {};
      const payload: any = {
        locator_id: locator.id, plant_id: plantId,
        current_reading: value, previous_reading: 0, is_estimated: false,
        recorded_by: userId,
      };
      // Editing the existing row (if the sweep already wrote one) keeps the
      // same reading_datetime, so the override lands on the date it's meant
      // to correct rather than shifting to "now".
      const { data: savedRow, error } = latestReading?.id
        ? await supabase.from('locator_readings').update(payload).eq('id', latestReading.id).select().single()
        : await supabase.from('locator_readings').insert({ ...payload, reading_datetime: new Date().toISOString() }).select().single();
      if (error) throw error;

      await logReadingEdit({
        table_name: 'locator_readings',
        record_id: (savedRow as any)?.id ?? null,
        plant_id: plantId,
        actor_user_id: userId ?? null,
        actor_label: actorLabel,
        changes: { ...diffFields(before, { current_reading: value, is_estimated: false }), override_reason: { old: null, new: reason } },
      });

      toast.success(`${locator.name}: override saved.`);
      setOverrideOpen(false);
      qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
      qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
      onSaved();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setOverrideSaving(false);
    }
  };

  if (locator.is_derived) {
    return (
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground break-words">{locator.name}</div>
            <span className="inline-flex items-center gap-1 text-3xs font-bold uppercase tracking-widest bg-warn-soft text-warn px-1.5 py-0.5 rounded-full shrink-0">
              <DerivedMeterIcon className="h-2.5 w-2.5" /> Derived
            </span>
          </div>
          {isManagerOrAdmin && (
            <Button variant="ghost" size="sm"
              className="h-9 w-9 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={() => setShowHistory(true)} title="View computed reading history">
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {reviewFlag && (
          <div className="flex items-center gap-1.5 text-xs text-warn bg-warn-soft border border-warn/40 rounded-lg px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warn" />
            <span>
              Needs review — a sibling locator or the mother meter changed for {new Date(reviewFlag.date_key).toLocaleDateString()} since this was last computed.
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-lg px-3 py-2">
          <DerivedMeterIcon className="h-3.5 w-3.5 shrink-0 text-warn" />
          <span>
            No physical meter — volume is auto-computed as mother meter minus other locators.
            {/* FIX (2026-07-26): the residual sweep can only compute a day's
                value once that day has closed (it needs that day's mother-meter
                and sibling readings to already exist), so a derived locator's
                own reading is never dated "today" — lastToday (today-only)
                was permanently empty for this row even once the sweep was
                running. latestReading (the dedicated latest-per-locator query,
                unscoped by date) is what actually reflects the sweep's output. */}
            {latestReading ? (
              latestReading.is_estimated === false ? (
                <> Manually overridden: <span className="font-mono-num font-medium text-foreground/80">{fmtNum(latestReading.daily_volume)} m³</span> on {new Date(latestReading.reading_datetime).toLocaleDateString()}.</>
              ) : (
                <> Last computed: <span className="font-mono-num font-medium text-foreground/80">{fmtNum(latestReading.daily_volume)} m³</span> on {new Date(latestReading.reading_datetime).toLocaleDateString()}.</>
              )
            ) : (
              <> Not yet computed — waiting on the next sweep (runs every 8h), or recalculate now below.</>
            )}
          </span>
        </div>

        {isManagerOrAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" disabled={recalcSaving} onClick={recalcNow}>
              {recalcSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recalculate now
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOverrideOpen(true)}>
              <PencilLine className="h-3.5 w-3.5" />
              Override
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setImportOverrideOpen(true)}>
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </Button>
          </div>
        )}

        {showHistory && (
          <ReadingHistoryDialog
            entityName={locator.name}
            module="locator"
            entityId={locator.id}
            plantId={plantId}
            assetMeterSerial={locator.meter_serial}
            defaultInputMode={locator.default_input_mode === 'direct' ? 'direct' : 'raw'}
            onClose={() => setShowHistory(false)}
          />
        )}
        {overrideOpen && (
          <DerivedMeterOverrideDialog
            open={overrideOpen}
            onOpenChange={setOverrideOpen}
            locatorName={locator.name}
            currentValue={latestReading?.daily_volume ?? null}
            busy={overrideSaving}
            onConfirm={saveOverride}
          />
        )}
        {importOverrideOpen && (
          <ImportReadingsDialog
            title={`Bulk Override ${locator.name} from CSV`}
            module="Derived Meter Override"
            plantId={plantId}
            userId={userId ?? null}
            schemaHint={HAMAS_OVERRIDE_SCHEMA}
            templateFilename={`${locator.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_override_template.csv`}
            templateRow={HAMAS_OVERRIDE_TEMPLATE_ROW}
            validateRow={validateDerivedOverrideRow}
            insertRows={(rows, pid) => insertDerivedOverrideRows(rows, pid, locator.id, userId ?? null, actorLabel)}
            onClose={() => setImportOverrideOpen(false)}
            onImported={() => {
              setImportOverrideOpen(false);
              qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
              qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
              onSaved();
            }}
          />
        )}
      </div>
    );
  }

  // ── Shared action buttons row (edit / cancel / history) ────────────────────
  // Item 2: within 2h = free edit; 2h-7days = correction request sent to pending_review
  // Item 9: locked readings (approved by supervisor) cannot be self-edited regardless of age
  const lastTodayAge  = lastToday ? (Date.now() - new Date(lastToday.reading_datetime).getTime()) / 60_000 : Infinity;
  const isLocked      = !!(lastToday as any)?.locked_at;
  const canSelfEdit   = lastTodayAge <= 120 && !isLocked; // within 2 hours AND not locked
  const canRequest    = lastTodayAge > 120 && lastTodayAge < 7 * 24 * 60 && !isLocked; // 2h→7d AND not locked

  const handleCorrectionRequest = () => {
    if (!lastToday) return;
    setCorrectionTarget({
      id:              lastToday.id,
      sourceTable:     'locator_readings',
      plantId:         plantId,
      entityName:      locator.name,
      currentReading:  lastToday.current_reading,
      previousReading: lastToday.previous_reading ?? null,
      dailyVolume:     lastToday.daily_volume ?? null,
      readingDatetime: lastToday.reading_datetime,
    });
  };

  const ActionButtons = (
    <>
      {lastToday && !editingId && canSelfEdit && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={() => { setEditingId(lastToday.id); setReading(String(lastToday.current_reading)); }}
          title={`Edit last reading (${fmtNum(lastToday.current_reading)})`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {editingId && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={() => { setEditingId(null); setReading(''); }} title="Cancel edit">
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      {isManagerOrAdmin && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={() => setShowHistory(true)} title="View reading history">
          <History className="h-3.5 w-3.5" />
        </Button>
      )}
      {/* Item 9: locked badge — reading approved by supervisor, cannot be edited */}
      {isLocked && lastToday && !editingId && (
        <span className="h-10 px-2 flex items-center text-2xs font-medium text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/40 rounded-lg gap-1 shrink-0">
          🔒 Locked
        </span>
      )}
      {/* Item 8: correction request — visible for entries 2h–7d old that aren't locked */}
      {lastToday && !editingId && canRequest && (
        <Button variant="ghost" size="sm"
          className="h-10 px-2.5 rounded-lg shrink-0 text-warn hover:text-warn hover:bg-warn/10 text-xs font-medium gap-1.5"
          onClick={handleCorrectionRequest}
          title="Entry is older than 2 hours — submit a correction request for supervisor review">
          ✎ Fix
        </Button>
      )}
      {/* Item 8: CorrectionRequestDialog mounts when correctionTarget is set */}
      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget}
          onClose={() => setCorrectionTarget(null)}
          onSubmitted={() => { setCorrectionTarget(null); onSaved(); }}
        />
      )}
    </>
  );

  return (
    <div className="px-4 py-3 space-y-2.5">
      {/* Row 1: Name + editing badge (full width — no truncation) */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground break-words">{locator.name}</div>
          {/* Meter lock state — separate concept from the supervisor-approval
              "Locked" badge further down this card. Intentionally a
              different icon (ShieldAlert, not Lock) and tone so the two
              never look like the same thing. Always shown while is_locked,
              not just when there's a reading today, so it stays visible
              even on a day nobody's logged anything yet. */}
          {locator.is_locked && (
            <StatusPill tone="danger">
              <ShieldAlert className="h-3 w-3" />
              meter locked
            </StatusPill>
          )}
          {lastToday?.off_location_flag && (
            <StatusPill tone="warn"><MapPin className="h-3 w-3" /> off-site</StatusPill>
          )}
          {editingId && (
            <span className="text-2xs font-semibold uppercase tracking-widest text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.5 rounded">Editing</span>
          )}
          {todayCount === 0 && !editingId && (
            gapReason ? (
              <button
                type="button"
                onClick={() => setGapDialogOpen(true)}
                title={`No reading — ${reasonCategoryLabel(gapReason.reason_category)}${gapReason.reason_detail ? ': ' + gapReason.reason_detail : ''} (click to edit)`}
                className="shrink-0 inline-flex items-center gap-0.5 text-2xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-1.5 py-0.5 rounded-full hover:bg-amber-100 transition-colors"
                data-testid={`locator-gap-reason-badge-${locator.id}`}
              >
                <MessageCircleOff className="h-2.5 w-2.5" />
                {reasonCategoryLabel(gapReason.reason_category)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setGapDialogOpen(true)}
                title="No reading today — log why"
                aria-label="No reading today — log why"
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                data-testid={`locator-gap-reason-btn-${locator.id}`}
              >
                <MessageCircleOff className="h-3.5 w-3.5" />
              </button>
            )
          )}
        </div>
        {/* Date picker always visible, not fighting for space with the name */}
        <label className="shrink-0 cursor-pointer relative">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted border border-border/70 rounded-md px-3.5 py-1.5 font-mono-num whitespace-nowrap hover:bg-muted/80 transition-colors"
            onClick={(e) => {
              // Clicking inside the input's own box only focuses/places the
              // cursor in most browsers — it does not open the picker
              // overlay. Explicitly request it so a single click/tap always
              // pops it up (falls back to focus() where showPicker() isn't
              // supported, e.g. Firefox).
              e.preventDefault();
              const el = dtInputRef.current;
              if (!el) return;
              if (typeof el.showPicker === 'function') {
                try { el.showPicker(); } catch { el.focus(); }
              } else {
                el.focus();
              }
            }}
          >
            {customDt ? new Date(customDt).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}
            <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
          </span>
          <Input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" tabIndex={-1} />
        </label>
      </div>

      {/* Row 2: input mode (read-only — set in Plant config > Locators by a Manager/Admin) + status */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center rounded-lg border border-border overflow-hidden text-2xs font-semibold shrink-0 px-2.5 py-1.5 bg-kpi-locator text-white"
          title={locInputMode === 'raw'
            ? 'Cumulative meter reading — Δ auto-computed. Set in Plant config > Locators.'
            : 'Daily m³ entered directly. Set in Plant config > Locators.'}
        >
          {locInputMode === 'raw' ? 'Raw' : 'Direct m³'}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {locInputMode === 'raw' ? (
            <>
              prev: <span className="font-mono-num text-foreground/80">{previous == null ? '—' : fmtNum(previous)}</span>
              {/* On mobile the delta is shown below the drum, so only show it inline on desktop */}
              {!isMobile && dailyVol != null && <> · Δ <span className="font-mono-num font-medium text-teal-700 dark:text-teal-400">{fmtNum(dailyVol)} m³</span></>}
              <span className="mx-1.5 text-border">·</span>
              <span className={atLimit ? 'text-warn-foreground font-medium' : 'text-muted-foreground'}>{todayCount}/{maxReadingsPerDay} today</span>
            </>
          ) : (
            <>
              {dailyVol != null ? <><span className="font-mono-num font-medium text-teal-700 dark:text-teal-400">{fmtNum(dailyVol)} m³</span> to save</> : <span className="text-muted-foreground/60">enter daily volume</span>}
              <span className="mx-1.5 text-border">·</span>
              <span className={atLimit ? 'text-warn-foreground font-medium' : 'text-muted-foreground'}>{todayCount}/{maxReadingsPerDay} today</span>
            </>
          )}
        </div>
      </div>

      {/* ── Row 3 (mobile raw mode): Odometer drum + current reading + save ── */}
      {isMobile && locInputMode === 'raw' ? (
        <div className="space-y-2">
          {/* Drum display */}
          <OdometerRollerInput
            value={reading}
            onChange={(v) => { setReading(v); setDraftReading({ value: v }); }}
            alertState={odometerAlert}
            disabled={saving || atLimit}
            testId={`loc-odometer-${locator.id}`}
          />

          {/* Current reading label + delta */}
          <div className="flex items-center justify-between text-xs px-0.5 min-h-[18px]">
            <span className="text-muted-foreground">
              Current:{' '}
              <span className={`font-mono-num font-semibold ${reading ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {reading ? (+reading).toFixed(2) : '—'}
              </span>
            </span>
            {dailyVol != null && (
              <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                Δ {fmtNum(dailyVol)} m³
              </span>
            )}
          </div>

          {/* Save + action buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={save} disabled={saving || !readingChanged || atLimit}
              className="flex-1 h-11 text-sm bg-kpi-locator hover:bg-kpi-locator/90 active:bg-kpi-locator/80 text-white shadow-sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update' : 'Save'}
            </Button>
            {ActionButtons}
          </div>
        </div>
      ) : (
        /* ── Row 3 (desktop or direct-mode): standard Input row ── */
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Droplet className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-kpi-locator pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading} onChange={(e) => { setReading(e.target.value); setDraftReading({ value: e.target.value }); }}
              placeholder={locInputMode === 'direct' ? 'Daily volume (m³)' : 'Meter reading'}
              className="pl-8 h-10 bg-kpi-locator/5 border-kpi-locator/30 focus-visible:ring-kpi-locator/30"
            />
          </div>
          <Button
            onClick={save} disabled={saving || !readingChanged || atLimit}
            className="h-10 px-4 text-sm shrink-0 bg-kpi-locator hover:bg-kpi-locator/90 active:bg-kpi-locator/80 text-white shadow-sm"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? 'Update' : 'Save'}
          </Button>
          {ActionButtons}
        </div>
      )}

      {/* Meter replaced — raw mode only; 'direct' locators (e.g. HAMAS) enter a
          daily volume, not a cumulative reading, so there's no physical odometer
          value for a swap to apply to. */}
      {locInputMode === 'raw' && (
        <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer select-none">
          <Checkbox
            checked={!!meterReplacePending}
            onCheckedChange={(v) => {
              if (v === true) setShowReplaceMeter(true);
              else setMeterReplacePending(null);
            }}
          />
          Meter replaced
          {meterReplacePending && <span className="text-primary font-medium">— logged</span>}
        </label>
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={locator.name}
          module="locator"
          entityId={locator.id}
          plantId={plantId}
          assetMeterSerial={locator.meter_serial}
          defaultInputMode={locator.default_input_mode === 'direct' ? 'direct' : 'raw'}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showReplaceMeter && (
        <ReplaceMeterDialog
          kind="locator"
          assetId={locator.id}
          plantId={plantId}
          oldSerial={locator.meter_serial}
          onSuccess={(info) => {
            setMeterReplacePending(info ?? { newInitialReading: null, replacementId: null });
            if (info?.newInitialReading != null && (reading === '' || reading === previous?.toFixed(2))) {
              setReading(String(info.newInitialReading));
            }
          }}
          onClose={() => setShowReplaceMeter(false)}
        />
      )}
      {cooldownMinutes > 0 && cooldownAvailableAt && (
        <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Cooldown active — next reading available at{' '}
          {cooldownAvailableAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}{' '}
          ({cooldownMinutes} min remaining).
        </div>
      )}

      {lastSavePending && !cooldownMinutes && (
        <div className="flex items-center gap-1.5 rounded-md bg-warn-soft border border-warn/40 px-2.5 py-1.5 text-xs text-warn">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Last reading sent for supervisor review — excluded from totals until approved.
        </div>
      )}

      {reading && (belowPrev || highVol) && !lastSavePending && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn/30 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {belowPrev ? 'Below previous — will go to supervisor review after save.' : `Flow rate ${Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above avg — will go to supervisor review after save.`}
          </span>
          {belowPrev && (
            <span className="text-warn pl-5">
              If the meter was replaced, check "Meter replaced" above instead.
            </span>
          )}
        </div>
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={`No reading today for "${locator.name}" — why?`}
        description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={async (category, detail) => {
          setGapSaving(true);
          const todayDateStr = format(new Date(), 'yyyy-MM-dd');
          const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
            [{
              entity_type: 'locator', entity_id: locator.id, plant_id: plantId,
              gap_date: todayDateStr, reason_category: category, reason_detail: detail || null,
              logged_by: userId ?? null,
            }] as any,
            { onConflict: 'entity_type,entity_id,gap_date' },
          );
          setGapSaving(false);
          if (error) { toast.error(friendlyError(error)); return; }
          toast.success(`${locator.name}: reason logged`);
          setGapDialogOpen(false);
          onGapReasonSaved?.();
        }}
      />
    </div>
  );
}

// ─── WELL ────────────────────────────────────────────────────────────────────

// ─── SharedPowerMeterRow ──────────────────────────────────────────────────────
// Shown once per shared-power-meter group, above the member wells.
// Saves the raw kWh reading to the primary well's record for that day.
function SharedPowerMeterRow({
  groupName, primaryWellId, plantId, previousPower, userId, onSaved,
}: {
  groupName: string;
  primaryWellId: string;
  plantId: string;
  previousPower: number | null;
  userId: string | undefined;
  onSaved: () => void;
}) {
  const [reading, setReading] = useState('');
  // Draft recovery — restores the power meter value if the operator navigates away accidentally
  const { draft: draftReading, setDraft: setDraftReading, clearDraft: clearDraftReading } =
    useDraft(`shared-power-${primaryWellId}`, { value: '' });
  // Restore draft on mount if input is empty
  useEffect(() => { if (!reading && draftReading.value) setReading(draftReading.value); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!reading) { toast.error(`${groupName}: enter a power meter reading`); return; }
    setSaving(true);
    const val = +reading;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    // Check if primary well already has a reading today — update it if so
    const { data: todayRecs, error: checkErr } = await supabase
      .from('well_readings')
      .select('id')
      .eq('well_id', primaryWellId)
      .gte('reading_datetime', startOfDay.toISOString())
      .order('reading_datetime', { ascending: false })
      .limit(1);
    // Was: error discarded — same duplicate-row risk as elsewhere this
    // session: a failed check fell through to the INSERT branch below even
    // when today's well reading already existed, creating a second row.
    if (checkErr) {
      setSaving(false);
      toast.error("Couldn't verify today's existing reading — retry before saving.");
      return;
    }

    if (todayRecs?.length) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val })
        .eq('id', (todayRecs[0] as any).id);
      setSaving(false);
      if (error) { toast.error(friendlyError(error)); return; }
    } else {
      // No water reading yet for today — insert a standalone power record
      const { error } = await supabase.from('well_readings').insert({
        well_id: primaryWellId,
        plant_id: plantId,
        current_reading: previousPower ?? 0,
        power_meter_reading: val,
        recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSaving(false);
      if (error) { toast.error(friendlyError(error)); return; }
    }

    toast.success(`${groupName}: power meter saved`);
    setReading(''); clearDraftReading();
    onSaved();
  };

  return (
    /* ── Shared meter group header — owns the kWh input ── */
    <div className="border-b border-amber-200/80 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20">
      {/* Title bar */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
          <Zap className="h-3.5 w-3.5 text-warn" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground tracking-tight truncate">{groupName}</span>
          <span className="text-3xs font-bold uppercase tracking-widest bg-amber-200/70 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full shrink-0">
            Shared Meter
          </span>
        </div>
        {/* Date picker */}
        <label className="shrink-0 cursor-pointer relative">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted border border-border/70 rounded-md px-3.5 py-1.5 font-mono-num whitespace-nowrap hover:bg-muted/80 transition-colors"
            onClick={(e) => {
              e.preventDefault();
              const el = dtInputRef.current;
              if (!el) return;
              if (typeof el.showPicker === 'function') {
                try { el.showPicker(); } catch { el.focus(); }
              } else {
                el.focus();
              }
            }}
          >
            {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
            <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
          </span>
          <Input ref={dtInputRef} type="datetime-local" value={customDt}
            onChange={e => setCustomDt(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full pointer-events-none"
            title="Reading date & time" tabIndex={-1} />
        </label>
      </div>

      {/* kWh input */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
          prev: <span className="font-mono-num font-medium text-foreground/80">{previousPower == null ? '—' : fmtNum(previousPower)}</span>
        </span>
        <div className="relative flex-1">
          <Zap className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-kpi-meter pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={reading}
            onChange={e => { setReading(e.target.value); setDraftReading({ value: e.target.value }); }} placeholder="Shared power kWh"
            className="h-10 pl-8 w-full border-kpi-meter/30 focus-visible:ring-kpi-meter/40 bg-kpi-meter/5 placeholder:text-muted-foreground/50"
            data-testid={`shared-power-input-${primaryWellId}`} />
        </div>
        <Button onClick={save} disabled={saving || !reading}
          className="h-10 px-4 text-sm shrink-0 bg-kpi-meter hover:bg-kpi-meter/90 active:bg-kpi-meter/80 text-white shadow-sm border-0">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </div>
  );
}
