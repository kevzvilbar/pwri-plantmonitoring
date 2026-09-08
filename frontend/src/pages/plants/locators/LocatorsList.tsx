import { useState, useEffect, useRef, useMemo } from 'react';
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocatorsForPlant } from '@/hooks/useLocators';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ExportButton } from '@/components/ExportButton';
import { ChevronLeft, Plus, MapPin, Gauge, Upload, FileDown, X, Download, BarChart2, Calendar, Droplet, ShieldAlert, CalendarClock, ArrowUpRight, Trash2 } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { DataState } from '@/components/DataState';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { lastReadingFreshness } from '@/lib/format';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';

import {
  AddLocatorDialog, EditLocatorDialog, ReplaceMeterDialog, LocatorCsvImportDialog,
  ReasonField,
} from './LocatorDialogs';
import { LocatorCard, LocatorDetail, DeleteDialogs } from './LocatorsList/index';
import { CollapsibleSection, GridPylonIcon, logStatusChange } from '../shared';
import { ReasonDialog } from '@/components/ReasonDialog';
import type { ReasonCategory, LockReasonCategory } from '@/lib/reasonCodes';
import { LOCK_REASON_CATEGORIES } from '@/lib/reasonCodes';
import { useLocatorActions } from './LocatorsList/index';

export function LocatorsList({ plantId, highlightId }: { plantId: string; highlightId?: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isManager, isAdmin, user, activeOperator } = useAuth();

  const { data: locators, error: locatorsError, refetch: refetchLocators } = useLocatorsForPlant(plantId);

  const { data: productMeters } = useQuery({
    queryKey: ['locators-fed-by-product-meters', plantId],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, name')
        .eq('plant_id', plantId)
        .order('sort_order', { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const { data: latestReadings } = useQuery({
    queryKey: ['locators-latest-readings', plantId],
    queryFn: async () => {
      const { data } = await (supabase.from('locator_readings_latest' as any) as any)
        .select('locator_id, reading_datetime')
        .eq('plant_id', plantId);
      return (data ?? []) as { locator_id: string; reading_datetime: string }[];
    },
  });

  const latestByLocator = useMemo(() => {
    const map: Record<string, string> = {};
    latestReadings?.forEach(r => { map[r.locator_id] = r.reading_datetime; });
    return map;
  }, [latestReadings]);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [selectedLocator, setSelectedLocator] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showLocatorCsv, setShowLocatorCsv] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightId) return;
    const el = cardRefs.current[highlightId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulseId(highlightId);
    const t = setTimeout(() => setPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, locators]);

  const {
    deleteTarget, setDeleteTarget, deleteReason, setDeleteReason, deleteBusy, doDelete,
    locatorOfflineTarget, setLocatorOfflineTarget, locatorOfflineBusy, setLocatorOfflineBusy, applyLocatorStatusChange, toggleLocatorStatus,
    locatorLockTarget, setLocatorLockTarget, locatorLockBusy, setLocatorLockBusy, applyLocatorLockStatus, handleLockCheckboxChange,
    selected, setSelected, bulkOpen, setBulkOpen, bulkReason, setBulkReason, bulkBusy, toggleOne, toggleAll, doBulkDelete,
  } = useLocatorActions(plantId, locators ?? [], qc, isManager, isAdmin, activeOperator, user);

  if (detail) return <LocatorDetail locatorId={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="space-y-2">
      {locatorsError && (
        <DataState error={locatorsError} onRetry={() => refetchLocators()} />
      )}
      <div className="flex justify-between items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Locators ({locators?.length ?? 0})</h3>
        <div className="flex items-center gap-1.5">
          {isAdmin && locators && locators.length > 0 && (
            <button
              onClick={() => toggleAll(locators)}
              className="text-2xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
              data-testid="locators-toggle-all"
            >
              {selected.size === locators.length ? 'Clear' : 'Select all'}
            </button>
          )}
          {isAdmin && selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setBulkOpen(true)}
              data-testid="locators-bulk-delete-btn"
            >
              <Trash2 className="h-3 w-3 mr-1" />{selected.size}
            </Button>
          )}
          {isManager && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setShowLocatorCsv(true)}>
              <Upload className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <div className="stagger-grid space-y-2">
      {locators?.map((l: any) => (
        <LocatorCard
          key={l.id}
          l={l}
          checked={selected.has(l.id)}
          onToggle={() => toggleOne(l.id)}
          selectedLocator={selectedLocator}
          setSelectedLocator={setSelectedLocator}
          isManager={isManager}
          isAdmin={isAdmin}
          productMeters={productMeters ?? []}
          latestByLocator={latestByLocator}
          cardRefs={cardRefs}
          pulseId={pulseId}
          onEdit={l => setEditing(l)}
          onDelete={l => { setDeleteTarget(l); setDeleteReason(''); }}
          onDetail={id => setDetail(id)}
          onStatusToggle={toggleLocatorStatus}
          onLockChange={handleLockCheckboxChange}
          navigate={navigate}
        />
      ))}
      {!locators?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No Locators Yet</Card>}
      </div>

      {adding && <AddLocatorDialog plantId={plantId} onClose={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['locators', plantId] }); qc.invalidateQueries({ queryKey: ['product-meters-plant-locators', plantId] }); }} />}
      {editing && <EditLocatorDialog locator={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['locators', plantId] }); qc.invalidateQueries({ queryKey: ['product-meters-plant-locators', plantId] }); }} />}
      {showLocatorCsv && (
        <LocatorCsvImportDialog
          plantId={plantId}
          onClose={() => { setShowLocatorCsv(false); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }}
        />
      )}

      <DeleteDialogs
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        deleteReason={deleteReason}
        setDeleteReason={setDeleteReason}
        deleteBusy={deleteBusy}
        onDelete={doDelete}
        locatorOfflineTarget={locatorOfflineTarget}
        setLocatorOfflineTarget={setLocatorOfflineTarget}
        locatorOfflineBusy={locatorOfflineBusy}
        onStatusChange={async (locator, newStatus, category, detail) => {
          setLocatorOfflineBusy(true);
          await applyLocatorStatusChange(locator, newStatus, category, detail);
          setLocatorOfflineBusy(false);
          setLocatorOfflineTarget(null);
        }}
        locatorLockTarget={locatorLockTarget}
        setLocatorLockTarget={setLocatorLockTarget}
        locatorLockBusy={locatorLockBusy}
        onLockChange={async (locator, newIsLocked, category, detail) => {
          setLocatorLockBusy(true);
          await applyLocatorLockStatus(locator, newIsLocked, category, detail);
          setLocatorLockBusy(false);
          setLocatorLockTarget(null);
        }}
        selectedSize={selected.size}
        bulkOpen={bulkOpen}
        setBulkOpen={setBulkOpen}
        bulkReason={bulkReason}
        setBulkReason={setBulkReason}
        bulkBusy={bulkBusy}
        onBulkDelete={doBulkDelete}
      />
    </div>
  );
}