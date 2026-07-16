import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';


import {
  ReasonField, EditLocatorDialog, AddLocatorDialog,
  ReplaceMeterDialog, LocatorCsvImportDialog,
} from './LocatorDialogs';
import { EntityHistoryChart, MeterDetailButton } from '../charts/EntityHistoryChart';
import { CollapsibleSection, GridPylonIcon } from '../shared';

export function LocatorsList({ plantId }: { plantId: string }) {
  const qc = useQueryClient();
  const { isManager, isAdmin, user, activeOperator } = useAuth();
  const [adding, setAdding] = useState(false);
  const [showLocatorCsv, setShowLocatorCsv] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  // Inline graph expansion — click a locator card to show its history chart
  const [selectedLocator, setSelectedLocator] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const doDelete = async () => {
    if (!deleteTarget) return;
    if (deleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'locator', entity_id: deleteTarget.id, entity_label: deleteTarget.name, action: 'hard', reason: deleteReason.trim(), performed_by: activeOperator?.id ?? user?.id ?? null, forced: false }] as any);
    } catch {}
    const { error } = await supabase.from('locators').delete().eq('id', deleteTarget.id);
    setDeleteBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Locator deleted');
    setDeleteTarget(null);
    setDeleteReason('');
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  const toggleLocatorStatus = async (l: any) => {
    if (!isManager) return;
    const newStatus = l.status === 'Active' ? 'Inactive' : 'Active';
    const { error } = await supabase.from('locators').update({ status: newStatus }).eq('id', l.id);
    if (error) { toast.error(error.message); return; }
    await logStatusChange({
      user_id: activeOperator?.id ?? user?.id ?? null,
      plant_id: l.plant_id,
      entity_type: 'Locator',
      entity_id: l.id,
      entity_label: l.name,
      from_status: l.status,
      to_status: newStatus,
      timestamp: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Locator marked ${newStatus}`);
  };

  const { data: locators } = useQuery({
    queryKey: ['locators', plantId],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('*').eq('plant_id', plantId).order('name');
      return data ?? [];
    },
  });

  // Product meters for this plant — used to show "Fed by" on each locator row
  const { data: productMeters } = useQuery({
    queryKey: ['product-meters', plantId],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, name')
        .eq('plant_id', plantId)
        .order('sort_order', { ascending: true });
      return (data ?? []) as any[];
    },
  });

  // Admin selection / bulk-delete state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (!locators) return;
    if (selected.size === locators.length) setSelected(new Set());
    else setSelected(new Set(locators.map((l: any) => l.id)));
  };

  const auditDelete = async (rows: { id: string; name: string }[], reason: string, bulk: boolean) => {
    try {
      const payload = rows.map((r) => ({
        kind: 'locator',
        entity_id: r.id,
        entity_label: r.name ?? null,
        action: 'hard',
        reason: bulk ? `[BULK] ${reason}` : reason,
        performed_by: activeOperator?.id ?? user?.id ?? null,
        forced: false,
      }));
      await supabase.from('deletion_audit_log' as any).insert(payload as any);
    } catch (err) {
      // Log non-fatal: deletion_audit_log table may be missing pre-migration.
      // Surfacing keeps debugging easy without crashing the delete flow.
      // eslint-disable-next-line no-console
      console.warn('[Plants] deletion_audit_log insert failed (non-fatal):', err);
    }
  };

  const doBulkDelete = async () => {
    if (!selected.size) return;
    if (bulkReason.trim().length < 5) {
      toast.error('Please enter a reason of at least 5 characters.');
      return;
    }
    setBulkBusy(true);
    const ids = Array.from(selected);
    const rows = (locators ?? []).filter((l: any) => ids.includes(l.id)).map((l: any) => ({ id: l.id, name: l.name }));
    // locators have ON DELETE CASCADE on readings/replacements.
    const { error } = await supabase.from('locators').delete().in('id', ids);
    if (error) { setBulkBusy(false); toast.error(error.message); return; }
    await auditDelete(rows, bulkReason.trim(), true);
    setBulkBusy(false);
    setBulkOpen(false);
    setBulkReason('');
    setSelected(new Set());
    toast.success(`${ids.length} locator(s) permanently deleted`);
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  if (detail) return <LocatorDetail locatorId={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Locators ({locators?.length ?? 0})</h3>
        <div className="flex items-center gap-1.5">
          {isAdmin && locators && locators.length > 0 && (
            <button
              onClick={toggleAll}
              className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
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
      {locators?.map((l: any) => {
        const checked = selected.has(l.id);
        return (
          <Card
            key={l.id}
            className={`p-3 hover:shadow-elev border-l-2 transition-colors ${
              checked ? 'ring-1 ring-primary' : ''
            } ${
              l.status === 'Active'
                ? 'border-l-emerald-400 dark:border-l-emerald-600'
                : 'border-l-muted-foreground/30'
            }`}
            data-testid={`locator-card-${l.id}`}
          >
            <div className="flex items-start gap-2">
              {isAdmin && (
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleOne(l.id)}
                  className="mt-0.5 h-5 w-5 sm:h-4 sm:w-4 shrink-0 [&]:rounded-full sm:[&]:rounded-sm"
                  data-testid={`locator-select-${l.id}`}
                />
              )}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setSelectedLocator(selectedLocator === l.id ? null : l.id)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate flex items-center gap-1.5">
                      {l.name}
                      <TrendingUp className={`h-3 w-3 transition-colors shrink-0 ${selectedLocator === l.id ? 'text-teal-600' : 'text-muted-foreground/30'}`} />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {l.meter_brand} {l.meter_size} · SN {l.meter_serial ?? '—'}
                    </div>
                    {/* Fed by: product meter badge */}
                    {(() => {
                      const supplyMeter = (productMeters ?? []).find((m: any) => m.id === l.product_meter_id);
                      if (!supplyMeter) return null;
                      return (
                        <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                          <Droplet className="h-2.5 w-2.5" />
                          Fed by: {supplyMeter.name}
                        </div>
                      );
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleLocatorStatus(l); }}
                    title={isManager ? `Click to toggle status (currently ${l.status})` : l.status}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0 border transition-colors ${
                      l.status === 'Active'
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100'
                        : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                    } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${l.status === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    {l.status}
                  </button>
                </div>
              </div>
              {isManager && (
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" title="Edit" onClick={() => setEditing(l)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete" onClick={() => { setDeleteTarget(l); setDeleteReason(''); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
            {/* ── Details link ── */}
            <div className="mt-1.5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setDetail(l.id)}
                className="text-[11px] text-teal-600 hover:underline inline-flex items-center gap-0.5"
              >
                Details →
              </button>
            </div>
            {/* ── Inline history chart ── */}
            {selectedLocator === l.id && (
              <div className="mt-3 pt-3 border-t">
                <EntityHistoryChart entityId={l.id} entityType="locator" entityName={l.name} />
              </div>
            )}
          </Card>
        );
      })}
      {!locators?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No Locators Yet</Card>}
      {adding && <AddLocatorDialog plantId={plantId} onClose={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }} />}
      {editing && <EditLocatorDialog locator={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }} />}
      {showLocatorCsv && (
        <LocatorCsvImportDialog
          plantId={plantId}
          onClose={() => { setShowLocatorCsv(false); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }}
        />
      )}

      {/* Single delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleteBusy && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>All meter readings and replacement logs will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={deleteReason} onChange={setDeleteReason} testId="locator-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={deleteBusy || deleteReason.trim().length < 5} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkOpen} onOpenChange={(o) => !o && !bulkBusy && setBulkOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Permanently delete {selected.size} locator(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All meter readings and meter-replacement logs attached to the
              selected locators will be removed via the database cascade rule.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={bulkReason} onChange={setBulkReason} testId="locators-bulk-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doBulkDelete}
              disabled={bulkBusy || bulkReason.trim().length < 5}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="confirm-locators-bulk-delete"
            >
              {bulkBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

// Shared "reason" textarea with min-5-char hint, used by all admin delete dialogs.

function LocatorDetail({ locatorId, onBack }: { locatorId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const { data: locator } = useQuery({
    queryKey: ['locator', locatorId],
    queryFn: async () => (await supabase.from('locators').select('*').eq('id', locatorId).single()).data,
  });
  const { data: replacements } = useQuery({
    queryKey: ['locator-replacements', locatorId],
    queryFn: async () => (await supabase.from('locator_meter_replacements').select('*').eq('locator_id', locatorId).order('replacement_date', { ascending: false })).data ?? [],
  });
  if (!locator) return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  const hasCoords = locator.gps_lat != null && locator.gps_lng != null;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${locator.gps_lat},${locator.gps_lng}` : null;

  return (
    <div className="space-y-3">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" /> Back to Locators
      </button>

      {/* Hero info card */}
      <Card className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-base">{locator.name}</h3>
            {locator.address && <p className="text-xs text-muted-foreground mt-0.5">{locator.address}</p>}
            {hasCoords && (
              <a href={mapsUrl!} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                <MapPin className="h-3 w-3" />
                {(+locator.gps_lat).toFixed(5)}, {(+locator.gps_lng).toFixed(5)}
              </a>
            )}
          </div>
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${
            locator.status === 'Active'
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-900'
              : 'text-muted-foreground bg-muted border-border'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${locator.status === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
            {locator.status ?? 'Active'}
          </span>
        </div>
      </Card>

      {/* Meter — expandable popup button */}
      <MeterDetailButton
        label="Meter Details"
        icon={<Gauge className="h-4 w-4" />}
        fields={[
          { label: 'Brand', value: locator.meter_brand },
          { label: 'Size', value: locator.meter_size ? `${locator.meter_size} in` : null },
          { label: 'Serial No.', value: locator.meter_serial },
          { label: 'Installed', value: locator.meter_installed_date },
        ]}
      >
        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setReplaceOpen(true)}>
          <Wrench className="h-3.5 w-3.5" /> Replace Meter
        </Button>
      </MeterDetailButton>

      {/* Historical Consumption Chart */}
      <Card className="p-3">
        <EntityHistoryChart entityId={locatorId} entityType="locator" entityName={locator.name} />
      </Card>

      {/* Replacement history */}
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5 text-muted-foreground" /> Replacement History
        </h4>
        {replacements?.length ? (
          <div className="space-y-0">
            {(replacements as any[]).map((r: any) => (
              <div key={r.id} className="border-t py-2 text-xs grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div className="col-span-2 font-medium text-foreground">{r.replacement_date}</div>
                <div className="text-muted-foreground">Old: SN {r.old_meter_serial ?? '—'} <span className="font-mono">({r.old_meter_final_reading ?? '—'})</span></div>
                <div className="text-muted-foreground">New: SN {r.new_meter_serial ?? '—'} <span className="font-mono">({r.new_meter_initial_reading ?? '—'})</span></div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">No replacements recorded</p>}
      </Card>

      {replaceOpen && (
        <ReplaceMeterDialog
          kind="locator" assetId={locatorId} plantId={locator.plant_id} oldSerial={locator.meter_serial}
          onClose={() => { setReplaceOpen(false); qc.invalidateQueries({ queryKey: ['locator', locatorId] }); qc.invalidateQueries({ queryKey: ['locator-replacements', locatorId] }); }}
        />
      )}
    </div>
  );
}

