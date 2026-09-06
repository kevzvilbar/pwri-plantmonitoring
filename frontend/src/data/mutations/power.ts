import { supabase } from '@/integrations/supabase/client';
import { normalizeDatetime, resolveImportDuplicate } from '@/components/ReadingImportDialog';

export async function insertPowerReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  // ── 1. Load all plants ────────────────────────────────────────────────────
  const { data: allPlants } = await supabase.from('plants' as any).select('id, name');
  const plantNameToId: Record<string, string> = {};
  const plantIdToName: Record<string, string> = {};
  (allPlants ?? []).forEach((p: any) => {
    plantNameToId[p.name.trim().toLowerCase()] = p.id;
    plantIdToName[p.id] = p.name.trim();
  });

  // ── 2. Pre-load plant_power_config for all plants (grid meter names, count + multipliers) ──
  // Lets a CSV row target a specific meter by name (e.g. "Grid Meter 1 STP")
  // via the meter_name column, resolved against the plant's configured names.
  // Without this, multi-meter CSV rows all fall back to meter 0, overwrite
  // each other, and never write grid_meter_readings, so the history dialog
  // shows no change for meters 2, 3, etc.
  type PlantPowerCfg = { names: string[]; multipliers: number[]; count: number };
  const powerCfgByPlant: Record<string, PlantPowerCfg> = {};
  try {
    const { data: allCfgs } = await (supabase.from('plant_power_config' as any) as any)
      .select('plant_id, grid_meter_names, grid_meter_multipliers, grid_meter_count');
    (allCfgs ?? []).forEach((c: any) => {
      const names = Array.isArray(c.grid_meter_names) ? c.grid_meter_names.map(String) : [];
      powerCfgByPlant[c.plant_id] = {
        names,
        multipliers: Array.isArray(c.grid_meter_multipliers) ? c.grid_meter_multipliers.map(Number) : [],
        // grid_meter_names is padded to a fixed length with unused default
        // labels ("Grid Meter 4", ...) beyond what a plant actually has —
        // count keeps meter_name matching scoped to real, configured meters.
        count: Number(c.grid_meter_count) > 0 ? Number(c.grid_meter_count) : Math.max(1, names.length),
      };
    });
  } catch { /* table may not exist; single-meter path still works */ }

  const getPerMeterMult = (pid: string, mi: number): number => {
    const cfg = powerCfgByPlant[pid];
    const m = cfg?.multipliers?.[mi];
    return m && m > 0 ? m : 1;
  };

  // ── 3. Resolve each CSV row to { resolvedPlantId, meterIndex } ──────────────
  // Priority:
  //   a) Exact match against plant name, then use the optional meter_name
  //      column to pick which grid meter this row is for — by the meter's
  //      exact configured name (case-insensitive) or a plain 1-based
  //      position like "2". Blank/absent meter_name → meter 1 (index 0),
  //      so single-meter plants and pre-existing CSVs need no changes.
  //   b) Legacy "${plantName} ${meterName}" composite in plant_name itself
  //      (undocumented, kept only for backward compatibility).
  //   c) Fallback to the UI-selected plantId, same meter_name handling as (a).
  // A meter_name that doesn't match any configured meter is a row-level
  // error rather than a silent fall-through to meter 1 — silently applying
  // it would overwrite the wrong meter's reading with no indication why.
  type ResolvedRow = { r: Record<string, string>; pid: string; mi: number; meterError?: string };
  const resolveMeterIndex = (pid: string, rawMeterName: string, rowNum: number): { mi: number; err?: string } => {
    const trimmed = rawMeterName.trim();
    if (!trimmed) return { mi: 0 };
    const cfg = powerCfgByPlant[pid];
    const count = cfg?.count && cfg.count > 0 ? cfg.count : Math.max(1, cfg?.names?.length ?? 1);
    const asNum = Number(trimmed);
    if (Number.isInteger(asNum) && asNum >= 1 && asNum <= count) return { mi: asNum - 1 };
    const idx = (cfg?.names ?? []).slice(0, count).findIndex(n => n.toLowerCase() === trimmed.toLowerCase());
    if (idx >= 0) return { mi: idx };
    const plantLabel = plantIdToName[pid] ?? pid;
    return {
      mi: 0,
      err: `Row ${rowNum}: meter_name "${trimmed}" doesn't match any configured meter for ${plantLabel} (check Plants \u2192 Power for the exact name) \u2014 this row's reading was not imported`,
    };
  };

  const resolvedRows: ResolvedRow[] = rows.map((r, i) => {
    const csvName = r.plant_name?.trim() ?? '';
    const csvLower = csvName.toLowerCase();
    const rowNum = i + 2; // header is row 1

    // (a) Exact plant name match → resolve meter via meter_name column
    if (plantNameToId[csvLower]) {
      const pid = plantNameToId[csvLower];
      const { mi, err } = resolveMeterIndex(pid, r.meter_name ?? '', rowNum);
      return { r, pid, mi, meterError: err };
    }

    // (b) Legacy composite "${plantName} ${meterLabel}" match
    for (const [pNameLower, pId] of Object.entries(plantNameToId)) {
      const cfg = powerCfgByPlant[pId];
      if (!cfg?.names?.length) continue;
      for (let idx = 0; idx < cfg.names.length; idx++) {
        if (`${pNameLower} ${cfg.names[idx].toLowerCase()}` === csvLower) {
          return { r, pid: pId, mi: idx };
        }
      }
    }

    // (c) Fallback to the UI-selected plant
    const { mi, err } = resolveMeterIndex(plantId, r.meter_name ?? '', rowNum);
    return { r, pid: plantId, mi, meterError: err };
  });

  // ── 4. Group rows by plantId + calendar-date ─────────────────────────────
  // Rows for the same plant on the same day belong in ONE power_readings row,
  // with each meter's value stored under its index in grid_meter_readings JSONB.
  // Without grouping, the three CSV rows for SRP on 2026-05-01 would hit the
  // same duplicate-decision key and overwrite each other, losing meters 0 and 1.
  type DayGroup = {
    pid: string;
    dt: string;       // ISO UTC string for the DB
    dtDate: string;   // YYYY-MM-DD as entered (Manila calendar date, dup-check window key)
    meters: Map<number, number>;
    solar?: number;
    dailySolar?: number;
    dailyGrid?: number;
    solarMode?: string;
  };
  const groups = new Map<string, DayGroup>();
  const errors: string[] = [];
  for (const { r, pid, mi, meterError } of resolvedRows) {
    // BUG FIX (timezone day-rollback): previously derived dtDate by round-tripping
    // through `new Date(...).toISOString().slice(0, 10)`, which converts to UTC
    // first. For Manila (UTC+8) that silently shifts any reading between
    // 12:00–7:59 AM local onto the *previous* calendar day (e.g. "2026-08-08T00:25"
    // → "2026-08-07"), causing early-morning rows to false-positive as duplicates
    // of the prior day and merge into the wrong power_readings row. normalizeDatetime()
    // already guarantees a clean "YYYY-MM-DDTHH:mm" string, so slice the date
    // straight from that — no UTC conversion, no dependency on runtime timezone.
    const normalized = normalizeDatetime(r.reading_datetime);
    const dt = new Date(normalized).toISOString();
    const dtDate = normalized.slice(0, 10);
    const key = `${pid}|${dtDate}`;
    if (!groups.has(key)) groups.set(key, { pid, dt, dtDate, meters: new Map() });
    const g = groups.get(key)!;
    if (meterError) {
      errors.push(meterError);
    } else {
      g.meters.set(mi, +r.meter_reading_kwh);
    }
    // Solar / grid totals come from whichever row supplies them (typically meter-0)
    if (g.solar     == null && r.solar_meter_reading?.trim()) g.solar     = +r.solar_meter_reading;
    if (g.dailySolar == null && r.daily_solar_kwh?.trim())    g.dailySolar = +r.daily_solar_kwh;
    if (g.dailyGrid  == null && r.daily_grid_kwh?.trim())     g.dailyGrid  = +r.daily_grid_kwh;
    if (!g.solarMode          && r.solar_input_mode?.trim())  g.solarMode  = r.solar_input_mode.trim().toLowerCase();
  }

  // ── 5. Insert or overwrite one DB row per group ──────────────────────────
  // PERFORMANCE FIX: the previous version issued up to 4 sequential Supabase
  // calls PER DAY-GROUP — a "previous reading" query (for daily_consumption_kwh),
  // a duplicate-existence query, a conditional "existing row" re-fetch (for the
  // multi-meter merge), then the insert/update itself. For a multi-month import
  // across several plants that's hundreds of round-trips.
  //
  // Fix: fetch each involved plant's full reading history ONCE up front (one
  // query total), then serve all three lookups — duplicate check, previous-day
  // baseline, and merge source — from that in-memory data. Groups are processed
  // in chronological order per plant, with a running "last known meters" state
  // updated after each group, so daily_consumption_kwh still chains correctly
  // across multiple new days within the same import (matching the old
  // behavior when CSV rows were in date order).
  let count = 0;

  const groupList = Array.from(groups.entries())
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => a.dt.localeCompare(b.dt));

  type ExistingPowerRow = {
    id: string; plant_id: string; reading_datetime: string;
    meter_reading_kwh: number; grid_meter_readings: Record<string, number> | null;
  };
  const involvedPids = Array.from(new Set(groupList.map(g => g.pid)));
  const byPlant: Record<string, ExistingPowerRow[]> = {};
  if (involvedPids.length > 0) {
    const { data: existingAll } = await supabase
      .from('power_readings')
      .select('id, plant_id, reading_datetime, meter_reading_kwh, grid_meter_readings')
      .in('plant_id', involvedPids)
      .order('reading_datetime', { ascending: true });
    (existingAll ?? []).forEach((row: any) => {
      (byPlant[row.plant_id] ??= []).push(row);
    });
  }

  // Running "last known meter state" per plant — seeded lazily from DB history
  // the first time each plant is touched, then updated after every group so
  // later same-import days chain off it instead of re-querying.
  const lastKnownByPlant: Record<string, { atMs: number; meters: Record<string, number> } | undefined> = {};

  const toGmrRecord = (row: ExistingPowerRow): Record<string, number> => {
    const gmr = { ...(row.grid_meter_readings ?? {}) };
    if (gmr['0'] == null) gmr['0'] = row.meter_reading_kwh;
    return gmr;
  };

  for (const g of groupList) {
    const { key, pid: gPid, dt, dtDate, meters } = g;
    // Every row that would have contributed to this plant+day failed
    // meter_name resolution (already logged to `errors` above) — nothing
    // valid to write, and writing anyway would insert/overwrite with a
    // bogus meter_reading_kwh of 0. Skip the group rather than corrupt data.
    if (meters.size === 0) continue;
    // BUG FIX: dtDate is now the Manila calendar date (see above), so the window
    // must bound the Manila day, not a UTC day of the same label. Philippines has
    // no DST, so a fixed +08:00 offset is always correct — this avoids depending
    // on the runtime's local timezone (unlike appending "Z").
    const dayStart = `${dtDate}T00:00:00.000+08:00`;
    const dayEnd   = `${dtDate}T23:59:59.999+08:00`;
    const dayStartMs = new Date(dayStart).getTime();
    const dayEndMs   = new Date(dayEnd).getTime();

    // Build grid_meter_readings JSONB from all meters in this group
    const gmrObj: Record<string, number> = {};
    for (const [mi, val] of meters) gmrObj[String(mi)] = val;

    const payload: Record<string, any> = {
      plant_id:          gPid,
      grid_meter_readings: gmrObj,           // full per-meter JSONB — the key fix
      reading_datetime:  dt,
      recorded_by:       userId,
    };
    // meter_reading_kwh: legacy meter-0 mirror, kept for dashboards/trend
    // charts that haven't migrated to grid_meter_readings. Only set it when
    // this row's data actually includes meter 0 — otherwise:
    //   - INSERT: column is nullable (see 20260822 migration) — leave it out
    //     rather than writing a fake 0 that reads like a meter reset.
    //   - UPDATE: omitting the key from payload leaves whatever real value
    //     is already saved untouched, instead of clobbering it with 0 just
    //     because this particular import batch only covered meters 1/2.
    if (meters.has(0)) payload.meter_reading_kwh = meters.get(0);

    // Solar
    const explicitDirect = g.solarMode === 'direct';
    const impliedDirect  = !g.solarMode && g.dailySolar != null;
    const solarMode = (explicitDirect || impliedDirect) ? 'direct' : 'raw';
    if (solarMode === 'direct') {
      const kw = g.dailySolar ?? g.solar;
      if (kw != null) payload.daily_solar_kwh = kw;
    } else {
      if (g.solar      != null) payload.solar_meter_reading = g.solar;
      if (g.dailySolar != null) payload.daily_solar_kwh     = g.dailySolar;
    }
    if (g.dailyGrid != null) payload.daily_grid_kwh = g.dailyGrid;

    // Find this day's existing DB row (duplicate check) and the most recent
    // reading strictly before this day (previous-day baseline), both from the
    // one pre-fetched list instead of separate queries.
    const plantHistory = byPlant[gPid] ?? [];
    let dayRow: ExistingPowerRow | undefined;
    let dbPrevRow: ExistingPowerRow | undefined;
    for (const row of plantHistory) {
      const ms = new Date(row.reading_datetime).getTime();
      if (!dayRow && ms >= dayStartMs && ms <= dayEndMs) dayRow = row;
      if (ms < dayStartMs) dbPrevRow = row; // list is ascending, so this ends up the latest one < dayStart
    }

    // daily_consumption_kwh: sum Δ × per-meter multiplier across all meters in group.
    // Prefer the running same-import state if it's from before this day; otherwise
    // fall back to the DB history baseline.
    try {
      const running = lastKnownByPlant[gPid];
      const prevMeters = (running && running.atMs < dayStartMs)
        ? running.meters
        : (dbPrevRow ? toGmrRecord(dbPrevRow) : null);
      if (prevMeters) {
        let total = 0;
        let allPresent = true;
        for (const [mi, currVal] of meters) {
          const prevVal = prevMeters[String(mi)];
          if (prevVal == null) { allPresent = false; continue; }
          const delta = currVal - prevVal;
          if (delta >= 0) total += delta * getPerMeterMult(gPid, mi);
        }
        if (allPresent || meters.size === 1) {
          if (total >= 0) payload.daily_consumption_kwh = total;
        }
      }
    } catch { /* non-critical */ }

    const doInsert = async (): Promise<boolean> => {
      const { error } = await supabase.from('power_readings').insert(payload as any);
      if (error) {
        if (error.message.includes('daily_solar_kwh') || error.message.includes('daily_grid_kwh') ||
            error.message.includes('solar_meter_reading') || error.message.includes('grid_meter_readings')) {
          const { daily_solar_kwh: _s, daily_grid_kwh: _g, solar_meter_reading: _sm, grid_meter_readings: _gmr, ...fb } = payload as any;
          const { error: e2 } = await supabase.from('power_readings').insert(fb);
          if (e2) { errors.push(e2.message); return false; }
          count++; return true;
        }
        errors.push(error.message); return false;
      }
      count++; return true;
    };

    if (dayRow) {
      const plantLabel = plantIdToName[gPid] ?? gPid;
      const decision = await resolveImportDuplicate(key, `${plantLabel} @ ${dtDate}`, true);
      if (decision === 'skip') continue;
      // Merge: keep existing meter readings for indices NOT present in this CSV import,
      // so uploading a partial CSV (e.g. only meter-0) doesn't zero out meters 1 and 2.
      // Sourced from the same pre-fetched row — no extra query needed.
      const existGmr = dayRow.grid_meter_readings ?? {};
      const mergedGmr = { ...existGmr, ...gmrObj }; // CSV values win; existing secondary meters preserved
      payload.grid_meter_readings = mergedGmr;

      const { error } = await supabase.from('power_readings').update(payload as any).eq('id', dayRow.id);
      if (error) {
        if (error.message.includes('daily_solar_kwh') || error.message.includes('daily_grid_kwh') ||
            error.message.includes('solar_meter_reading') || error.message.includes('grid_meter_readings')) {
          const { daily_solar_kwh: _s, daily_grid_kwh: _g, solar_meter_reading: _sm, grid_meter_readings: _gmr, ...fb } = payload as any;
          const { error: e2 } = await supabase.from('power_readings').update(fb).eq('id', dayRow.id);
          if (e2) { errors.push(e2.message); }
          else { count++; lastKnownByPlant[gPid] = { atMs: new Date(dt).getTime(), meters: mergedGmr }; }
        } else { errors.push(error.message); }
      } else {
        count++;
        lastKnownByPlant[gPid] = { atMs: new Date(dt).getTime(), meters: mergedGmr };
      }
    } else {
      const ok = await doInsert();
      if (ok) lastKnownByPlant[gPid] = { atMs: new Date(dt).getTime(), meters: gmrObj };
    }
  }
  return { count, errors };
}
