import React, { useState, useMemo } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { fmtNum, ALERTS } from '@/lib/calculations';
import { format, subDays } from 'date-fns';
import { Upload, Gauge } from 'lucide-react';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { MobileCarousel } from '@/components/OdometerRollerInput';
import {
  computeRate, computeRollingAverageRateFromDeltas, classifyDeviation, MIN_ELAPSED_DAYS,
  type VolumePoint,
} from '@/lib/flowRateGuards';
import { ImportReadingsDialog } from '@/components/ReadingImportDialog';
import { useBlendingWells } from '../shared';
import { insertBlendingReadings } from '@/data/mutations/blending';
import { BlendingRow } from '@/components/operations/BlendingRow';
import { validateBlendingRow } from '@/lib/readingValidation';

// Blending wells are always metered — there is no such thing as a blending
// source with no physical meter, so daily volume is always derived as a
// delta between two cumulative readings. volume_m3 is no longer an accepted
// direct-entry column; raw_meter_reading is required on every row.
const BLENDING_SCHEMA =
  'well_name*,  raw_meter_reading* (cumulative),  ' +
  'previous_reading (prev cumulative — auto-detected if omitted),  ' +
  'event_date (YYYY-MM-DD),  reading_datetime (YYYY-MM-DDTHH:mm)';

const BLENDING_TEMPLATE_ROW = {
  well_name:          'Well #2',
  raw_meter_reading:  '12345.00',   // ← required: current cumulative meter reading
  previous_reading:   '12195.00',   //   optional: previous cumulative value (auto-detected if omitted)
  event_date:         '2024-06-15',
  reading_datetime:   '2024-06-15T08:30',
};

// Power readings:
// Note: Power/solar CSV import lives in PowerSection.tsx (POWER_SCHEMA there) —
// this module handles blending readings only.

export function BlendingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const plantName = plants?.find((p: any) => p.id === plantId)?.name ?? '';

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('wells').select('id, name, plant_id, status').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: blendingData } = useBlendingWells(plantId);
  const blendingIds    = useMemo(() => new Set((blendingData?.wells ?? []).map((w) => w.well_id)), [blendingData]);
  const blendingWells  = useMemo(() => (wells ?? []).filter((w: any) => blendingIds.has(w.id)), [wells, blendingIds]);

  const { data: volumeData } = useQuery<{
    by_well: {
      well_id: string; volume_m3: number; today_volume_m3: number;
      previous_volume_m3: number | null; previous_event_date: string | null;
      avg_rate_m3_per_day: number | null;
    }[];
  }>({
    queryKey: ['blending-today', plantId],
    queryFn: async () => {
      // Ported from the old FastAPI /api/blending/volume route's `by_well`
      // computation — same 14-day window, same per-well today/previous-day
      // fields — just read directly from blending_events now.
      const span = 14;
      const base = new Date();
      const today = format(base, 'yyyy-MM-dd');
      const since = format(subDays(base, span - 1), 'yyyy-MM-dd');

      let q = supabase.from('blending_events' as any).select('*').gte('event_date', since);
      if (plantId) q = q.eq('plant_id', plantId);
      const { data: events, error } = await q;
      if (error) throw error;

      const byWell = new Map<string, {
        well_id: string; volume_m3: number; today_volume_m3: number;
        previous_volume_m3: number | null; previous_event_date: string | null;
        byDay: Map<string, number>;
      }>();

      for (const ev of (events ?? []) as any[]) {
        const day = String(ev.event_date ?? '').slice(0, 10);
        const vol = Number(ev.volume_m3) || 0;
        const wid = ev.well_id || '';
        if (!wid) continue;
        if (!byWell.has(wid)) {
          byWell.set(wid, {
            well_id: wid, volume_m3: 0, today_volume_m3: 0,
            previous_volume_m3: null, previous_event_date: null,
            byDay: new Map(),
          });
        }
        const cur = byWell.get(wid)!;
        cur.volume_m3 += vol;
        cur.byDay.set(day, (cur.byDay.get(day) ?? 0) + vol);
        if (day === today) {
          cur.today_volume_m3 += vol;
        } else if (day && day < today) {
          const prevDay = cur.previous_event_date;
          if (prevDay === null || day > prevDay) {
            cur.previous_event_date = day;
            cur.previous_volume_m3 = vol;
          }
        }
      }

      const byWellList = Array.from(byWell.values())
        .sort((a, b) => b.volume_m3 - a.volume_m3)
        .map((w) => {
          // Q = V / t at day granularity — blending_events only stores a
          // DATE (event_date), not a timestamp, so hours aren't available;
          // each calendar day with events becomes one point, and each
          // point's rate is that day's TOTAL volume ÷ days since the
          // previous day WITH an event (not ÷1, so a day with no blending
          // event doesn't silently get treated as "0 that day" or get
          // smeared into a false same-length gap the way a plain average
          // of volume_m3 across events would).
          const points: VolumePoint[] = Array.from(w.byDay.entries())
            .map(([day, volume]) => ({ volume, at: new Date(`${day}T00:00:00`) }));
          const avgRate = computeRollingAverageRateFromDeltas(points, span, MIN_ELAPSED_DAYS, 86_400_000);
          return {
            well_id: w.well_id,
            volume_m3: Math.round(w.volume_m3 * 100) / 100,
            today_volume_m3: Math.round(w.today_volume_m3 * 100) / 100,
            previous_volume_m3: w.previous_volume_m3 !== null ? Math.round(w.previous_volume_m3 * 100) / 100 : null,
            previous_event_date: w.previous_event_date,
            avg_rate_m3_per_day: avgRate,
          };
        });

      return { by_well: byWellList };
    },
    enabled: !!plantId,
    retry: false,
  });
  const todayByWell = useMemo(() => {
    const m: Record<string, number> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = w.today_volume_m3 ?? 0;
    return m;
  }, [volumeData]);
  const prevByWell = useMemo(() => {
    const m: Record<string, { volume: number | null; date: string | null }> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = { volume: w.previous_volume_m3 ?? null, date: w.previous_event_date ?? null };
    return m;
  }, [volumeData]);
  // Real rolling-average rate (m³/day), distinct from prevByWell's single
  // most-recent-day snapshot above. Was: avgVol was literally just
  // prevByWell[...].volume reused — i.e. "the average" was one prior day's
  // volume, not an average of anything, and not normalized for gap days
  // between blending events (blending_events only stores a DATE, so this is
  // day-granularity, not hourly, like the other odometer inputs — see
  // computeRollingAverageRateFromDeltas's call above with 86_400_000ms/day).
  const avgRateByWell = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = w.avg_rate_m3_per_day ?? null;
    return m;
  }, [volumeData]);

  // Fetch the latest raw_meter_reading per blending well from the DB so the
  // OdometerRollerInput can pre-fill correctly on devices with no localStorage.
  const { data: latestRawData } = useQuery({
    queryKey: ['blending-latest-raw', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await (supabase.from('blending_events' as any) as any)
        .select('well_id, raw_meter_reading, event_date, is_estimated')
        .eq('plant_id', plantId)
        .not('raw_meter_reading', 'is', null)
        .order('event_date', { ascending: false })
        .order('noted_at', { ascending: false, nullsFirst: false })
        .limit(200);
      // Keep only the most recent row per well
      const seen = new Set<string>();
      return ((data ?? []) as any[]).filter((r: any) => {
        if (seen.has(r.well_id)) return false;
        seen.add(r.well_id);
        return true;
      });
    },
    enabled: !!plantId,
  });

  const latestRawByWell = useMemo(() => {
    const m: Record<string, { reading: number; date: string; is_estimated?: boolean } | null> = {};
    for (const r of latestRawData ?? [])
      m[r.well_id] = { reading: r.raw_meter_reading, date: r.event_date, is_estimated: r.is_estimated };
    return m;
  }, [latestRawData]);

  // "No reading — why?" gap reasons logged for today, keyed by well ID.
  // Mirrors WellSection.tsx / LocatorSection.tsx — entity_type here is
  // 'blending', not 'well', because a well's regular well_readings gap and
  // its blending_events gap are two separate things (see the migration
  // adding 'blending' to reading_gap_reasons' entity_type check).
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const { data: gapReasons } = useQuery({
    queryKey: ['blending-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'blending')
        .eq('gap_date', todayDateStr);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const gapReasonsByWell = useMemo(() => {
    const m: Record<string, any> = {};
    (gapReasons ?? []).forEach((g: any) => { m[g.entity_id] = g; });
    return m;
  }, [gapReasons]);

  // ── Summary strip — supervisors scanning several wells need at-a-glance
  // totals more than the per-well detail; the old "N tagged" pill only gave
  // one of the three numbers they'd actually want.
  const loggedTodayCount = useMemo(
    () => blendingWells.filter((w) => (todayByWell[w.id] ?? 0) > 0).length,
    [blendingWells, todayByWell],
  );
  const totalTodayM3 = useMemo(
    () => blendingWells.reduce((sum, w) => sum + (todayByWell[w.id] ?? 0), 0),
    [blendingWells, todayByWell],
  );

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="blendingsection-plant" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} id="blendingsection-plant" />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-primary/60 text-primary hover:bg-primary-soft hover:border-primary/90"
              onClick={() => setImportOpen(true)}
              data-testid="import-blending-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && blendingWells.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3.5">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tagged wells</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">{blendingWells.length}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Logged today</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">
              {loggedTodayCount}<span className="text-muted-foreground font-normal">/{blendingWells.length}</span>
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Total blended today</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums text-primary">{fmtNum(totalTodayM3)} m³</div>
          </Card>
        </div>
      )}

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Blending Wells</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">{blendingWells.length} tagged</span>
          </div>
          {blendingWells.length ? (
            // Two-column responsive grid on desktop cuts scrolling once a plant
            // has more than 2–3 blending wells; MobileCarousel keeps its own
            // swipeable single-item layout on mobile (its `!isMobile` branch
            // just returns a fragment, so this grid governs desktop only).
            <div className={isMobile ? '' : 'grid grid-cols-1 lg:grid-cols-2 gap-3 p-3'}>
              <MobileCarousel
                isMobile={isMobile}
                items={blendingWells}
                renderItem={(w) => (
                  <BlendingRow
                    key={w.id}
                    well={w} plantId={plantId} plantName={plantName}
                    todayVolume={todayByWell[w.id] ?? 0}
                    previousVolume={prevByWell[w.id]?.volume ?? null}
                    previousDate={prevByWell[w.id]?.date ?? null}
                    avgVol={avgRateByWell[w.id] ?? null}
                    dbLatestRaw={latestRawByWell[w.id] ?? null}
                    userId={user?.id ?? null}
                    gapReason={gapReasonsByWell[w.id] ?? null}
                    onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['blending-gap-reasons', plantId, todayDateStr] })}
                    onSaved={() => {
                      qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
                      qc.invalidateQueries({ queryKey: ['blending-latest-raw', plantId] });
                      qc.invalidateQueries({ queryKey: ['blending-volume'] });
                    }}
                  />
                )}
              />
            </div>
          ) : (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">
              No wells tagged as blending for this plant. Tag a well under <span className="font-medium text-foreground/70">Plants → Wells</span>.
            </div>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Blending Readings from CSV"
          module="Blending Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={BLENDING_SCHEMA}
          templateFilename="blending_readings_template.csv"
          templateRow={BLENDING_TEMPLATE_ROW}
          validateRow={validateBlendingRow}
          insertRows={(rows, pid) => insertBlendingReadings(rows, pid, plantName)}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
            qc.invalidateQueries({ queryKey: ['blending-volume'] });
          }}
        />
      )}
    </div>
  );
}

// ─── PRODUCT METER audit logger ──────────────────────────────────────────────

async function logProductMeterChange(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  old_value: number | null;
  new_value: number | null;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('product_meter_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore if table missing */ }
}
