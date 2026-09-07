import { useState, useEffect, useMemo, useRef } from 'react';
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
import { lastReadingFreshness, STALE_READING_HOURS } from '@/lib/format';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, CalendarClock, ArrowUpRight } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';

import { EntityHistoryChart, MeterDetailButton } from '../charts/EntityHistoryChart';
import { usePlantMeterConfig } from '../shared';
import { ReasonField, ReplaceMeterDialog } from '../locators/LocatorDialogs';
import { ProductMetersStat } from './sections/ProductMetersStat';
import { AssignLocatorsDialog } from './sections/AssignLocatorsDialog';
import { AddProductMeterDialog } from './sections/AddProductMeterDialog';
import { ProductMeterNameInline } from './sections/ProductMeterNameInline';
import { ProductMeterNameInlineBase } from './sections/ProductMeterNameInline';

export { ProductMetersStat } from './sections/ProductMetersStat';

export function ProductMetersCard({ plant, highlightId }: { plant: any; highlightId?: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isManager, isAdmin, user } = useAuth();
  const canEdit = isManager || isAdmin;

  const { data: meters, isLoading, isFetching } = useQuery({
    queryKey: ['product-meters', plant.id],
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      let { data, error } = await supabase
        .from('product_meters' as any)
        .select('id, name, status, sort_order, is_derived, created_at')
        .eq('plant_id', plant.id)
        .order('sort_order', { ascending: true });

      if (error?.message?.includes('sort_order')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, is_derived, created_at')
          .eq('plant_id', plant.id)
          .order('created_at', { ascending: true }));
      }

      if (error?.message?.includes('status')) {
        const { data: fallback, error: fbError } = await supabase
          .from('product_meters' as any)
          .select('id, name, is_derived, created_at')
          .eq('plant_id', plant.id)
          .order('created_at', { ascending: true });
        if (fbError) throw fbError;
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }

      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['product-meters', plant.id] });
    qc.invalidateQueries({ queryKey: ['product-meters-stat', plant.id] });
    qc.invalidateQueries({ queryKey: ['locators-fed-by-product-meters', plant.id] });
    qc.invalidateQueries({ queryKey: ['locator-dialog-product-meters', plant.id] });
  };

  const { data: plantLocators } = useQuery({
    queryKey: ['product-meters-plant-locators', plant.id],
    queryFn: async () => {
      let data: any, error: any;
      ({ data, error } = await supabase.from('locators').select('id, name, status, product_meter_id, is_derived, default_input_mode').eq('plant_id', plant.id).order('name'));
      if (error && error.message?.includes('column')) {
        ({ data, error } = await supabase.from('locators').select('id, name, status, product_meter_id').eq('plant_id', plant.id).order('name'));
        if (!error && data) data = (data as any[]).map((l) => ({ ...l, is_derived: false, default_input_mode: 'raw' }));
      }
      return (data ?? []) as any[];
    },
  });

  const { data: meterReplacements } = useQuery({
    queryKey: ['product-meter-replacements', plant.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_meter_replacements' as any)
        .select('*, replacer:user_profiles!product_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('plant_id', plant.id)
        .order('replacement_date', { ascending: false });
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const latestReplacementByMeter = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of meterReplacements ?? []) {
      if (!r.meter_id) map[r.meter_id] = r;
    }
    return map;
  }, [meterReplacements]);

  const { data: latestMeterReadings } = useQuery({
    queryKey: ['product-meters-latest-readings', plant.id],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meter_readings_latest' as any) as any)
        .select('meter_id, reading_datetime')
        .eq('plant_id', plant.id);
      return (data ?? []) as { meter_id: string; reading_datetime: string }[];
    },
  });
  const latestDtByMeter = useMemo(() => {
    const map: Record<string, string> = {};
    latestMeterReadings?.forEach(r => { map[r.meter_id] = r.reading_datetime; });
    return map;
  }, [latestMeterReadings]);

  const meterCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [meterPulseId, setMeterPulseId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const el = meterCardRefs.current[highlightId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setMeterPulseId(highlightId);
    const t = setTimeout(() => setMeterPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, meters]);

  const [addOpen, setAddOpen]           = useState(false);
  const [assignTarget, setAssignTarget] = useState<any>(null);
  const [replaceMeterTarget, setReplaceMeterTarget] = useState<any | null>(null);
  const [selectedMeter, setSelectedMeter] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget]   = useState<any | null>(null);
  const [deleteReason, setDeleteReason]   = useState('');
  const [deleteBusy, setDeleteBusy]       = useState(false);

  const doDelete = async () => {
    if (!deleteTarget) return;
    if (deleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setDeleteBusy(true);
    await supabase.from('product_meter_readings' as any).delete().eq('meter_id', deleteTarget.id);
    const { error } = await supabase.from('product_meters' as any).delete().eq('id', deleteTarget.id);
    setDeleteBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plant.id, meter_id: deleteTarget.id,
      meter_name: deleteTarget.name, old_value: deleteTarget.name, new_value: null,
      user_id: user?.id ?? null, timestamp: new Date().toISOString(),
    });
    toast.success(`"${deleteTarget.name}" deleted`);
    setDeleteTarget(null); setDeleteReason('');
    invalidate();
    qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['dsm-prod-readings'] });
    qc.invalidateQueries({ queryKey: ['dsm-product-meters'] });
    qc.invalidateQueries();
  };

  const toggleStatus = async (m: any) => {
    if (!canEdit) return;
    const next = (m.status ?? 'Active') === 'Active' ? 'Inactive' : 'Active';
    const { error } = await supabase
      .from('product_meters' as any).update({ status: next } as any).eq('id', m.id);
    if (error?.message?.includes('status')) {
      toast.error('Status column not yet available — run the migration SQL in Supabase first.');
      return;
    }
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plant.id, meter_id: m.id, meter_name: m.name,
      old_value: m.status, new_value: next,
      user_id: user?.id ?? null, timestamp: new Date().toISOString(),
    });
    toast.success(`Meter marked ${next}`);
    invalidate();
    qc.invalidateQueries({ queryKey: ['product-meters-active', plant.id] });
  };

  return (
    <div className="space-y-2">
      <div className="relative flex justify-between items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Product Meters ({meters?.length ?? 0})
        </h3>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <Button size="sm" className="h-7 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80" onClick={() => setAddOpen(true)} data-testid="add-product-meter-btn">
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          )}
        </div>
      </div>

      {isLoading && !meters && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      )}

      {isFetching && !!meters && (
        <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
      )}

      <div className="stagger-grid space-y-2">
      {meters?.map((m: any, idx: number) => (
        <Card
          key={m.id}
          ref={(el) => { meterCardRefs.current[m.id] = el; }}
          className={`p-3 card-interactive border-l-2 ${
            (m.status ?? 'Active') === 'Active'
              ? 'border-l-accent'
              : 'border-l-muted-foreground/30'
          } ${meterPulseId === m.id ? 'ring-2 ring-accent shadow-elev' : ''}`}
          data-testid={`product-meter-card-${m.id}`}
        >
          {(() => {
            const supplied = (plantLocators ?? []).filter((l: any) => l.product_meter_id === m.id);
            return (
            <>
            <div className="flex items-start gap-2">
              <div
                role="button"
                tabIndex={0}
                className="flex-1 min-w-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 rounded"
                onClick={() => setSelectedMeter(selectedMeter === m.id ? null : m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMeter(selectedMeter === m.id ? null : m.id); }
                }}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <ProductMeterNameInlineBase
                      meter={m} plantId={plant.id} userId={user?.id ?? null}
                      canEdit={canEdit} onChanged={invalidate} fallbackIndex={idx + 1}
                    />
                    <div className="text-xs text-muted-foreground">
                      Product Meter · {(m.status ?? 'Active') === 'Active' ? 'Reading active' : 'Inactive'}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const fresh = lastReadingFreshness(latestDtByMeter[m.id]);
                        return (
                          <StatusPill tone={fresh.tone}>
                            <CalendarClock className="h-2.5 w-2.5" />
                            {fresh.label}
                          </StatusPill>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => navigate(`/operations?tab=product&highlight=${m.id}`)}
                        title="Open this meter in Operations"
                        aria-label="Open this meter in Operations"
                        className="inline-flex items-center gap-0.5 text-2xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 px-1.5 py-0.5 rounded-full transition-colors"
                      >
                        <ArrowUpRight className="h-2.5 w-2.5" />
                        Operations
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (canEdit) toggleStatus(m); }}
                      title={canEdit ? `Click to toggle (currently ${m.status ?? 'Active'})` : (m.status ?? 'Active')}
                      className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full border transition-colors ${
                        (m.status ?? 'Active') === 'Active'
                          ? 'text-accent bg-accent-soft border-accent hover:bg-accent-soft'
                          : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                      } ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${(m.status ?? 'Active') === 'Active' ? 'bg-accent' : 'bg-muted-foreground'}`} />
                      {m.status ?? 'Active'}
                    </button>
                    <TrendingUp className={`h-3.5 w-3.5 transition-colors ${selectedMeter === m.id ? 'text-primary' : 'text-muted-foreground/40'}`} />
                  </div>
                </div>

                {(() => {
                  if (!supplied.length) return (
                    <div className="mt-1.5 flex items-center gap-1">
                      <Droplet className="h-3 w-3 text-muted-foreground/40" />
                      <span className="text-xs text-muted-foreground/60 italic">No locators assigned</span>
                    </div>
                  );
                  const visible  = supplied.slice(0, 3);
                  const overflow = supplied.length - 3;
                  return (
                    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                      <Droplet className="h-3 w-3 text-primary shrink-0" />
                      {visible.map((l: any) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/plants/${plant.id}?tab=locators&highlight=${l.id}`);
                          }}
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs border transition-colors ${
                            l.is_derived
                              ? 'bg-warn-soft text-warn border-warn hover:bg-warn-soft/70'
                              : 'bg-primary-soft text-primary border-primary hover:bg-primary-soft/70'
                          }`} title={l.is_derived ? `${l.name} — derived (no physical meter; residual computed by cron sweep). Click to open in Locators.` : `${l.name} — click to open in Locators`}>
                          {l.is_derived && <span className="font-bold opacity-70">~</span>}
                          {l.name}
                        </button>
                      ))}
                      {overflow > 0 && (
                        <span className="text-2xs text-muted-foreground">+{overflow} more</span>
                      )}
                    </div>
                  );
                })()}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full text-primary hover:text-primary/90 hover:bg-primary-soft" title="Assign locators" onClick={() => setAssignTarget(m)} data-testid={`assign-locators-${m.id}`}>
                    <Droplet className="h-3.5 w-3.5" />
                  </Button>
                  <ProductMeterNameInline.EditTrigger meter={m} plantId={plant.id} userId={user?.id ?? null} canEdit={canEdit} onChanged={invalidate} />
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete" onClick={() => { setDeleteTarget(m); setDeleteReason(''); }} data-testid={`delete-product-meter-${m.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {selectedMeter === m.id && (
              <div className="mt-3 pt-3 border-t space-y-3" onClick={(e) => e.stopPropagation()}>
                <MeterDetailButton
                  label="Product Meter"
                  icon={<Gauge className="h-4 w-4 text-info" />}
                  fields={[
                    { label: 'Brand', value: m.meter_brand },
                    { label: 'Size', value: m.meter_size ? `${m.meter_size} in` : null },
                    { label: 'Serial No.', value: m.meter_serial },
                    { label: 'Installed', value: m.meter_installed_date },
                    {
                      label: 'Last Replaced By',
                      value: latestReplacementByMeter[m.id]?.replacer
                        ? [latestReplacementByMeter[m.id].replacer.first_name, latestReplacementByMeter[m.id].replacer.last_name].filter(Boolean).join(' ')
                        : null,
                    },
                    { label: 'Replacement Date', value: latestReplacementByMeter[m.id]?.replacement_date },
                  ]}
                >
                  {canEdit && (
                    <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setReplaceMeterTarget(m)}>
                      <ChangeMeterIcon className="h-3.5 w-3.5" /> Replace Meter
                    </Button>
                  )}
                </MeterDetailButton>
                <EntityHistoryChart
                  entityId={m.id}
                  entityType="product_meter"
                  entityName={m.name ?? 'Meter'}
                  defaultInputMode={m.is_derived ? 'direct' : 'raw'}
                  siblingLocators={supplied.map((l: any) => ({
                    id: l.id,
                    name: l.name,
                    defaultInputMode: l.default_input_mode === 'direct' ? 'direct' : 'raw',
                  }))}
                />
              </div>
            )}
            </>
            );
          })()}
        </Card>
      ))}

      {meters && meters.length === 0 && !isLoading && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          No product meters yet.{canEdit ? ' Click Add to create one.' : ''}
        </Card>
      )}
      </div>

      {addOpen && (
        <AddProductMeterDialog
          plantId={plant.id}
          meterCount={meters?.length ?? 0}
          userId={user?.id ?? null}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); invalidate(); }}
        />
      )}

      {replaceMeterTarget && (
        <ReplaceMeterDialog
          kind="product"
          assetId={replaceMeterTarget.id}
          plantId={plant.id}
          oldSerial={replaceMeterTarget.meter_serial}
          onClose={() => {
            setReplaceMeterTarget(null);
            invalidate();
            qc.invalidateQueries({ queryKey: ['product-meter-replacements', plant.id] });
          }}
        />
      )}

      {assignTarget && (
        <AssignLocatorsDialog
          meter={assignTarget}
          plantId={plant.id}
          onClose={() => setAssignTarget(null)}
          onSaved={() => {
            setAssignTarget(null);
            qc.invalidateQueries({ queryKey: ['locators', plant.id] });
            qc.invalidateQueries({ queryKey: ['product-meters-plant-locators', plant.id] });
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleteBusy && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Delete &quot;{deleteTarget?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All readings for this product meter will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={deleteReason} onChange={setDeleteReason} testId="product-meter-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              disabled={deleteBusy || deleteReason.trim().length < 5}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

async function logProductMeterAudit(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('product_meter_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore */ }
}
