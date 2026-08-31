import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { deriveTrainStatus, TrainCard } from '../ro-trains';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import { useTrainHourlyGaps, type TrainHourlyGap } from '@/hooks/useTrainHourlyGaps';
import { Search, X, ShieldAlert } from 'lucide-react';
import { PlantPicker } from './shared/PlantPicker';

// ─── Overview Dashboard ───────────────────────────────────────────────────────
export function Overview() {
  const { selectedPlantId, addAlerts, removeAlerts } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Running' | 'Maintenance' | 'Offline'>('All');
  const [search, setSearch] = useState('');
  const lastSyncedPlantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPlantId || selectedPlantId === lastSyncedPlantRef.current) return;
    lastSyncedPlantRef.current = selectedPlantId;
    setPlantId(selectedPlantId);
  }, [selectedPlantId]);

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
        .limit(trainIds.length * 14);
      const map: Record<string, any[]> = {};
      for (const r of data ?? []) {
        if (!map[r.train_id]) map[r.train_id] = [];
        if (map[r.train_id].length < 12) map[r.train_id].push(r);
      }
      return map;
    },
    enabled: trainIds.length > 0,
    refetchInterval: 180_000,
  });

  const trainHourlyGaps = useTrainHourlyGaps(plantId ? [plantId] : []);
  const hourlyGapsByTrain = useMemo(() => {
    const m: Record<string, TrainHourlyGap[]> = {};
    trainHourlyGaps.forEach((g) => { (m[g.train_id] ??= []).push(g); });
    return m;
  }, [trainHourlyGaps]);

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
    <div className="space-y-3">
      {/* ── Control & Filter Toolbar ── */}
      <div className="p-1.5 rounded-xl border border-border/50 bg-card flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[180px] max-w-xs">
          <div className="flex-1">
            <PlantPicker value={plantId} onChange={setPlantId} />
          </div>
        </div>

        {/* Status Filter Segmented Controls */}
        <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-lg border border-border/40">
          {STATUS_FILTERS.map(({ key, label, dot }) => {
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                  isActive
                    ? 'bg-background text-foreground shadow-xs border border-border/50 font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}
              >
                {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Search train */}
        <div className="relative min-w-[140px] sm:min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground h-3 w-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search train…"
            className="w-full h-8 pl-7 pr-6 rounded-lg border border-border/50 bg-background text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 transition-colors"
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

      {/* ── Train Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {filtered.map((t: any) => (
          <TrainCard
            key={t.id}
            train={t}
            last={lastReadings?.[t.id] ?? null}
            spark={sparkData?.[t.id] ?? []}
            permTdsLimit={PERM_TDS_LIMIT}
            hourlyGaps={hourlyGapsByTrain[t.id] ?? []}
            autoOpenLog={deepLog && deepTrain === t.id}
            autoOpenTab={deepLogTab}
            autoOpenHighlightId={deepHighlight}
            onAutoOpenConsumed={clearDeepLinkParams}
          />
        ))}
      </div>

      {plantId && !filtered.length && (
        <Card className="p-6 text-center space-y-1 rounded-xl border border-dashed shadow-none">
          <p className="text-xs font-semibold text-foreground">No trains match your filter</p>
          <p className="text-3xs text-muted-foreground">Try resetting the status filter or searching for another train number.</p>
        </Card>
      )}

      {!plantId && (
        <Card className="p-6 text-center space-y-1 rounded-xl border border-dashed shadow-none">
          <p className="text-xs font-semibold text-foreground">Select a plant</p>
          <p className="text-3xs text-muted-foreground">Choose a facility from the picker above to load its RO train topology.</p>
        </Card>
      )}
    </div>
  );
}
