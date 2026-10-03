import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ChevronLeft,
  Gauge,
  Zap,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Clock,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { MeterDetailButton } from '@/features/plants/components/charts/EntityHistoryChart/index';
import { EntityHistoryChart } from '@/features/plants/components/charts/EntityHistoryChart/index';
import { ReplaceMeterDialog } from '@/features/plants/components/locators/LocatorDialogs';
import { MeterReplacementDetailDialog } from '@/components/readingHistory/MeterReplacementDetailDialog';
import { replacementToInitial } from '@/components/readingHistory/replacementEdit';
import type { NormalizedReplacement, ReplacementDetailHost } from '@/components/readingHistory/replacementTypes';
import { EditElectricMeterDialog, EditHydraulicDialog, HydraulicHistoryDialog } from './WellDialogs';
import { deleteWellMeterReplacement } from '@/lib/meterReplacementDelete';
import { useAuth } from '@/hooks/useAuth';
import { WellUnavailable } from './WellUnavailable';
import { resolveWellView } from '../lib/wellRoutes';
import { CanLink } from '@/components/CanLink';
import { readingsPath } from '@/shared/assetLinks';
import { WellHeroCard } from './detail/WellHeroCard';
import {
  computeDrawdown,
  getMissingCoreFields,
  getSurveyAgeDays,
  isSurveyDue as checkIsSurveyDue,
  getHydraulicStatus,
  getHydraulicStatusMeta,
} from '../lib/hydraulics';
import { WellReplacementHistoryCard } from './detail/WellReplacementHistoryCard';
import { WellHydraulicDataCard } from './detail/WellHydraulicDataCard';

export function WellDetail({ wellId, plantId, onBack }: { wellId: string; /** The plant in the URL; a well from another plant is treated as not found. */ plantId?: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [replaceOpen, setReplaceOpen] = useState(false);
  /** Which logged swap the user clicked in Replacement History for detailed popover */
  const [detailRec, setDetailRec] = useState<NormalizedReplacement | null>(null);
  const [editInitial, setEditInitial] = useState<any | null>(null);
  const [editHydraulicOpen, setEditHydraulicOpen] = useState(false);
  const [editingPmsRecord, setEditingPmsRecord] = useState<any | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletePmsRecord, setDeletePmsRecord] = useState<any | null>(null);
  const [deleteReplRecord, setDeleteReplRecord] = useState<NormalizedReplacement | null>(null);
  const [deletingPms, setDeletingPms] = useState(false);
  const [deletingRepl, setDeletingRepl] = useState(false);
  const [editElectricOpen, setEditElectricOpen] = useState(false);

  // P5-3: the well now comes from a URL, so "no such row" is a normal outcome.
  // maybeSingle() gives null for that; a real failure throws so it can be told
  // apart from "not found" instead of both spinning forever.
  const { data: well, isLoading: wellLoading, isError: wellError, refetch: refetchWell } = useQuery({
    queryKey: ['well', wellId],
    queryFn: async () => {
      const { data, error } = await supabase.from('wells').select('*').eq('id', wellId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: pms } = useQuery({
    queryKey: ['well-pms', wellId],
    queryFn: async () => (await supabase.from('well_pms_records').select('*').eq('well_id', wellId).order('date_gathered', { ascending: false })).data ?? [],
  });
  const { data: latestReplacement } = useQuery({
    queryKey: ['well-latest-replacement', wellId],
    queryFn: async () => {
      const { data } = await supabase.from('well_meter_replacements')
        .select('*, replacer:user_profiles!well_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('well_id', wellId).order('replacement_date', { ascending: false }).limit(1);
      return (data?.[0] ?? null) as any;
    },
  });
  const { data: allReplacements = [] } = useQuery<any[]>({
    queryKey: ['well-replacements', wellId],
    queryFn: async () => {
      const { data } = await supabase.from('well_meter_replacements')
        .select('*, replacer:user_profiles!well_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('well_id', wellId).order('replacement_date', { ascending: false });
      return data ?? [];
    },
  });
  const { data: rawReadings = [] } = useQuery<any[]>({
    queryKey: ['well-raw-readings', wellId],
    queryFn: async () => {
      const { data } = await supabase
        .from('well_readings')
        .select('id, reading_datetime, current_reading, previous_reading, power_meter_reading, tds_ppm, pressure_psi')
        .eq('well_id', wellId)
        .order('reading_datetime', { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });
  const { data: isBlendingWell } = useQuery<boolean>({
    queryKey: ['well-is-blending', wellId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blending_wells')
        .select('well_id')
        .eq('well_id', wellId)
        .limit(1);
      if (error) return false;
      return (data ?? []).length > 0;
    },
  });

  const view = resolveWellView({ well: well as { plant_id?: string | null } | null | undefined, isLoading: wellLoading, isError: wellError, plantId });
  if (view === 'loading') return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
  if (view === 'not-found' || view === 'error' || !well) {
    return <WellUnavailable kind={view === 'error' ? 'error' : 'not-found'} onBack={onBack} onRetry={() => { void refetchWell(); }} />;
  }

  const latest = pms?.[0];
  const previous = pms?.[1];
  const drillingDepth = (latest as any)?.drilling_depth_m ?? (well as any).drilling_depth_m;
  const swl = latest?.static_water_level_m;
  const pwl = latest?.pumping_water_level_m;
  const drawdown = computeDrawdown(pwl, swl);

  const missingCoreFields = getMissingCoreFields(latest, drillingDepth);
  const daysSinceSurvey = getSurveyAgeDays(latest?.date_gathered);
  const isSurveyDue = checkIsSurveyDue(latest?.date_gathered);
  const hydraulicStatus = getHydraulicStatus(latest, drillingDepth);
  const statusMeta = getHydraulicStatusMeta(hydraulicStatus, daysSinceSurvey, missingCoreFields.length);

  let statusBadge: React.ReactNode = null;
  if (hydraulicStatus === 'no_survey') {
    statusBadge = (
      <Badge variant="outline" className={`gap-1 text-2xs ${statusMeta.badgeClass}`}>
        <AlertTriangle className="h-3 w-3" /> {statusMeta.label}
      </Badge>
    );
  } else if (hydraulicStatus === 'incomplete') {
    statusBadge = (
      <Badge
        variant="outline"
        className={`gap-1 text-2xs ${statusMeta.badgeClass}`}
        title={`Missing: ${missingCoreFields.map(f => f.label).join(', ')}`}
      >
        <AlertCircle className="h-3 w-3" /> {statusMeta.label}
      </Badge>
    );
  } else if (hydraulicStatus === 'overdue') {
    statusBadge = (
      <Badge
        variant="outline"
        className={`gap-1 text-2xs ${statusMeta.badgeClass}`}
      >
        <Clock className="h-3 w-3" /> {statusMeta.label}
      </Badge>
    );
  } else {
    statusBadge = (
      <Badge
        variant="outline"
        className={`gap-1 text-2xs ${statusMeta.badgeClass}`}
      >
        <CheckCircle2 className="h-3 w-3" /> {statusMeta.label}
      </Badge>
    );
  }

  const latestPressureReading = (rawReadings as any[]).find((r: any) => r.pressure_psi != null);
  const operatingPressure = latestPressureReading?.pressure_psi;
  const latestTdsReading = (rawReadings as any[]).find((r: any) => r.tds_ppm != null);
  const dailyTds = latestTdsReading?.tds_ppm;

  const replacerName = latestReplacement?.replacer
    ? [latestReplacement.replacer.first_name, latestReplacement.replacer.last_name].filter(Boolean).join(' ') : null;
  const hasCoords = (well as any).gps_lat != null && (well as any).gps_lng != null;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${(well as any).gps_lat},${(well as any).gps_lng}` : null;

  const handleDeletePmsRecord = async () => {
    if (!deletePmsRecord) return;
    setDeletingPms(true);
    try {
      const { error } = await supabase
        .from('well_pms_records')
        .delete()
        .eq('id', deletePmsRecord.id);
      if (error) {
        toast.error(friendlyError(error));
        return;
      }
      toast.success('Hydraulic survey record deleted');
      setDeletePmsRecord(null);
      qc.invalidateQueries({ queryKey: ['well-pms', wellId] });
      qc.invalidateQueries({ queryKey: ['well', wellId] });
    } finally {
      setDeletingPms(false);
    }
  };

  const handleDeleteReplRecord = async () => {
    if (!deleteReplRecord) return;
    setDeletingRepl(true);
    try {
      const res = await deleteWellMeterReplacement({
        replacementId: deleteReplRecord.id,
        wellId,
        plantId: well.plant_id,
      });
      if (!res.success) {
        toast.error(res.error || 'Failed to delete replacement');
        return;
      }
      toast.success('Meter replacement deleted');
      setDeleteReplRecord(null);
      setDetailRec(null);
      qc.invalidateQueries({ queryKey: ['well', wellId] });
      qc.invalidateQueries({ queryKey: ['well-latest-replacement', wellId] });
      qc.invalidateQueries({ queryKey: ['well-replacements', wellId] });
      qc.invalidateQueries({ queryKey: ['well-raw-readings', wellId] });
      qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
      qc.invalidateQueries({ queryKey: ['reading-history'] });
    } finally {
      setDeletingRepl(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" /> Back to Wells
        </button>
        {/* P5-7: the way back to this well's row in Daily Readings. */}
        <CanLink module="operations">
          <Link
            to={readingsPath('well', well.id)}
            title="Open this well in Daily Readings"
            className="inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted px-2 py-0.5 rounded-full transition-colors border border-border/50"
          >
            <ArrowUpRight className="h-2.5 w-2.5" />
            <span>Daily Readings</span>
          </Link>
        </CanLink>
      </div>

      {/* Hero */}
      <WellHeroCard well={well} drillingDepth={drillingDepth} hasCoords={hasCoords} mapsUrl={mapsUrl} />

      {/* Water Meter */}
      <MeterDetailButton label="Water Meter" icon={<Gauge className="h-4 w-4 text-info" />}
        fields={[
          { label: 'Brand', value: well.meter_brand },
          { label: 'Size', value: well.meter_size ? `${well.meter_size} in` : null },
          { label: 'Serial No.', value: well.meter_serial },
          { label: 'Installed', value: well.meter_installed_date },
          { label: 'Last Replaced By', value: replacerName },
          { label: 'Replacement Date', value: latestReplacement?.replacement_date },
        ]}>
        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setReplaceOpen(true)}>
          Replace Meter
        </Button>
      </MeterDetailButton>

      {/* Electric Meter */}
      {well.has_power_meter && (
        <MeterDetailButton label="Electric Meter" icon={<Zap className="h-4 w-4 text-warn" />}
          fields={[
            { label: 'Brand', value: (well as any).electric_meter_brand },
            { label: 'Size', value: (well as any).electric_meter_size },
            { label: 'Serial No.', value: (well as any).electric_meter_serial },
            { label: 'Installed', value: (well as any).electric_meter_installed_date },
          ]}>
          {isManager && (
            <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setEditElectricOpen(true)}>
              Edit Electric Meter
            </Button>
          )}
        </MeterDetailButton>
      )}

      {/* Replacement History */}
      <WellReplacementHistoryCard
        allReplacements={allReplacements}
        isManager={isManager}
        onReplaceMeter={() => setReplaceOpen(true)}
        onViewDetail={(norm) => setDetailRec(norm)}
        onEditReplacement={(initial) => setEditInitial(initial)}
        onDeleteReplacement={(norm) => setDeleteReplRecord(norm)}
      />

      {/* Historical Consumption Chart */}
      <Card className="p-3">
        <EntityHistoryChart
          entityId={wellId}
          entityType="well"
          entityName={well.name}
          isBlendingWell={!!isBlendingWell}
          entityMultiplier={well.multiplier_enabled ? Number(well.meter_multiplier ?? 1) : 1}
        />
      </Card>

      {/* Hydraulic data */}
      <WellHydraulicDataCard
        pms={pms}
        latest={latest}
        previous={previous}
        statusBadge={statusBadge}
        missingCoreFields={missingCoreFields}
        isSurveyDue={isSurveyDue}
        daysSinceSurvey={daysSinceSurvey}
        drillingDepth={drillingDepth}
        drawdown={drawdown}
        operatingPressure={operatingPressure}
        operatingPressureDate={latestPressureReading?.reading_datetime}
        dailyTds={dailyTds}
        dailyTdsDate={latestTdsReading?.reading_datetime}
        isManager={isManager}
        plantId={plantId ?? well?.plant_id}
        onOpenHistory={() => setHistoryOpen(true)}
        onEditSurvey={(rec) => {
          setEditingPmsRecord(rec);
          setEditHydraulicOpen(true);
        }}
        onLogNewSurvey={() => {
          setEditingPmsRecord(null);
          setEditHydraulicOpen(true);
        }}
      />

      {replaceOpen && (
        <ReplaceMeterDialog kind="well" assetId={wellId} plantId={well.plant_id} oldSerial={well.meter_serial}
          onClose={() => {
            setReplaceOpen(false);
            qc.invalidateQueries({ queryKey: ['well', wellId] });
            qc.invalidateQueries({ queryKey: ['well-latest-replacement', wellId] });
            qc.invalidateQueries({ queryKey: ['well-replacements', wellId] });
          }}
        />
      )}

      <MeterReplacementDetailDialog
        host={detailRec ? ({
          target: {
            kind: 'well',
            readingId: (detailRec.raw?.reading_id ?? null) as string | null,
            entityId: wellId, plantId: well.plant_id ?? null,
            entityName: well.name, readingDatetime: detailRec.replacementDate ?? null,
          },
          settingsHref: null,
          canEdit: isManager,
        } satisfies ReplacementDetailHost) : null}
        records={detailRec ? [detailRec] : []}
        isLoading={false}
        onClose={() => setDetailRec(null)}
        onEdit={(rec) => {
          setDetailRec(null);
          if (rec) setEditInitial(replacementToInitial(rec));
          else setReplaceOpen(true);
        }}
        onDelete={(rec) => {
          setDetailRec(null);
          setDeleteReplRecord(rec);
        }}
      />

      {editInitial && (
        <ReplaceMeterDialog
          kind="well" assetId={wellId} plantId={well.plant_id} oldSerial={well.meter_serial}
          readingId={(editInitial.readingId ?? undefined) as string | undefined}
          initial={editInitial}
          onSuccess={() => {
            setEditInitial(null);
            qc.invalidateQueries({ queryKey: ['well', wellId] });
            qc.invalidateQueries({ queryKey: ['well-latest-replacement', wellId] });
            qc.invalidateQueries({ queryKey: ['well-replacements', wellId] });
            qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
            qc.invalidateQueries({ queryKey: ['reading-history'] });
          }}
          onClose={() => setEditInitial(null)}
        />
      )}

      {editHydraulicOpen && (
        <EditHydraulicDialog
          well={well}
          latest={latest}
          record={editingPmsRecord}
          onClose={() => {
            setEditHydraulicOpen(false);
            setEditingPmsRecord(null);
            qc.invalidateQueries({ queryKey: ['well-pms', wellId] });
            qc.invalidateQueries({ queryKey: ['well', wellId] });
          }}
        />
      )}

      {historyOpen && (
        <HydraulicHistoryDialog
          well={well}
          records={pms ?? []}
          canEdit={isManager}
          onEdit={(rec) => {
            setHistoryOpen(false);
            setEditingPmsRecord(rec);
            setEditHydraulicOpen(true);
          }}
          onDelete={(rec) => {
            setDeletePmsRecord(rec);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {editElectricOpen && (
        <EditElectricMeterDialog well={well} onClose={() => {
          setEditElectricOpen(false);
          qc.invalidateQueries({ queryKey: ['well', wellId] });
          qc.invalidateQueries({ queryKey: ['wells', well.plant_id] });
        }} />
      )}

      {/* Confirm Delete PMS Record */}
      <AlertDialog open={!!deletePmsRecord} onOpenChange={(open) => { if (!open) setDeletePmsRecord(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader tone="critical">
            <AlertDialogTitle>Delete Hydraulic Survey Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the hydraulic survey record from{' '}
              <strong className="text-foreground">{deletePmsRecord?.date_gathered}</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPms}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingPms}
              onClick={handleDeletePmsRecord}
            >
              {deletingPms ? 'Deleting…' : 'Delete Record'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Delete Meter Replacement */}
      <AlertDialog open={!!deleteReplRecord} onOpenChange={(open) => { if (!open) setDeleteReplRecord(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader tone="critical">
            <AlertDialogTitle>Delete Meter Replacement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the meter replacement from{' '}
              <strong className="text-foreground">{deleteReplRecord?.replacementDate}</strong>?
              <br /><br />
              This will remove any synthetic reading logged for this swap, unflag associated records,
              and restore the well&apos;s active meter serial to the prior installed meter. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRepl}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingRepl}
              onClick={handleDeleteReplRecord}
            >
              {deletingRepl ? 'Deleting…' : 'Delete Replacement'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
