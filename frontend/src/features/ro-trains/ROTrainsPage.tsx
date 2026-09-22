import { useUrlTab } from '@/hooks/useUrlTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutGrid, Recycle } from 'lucide-react';
import { ROTrainIcon, ChemicalsIcon } from '@/components/icons/water-icons';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useROTrainsForPlant } from '@/hooks/useROTrains';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type Database } from '@/integrations/supabase/types';
import { deriveTrainStatus, ROTrainHero } from './index';
import { loadThresholds } from '@/pages/Compliance';

import { CIPLog } from './cip/CIPLog';
import { ChemicalDosing } from './dosing/ChemicalDosing';
import { Overview } from './Overview';
import { PretreatmentAndROLog } from './pretreatment/PretreatmentAndROLog';

// Mirrors the ?tab= pattern already used by operations/index.tsx, so alerts
// (Dashboard.tsx) and notifications can deep-link straight to a tab instead
// of always landing on Overview.
const RO_TRAIN_TABS = ['overview', 'pretreat-ro', 'cip', 'chemical-dosing'] as const;

export default function ROTrains() {
  // A tab picked by hand should not keep the ?train= deep link of an earlier
  // alert click: confusing once the operator has moved on to another train.
  const [tab, handleTabChange] = useUrlTab('tab', RO_TRAIN_TABS, 'overview', { clearOnChange: ['train'] });

  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const currentPlant = plants?.find(p => p.id === selectedPlantId);

  const { data: thresholds } = useQuery({
    queryKey: ['thresholds', selectedPlantId || 'global'],
    queryFn: () => loadThresholds(selectedPlantId || 'global'),
    staleTime: 60_000,
  });

  const { data: trains } = useROTrainsForPlant(selectedPlantId || undefined);

  const trainIds = (trains ?? []).map((t: any) => t.id);
  const trainIdsKey = trainIds.join(',');

  // EGRESS: this used to be its own ['ro-hero-last-all', ...] query — an
  // exact duplicate of Overview.tsx's ['ro-last-all', ...] query below (same
  // table, same columns, same trainIds), fetched a second time under a
  // different cache key purely because this page mounts <Overview> as its
  // default tab at the same time. Sharing the key lets react-query dedupe
  // the two into one request/cache entry instead of two independent ones.
  //
  // No refetchInterval here (and none in Overview.tsx either): this query
  // key is in useTrainDataRealtime's invalidation list, so real writes to
  // ro_train_readings/ro_pretreatment_readings/train_status_log already
  // trigger a refetch within moments via realtime — polling every 3 minutes
  // on top of that was pure duplicate egress, not added freshness. The 5-min
  // useBackgroundSync sweep remains the safety net for when realtime isn't
  // available (see useTrainDataRealtime.ts's own documented rationale).
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
    staleTime: 5 * 60_000,
  });

  const activeTrains = (trains ?? []).filter(
    (t: any) => deriveTrainStatus(t, lastReadings?.[t.id]) === 'Running'
  );
  const activeReadings = activeTrains
    .map((t: any) => lastReadings?.[t.id])
    .filter(Boolean);

  const onlineCount = activeTrains.length;
  const maintCount = (trains ?? []).filter(
    (t: any) => deriveTrainStatus(t, lastReadings?.[t.id]) === 'Maintenance'
  ).length;
  const offlineCount = (trains ?? []).filter(
    (t: any) => deriveTrainStatus(t, lastReadings?.[t.id]) === 'Offline'
  ).length;

  const totalPermFlow = activeReadings.reduce((s: number, r: any) => s + (r.permeate_flow ?? 0), 0);
  const hasPermFlow = activeReadings.some((r: any) => r.permeate_flow != null && r.permeate_flow > 0);

  const totalFeedFlow = activeReadings.reduce((s: number, r: any) => s + (r.feed_flow ?? 0), 0);
  const hasFeedFlow = activeReadings.some((r: any) => r.feed_flow != null && r.feed_flow > 0);

  const fleetRecovery =
    totalFeedFlow > 0 && totalPermFlow > 0
      ? (totalPermFlow / totalFeedFlow) * 100
      : activeReadings.filter((r: any) => r.recovery_pct != null).length
      ? activeReadings.reduce((s: number, r: any) => s + (r.recovery_pct ?? 0), 0) /
        activeReadings.filter((r: any) => r.recovery_pct != null).length
      : null;

  const tdsReadings = activeReadings.filter((r: any) => r.permeate_tds != null);
  const avgPermTDS = tdsReadings.length
    ? tdsReadings.reduce((s: number, r: any) => s + (r.permeate_tds ?? 0), 0) / tdsReadings.length
    : null;

  const dpReadings = activeReadings
    .map((r: any) => {
      if (r.dp_psi != null) return r.dp_psi;
      if (r.feed_pressure_psi != null && r.reject_pressure_psi != null) {
        return r.feed_pressure_psi - r.reject_pressure_psi;
      }
      return null;
    })
    .filter((v: any) => v != null);
  const avgDp = dpReadings.length
    ? dpReadings.reduce((s: number, v: number) => s + v, 0) / dpReadings.length
    : null;

  const rejReadings = activeReadings
    .map((r: any) => {
      if (r.rejection_pct != null) return r.rejection_pct;
      if (r.feed_tds != null && r.permeate_tds != null && r.feed_tds > 0) {
        return (1 - r.permeate_tds / r.feed_tds) * 100;
      }
      return null;
    })
    .filter((v: any) => v != null);
  const avgRejection = rejReadings.length
    ? rejReadings.reduce((s: number, v: number) => s + v, 0) / rejReadings.length
    : null;

  return (
    <div className="space-y-4 animate-fade-in">
      <ROTrainHero
        plantName={currentPlant?.name}
        totalTrains={trains?.length ?? 0}
        onlineCount={onlineCount}
        maintCount={maintCount}
        offlineCount={offlineCount}
        permeateFlow={hasPermFlow ? totalPermFlow : null}
        feedFlow={hasFeedFlow ? totalFeedFlow : null}
        fleetRecovery={fleetRecovery}
        avgPermTDS={avgPermTDS}
        avgDp={avgDp}
        avgRejection={avgRejection}
        permTdsLimit={thresholds?.permeate_tds_max}
        recoveryMin={thresholds?.recovery_pct_min}
      />
      <Tabs value={tab} onValueChange={handleTabChange} className="space-y-3">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto sm:h-10 p-1 rounded-xl bg-muted/50 border border-border/50 gap-1">
          <TabsTrigger
            value="overview"
            className="h-8 rounded-lg px-3 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs text-muted-foreground transition-all gap-1.5"
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Overview</span>
          </TabsTrigger>

          <TabsTrigger
            value="pretreat-ro"
            className="h-8 rounded-lg px-3 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs text-muted-foreground transition-all gap-1.5"
          >
            <ROTrainIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Pre-Treatment & RO</span>
          </TabsTrigger>

          <TabsTrigger
            value="cip"
            className="h-8 rounded-lg px-3 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs text-muted-foreground transition-all gap-1.5"
          >
            <Recycle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>CIP</span>
          </TabsTrigger>

          <TabsTrigger
            value="chemical-dosing"
            className="h-8 rounded-lg px-3 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs text-muted-foreground transition-all gap-1.5"
          >
            <ChemicalsIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Chemical Dosing</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-2"><Overview /></TabsContent>
        <TabsContent value="pretreat-ro" className="mt-2"><PretreatmentAndROLog /></TabsContent>
        <TabsContent value="cip" className="mt-2"><CIPLog /></TabsContent>
        <TabsContent value="chemical-dosing" className="mt-2"><ChemicalDosing /></TabsContent>
      </Tabs>
    </div>
  );
}
