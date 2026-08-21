import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { fmtNum } from '@/lib/calculations';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { deriveTrainStatus, TrainCard } from '../ro-trains';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';

import { PlantPicker } from './shared/PlantPicker';

// ─── Overview Dashboard ───────────────────────────────────────────────────────
// Renders the per-plant train grid.  TrainCard and all helpers are imported
// from ./ro-trains (§4 item 2 decomposition).
export function Overview() {
  const qc = useQueryClient();
  const [plantId, setPlantId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Running' | 'Maintenance' | 'Offline'>('All');
  const [search, setSearch] = useState('');
  const { selectedPlantId, addAlerts, removeAlerts } = useAppStore();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPlantId && !plantId) setPlantId(selectedPlantId); }, [selectedPlantId]);

  // ── Deep-link from an alert: /ro-trains?tab=overview&plant=<id>&train=<id>&log=1&logTab=ro|pretreat&highlight=<readingId> ──
  // Takes priority over both the plant seeded above and whatever was
  // previously selected here — clicking an alert for a specific train should
  // land on that train's log, not wherever this tab was last left.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepPlant     = searchParams.get('plant');
  const deepTrain     = searchParams.get('train');
  const deepLog       = searchParams.get('log') === '1';
  const deepLogTab    = (searchParams.get('logTab') === 'pretreat' ? 'pretreat' : 'ro') as 'ro' | 'pretreat';
  const deepHighlight = searchParams.get('highlight') ?? undefined;
  useEffect(() => { if (deepPlant) setPlantId(deepPlant); }, [deepPlant]);
  useEffect(() => {
    if (!deepTrain) return;
    setStatusFilter('All');
    setSearch('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepTrain]);
  // Cleared once TrainCard has actually opened the modal for deepTrain (see
  // onAutoOpenConsumed below) — until then the ?train=/&log=1/&highlight=
  // params stay in the URL so they survive the plant query re-fetching.
  const clearDeepLinkParams = () => {
    const sp = new URLSearchParams(searchParams);
    sp.delete('plant'); sp.delete('train'); sp.delete('log'); sp.delete('logTab'); sp.delete('highlight');
    setSearchParams(sp, { replace: true });
  };

  const { data: trains } = useQuery({
    queryKey: ['ro-overview', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? []
      : [],
    enabled: !!plantId,
  });

  // Same scope resolution Compliance.tsx itself uses (plant-specific row if
  // one's been saved for this plant, else the 'global' scope's defaults) —
  // this used to be a hardcoded PERM_TDS_LIMIT = 600 here, disconnected from
  // whatever an Admin/Data Analyst actually configured on the Compliance
  // page (whose own DEFAULT_THRESHOLDS.permeate_tds_max is 500, not 600 —
  // this alert threshold silently didn't match the app's own default even
  // before anyone customized anything).
  const { data: thresholds } = useQuery({
    queryKey: ['thresholds', plantId || 'global'],
    queryFn: () => loadThresholds(plantId || 'global'),
    enabled: !!plantId,
    staleTime: 60_000,
  });

  const trainIds    = (trains ?? []).map((t: any) => t.id);
  const trainIdsKey = trainIds.join(',');

  const { data: lastReadings } = useQuery({
    queryKey: ['ro-last-all', trainIdsKey],
    queryFn: async () => {
      if (!trainIds.length) return {};
      // FIX (egress): this used to select('*') over the entire unbounded
      // ro_train_readings history, ordered desc, just to keep the first row
      // per train_id client-side — a payload that grew every day forever.
      // ro_train_readings_latest is a DISTINCT ON (train_id) view (see
      // supabase/migrations/20260725000000_ro_train_readings_latest_view.sql)
      // so the server does the "one row per train" reduction and the wire
      // payload stays O(number of trains) regardless of history size.
      //
      // .returns<>() below: postgrest-js's relationship-inference for views
      // combined with select('*') can't resolve one and falls back to a
      // SelectQueryError sentinel type — a known postgrest-js quirk for
      // views, not a real runtime problem. Safe to override with the base
      // table's Row type since the view is a plain `select *` over it.
      //
      // BUGFIX (2026-07-25) — CI failure (TS2589 "Type instantiation is
      // excessively deep", TS2769 "No overload matches this call"): the
      // .returns<>() override above only fixes the SelectQueryError on the
      // final result — it doesn't help .from() itself. `ro_train_readings_latest`
      // is a DB view (20260725000000_ro_train_readings_latest_view.sql) that
      // isn't in the generated Database type's table/view union at all, so
      // .from('ro_train_readings_latest') has no matching overload and TS
      // tries — and fails — to reconcile it against every other table's
      // overload. `as any` on just the string argument (not the whole call)
      // is enough: it satisfies both from() overloads without collapsing the
      // rest of the chain to `any`, so .select()/.in()/.returns<>() below
      // still type-check normally — casting the whole chain instead breaks
      // .returns<>()'s explicit type argument (TS2347: "Untyped function
      // calls may not accept type arguments").
      //
      // REFINEMENT (2026-07-25): swapped `as any` for `as unknown as
      // 'ro_train_readings'` — same effect on tsc (from() resolves against
      // the real ro_train_readings table's overload, which has the identical
      // Row shape since the view is a plain `select *` over it), but doesn't
      // trip @typescript-eslint/no-explicit-any, which was pushing the repo
      // over its `--max-warnings` CI ceiling by 1. Runtime is unaffected —
      // the actual string sent to PostgREST is still 'ro_train_readings_latest';
      // only the compile-time type of the literal is being asserted.
      // Regenerate src/integrations/supabase/types.ts and this cast can be
      // simplified back to a plain .from('ro_train_readings_latest').
      type RoTrainReadingRow = Database['public']['Tables']['ro_train_readings']['Row'];
      const { data } = await supabase.from('ro_train_readings_latest' as unknown as 'ro_train_readings')
        .select('*')
        .in('train_id', trainIds)
        .returns<RoTrainReadingRow[]>();
      const map: Record<string, any> = {};
      for (const r of data ?? []) { map[r.train_id] = r; }
      return map;
    },
    enabled: trainIds.length > 0,
    // FIX (egress): readings here are manually entered by operators, not
    // streamed telemetry — the underlying data realistically changes on the
    // order of minutes, not seconds. 60s -> 3min cuts this query's request
    // volume 3x with no real loss of "is this train okay right now"
    // freshness. Revisit if trains ever get live sensor feeds.
    refetchInterval: 180_000,
  });

  const { data: sparkData } = useQuery({
    queryKey: ['ro-spark', trainIdsKey],
    queryFn: async () => {
      if (!trainIds.length) return {};
      const { data } = await supabase.from('ro_train_readings')
        .select('train_id, recovery_pct, permeate_tds, reading_datetime')
        .in('train_id', trainIds).order('reading_datetime', { ascending: false })
        .limit(trainIds.length * 6);
      const map: Record<string, any[]> = {};
      for (const r of data ?? []) {
        if (!map[r.train_id]) map[r.train_id] = [];
        if (map[r.train_id].length < 5) map[r.train_id].push(r);
      }
      return map;
    },
    enabled: trainIds.length > 0,
    // FIX (egress): same staleness reasoning as ro-last-all above — bumped
    // in lockstep so both queries land on the same poll cadence.
    refetchInterval: 180_000,
  });

  const allReadings  = Object.values(lastReadings ?? {});
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');

  const { data: gapReasons } = useQuery({
    queryKey: ['train-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase.from('reading_gap_reasons' as any)
        .select('*').eq('plant_id', plantId).eq('entity_type', 'ro_train').eq('gap_date', todayDateStr);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const gapReasonsByTrain = useMemo(() => {
    const m: Record<string, any> = {};
    (gapReasons ?? []).forEach((g: any) => { m[g.entity_id] = g; });
    return m;
  }, [gapReasons]);

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

  const onlineCount  = (trains ?? []).filter((t: any) => deriveTrainStatus(t, lastReadings?.[t.id]) === 'Running').length;
  const maintCount   = (trains ?? []).filter((t: any) => deriveTrainStatus(t, lastReadings?.[t.id]) === 'Maintenance').length;
  const offlineCount = (trains ?? []).filter((t: any) => deriveTrainStatus(t, lastReadings?.[t.id]) === 'Offline').length;
  const avgRecovery  = allReadings.filter(r => r.recovery_pct != null).length
    ? (allReadings.reduce((s, r) => s + (r.recovery_pct ?? 0), 0) / allReadings.filter(r => r.recovery_pct != null).length).toFixed(1) : null;
  const avgPermTDS   = allReadings.filter(r => r.permeate_tds != null).length
    ? (allReadings.reduce((s, r) => s + (r.permeate_tds ?? 0), 0) / allReadings.filter(r => r.permeate_tds != null).length).toFixed(0) : null;
  const totalTrains  = (trains ?? []).length;
  const healthScore  = totalTrains ? Math.round((onlineCount / totalTrains) * 100) : null;

  const PERM_TDS_LIMIT = thresholds?.permeate_tds_max ?? DEFAULT_THRESHOLDS.permeate_tds_max;
  const highTDSTrains  = (trains ?? []).filter((t: any) => {
    const reading = lastReadings?.[t.id];
    return reading?.permeate_tds != null && reading.permeate_tds > PERM_TDS_LIMIT;
  });

  useEffect(() => {
    if (!plantId) return;
    if (highTDSTrains.length === 0) {
      removeAlerts((trains ?? []).map((t: any) => `high-tds-${t.id}`));
      return;
    }
    addAlerts(highTDSTrains.map((t: any) => ({
      id: `high-tds-${t.id}`, severity: 'critical' as const,
      title: 'High Permeate TDS',
      description: `Train ${t.train_number}${t.name ? ` (${t.name})` : ''}: ${fmtNum(lastReadings?.[t.id]?.permeate_tds, 0)} ppm — above ${PERM_TDS_LIMIT} ppm limit`,
      source: 'RO Trains', plantId, timestamp: Date.now(),
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highTDSTrains.length, plantId, PERM_TDS_LIMIT]);

  const filtered = (trains ?? []).filter((t: any) => {
    const effectiveStatus = deriveTrainStatus(t, lastReadings?.[t.id]);
    const matchStatus = statusFilter === 'All' || effectiveStatus === statusFilter;
    const matchSearch = !search || `train ${t.train_number}`.toLowerCase().includes(search.toLowerCase()) || String(t.train_number).includes(search);
    return matchStatus && matchSearch;
  });

  const STATUS_FILTERS = ['All', 'Running', 'Maintenance', 'Offline'] as const;
  const statusColor = (s: string) =>
    s === 'Running' ? 'text-accent' : s === 'Maintenance' ? 'text-warn' : s === 'Offline' ? 'text-danger' : 'text-foreground';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-[160px] flex-1">
          <Label htmlFor="overview-plant" className="text-xs text-muted-foreground">Plant</Label>
          <PlantPicker value={plantId} onChange={setPlantId} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Show:</span>
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                statusFilter === s ? 'bg-primary text-primary-foreground border-primary'
                  : cn('border-border bg-muted/50 hover:bg-muted', statusColor(s)))}>
              {s}
            </button>
          ))}
        </div>
        <div className="relative min-w-[160px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search train…"
            className="w-full h-9 pl-7 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring" id="overview-plant"/>
        </div>
      </div>

      {plantId && (
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3 space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Plant Health</p>
            <div className="flex items-end gap-2">
              <span className={cn('text-2xl font-bold font-mono-num', healthScore != null && healthScore >= 80 ? 'text-accent' : healthScore != null && healthScore >= 50 ? 'text-warn' : 'text-danger')}>
                {healthScore != null ? `${healthScore}%` : '—'}
              </span>
              <span className={cn('text-xs font-medium pb-0.5', healthScore != null && healthScore >= 80 ? 'text-accent' : 'text-warn')}>
                {healthScore != null && healthScore >= 80 ? 'Optimal' : healthScore != null && healthScore >= 50 ? 'Degraded' : 'Critical'}
              </span>
            </div>
            <div className="flex gap-2 text-2xs text-muted-foreground flex-wrap">
              <span className="text-accent font-medium">● {onlineCount} Online</span>
              <span className="text-warn font-medium">● {maintCount} Maint.</span>
              <span className="text-danger font-medium">● {offlineCount} Offline</span>
            </div>
          </Card>
          <Card className="p-3 space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Recovery</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold font-mono-num text-foreground">{avgRecovery != null ? `${avgRecovery}%` : '—'}</span>
            </div>
            <p className="text-2xs text-muted-foreground">{totalTrains} trains total · {onlineCount} active</p>
          </Card>
          <Card className="p-3 space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Perm TDS</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold font-mono-num text-foreground">{avgPermTDS != null ? `${avgPermTDS} ppm` : '—'}</span>
            </div>
            <p className="text-2xs text-muted-foreground">Last readings · all trains</p>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {filtered.map((t: any) => (
          <TrainCard key={t.id} train={t} last={lastReadings?.[t.id] ?? null} spark={sparkData?.[t.id] ?? []}
            hasReadingToday={!!lastReadings?.[t.id]?.reading_datetime && new Date(lastReadings[t.id].reading_datetime) >= startOfToday}
            gapReason={gapReasonsByTrain[t.id] ?? null}
            onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['train-gap-reasons', plantId, todayDateStr] })}
            autoOpenLog={deepLog && deepTrain === t.id}
            autoOpenTab={deepLogTab}
            autoOpenHighlightId={deepHighlight}
            onAutoOpenConsumed={clearDeepLinkParams} />
        ))}
      </div>
      {plantId && !filtered.length && <Card className="p-4 text-xs text-center text-muted-foreground">No trains match your filter</Card>}
      {!plantId && <Card className="p-4 text-xs text-center text-muted-foreground">Select a plant to view trains</Card>}
    </div>
  );
}
