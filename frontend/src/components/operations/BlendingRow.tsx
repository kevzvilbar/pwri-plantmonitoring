import React, { useState, useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtNum, ALERTS } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { resolveBlendingDateContext } from '@/lib/blendingBackdate';
import { latestRaw } from '@/lib/blendingRawCache';
import { OdometerRollerInput } from '@/components/OdometerRollerInput';
import { computeRate, classifyDeviation, MIN_ELAPSED_DAYS } from '@/lib/flowRateGuards';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { invalidateWellDash } from '../../pages/operations/shared';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import {
  MessageCircleOff,
  CalendarClock,
  AlertCircle,
  Loader2,
  Droplet,
  History,
} from 'lucide-react';

function getBlendingRawKey(wellId: string)  { return `blending-raw-${wellId}`; }

function readPersistedRaw(wellId: string): { reading: number; date: string } | null {
  try {
    const v = localStorage.getItem(getBlendingRawKey(wellId));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function persistRaw(wellId: string, reading: number, date: string) {
  try { localStorage.setItem(getBlendingRawKey(wellId), JSON.stringify({ reading, date })); } catch { /* best-effort persist — ignore */ }
}

export function BlendingRow({
  well, plantId, plantName, todayVolume, previousVolume, previousDate, avgVol, dbLatestRaw, userId, gapReason, onGapReasonSaved, onSaved,
}: {
  well: any; plantId: string; plantName?: string;
  todayVolume: number; previousVolume: number | null; previousDate: string | null;
  avgVol?: number | null;
  dbLatestRaw?: { reading: number; date: string; is_estimated?: boolean } | null;
  userId?: string | null;
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  onSaved: () => void;
}) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [volume, setVolumeRaw] = useState('');
  const lastPrefilledBlend = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);

  // Status-chip support: reflects an optimistic "Logged today" immediately on
  // a successful save, ahead of the todayVolume query refetch landing. Cleared
  // the moment the operator starts editing a new value.
  const [justSaved, setJustSaved] = useState(false);
  const setVolume = (v: string) => { setVolumeRaw(v); setJustSaved(false); };

  // Blending wells are always metered — there is no direct-volume input mode.
  // The previous *cumulative* meter reading is not stored in the DB (the DB
  // only keeps the computed daily-volume delta). Read it from localStorage
  // where it was written on the last successful save for this well.
  const [prevRawReading, setPrevRawReading] = useState<{ reading: number; date: string } | null>(
    () => readPersistedRaw(well.id),
  );

  // Pre-fill the drum with the last persisted raw reading so the operator
  // starts from the real odometer value and rolls only the changed digits.
  // Source: whichever of localStorage / DB latest raw_meter_reading is
  // actually more recent by date (see latestRaw above) — not localStorage
  // unconditionally.
  // Race-condition fix: same pattern as LocatorRow / WellRow — track last auto-fill
  // in a ref so a poll-driven update to prevRawReading also updates the drum when
  // the user hasn't yet typed anything.
  useEffect(() => {
    const src = latestRaw(prevRawReading, dbLatestRaw)?.reading ?? null;
    if (src == null) return;
    const expected = src.toFixed(2);
    if (volume === '' || volume === lastPrefilledBlend.current) {
      setVolumeRaw(expected);
      lastPrefilledBlend.current = expected;
    }
  }, [prevRawReading, dbLatestRaw, volume]);

  // Self-heal the per-device cache: if the DB's latest reading for this well
  // is newer than what's cached on this device, adopt it (and re-persist it
  // locally). Without this, a stale local cache — e.g. left over from a
  // manual save weeks ago, on a device that never received the newer entries
  // saved elsewhere or imported elsewhere — shadows the fresher DB value
  // indefinitely, since localStorage here is otherwise only ever written by
  // this device's own Save button.
  useEffect(() => {
    if (dbLatestRaw && (!prevRawReading || dbLatestRaw.date > prevRawReading.date)) {
      setPrevRawReading(dbLatestRaw);
      persistRaw(well.id, dbLatestRaw.reading, dbLatestRaw.date);
    }
  }, [dbLatestRaw, prevRawReading, well.id]);

  // Δ uses the persisted cumulative reading first, then the DB-fetched
  // raw_meter_reading (for cross-device consistency), finally falling back to
  // the API-supplied previousVolume (daily m³ — less accurate for cumulative
  // meters, but better than showing nothing).
  const eventDate = customDt.slice(0, 10);
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const isBackdated = eventDate !== todayDateStr;

  // When the operator backdates (picks a date other than today), the
  // sources above are the well's GLOBALLY latest reading — not the reading
  // that was actually current as of the selected date. Comparing a
  // backfilled Aug 13 entry against an already-logged Aug 15 reading
  // produces a nonsensical negative delta and permanently blocks Save
  // (volumeChanged below requires deltaRaw > 0), even though the entry may
  // be perfectly valid. This mirrors trg_blending_set_reading's own
  // resolution (latest event_date strictly before the selected one) so the
  // preview/warning/Save-gating here agree with what the server would
  // derive — and reports whether a reading already exists ON the selected
  // date, so the "No reading — why?" affordance below can key off the date
  // actually being edited instead of assuming "today".
  // limit(2) + lte (rather than two separate queries) gets both answers —
  // "does this exact date already have a reading" and "what's the true
  // predecessor" — in one round trip: sorted desc, an exact match for
  // eventDate (the largest date <= eventDate) always sorts first, so the
  // next row that doesn't match eventDate is necessarily the predecessor.
  const { data: backdatedContext, isLoading: backdatedContextLoading } = useQuery({
    queryKey: ['blending-backdated-context', well.id, eventDate],
    enabled: isBackdated,
    queryFn: async () => {
      const { data, error } = await (supabase.from('blending_events' as any) as any)
        .select('raw_meter_reading, event_date, is_estimated')
        .eq('well_id', well.id)
        .lte('event_date', eventDate)
        .not('raw_meter_reading', 'is', null)
        .order('event_date', { ascending: false })
        .limit(2);
      if (error) return { existingForDate: null, predecessor: null };
      return resolveBlendingDateContext((data ?? []) as { raw_meter_reading: number; event_date: string; is_estimated?: boolean }[], eventDate);
    },
    staleTime: 15_000,
  });

  // "No reading — why?" for the currently selected date. Today keeps using
  // the form-level batched query (gapReason prop, keyed to todayDateStr —
  // cheap because it's fetched once for all wells together). Backdating
  // needs its own per-row lookup since eventDate varies per-row/per-
  // interaction and can't be usefully batched at the form level.
  const { data: backdatedGapReason } = useQuery({
    queryKey: ['blending-gap-reason-for-date', well.id, eventDate],
    enabled: isBackdated,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'blending')
        .eq('entity_id', well.id)
        .eq('gap_date', eventDate)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 15_000,
  });
  const effectiveGapReason = isBackdated ? backdatedGapReason : gapReason;
  const hasReadingForSelectedDate = isBackdated ? !!backdatedContext?.existingForDate : todayVolume > 0;

  const prevCumulative: number | null = isBackdated
    ? (backdatedContext?.predecessor?.reading ?? null)
    : (latestRaw(prevRawReading, dbLatestRaw)?.reading ?? previousVolume ?? null);

  const deltaRaw = volume !== ''
    ? prevCumulative != null ? +volume - prevCumulative : null
    : null;

  // Allow saving a baseline reading (storeVol = +volume) when no prior
  // cumulative reading exists yet — e.g. first entry ever for this well.
  const isBaselineRaw = prevCumulative == null && volume !== '' && +volume > 0;
  const volumeChanged = volume !== '' && (isBaselineRaw || (deltaRaw != null && deltaRaw > 0));

  // ── Warning flags (mirrors well / locator logic) ───────────────────────────
  const blendBelowPrev = deltaRaw != null && deltaRaw < 0;
  // Q = V / t at day granularity — blending_events is keyed one row per
  // (well, day), so "t" here is days since the previous row for this well,
  // not a fixed 1. avgVol is now avgRateByWell (m³/day, a real rolling
  // average — see the query above), not the single previous day's volume it
  // used to be, so a gap of several days between blending events no longer
  // makes every entry after it look like a huge, false spike.
  const prevDateStr = isBackdated
    ? (backdatedContext?.predecessor?.date ?? null)
    : (latestRaw(prevRawReading, dbLatestRaw)?.date ?? previousDate ?? null);
  const daysElapsedBlend = prevDateStr
    ? (new Date(`${eventDate}T00:00:00`).getTime() - new Date(`${prevDateStr}T00:00:00`).getTime()) / 86_400_000
    : null;
  const blendRate = computeRate(deltaRaw, daysElapsedBlend, MIN_ELAPSED_DAYS);
  const deviationBlend = classifyDeviation(blendRate, avgVol ?? null, ALERTS.blending_spike_multiplier);
  const blendHighVol = deviationBlend.tier !== 'ok';
  // Required whenever the rate falls outside ±75% of the rolling average
  // (see flowRateGuards.ts) — cleared after every successful save.
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);
  const anomalyRemarkRequired = blendHighVol && !isAnomalyRemarkValid(anomalyRemark);

  // ── Status chip: "Not logged" → "Ready to save" → "Estimated" / "Logged today" ──
  // Replaces having to parse "prev: — · today: 0 m³ logged" — the color alone
  // now tells a supervisor scanning many wells what state each one is in.
  const isEstimatedForDate = isBackdated
    ? !!backdatedContext?.existingForDate?.is_estimated
    : (hasReadingForSelectedDate ? !!dbLatestRaw?.is_estimated : false);
  const chipState: 'pending' | 'ready' | 'logged' | 'estimated' =
    isEstimatedForDate ? 'estimated'
    : (hasReadingForSelectedDate || justSaved) ? 'logged'
    : volumeChanged ? 'ready'
    : 'pending';

  // ── Live preview of what Save will actually commit ─────────────────────────
  let previewLine: React.ReactNode = null;
  if (volume !== '' && deltaRaw != null) {
    previewLine = (
      <>Δ <span className={`font-semibold ${deltaRaw >= 0 ? 'text-kpi-ro' : 'text-destructive'}`}>{fmtNum(deltaRaw)} m³</span> will be saved</>
    );
  } else if (isBaselineRaw) {
    previewLine = (
      <>First reading — <span className="font-semibold text-kpi-ro">{fmtNum(+volume)} m³</span> will be saved as baseline</>
    );
  }

  const save = async () => {
    // Redundancy Guard (12 hours): identical odometer reading cannot be saved
    if (prevCumulative != null && +volume === prevCumulative) {
      toast.error(`${well.name}: this odometer reading (${fmtNum(+volume, 1)}) is identical to the previous reading. Same reading within 12 hours cannot be saved.`);
      return;
    }

    if (anomalyRemarkRequired) {
      setShowAnomalyBanner(true);
      toast.error(`${well.name}: this reading is outside the normal range (±75%) — add a remark before saving.`);
      return;
    }
    // Client-side preview/guard only — mirrors deltaRaw when a previous
    // reading is known, or the raw entry itself as a placeholder when this
    // looks like a first-ever reading. What actually gets stored is decided
    // server-side by trg_blending_set_reading, which correctly logs 0 m³ for
    // a genuine baseline rather than the full reading.
    const storeVol = deltaRaw != null ? deltaRaw : +volume;

    if (!volume || !(storeVol > 0)) {
      if (deltaRaw != null && deltaRaw <= 0) {
        toast.error(`${well.name}: current reading must be greater than the previous (${fmtNum(prevCumulative!)})`);
      } else {
        toast.error(`${well.name}: enter a positive blending volume`);
      }
      return;
    }
    // Warn on suspicious values (same behaviour as locator / well — save proceeds).
    if (blendBelowPrev) toast.info(`${well.name}: reading below previous — saved anyway`);
    setSaving(true);
    try {
      // Atomic upsert via fn_blending_upsert_reading (INSERT ... ON CONFLICT
      // (well_id, event_date) DO UPDATE) — replaces the old select-then-
      // insert/update pair, which left a race window where two concurrent
      // saves for the same well+day (double-click, retry, two people saving
      // around the same time) could each pass the "does it exist?" check
      // before either had written, producing two rows for the same well/day.
      // See 20260809_blending_events_dedupe_and_unique_constraint.sql.
      // p_update_previous_reading: false — previous_reading is intentionally
      // left untouched when this resolves to an UPDATE (trg_blending_set_reading
      // only auto-resolves it on INSERT), so correcting a typo'd reading here
      // never re-baselines it from a client-tracked value — same behaviour
      // as the old manual UPDATE branch. volume_m3 is never sent; the
      // trigger recomputes it from raw_meter_reading / previous_reading on
      // every write.
      // p_previous_reading: null when backdating — this may be a brand new
      // INSERT (no row yet for well_id + eventDate), and prevCumulative here
      // is already the correct chronological predecessor for display, but
      // trusting it as a literal value risks drift if another entry landed
      // between the query above and this write. Passing null instead lets
      // trg_blending_set_reading resolve it itself, from the same
      // (event_date < eventDate) lookup, at the actual moment of insert —
      // and trg_blending_readings_chain (AFTER trigger) independently
      // re-derives and confirms it either way, so this can't drift from
      // what ends up stored. Today's entry is unchanged — still sends its
      // own prevCumulative as before.
      const { data: savedId, error } = await supabase.rpc('fn_blending_upsert_reading' as any, {
        p_well_id: well.id, p_plant_id: plantId, p_well_name: well.name, p_plant_name: plantName,
        p_event_date: eventDate, p_reading_datetime: new Date(customDt).toISOString(),
        p_raw_meter_reading: +volume,
        p_previous_reading: isBackdated ? null : prevCumulative,
        p_update_previous_reading: false,
      });
      if (error) throw error;

      // Best-effort — the reading itself already saved successfully above,
      // this never blocks or rolls it back. See flowRateGuards.ts. Note:
      // blending_events has no norm_status column, so unlike locator/well/
      // product/RO, a 'critical' reading here still isn't auto-queued for
      // supervisor review — just remarked and visually flagged. See the
      // `escalates={false}` passed to AnomalyRemarkBanner below.
      if (blendHighVol && savedId) {
        void submitAnomalyRemark({
          table_name: 'blending_events',
          record_id: savedId,
          plant_id: plantId,
          tier: deviationBlend.tier as 'needs_remark' | 'critical',
          direction: deviationBlend.direction!,
          deviation_pct: deviationBlend.deviationPct!,
          flow_rate: deviationBlend.rate,
          avg_flow_rate: deviationBlend.avgRate,
          rate_unit: 'm3/day',
          remark_text: anomalyRemark,
        });
      }
      setAnomalyRemark('');

      // Persist the cumulative meter reading locally so the next save can
      // compute the correct Δ. Purely a same-device UX cache now — the
      // trigger is the actual source of truth for what gets stored.
      // Guarded by date: a backdated fill-in for an earlier gap (eventDate
      // older than what's already cached) must never regress this cache
      // backward — that cache also seeds the prefill + Δ baseline for
      // today's entry, and overwriting it with an older reading would
      // corrupt that baseline the next time this well is opened.
      const cachedDate = latestRaw(prevRawReading, dbLatestRaw)?.date ?? null;
      if (!cachedDate || eventDate >= cachedDate) {
        persistRaw(well.id, +volume, eventDate);
        setPrevRawReading({ reading: +volume, date: eventDate });
        // Reset the pre-fill guard so the drum auto-fills with the new "prev"
        // value after setVolume('') clears the input.
        lastPrefilledBlend.current = null;
      }

      toast.success(`${well.name}: meter reading saved${deltaRaw != null ? ` (Δ ${fmtNum(deltaRaw)} m³)` : ''}`);
      setVolume('');
      setJustSaved(true);

      // Invalidate dashboard so stat cards refresh immediately, plus the
      // date-aware queries above — a partial key matches every eventDate
      // cached for this well, so this covers whichever date(s) the operator
      // looks at next without needing to know which one just changed.
      invalidateWellDash(qc, [well.id]);
      qc.invalidateQueries({ queryKey: ['blending-backdated-context', well.id] });
      qc.invalidateQueries({ queryKey: ['blending-gap-reason-for-date', well.id] });
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setSaving(false); }
  };

  // "No reading — why?" — same (entity_type, entity_id, gap_date) upsert
  // pattern as WellRow / LocatorRow, entity_type: 'blending' instead of
  // 'well' (see 20260815000000_reading_gap_reasons_add_blending.sql).
  // Keyed to eventDate (the currently selected date), not hardcoded to
  // today, so this also covers logging a reason for a backdated gap —
  // eventDate already equals todayDateStr in the default case, so this is
  // a strict generalization, not a behavior change for that path.
  const saveGapReason = async (category: string, detail: string) => {
    setGapSaving(true);
    const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
      [{
        entity_type: 'blending', entity_id: well.id, plant_id: plantId,
        gap_date: eventDate, reason_category: category, reason_detail: detail || null,
        logged_by: userId ?? null,
      }] as any,
      { onConflict: 'entity_type,entity_id,gap_date' },
    );
    setGapSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${well.name}: reason logged`);
    setGapDialogOpen(false);
    qc.invalidateQueries({ queryKey: ['blending-gap-reason-for-date', well.id, eventDate] });
    onGapReasonSaved?.();
  };

  return (
    <div
      className="instrument-housing p-4 space-y-3 border border-border/80 rounded-2xl mb-3 shadow-xs"
      data-testid={`blending-row-${well.id}`}
    >
      {/* Row 1: Well name + Prioritized MetaStrip + ControlCluster + date */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-bold text-foreground break-words">{well.name}</span>
          <MetaStrip
            primary={
              <Badge className="bg-kpi-ro/20 text-kpi-ro border-kpi-ro/40 hover:bg-kpi-ro/20 font-semibold text-2xs rounded-full">
                Blending
              </Badge>
            }
            alerts={[
              hasReadingForSelectedDate === false && !justSaved && !(isBackdated && backdatedContextLoading) && {
                tone: 'warn',
                icon: MessageCircleOff,
                label: effectiveGapReason ? reasonCategoryLabel(effectiveGapReason.reason_category) : (isBackdated ? `Log gap (${eventDate})` : 'Log gap reason'),
                onClick: () => setGapDialogOpen(true),
                testId: `blending-gap-reason-btn-${well.id}`,
              },
              chipState === 'estimated' && {
                tone: 'warn',
                label: 'Estimated',
                title: 'Auto-backfilled reading — no manual operator entry on file.',
              },
              chipState === 'logged' && {
                tone: 'accent',
                label: isBackdated ? `Logged (${eventDate})` : 'Logged today',
              },
              chipState === 'ready' && {
                tone: 'default',
                label: 'Ready to save',
              },
              chipState === 'pending' && !effectiveGapReason && {
                tone: 'warn',
                label: 'Not logged',
              },
            ].filter(Boolean)}
            overflow={[]}
            maxVisible={4}
          />
        </div>

        {/* Controls & Date */}
        <div className="flex items-center gap-2 shrink-0">
          <ControlCluster
            actions={[
              {
                icon: History,
                title: 'View blending history',
                onClick: () => setShowHistory(true),
              },
            ]}
          />
          <label className="cursor-pointer relative">
            <span
              className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted border border-border/70 rounded-full px-3 py-1 font-mono-num whitespace-nowrap hover:bg-muted/80 hover:text-foreground transition-colors"
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
            <Input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
              className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
          </label>
        </div>
      </div>

      {/* Row 2: Recessed Telemetry Panel */}
      <div className="recessed-glass p-2.5 sm:p-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          prev meter: <span className="font-mono-num font-semibold text-foreground" title={
            isBackdated
              ? (backdatedContextLoading
                  ? 'Looking up the reading before this date…'
                  : backdatedContext?.predecessor
                    ? `Last cumulative reading before ${eventDate}, on ${backdatedContext.predecessor.date}`
                    : `No reading before ${eventDate} — this would be the well's earliest known reading`)
              : prevRawReading
                ? `Last cumulative reading on ${prevRawReading.date}`
                : dbLatestRaw
                  ? `Last cumulative reading on ${dbLatestRaw.date} (from DB)`
                  : previousDate ? `Last entry on ${previousDate} (daily vol)` : 'No prior reading'
          }>
            {isBackdated && backdatedContextLoading ? '…' : prevCumulative != null ? fmtNum(prevCumulative) : '—'}
          </span>
          {prevDateStr && (
            <span className="text-muted-foreground/60 ml-1">({prevDateStr})</span>
          )}
          <span className="mx-1.5 text-border">·</span>
          today: <span className="font-mono-num font-semibold text-primary">{fmtNum(todayVolume)} m³</span>
        </div>
      </div>

      {/* Row 3: Input — drum roller (mobile) or regular input */}
      {isMobile ? (
        <div className="space-y-2">
          <OdometerRollerInput
            value={volume} onChange={setVolume}
            alertState={!volumeChanged ? 'neutral' : blendBelowPrev ? 'warn' : blendHighVol ? 'warn' : 'ok'}
            disabled={saving}
            testId={`blending-input-${well.id}`}
          />
          <div className="text-xs text-muted-foreground px-1">
            prev: <span className="font-mono-num font-semibold text-foreground">{prevCumulative != null ? fmtNum(prevCumulative) : '—'}</span>
          </div>
        </div>
      ) : (
        <div className="relative">
          <Droplet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kpi-ro pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="Cumulative meter reading"
            className="h-11 pl-9 w-full rounded-xl border-kpi-ro/30 focus-visible:ring-kpi-ro bg-kpi-ro/10 font-mono-num font-medium"
            data-testid={`blending-input-${well.id}`} />
        </div>
      )}

      {/* Live preview of what Save will actually commit */}
      {previewLine && (
        <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-kpi-ro/15 border border-kpi-ro/30 text-kpi-ro font-medium">
          {previewLine}
        </div>
      )}

      {/* Save button */}
      <Button onClick={save} disabled={saving || !volumeChanged || (showAnomalyBanner && anomalyRemarkRequired) || (isBackdated && backdatedContextLoading)}
        style={{ '--confirm-glow': 'hsl(var(--kpi-ro, 271 81% 56%) / 0.5)' } as React.CSSProperties}
        className={cn(
          'w-full sm:w-auto h-11 px-6 rounded-full text-sm font-semibold shadow-sm transition-all',
          volumeChanged
            ? 'bg-kpi-ro hover:bg-kpi-ro/90 active:scale-[0.98] text-white'
            : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
          justSaved && 'animate-gauge-confirm',
        )}
        data-testid={`blending-save-${well.id}`}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isBackdated ? `Save reading for ${eventDate}` : 'Save reading'}
      </Button>

      {/* Warning banner */}
      {volume !== '' && blendBelowPrev && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          <span className="text-warn pl-5">
            Reading is below the previous value — possible meter rollback or data entry error.
          </span>
        </div>
      )}

      {volume !== '' && !blendBelowPrev && blendHighVol && (showAnomalyBanner || anomalyRemark.trim().length > 0) && (
        <AnomalyRemarkBanner
          result={deviationBlend}
          label={well.name}
          unit="m3/day"
          windowDays={14}
          remark={anomalyRemark}
          onRemarkChange={setAnomalyRemark}
          escalates={false}
        />
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="blending"
          entityId={well.id}
          plantId={plantId}
          onClose={() => setShowHistory(false)}
        />
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={isBackdated
          ? `No blending reading for "${well.name}" on ${eventDate} — why?`
          : `No blending reading today for "${well.name}" — why?`}
        description={isBackdated
          ? `This explains the gap on ${eventDate}. If you have the real meter reading for that day instead, enter it above and Save — that takes priority over this note.`
          : 'This explains the gap for today. If a reading comes in later today, it takes priority over this note.'}
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={(category, detail) => saveGapReason(category, detail)}
      />
    </div>
  );
}
