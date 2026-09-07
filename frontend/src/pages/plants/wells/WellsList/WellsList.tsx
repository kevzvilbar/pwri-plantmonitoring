import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, Plus, MapPin, Gauge, Sun, Zap, Trash2, Loader2, Pencil, Upload, TrendingUp, Calendar, Droplet, CalendarClock, ArrowUpRight } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { lastReadingFreshness } from '@/lib/format';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ReasonDialog } from '@/components/ReasonDialog';
import { ReasonField } from '../../locators/LocatorDialogs';
import { EntityHistoryChart, MeterDetailButton } from '../../charts/EntityHistoryChart/index';
import { CollapsibleSection, GridPylonIcon, usePlantMeterConfig, logStatusChange } from '../../shared';
import { AddWellDialog, EditWellDialog, EditElectricMeterDialog, EditHydraulicDialog, WellCsvImportDialog } from '../WellDialogs';
import { WellDetail } from './WellDetail';
import { useWellsList, PAGE_SIZE } from './WellsList/useWellsList';
import { WellCard } from './WellsList/WellCard';

export function WellsList({ plantId, highlightId }: { plantId: string; highlightId?: string | null }) {
  const {
    isAdmin, isManager, qc,
    wells, latestWellReadings, latestByWellId, wellCardRefs, wellPulseId,
    wellOfflineTarget, wellOfflineBusy, blendingSet, detail, selectedWell, selected,
    bulkDeleteOpen, bulkReason, bulkBusy, blendingBusy, powerBusy, adding,
    wellDeleteTarget, wellDeleteReason, wellDeleteBusy, editingWell, showWellCsv,
    meterCfg, getWellElectricMode, plant,
    toggle, toggleAll, toggleWellStatus, toggleWellElectric, toggleBlending,
    doWellDelete, doBulkDelete, applyWellStatusChange,
    setDetail, setSelectedWell, setSelected,
    setBulkDeleteOpen, setBulkReason, setBulkBusy,
    setWellOfflineTarget, setWellOfflineBusy,
    setAdding, setEditingWell, setShowWellCsv,
    setWellDeleteTarget, setWellDeleteReason,
    setWellDeleteBusy, setBlendingBusy, setPowerBusy,
  } = useWellsList(plantId, highlightId);

  const navigate = useNavigate();

  const handleCardClick = (w: any) => {
    setSelectedWell(selectedWell === w.id ? null : w.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, w: any) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(w); }
  };

  const handleEdit = (w: any) => { setEditingWell(w); };
  const handleDelete = (w: any) => { setWellDeleteTarget(w); setWellDeleteReason(''); };
  const handleDetail = (id: string) => { setDetail(id); };
  const handleNavOperations = (w: any) => { navigate(`/operations?tab=well&highlight=${w.id}`); };

  if (detail) return <WellDetail wellId={detail} onBack={() => setDetail(null)} />;
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Wells ({wells?.length ?? 0})</h3>
        <div className="flex items-center gap-1.5">
          {isAdmin && wells && wells.length > 0 && (
            <button onClick={toggleAll}
              className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
              data-testid="wells-toggle-all">
              {selected.size === wells.length ? 'Clear' : 'Select all'}
            </button>
          )}
          {isAdmin && selected.size > 0 && (
            <Button size="sm" variant="outline"
              className="h-7 px-2 text-xs border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setBulkDeleteOpen(true)} data-testid="wells-bulk-delete-btn">
              <Trash2 className="h-3 w-3 mr-1" />{selected.size}
            </Button>
          )}
          {isManager && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAdding(true)} data-testid="add-well-btn">
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setShowWellCsv(true)}>
              <Upload className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="stagger-grid space-y-2">
      {wells?.map((w: any) => {
        const checked = selected.has(w.id);
        const isBlending = blendingSet.has(w.id);
        const blendingPending = blendingBusy.has(w.id);
        return (
          <WellCard
            key={w.id}
            w={w}
            checked={checked}
            isAdmin={isAdmin}
            isManager={isManager}
            isBlending={isBlending}
            blendingPending={blendingPending}
            selectedWell={selectedWell}
            wellPulseId={wellPulseId}
            latestByWellId={latestByWellId}
            onToggleSelect={() => toggle(w.id)}
            onCardClick={() => handleCardClick(w)}
            onKeyDown={(e) => handleKeyDown(e, w)}
            onNavigateOperations={() => handleNavOperations(w)}
            onToggleStatus={() => toggleWellStatus(w)}
            onEdit={() => handleEdit(w)}
            onDelete={() => handleDelete(w)}
            onToggleBlending={() => toggleBlending(w, !isBlending)}
            onToggleElectric={() => toggleWellElectric(w)}
            onSetDetail={() => handleDetail(w.id)}
            getWellElectricMode={getWellElectricMode}
            powerBusy={powerBusy}
            cardRef={(el) => { wellCardRefs.current[w.id] = el; }}
          />
        );
      })}
      {!wells?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No Wells Yet</Card>}
      </div>

      {adding && (
        <AddWellDialog plantId={plantId} onClose={() => {
          setAdding(false);
          qc.invalidateQueries({ queryKey: ['wells', plantId] });
        }} />
      )}
      {editingWell && <EditWellDialog well={editingWell} onClose={() => { setEditingWell(null); qc.invalidateQueries({ queryKey: ['wells', plantId] }); }} />}
      {showWellCsv && (
        <WellCsvImportDialog plantId={plantId} onClose={() => { setShowWellCsv(false); qc.invalidateQueries({ queryKey: ['wells', plantId] }); }}
        />
      )}

      <AlertDialog open={!!wellDeleteTarget} onOpenChange={(o) => !o && !wellDeleteBusy && setWellDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete "{wellDeleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>All meter readings, hydraulic history, and replacement logs will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={wellDeleteReason} onChange={setWellDeleteReason} testId="well-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={wellDeleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doWellDelete} disabled={wellDeleteBusy || wellDeleteReason.trim().length < 5} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {wellDeleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReasonDialog open={!!wellOfflineTarget} onOpenChange={(o) => !o && setWellOfflineTarget(null)}
        title={`Mark "${wellOfflineTarget?.name}" Inactive?`}
        description="This well's status change will explain any gaps in Data Summary while it's inactive."
        confirmLabel="Mark Inactive" busy={wellOfflineBusy}
        onConfirm={async (category, detail) => {
          setWellOfflineBusy(true);
          await applyWellStatusChange(wellOfflineTarget, 'Inactive', category, detail);
          setWellOfflineBusy(false);
          setWellOfflineTarget(null);
        }}
      />

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(o) => !o && !bulkBusy && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Permanently delete {selected.size} well(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All meter readings, hydraulic history, and meter-replacement logs
              attached to the selected wells will be removed via the database
              cascade rule. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="wellslist-reason-min-5-chars-required-for-audit-log" className="text-xs text-muted-foreground">
              Reason <span className="text-danger">*</span>
              <span className="ml-1 text-2xs">(min 5 chars — required for audit log)</span>
            </Label>
            <Textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)}
              placeholder="e.g. Wells decommissioned after Q1 2026" maxLength={500} rows={2}
              data-testid="wells-bulk-reason"
              aria-invalid={bulkReason.length > 0 && bulkReason.trim().length < 5}
              className={bulkReason.length > 0 && bulkReason.trim().length < 5 ? 'border-danger' : ''}
            id="wellslist-reason-min-5-chars-required-for-audit-log"/>
            {bulkReason.length > 0 && bulkReason.trim().length < 5 && (
              <p className="text-2xs text-danger">
                Reason must be at least 5 characters ({bulkReason.trim().length}/5).
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doBulkDelete} disabled={bulkBusy || bulkReason.trim().length < 5}
              className="bg-danger text-danger-foreground hover:bg-danger/90" data-testid="confirm-wells-bulk-delete">
              {bulkBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
