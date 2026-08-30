import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { deriveTrainStatus, TrainCard } from '../ro-trains';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import { useTrainHourlyGaps, type TrainHourlyGap } from '@/hooks/useTrainHourlyGaps';
import { Activity, Search, Droplet, X, ShieldAlert, Sparkles } from 'lucide-react';
import { ROTrainIcon, MembranePerformanceIcon, PermeateIcon } from '@/components/icons/water-icons';
import { PlantPicker } from './shared/PlantPicker';

// ─── Overview Dashboard ───────────────────────────────────────────────────────
export function Overview() {
  const [plantId, setPlantId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Running' | 'Maintenance' | 'Offline'>('All');
  const [search, setSearch] = useState('');
  const { selectedPlantId, addAlerts, removeAlerts } = useAppStore();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPlantId && !plantId) setPlantId(selectedPlantId); }, [selectedPlantId]);

  // ── Deep-link from an alert: /ro-trains?tab=overview&plant=<id>&train=<id>&log=1&logTab=ro|pretreat&highlight=<readingId> ──
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
    refetchInterval: 180_000,
  });

  const allReadings  = Object.values(lastReadings ?? {});
  const trainHourlyGaps = useTrainHourlyGaps(plantId ? [plantId] : []);
  const hourlyGapsByTrain = useMemo(() => {
    const m: Record<string, TrainHourlyGap[]> = {};
    trainHourlyGaps.forEach((g) => { (m[g.train_id] ??= []).push(g); });
    return m;
  }, [trainHourlyGaps]);

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

  const STATUS_FILTERS = [
    { key: 'All', label: 'All', dot: null },
    { key: 'Running', label: 'Running', dot: 'bg-accent' },
    { key: 'Maintenance', label: 'Maintenance', dot: 'bg-warn' },
    { key: 'Offline', label: 'Offline', dot: 'bg-danger' },
  ] as const;

  return (
    <div className="space-y-4">
      {/* ── Control & Filter Toolbar ── */}
      <div className="p-2 sm:p-2.5 rounded-2xl border border-border/70 bg-card/70 backdrop-blur-md shadow-2xs flex flex-wrap gap-2.5 items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <div className="flex-1">
            <PlantPicker value={plantId} onChange={setPlantId} />
          </div>
        </div>

        {/* Status Filter Segmented Controls */}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50">
          {STATUS_FILTERS.map(({ key, label, dot }) => {
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all',
                  isActive
                    ? 'bg-card text-foreground shadow-2xs border border-border/60'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Search train */}
        <div className="relative min-w-[160px] sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground h-3.5 w-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search train…"
            className="w-full h-9 pl-8 pr-7 rounded-xl border border-border/70 bg-background text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 transition-colors shadow-2xs"
            id="overview-plant"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Stat Cards ── */}
      {plantId && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Card 1: Plant Health */}
          <Card className="relative overflow-hidden p-4 rounded-2xl border border-border/70 bg-card/90 backdrop-blur-sm shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <span>Plant Health</span>
              </div>
              <span className={cn(
                'text-3xs font-bold uppercase px-2 py-0.5 rounded-full border',
                healthScore != null && healthScore >= 80 ? 'bg-accent-soft text-accent border-accent/30' :
                healthScore != null && healthScore >= 50 ? 'bg-warn-soft text-warn border-warn/30' :
                'bg-danger-soft text-danger border-danger/30'
              )}>
                {healthScore != null && healthScore >= 80 ? 'Optimal' : healthScore != null && healthScore >= 50 ? 'Degraded' : 'Critical'}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className={cn(
                'text-3xl font-extrabold font-mono-num tracking-tight',
                healthScore != null && healthScore >= 80 ? 'text-accent' :
                healthScore != null && healthScore >= 50 ? 'text-warn' : 'text-danger'
              )}>
                {healthScore != null ? `${healthScore}%` : '—'}
              </span>
            </div>

            {/* Segmented health gauge bar */}
            {totalTrains > 0 && (
              <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-muted gap-0.5">
                <div style={{ width: `${(onlineCount / totalTrains) * 100}%` }} className="bg-accent transition-all duration-500" />
                <div style={{ width: `${(maintCount / totalTrains) * 100}%` }} className="bg-warn transition-all duration-500" />
                <div style={{ width: `${(offlineCount / totalTrains) * 100}%` }} className="bg-danger transition-all duration-500" />
              </div>
            )}

            <div className="flex items-center gap-3 text-2xs text-muted-foreground font-mono-num pt-0.5">
              <span className="flex items-center gap-1 text-accent font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {onlineCount} Online
              </span>
              <span className="flex items-center gap-1 text-warn font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-warn" /> {maintCount} Maint.
              </span>
              <span className="flex items-center gap-1 text-danger font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" /> {offlineCount} Offline
              </span>
            </div>
          </Card>

          {/* Card 2: Avg Recovery */}
          <Card className="relative overflow-hidden p-4 rounded-2xl border border-border/70 bg-card/90 backdrop-blur-sm shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wider text-muted-foreground">
                <MembranePerformanceIcon className="h-3.5 w-3.5 text-primary" />
                <span>Avg Recovery</span>
              </div>
              <span className="text-3xs font-semibold text-muted-foreground bg-muted/80 px-2 py-0.5 rounded-full">
                Target 70.0%
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono-num tracking-tight text-foreground">
                {avgRecovery != null ? `${avgRecovery}%` : '—'}
              </span>
            </div>

            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                style={{ width: `${Math.min(100, Math.max(0, +(avgRecovery ?? 0)))}%` }}
                className="h-full bg-primary transition-all duration-500 rounded-full"
              />
            </div>

            <p className="text-2xs text-muted-foreground font-medium">
              {onlineCount} of {totalTrains} trains currently producing
            </p>
          </Card>

          {/* Card 3: Avg Perm TDS */}
          <Card className="relative overflow-hidden p-4 rounded-2xl border border-border/70 bg-card/90 backdrop-blur-sm shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wider text-muted-foreground">
                <PermeateIcon className="h-3.5 w-3.5 text-primary" />
                <span>Avg Perm TDS</span>
              </div>
              <span className={cn(
                'text-3xs font-bold px-2 py-0.5 rounded-full border',
                avgPermTDS != null && +avgPermTDS <= PERM_TDS_LIMIT
                  ? 'bg-accent-soft text-accent border-accent/30'
                  : 'bg-danger-soft text-danger border-danger/30'
              )}>
                {avgPermTDS != null && +avgPermTDS <= PERM_TDS_LIMIT ? 'Within Spec' : 'Exceeds Limit'}
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold font-mono-num tracking-tight text-foreground">
                {avgPermTDS != null ? avgPermTDS : '—'}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">ppm</span>
            </div>

            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                style={{ width: `${Math.min(100, Math.max(0, ((+(avgPermTDS ?? 0)) / PERM_TDS_LIMIT) * 100))}%` }}
                className={cn(
                  'h-full transition-all duration-500 rounded-full',
                  avgPermTDS != null && +avgPermTDS <= PERM_TDS_LIMIT ? 'bg-accent' : 'bg-danger'
                )}
              />
            </div>

            <p className="text-2xs text-muted-foreground font-medium">
              Permeate purity benchmark: &le; {PERM_TDS_LIMIT} ppm
            </p>
          </Card>
        </div>
      )}

      {/* ── Train Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((t: any) => (
          <TrainCard
            key={t.id}
            train={t}
            last={lastReadings?.[t.id] ?? null}
            spark={sparkData?.[t.id] ?? []}
            hourlyGaps={hourlyGapsByTrain[t.id] ?? []}
            autoOpenLog={deepLog && deepTrain === t.id}
            autoOpenTab={deepLogTab}
            autoOpenHighlightId={deepHighlight}
            onAutoOpenConsumed={clearDeepLinkParams}
          />
        ))}
      </div>

      {plantId && !filtered.length && (
        <Card className="p-8 text-center space-y-2 rounded-2xl border border-dashed">
          <p className="text-sm font-semibold text-foreground">No trains match your filter</p>
          <p className="text-xs text-muted-foreground">Try resetting the status filter or searching for another train number.</p>
        </Card>
      )}

      {!plantId && (
        <Card className="p-8 text-center space-y-2 rounded-2xl border border-dashed">
          <p className="text-sm font-semibold text-foreground">Select a plant</p>
          <p className="text-xs text-muted-foreground">Choose a facility from the picker above to load its RO train topology.</p>
        </Card>
      )}
    </div>
  );
}
