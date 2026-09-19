import { useState } from 'react';
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
  MapPin,
  Gauge,
  Zap,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Clock,
  CheckCircle2,
  Pencil,
  Trash2,
  Eye,
  History,
  Layers,
  Activity,
  Plus,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { MeterDetailButton } from '../../charts/EntityHistoryChart/index';
import { EntityHistoryChart } from '../../charts/EntityHistoryChart/index';
import { ReplaceMeterDialog } from '../../locators/LocatorDialogs';
import { MeterReplacementDetailDialog } from '@/components/readingHistory/MeterReplacementDetailDialog';
import { normalizeReplacementRow } from '@/components/readingHistory/replacementLookup';
import { replacementToInitial } from '@/components/readingHistory/replacementEdit';
import { ReplPill } from '@/components/readingHistory/ReplPill';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import type { NormalizedReplacement, ReplacementDetailHost } from '@/components/readingHistory/replacementTypes';
import { EditElectricMeterDialog, EditHydraulicDialog, HydraulicHistoryDialog } from '../WellDialogs';
import { deleteWellMeterReplacement } from '@/lib/meterReplacementDelete';
import { useAuth } from '@/hooks/useAuth';

export function WellDetail({ wellId, onBack }: { wellId: string; onBack: () => void }) {
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

  const { data: well } = useQuery({
    queryKey: ['well', wellId],
    queryFn: async () => (await supabase.from('wells').select('*').eq('id', wellId).single()).data,
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

  if (!well) return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  const latest = pms?.[0];
  const drillingDepth = (latest as any)?.drilling_depth_m ?? (well as any).drilling_depth_m;
  const swl = latest?.static_water_level_m;
  const pwl = latest?.pumping_water_level_m;
  const drawdown = pwl != null && swl != null ? +(pwl - swl).toFixed(2) : null;

  const coreFields = [
    { label: 'Drilling Depth', value: drillingDepth },
    { label: 'SWL', value: latest?.static_water_level_m },
    { label: 'PWL', value: latest?.pumping_water_level_m },
    { label: 'Pump Setting', value: latest?.pump_setting },
    { label: 'Motor HP', value: latest?.motor_hp },
    { label: 'TDS (PMS)', value: latest?.tds_ppm },
    { label: 'Turbidity', value: latest?.turbidity_ntu },
  ];
  const missingCoreFields = coreFields.filter(f => f.value == null || f.value === '');

  let daysSinceSurvey: number | null = null;
  if (latest?.date_gathered) {
    const d = new Date(latest.date_gathered);
    if (!isNaN(d.getTime())) {
      daysSinceSurvey = differenceInDays(new Date(), d);
    }
  }
  const isSurveyDue = daysSinceSurvey != null && daysSinceSurvey > 90;

  let statusBadge = null;
  if (!latest) {
    statusBadge = (
      <Badge variant="outline" className="text-destructive bg-destructive/10 border-destructive/20 gap-1 text-2xs">
        <AlertTriangle className="h-3 w-3" /> No Survey Logged
      </Badge>
    );
  } else if (missingCoreFields.length > 0) {
    statusBadge = (
      <Badge
        variant="outline"
        className="text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25 gap-1 text-2xs"
        title={`Missing: ${missingCoreFields.map(f => f.label).join(', ')}`}
      >
        <AlertCircle className="h-3 w-3" /> Incomplete ({missingCoreFields.length} missing)
      </Badge>
    );
  } else if (isSurveyDue) {
    statusBadge = (
      <Badge
        variant="outline"
        className="text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25 gap-1 text-2xs"
      >
        <Clock className="h-3 w-3" /> Survey Due ({daysSinceSurvey}d ago)
      </Badge>
    );
  } else {
    statusBadge = (
      <Badge
        variant="outline"
        className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25 gap-1 text-2xs"
      >
        <CheckCircle2 className="h-3 w-3" /> Up to Date
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
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" /> Back to Wells
      </button>

      {/* Hero */}
      <Card className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-base">{well.name}</h3>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {well.diameter && <span>{well.diameter}</span>}
              {drillingDepth && <span>{drillingDepth} m depth</span>}
            </div>
            {hasCoords && (
              <a href={mapsUrl!} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                <MapPin className="h-3 w-3" />
                {(+(well as any).gps_lat).toFixed(5)}, {(+(well as any).gps_lng).toFixed(5)}
              </a>
            )}
          </div>
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${
            well.status === 'Active' ? 'text-accent bg-accent-soft border-accent'
            : 'text-muted-foreground bg-muted border-border'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${well.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground'}`} />
            {well.status ?? 'Active'}
          </span>
        </div>
      </Card>

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
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <ChangeMeterIcon className="h-4 w-4 text-muted-foreground" /> Replacement History
            </h4>
            <Badge variant="secondary" className="text-2xs font-mono h-5 px-1.5">
              {(allReplacements as any[]).length}
            </Badge>
          </div>
          {isManager && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => setReplaceOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Replace Meter
            </Button>
          )}
        </div>
        {(allReplacements as any[]).length ? (
          <div className="space-y-2">
            {(allReplacements as any[]).map((r: any) => {
              const norm = normalizeReplacementRow('well', r);
              const replacerStr = r.replacer
                ? [r.replacer.first_name, r.replacer.last_name].filter(Boolean).join(' ')
                : null;
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-border/70 bg-card p-2.5 space-y-2 text-xs hover:border-border transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 border-b pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{r.replacement_date}</span>
                      <ReplPill title="View replacement details" onClick={() => setDetailRec(norm)} />
                      {replacerStr && (
                        <span className="text-2xs text-muted-foreground hidden sm:inline">
                          by {replacerStr}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        title="View details"
                        onClick={() => setDetailRec(norm)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {isManager && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                            title="Edit replacement"
                            onClick={() => setEditInitial(replacementToInitial(norm))}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="Delete replacement"
                            onClick={() => setDeleteReplRecord(norm)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-2xs">
                    <div className="rounded bg-muted/40 p-2 border border-border/40">
                      <div className="text-muted-foreground font-medium uppercase tracking-wider text-3xs">Old Meter</div>
                      <div className="text-foreground font-mono mt-0.5">SN: {r.old_serial ?? '—'}</div>
                      <div className="text-muted-foreground mt-0.5">Final: <span className="font-mono font-medium text-foreground">{r.old_final_reading != null ? fmtNum(+r.old_final_reading, 2) : '—'}</span></div>
                    </div>
                    <div className="rounded bg-primary/5 p-2 border border-primary/20">
                      <div className="text-primary font-medium uppercase tracking-wider text-3xs">New Meter</div>
                      <div className="text-foreground font-mono mt-0.5">SN: {r.new_serial ?? '—'}</div>
                      <div className="text-muted-foreground mt-0.5">Initial: <span className="font-mono font-medium text-foreground">{r.new_initial_reading != null ? fmtNum(+r.new_initial_reading, 2) : '—'}</span></div>
                    </div>
                  </div>

                  {r.reason_for_replacement && (
                    <div className="text-2xs text-muted-foreground pt-0.5">
                      <span className="font-medium">Reason:</span> {r.reason_for_replacement}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">No meter replacements recorded yet.</p>
        )}
      </Card>

      {/* Historical Consumption Chart */}
      <Card className="p-3">
        <EntityHistoryChart entityId={wellId} entityType="well" entityName={well.name} isBlendingWell={!!isBlendingWell} />
      </Card>

      {/* Hydraulic data */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold flex items-center gap-1.5">
              <Gauge className="h-4 w-4 text-info" /> Hydraulic Data
            </span>
            {statusBadge}
          </div>
          <div className="flex items-center gap-1.5">
            {pms && pms.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="h-3.5 w-3.5" /> History ({pms.length})
              </Button>
            )}
            {isManager && (
              <>
                {latest ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => {
                        setEditingPmsRecord(latest);
                        setEditHydraulicOpen(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" /> Edit Survey
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => {
                        setEditingPmsRecord(null);
                        setEditHydraulicOpen(true);
                      }}
                    >
                      <Plus className="h-3 w-3" /> Log New
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => {
                      setEditingPmsRecord(null);
                      setEditHydraulicOpen(true);
                    }}
                  >
                    <Plus className="h-3 w-3" /> Log Survey
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Notifications & Incomplete Callout */}
        {!latest ? (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-destructive/10 text-destructive border border-destructive/20 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="flex-1">No hydraulic survey has been logged yet for this well.</div>
            {isManager && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => { setEditingPmsRecord(null); setEditHydraulicOpen(true); }}>
                Log First Survey
              </Button>
            )}
          </div>
        ) : missingCoreFields.length > 0 ? (
          <div className="flex items-center gap-2 p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Incomplete survey data. Missing: <strong>{missingCoreFields.map(f => f.label).join(', ')}</strong>.
            </span>
            {isManager && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => { setEditingPmsRecord(latest); setEditHydraulicOpen(true); }}>
                Complete Data
              </Button>
            )}
          </div>
        ) : isSurveyDue ? (
          <div className="flex items-center gap-2 p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-xs">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Last survey was recorded <strong>{daysSinceSurvey} days ago</strong> ({latest.date_gathered}). Recommended update interval is quarterly (90 days).
            </span>
            {isManager && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => { setEditingPmsRecord(null); setEditHydraulicOpen(true); }}>
                Log New Survey
              </Button>
            )}
          </div>
        ) : null}

        {/* 3 Metric Clusters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Cluster 1: Borehole & Levels */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Layers className="h-3.5 w-3.5 text-info" /> Borehole & Water Levels
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Drilling Depth</div>
                <div className="font-mono-num font-medium">{drillingDepth ? `${drillingDepth} m` : '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Static Level (SWL)</div>
                <div className="font-mono-num font-medium">{latest?.static_water_level_m != null ? `${latest.static_water_level_m} m` : '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Pumping Level (PWL)</div>
                <div className="font-mono-num font-medium">{latest?.pumping_water_level_m != null ? `${latest.pumping_water_level_m} m` : '—'}</div>
              </div>
              <div className="rounded bg-info/10 p-1.5 -m-0.5 border border-info/20">
                <div className="text-2xs uppercase tracking-wide text-info font-medium flex items-center justify-between">
                  <span>Drawdown</span>
                  <span className="text-3xs lowercase font-normal opacity-80">(PWL − SWL)</span>
                </div>
                <div className="font-mono-num font-bold text-info text-sm">
                  {drawdown != null ? `${drawdown} m` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Cluster 2: Pumping Equipment */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Gauge className="h-3.5 w-3.5 text-accent" /> Pumping Equipment
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Pump Setting</div>
                <div className="font-mono-num font-medium">{latest?.pump_setting ?? '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Motor Rating</div>
                <div className="font-mono-num font-medium">{latest?.motor_hp != null ? `${latest.motor_hp} HP` : '—'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Operating Pressure</div>
                <div className="font-mono-num font-medium flex items-baseline gap-1.5">
                  <span>{operatingPressure != null ? `${operatingPressure} psi` : '—'}</span>
                  {operatingPressure != null && (
                    <span className="text-2xs text-muted-foreground font-normal">(from recent reading)</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cluster 3: Water Quality & Telemetry */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Activity className="h-3.5 w-3.5 text-warn" /> Water Quality & Telemetry
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">TDS (PMS Survey)</div>
                <div className="font-mono-num font-medium">{latest?.tds_ppm != null ? `${latest.tds_ppm} ppm` : '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">TDS (Daily Sensor)</div>
                <div className="font-mono-num font-medium">{dailyTds != null ? `${dailyTds} ppm` : '—'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Turbidity</div>
                <div className="font-mono-num font-medium">{latest?.turbidity_ntu != null ? `${latest.turbidity_ntu} NTU` : '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {latest?.date_gathered && (
          <div className="flex items-center justify-between pt-1 text-2xs text-muted-foreground flex-wrap gap-2 border-t">
            <span>Last survey recorded: <strong className="text-foreground">{latest.date_gathered}</strong></span>
            {latest.remarks && <span className="italic">Remarks: {latest.remarks}</span>}
          </div>
        )}
      </Card>

      {/* Recent raw readings table */}
      {rawReadings.length > 0 && (
        <Card className="p-3" data-testid="well-raw-readings-card">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" /> Recent Readings
            {well.has_power_meter && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-2xs uppercase tracking-wide text-warn bg-warn-soft px-1.5 py-0.5 rounded">
                <Zap className="h-2.5 w-2.5" /> kWh tracked
              </span>
            )}
          </h4>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead className="text-2xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left px-1 py-1 font-medium">Date</th>
                  <th className="text-right px-1 py-1 font-medium">Water m³</th>
                  <th className="text-right px-1 py-1 font-medium">Δ</th>
                  {well.has_power_meter && <th className="text-right px-1 py-1 font-medium">kWh</th>}
                  <th className="text-right px-1 py-1 font-medium">TDS (ppm)</th>
                  <th className="text-right px-1 py-1 font-medium">Pressure (psi)</th>
                </tr>
              </thead>
              <tbody>
                {rawReadings.map((r: any) => {
                  const delta = r.previous_reading != null && r.current_reading != null
                    ? +r.current_reading - +r.previous_reading : null;
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-1 py-1 text-muted-foreground whitespace-nowrap">
                        {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-1 py-1 text-right font-mono-num">{r.current_reading != null ? fmtNum(+r.current_reading, 2) : '—'}</td>
                      <td className="px-1 py-1 text-right font-mono-num text-muted-foreground">{delta != null ? fmtNum(delta, 2) : '—'}</td>
                      {well.has_power_meter && (
                        <td className="px-1 py-1 text-right font-mono-num text-warn">
                          {r.power_meter_reading != null ? fmtNum(+r.power_meter_reading, 2) : '—'}
                        </td>
                      )}
                      <td className="px-1 py-1 text-right font-mono-num">{r.tds_ppm != null ? fmtNum(+r.tds_ppm, 2) : '—'}</td>
                      <td className="px-1 py-1 text-right font-mono-num">{r.pressure_psi != null ? fmtNum(+r.pressure_psi, 2) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
