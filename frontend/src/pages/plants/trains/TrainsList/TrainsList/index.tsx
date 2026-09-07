import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, Search, Waves, Filter, Activity, Layers } from 'lucide-react';
import {
  ROTrainIcon, ChangeMeterIcon, MeterOdometerIcon, PressureGaugeIcon,
  HighPressurePumpIcon, BoosterPumpIcon, MediaFilterIcon, CartridgeFilterIcon, MembranePerformanceIcon,
} from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { deltaCache } from '@/lib/deltaCache';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { ReasonDialog } from '@/components/ReasonDialog';
import { ReasonField } from '@/pages/plants/locators/LocatorDialogs';
import { EditTrainDialog } from '@/pages/plants/trains/EditTrainDialog';
import { TrainOperatorLogModal } from '@/pages/plants/trains/TrainOperatorLogModal';
import { TrainRODetailCharts } from '@/pages/plants/trains/TrainRODetailCharts';
import { AddTrainDialog } from '@/pages/plants/trains/TrainsList/AddTrainDialog';
import type { AddTrainFormData } from '@/pages/plants/trains/TrainsList/AddTrainDialog';
import { TrainCsvImportDialog } from '@/pages/plants/trains/TrainsList/trainCsvImport';
import { ReplaceTrainMeterDialog } from '@/pages/ro-trains/ReplaceTrainMeterDialog';
import { parseCsv, downloadTemplate, CsvPreviewTable } from '@/pages/plants/shared';
import { useTrainsListData } from './useTrainsListData';
import { FleetHeader } from './FleetHeader';
import { TrainCard } from './TrainCard';

export function TrainsList({ plantId }: { plantId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { plant, trains, recentTrainIds, trainMeterReplacements, latestTrainReplacement,
    deriveTrainStatus, effectiveMediaType, effectiveFilterType, isManager, isAdmin, user, activeOperator } = useTrainsListData(plantId);

  const [editTrain, setEditTrain] = useState<any | null>(null);
  const [trainDeleteTarget, setTrainDeleteTarget] = useState<any | null>(null);
  const [trainDeleteReason, setTrainDeleteReason] = useState('');
  const [trainDeleteBusy, setTrainDeleteBusy] = useState(false);
  const [showAddTrain, setShowAddTrain] = useState(false);
  const [addTrainBusy, setAddTrainBusy] = useState(false);
  const [showTrainCsv, setShowTrainCsv] = useState(false);
  const [trainOfflineTarget, setTrainOfflineTarget] = useState<{ train: any; newStatus: 'Offline' | 'Maintenance' } | null>(null);
  const [trainOfflineBusy, setTrainOfflineBusy] = useState(false);

  const [logTrain, setLogTrain] = useState<{ id: string; label: string } | null>(null);
  const [replaceTrainMeter, setReplaceTrainMeter] = useState<{ trainId: string } | null>(null);

  const [activeSection, setActiveSection] = useState<Record<string, string | null>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Running' | 'Maintenance' | 'Offline'>('all');

  const toggleSection = (trainId: string, section: string) => {
    setActiveSection(prev => ({ ...prev, [trainId]: prev[trainId] === section ? null : section }));
  };

  const doAddTrain = async (form: AddTrainFormData) => {
    setAddTrainBusy(true);
    const { error } = await supabase.from('ro_trains').insert({
      plant_id: plantId,
      train_number: form.train_number,
      name: form.name || null,
      num_afm: form.num_afm,
      num_booster_pumps: form.num_booster_pumps,
      num_cartridge_filters: form.num_cartridge_filters,
      num_controllers: form.num_controllers,
      num_filter_housings: form.num_filter_housings,
      num_hp_pumps: form.num_hp_pumps,
      status: 'Running' as any,
    });
    setAddTrainBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('RO Train added');
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    setShowAddTrain(false);
  };

  const doTrainDelete = async () => {
    if (!trainDeleteTarget) return;
    if (trainDeleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setTrainDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'ro_train', entity_id: trainDeleteTarget.id, entity_label: `Train ${trainDeleteTarget.train_number}`, action: 'hard', reason: trainDeleteReason.trim(), performed_by: activeOperator?.id ?? user?.id ?? null, forced: false }] as any);
    } catch { /* audit log is best-effort */ }
    const { error } = await supabase.from('ro_trains').delete().eq('id', trainDeleteTarget.id);
    setTrainDeleteBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Train deleted');
    setTrainDeleteTarget(null);
    setTrainDeleteReason('');
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
  };

  const applyTrainStatusChange = async (t: any, newStatus: 'Running' | 'Offline' | 'Maintenance', reasonCategory?: string, reasonDetail?: string) => {
    const { error } = await supabase.from('ro_trains').update({ status: newStatus }).eq('id', t.id);
    if (error) { toast.error(friendlyError(error)); return; }
    try {
      await supabase.from('train_status_log').insert({
        train_id: t.id, plant_id: t.plant_id, status: newStatus,
        reason: reasonCategory ? `${reasonCategoryLabel(reasonCategory)}${reasonDetail ? `: ${reasonDetail}` : ''}` : null,
        confirmed_by: activeOperator?.id ?? user?.id ?? null,
      });
    } catch { /* best-effort */ }
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Train ${t.train_number} → ${newStatus}`);
  };

  const toggleTrainStatus = async (t: any) => {
    if (!isManager) return;
    const effectiveStatus = deriveTrainStatus(t);
    const cycle: Record<'Running' | 'Offline' | 'Maintenance', 'Running' | 'Offline' | 'Maintenance'> =
      { Running: 'Offline', Offline: 'Maintenance', Maintenance: 'Running' };
    const newStatus = cycle[effectiveStatus] ?? 'Running';
    if (newStatus === 'Offline' || newStatus === 'Maintenance') {
      setTrainOfflineTarget({ train: t, newStatus });
      return;
    }
    await applyTrainStatusChange(t, newStatus);
  };

  const filteredTrains = useMemo(() => {
    return (trains ?? []).filter((t: any) => {
      const st = deriveTrainStatus(t);
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const numMatch = `train ${t.train_number}`.includes(q) || `${t.train_number}`.includes(q);
        const nameMatch = (t.name ?? '').toLowerCase().includes(q);
        return numMatch || nameMatch;
      }
      return true;
    });
  }, [trains, statusFilter, searchTerm, recentTrainIds, deriveTrainStatus]);

  const runningCount = (trains ?? []).filter((t: any) => deriveTrainStatus(t) === 'Running').length;
  const maintenanceCount = (trains ?? []).filter((t: any) => deriveTrainStatus(t) === 'Maintenance').length;
  const offlineCount = (trains ?? []).filter((t: any) => deriveTrainStatus(t) === 'Offline').length;

  return (
    <div className="space-y-3.5">
      <FleetHeader
        isManager={isManager} isAdmin={isAdmin}
        onAddTrain={() => setShowAddTrain(true)} onImportCsv={() => setShowTrainCsv(true)}
        searchTerm={searchTerm} onSearchChange={setSearchTerm}
        statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
        totalTrains={trains?.length ?? 0} runningCount={runningCount} maintenanceCount={maintenanceCount} offlineCount={offlineCount}
      />

      {filteredTrains.map((t: any) => (
        <TrainCard
          key={t.id} t={t} plant={plant}
          deriveTrainStatus={deriveTrainStatus}
          toggleTrainStatus={toggleTrainStatus}
          toggleSection={toggleSection}
          activeSection={activeSection}
          latestTrainReplacement={latestTrainReplacement}
          isManager={isManager}
          effectiveMediaType={effectiveMediaType}
          effectiveFilterType={effectiveFilterType}
          onLog={(train) => setLogTrain(train)}
          onEdit={setEditTrain}
          onDelete={(train) => { setTrainDeleteTarget(train); setTrainDeleteReason(''); }}
          onReplaceMeter={(trainId) => setReplaceTrainMeter({ trainId })}
        />
      ))}
      {!trains?.length && (
        <Card className="p-8 text-center text-xs text-muted-foreground border-dashed">
          No RO trains configured for this plant yet.
        </Card>
      )}

      <AddTrainDialog open={showAddTrain} onOpenChange={setShowAddTrain}
        defaultTrainNumber={(trains?.length ?? 0) + 1} onSubmit={doAddTrain} loading={addTrainBusy}
        plantFilterType={plant?.filter_housing_type ?? 'Cartridge Filter'}
        plantMediaType={plant?.filter_media_type ?? 'AFM'} />
      {showTrainCsv && (
        <TrainCsvImportDialog plantId={plantId}
          plantFilterType={plant?.filter_housing_type ?? 'Cartridge Filter'}
          plantMediaType={plant?.filter_media_type ?? 'AFM'}
          onClose={() => { setShowTrainCsv(false); qc.invalidateQueries({ queryKey: ['ro-trains', plantId] }); }}
        />
      )}

      {editTrain && plant && (
        <EditTrainDialog train={editTrain} plant={plant} onClose={() => {
          setEditTrain(null);
          qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
        }} />
      )}

      <AlertDialog open={!!trainDeleteTarget} onOpenChange={(o) => !o && !trainDeleteBusy && setTrainDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete Train {trainDeleteTarget?.train_number}?</AlertDialogTitle>
            <AlertDialogDescription>All logs associated with this train will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={trainDeleteReason} onChange={setTrainDeleteReason} testId="train-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trainDeleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doTrainDelete} disabled={trainDeleteBusy || trainDeleteReason.trim().length < 5} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {trainDeleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReasonDialog open={!!trainOfflineTarget} onOpenChange={(o) => !o && setTrainOfflineTarget(null)}
        title={`Mark Train ${trainOfflineTarget?.train.train_number} ${trainOfflineTarget?.newStatus}?`}
        description="This status change will explain any gaps in Data Summary while the train is down."
        confirmLabel={`Mark ${trainOfflineTarget?.newStatus ?? ''}`}
        busy={trainOfflineBusy}
        onConfirm={async (category, detail) => {
          if (!trainOfflineTarget) return;
          setTrainOfflineBusy(true);
          await applyTrainStatusChange(trainOfflineTarget.train, trainOfflineTarget.newStatus, category, detail);
          setTrainOfflineBusy(false);
          setTrainOfflineTarget(null);
        }}
      />

      {logTrain && (
        <TrainOperatorLogModal trainId={logTrain.id} trainLabel={logTrain.label}
          plantId={plantId} onClose={() => setLogTrain(null)} />
      )}
      {replaceTrainMeter && (
        <ReplaceTrainMeterDialog trainId={replaceTrainMeter.trainId} plantId={plantId}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
            qc.invalidateQueries({ queryKey: ['ro-train-meter-replacements', plantId] });
            qc.invalidateQueries({ queryKey: ['train-meter-identity', replaceTrainMeter.trainId] });
          }}
          onClose={() => setReplaceTrainMeter(null)}
        />
      )}
    </div>
  );
}
