import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlantMeterConfig } from '../../plants/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DateTimePicker } from '@/components/ui/date-picker';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { ExportButton } from '@/components/ExportButton';
import { Loader2, Pencil, History, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_CIP_CHEMICALS, CIP_BUILTIN_DB_MAP, CIP_CHEM_ACCENTS, CIP_CUSTOM_ACCENT, EDIT_WINDOW_HOURS, canEditEntry, diffFields, logReadingEdit } from '../../ro-trains';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';

import { CIPSummaryContent } from './CIPSummaryContent';
import { CIPVolumetric } from './CIPVolumetric';
import { PlantPicker } from '../shared/PlantPicker';

export function CIPLog() {
  const qc = useQueryClient();
  // ── Use activeOperator, not user — same shared-email fix as PretreatmentAndROLog
  const { activeOperator, isManager, user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [trainId, setTrainId] = useState('');
  // Stable callback — prevents PlantPicker's useEffect from re-firing on every render
  // because an inline `(p) => { setPlantId(p); setTrainId(''); }` would be a new
  // function reference each render, triggering the picker's effect in a loop.
  const handleCIPPlantChange = useCallback((p: string) => {
    setPlantId(p);
    setTrainId('');
  }, []);

  // ── Load plant meter config to get CIP chemical list ──────────────────────
  const { config: plantConfig } = usePlantMeterConfig(plantId || null);
  // Use plant-configured chemicals; fall back to the 3 built-in defaults.
  const cipChemicals: Array<{ name: string; unit: string }> =
    plantConfig?.cip_chemicals?.length
      ? plantConfig.cip_chemicals
      : DEFAULT_CIP_CHEMICALS;

  const { data: trains } = useQuery({
    queryKey: ['cip-trains', plantId],
    queryFn: async () => plantId ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId)).data ?? [] : [],
    enabled: !!plantId,
  });
  const { data: history } = useQuery({
    queryKey: ['cip-history', trainId, plantId],
    queryFn: async () => plantId
      ? (await supabase.from('cip_logs')
          .select('*,ro_trains(train_number)')
          .eq('plant_id', plantId)
          .order('start_datetime', { ascending: false })
          .limit(10)).data ?? []
      : [],
    enabled: !!plantId,
  });
  const { data: cipPrices } = useQuery({
    queryKey: ['chem-current-prices-cip'],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase.from('chemical_prices').select('*').lte('effective_date', today).order('effective_date', { ascending: false });
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => {
        const fullName = p.chemical_name as string;
        if (!(fullName in map)) map[fullName] = p.unit_price;
        const baseName = fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(baseName in map)) map[baseName] = p.unit_price;
      });
      return map;
    },
  });

  const selectedTrain = useMemo(() => trains?.find((t: any) => t.id === trainId), [trains, trainId]);
  const numVessels = (selectedTrain as any)?.num_vessels ?? 15;

  // ── Form state: dynamic chemicals map + timing/remarks ────────────────────
  // chemicals: Record<chemicalName, inputValue>
  const [v, setV] = useState<{ start: string; end: string; remarks: string; chemicals: Record<string, string> }>({
    start: '', end: '', remarks: '', chemicals: {},
  });

  const setChemVal = (name: string, val: string) =>
    setV(prev => ({ ...prev, chemicals: { ...prev.chemicals, [name]: val } }));

  // ── Live computed values (built-ins drive the cost/mass summary) ──────────
  const causticKg = +(v.chemicals['Caustic Soda'] || '') || 0;
  const hclL      = +(v.chemicals['HCl']          || '') || 0;
  const slsG      = +(v.chemicals['SLS']           || '') || 0;
  const totalMassKg   = causticKg + slsG / 1000;
  const totalVolumeL  = hclL;
  const liveCost =
    causticKg * (cipPrices?.['Caustic Soda'] ?? 0) +
    hclL      * (cipPrices?.['HCl']          ?? 0) +
    (slsG / 1000) * (cipPrices?.['SLS']      ?? 0);

  const formDuration = v.start && v.end
    ? Math.round((new Date(v.end).getTime() - new Date(v.start).getTime()) / 60000)
    : null;

  const getHistoryCost = (c: any) =>
    (c.caustic_soda_kg || 0) * (cipPrices?.['Caustic Soda'] ?? 0) +
    (c.hcl_l           || 0) * (cipPrices?.['HCl']          ?? 0) +
    ((c.sls_g || 0) / 1000)  * (cipPrices?.['SLS']          ?? 0);

  const getChemType = (c: any) => {
    const parts: string[] = [];
    if (c.caustic_soda_kg > 0) parts.push('Caustic Alkaline');
    if (c.hcl_l > 0)           parts.push('Acid HCl');
    if (c.sls_g > 0)           parts.push('Anti Scalant');
    // Custom chemicals stored as JSON in remarks
    try {
      const match = (c.remarks ?? '').match(/__cip_extra:(\{[^}]+\})/);
      if (match) {
        const extra = JSON.parse(match[1]) as Record<string, { value: string }>;
        Object.entries(extra).forEach(([name, { value }]) => {
          if (+value > 0) parts.push(name);
        });
      }
    } catch { /* ignore bad JSON */ }
    return parts.join(' + ') || '—';
  };

  const lastCip = history?.[0];
  const lastCipCost = lastCip ? getHistoryCost(lastCip) : null;
  const comparisonPct = lastCipCost && liveCost
    ? (((liveCost - lastCipCost) / lastCipCost) * 100).toFixed(0)
    : null;

  const submit = async () => {
    if (!trainId) { toast.error('Select a train'); return; }

    // Build payload for built-in DB columns
    const payload: Record<string, any> = {
      train_id: trainId, plant_id: plantId,
      start_datetime: v.start ? new Date(v.start).toISOString() : null,
      end_datetime:   v.end   ? new Date(v.end).toISOString()   : null,
      conducted_by: activeOperator?.id,
    };

    // Map built-in chemicals to their DB columns
    cipChemicals.forEach(chem => {
      const col = CIP_BUILTIN_DB_MAP[chem.name];
      const val = v.chemicals[chem.name];
      if (col) payload[col] = val ? +val : null;
    });
    // Ensure null for any built-in columns not in cipChemicals
    if (!('caustic_soda_kg' in payload)) payload.caustic_soda_kg = null;
    if (!('hcl_l'           in payload)) payload.hcl_l           = null;
    if (!('sls_g'           in payload)) payload.sls_g           = null;

    // Serialize custom chemicals into remarks
    const customChems = cipChemicals.filter(c => !CIP_BUILTIN_DB_MAP[c.name]);
    let remarksOut = v.remarks || null;
    if (customChems.length > 0) {
      const extra: Record<string, { value: string; unit: string }> = {};
      customChems.forEach(c => {
        const val = v.chemicals[c.name];
        if (val) extra[c.name] = { value: val, unit: c.unit };
      });
      if (Object.keys(extra).length > 0) {
        const suffix = `__cip_extra:${JSON.stringify(extra)}`;
        remarksOut = remarksOut ? `${remarksOut} ${suffix}` : suffix;
      }
    }
    payload.remarks = remarksOut;

    const { error } = await supabase.from('cip_logs').insert(payload as any);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('CIP logged'); qc.invalidateQueries();
    clearForm();
  };
  const clearForm = () => setV({ start: '', end: '', remarks: '', chemicals: {} });

  // ── Edit state ───────────────────────────────────────────────────────────
  const [editId, setEditId]       = useState<string | null>(null);
  const [editRow, setEditRow]     = useState<any | null>(null);
  const [editChems, setEditChems] = useState<Record<string, string>>({});
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd]     = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving]       = useState(false);
  // ── Delete state ─────────────────────────────────────────────────────────
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting]   = useState(false);

  // cip_logs uses `conducted_by` instead of `recorded_by`; adapt for canEditEntry
  const cipAdapt = (c: any) => ({ recorded_by: c.conducted_by ?? null, created_at: c.created_at ?? null });

  const startEdit = (c: any) => {
    if (!canEditEntry(cipAdapt(c), isManager, activeOperator?.id)) {
      toast.error('You can only edit your own CIP logs within 8 hours of submitting them. Managers can edit any record.');
      return;
    }
    setEditId(c.id);
    setEditRow(c);
    setEditReason('');
    setEditCustomReason('');
    setEditStart(c.start_datetime ? format(new Date(c.start_datetime), "yyyy-MM-dd'T'HH:mm") : '');
    setEditEnd(c.end_datetime     ? format(new Date(c.end_datetime),   "yyyy-MM-dd'T'HH:mm") : '');
    // Restore built-in chemical values
    const chems: Record<string, string> = {};
    cipChemicals.forEach(chem => {
      const col = CIP_BUILTIN_DB_MAP[chem.name];
      if (col) { const val = c[col]; if (val != null && val !== 0) chems[chem.name] = String(val); }
    });
    // Restore custom chemicals from serialised __cip_extra suffix in remarks
    try {
      const match = (c.remarks ?? '').match(/__cip_extra:(\{[^}]+\})/);
      if (match) {
        const extra = JSON.parse(match[1]) as Record<string, { value: string }>;
        Object.entries(extra).forEach(([name, { value }]) => { chems[name] = value; });
      }
    } catch { /* ignore malformed JSON */ }
    setEditChems(chems);
    setEditRemarks((c.remarks ?? '').replace(/\s*__cip_extra:\{[^}]+\}/, '').trim());
  };

  const saveEdit = async () => {
    if (!editId || !editRow) return;
    if (!canEditEntry(cipAdapt(editRow), isManager, activeOperator?.id)) {
      toast.error('You no longer have permission to edit this entry.');
      return;
    }
    if (!editReason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(editReason, editCustomReason)) { toast.error('Describe the reason for this edit'); return; }
    setSaving(true);
    const payload: Record<string, any> = {
      start_datetime: editStart ? new Date(editStart).toISOString() : null,
      end_datetime:   editEnd   ? new Date(editEnd).toISOString()   : null,
    };
    // Built-in chemicals → dedicated DB columns
    cipChemicals.forEach(chem => {
      const col = CIP_BUILTIN_DB_MAP[chem.name];
      if (col) payload[col] = editChems[chem.name] ? +editChems[chem.name] : null;
    });
    if (!('caustic_soda_kg' in payload)) payload.caustic_soda_kg = null;
    if (!('hcl_l'           in payload)) payload.hcl_l           = null;
    if (!('sls_g'           in payload)) payload.sls_g           = null;
    // Custom chemicals → re-serialise into remarks suffix
    const customChems = cipChemicals.filter(c => !CIP_BUILTIN_DB_MAP[c.name]);
    let remarksOut: string | null = editRemarks.trim() || null;
    if (customChems.length > 0) {
      const extra: Record<string, { value: string; unit: string }> = {};
      customChems.forEach(c => {
        const val = editChems[c.name];
        if (val) extra[c.name] = { value: val, unit: c.unit };
      });
      if (Object.keys(extra).length > 0) {
        const suffix = `__cip_extra:${JSON.stringify(extra)}`;
        remarksOut = remarksOut ? `${remarksOut} ${suffix}` : suffix;
      }
    }
    payload.remarks = remarksOut;

    const { error } = await supabase.from('cip_logs').update(payload as any).eq('id', editId);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    // table_name was previously cast to 'chemical_dosing_logs' as any — see
    // helpers.tsx and the 20260809_reading_audit_log_add_cip_logs.sql
    // migration, which added the real 'cip_logs' value so this no longer
    // has to lie to get past the type union / DB check constraint.
    await logReadingEdit({
      table_name: 'cip_logs',
      record_id:  editId,
      plant_id:   editRow.plant_id ?? null,
      train_id:   editRow.train_id ?? null,
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel,
      changes: diffFields(editRow, payload),
      reason: resolveReason(editReason, editCustomReason),
    });

    toast.success('CIP record updated');
    setEditId(null); setEditRow(null);
    setEditReason(''); setEditCustomReason('');
    qc.invalidateQueries({ queryKey: ['cip-history'] });
  };

  const deleteCipRow = async (c: any) => {
    if (!canEditEntry(cipAdapt(c), isManager, activeOperator?.id)) {
      toast.error('You can only delete your own CIP logs within 8 hours of submitting them. Managers can delete any record.');
      return;
    }
    setDeleting(true);
    const { error } = await supabase.from('cip_logs').delete().eq('id', c.id);
    setDeleting(false);
    setPendingDeleteId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('CIP record deleted');
    qc.invalidateQueries({ queryKey: ['cip-history'] });
  };

  const trainStatusLabel = selectedTrain?.status === 'Running'
    ? 'Online - Optimal Health'
    : selectedTrain?.status ?? '';
  const trainStatusColor = selectedTrain?.status === 'Running'
    ? 'text-accent'
    : selectedTrain?.status === 'Maintenance'
    ? 'text-warn'
    : 'text-danger';

  return (
    <div className="space-y-2.5">
      {/* ── Plant + Train row ──────────────────────────────────────────── */}
      <Card className="p-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="ciplog-plant" className="text-xs text-muted-foreground">Plant</Label>
            <PlantPicker value={plantId} onChange={handleCIPPlantChange} id="ciplog-plant" />
          </div>
          <div>
            <Label htmlFor="ciplog-train" className="text-xs text-muted-foreground">Train</Label>
            <Select value={trainId} onValueChange={setTrainId}>
              <SelectTrigger id="ciplog-train"><SelectValue placeholder="Select train" /></SelectTrigger>
              <SelectContent>
                {trains?.map((t: any) => <SelectItem key={t.id} value={t.id}>Train {t.train_number}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {selectedTrain && (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-sm font-bold">Train {selectedTrain.train_number}</span>
            <span className={cn('text-xs font-medium', trainStatusColor)}>({trainStatusLabel})</span>
          </div>
        )}
      </Card>

      {/* ── Main + Sidebar layout: stacked on mobile, side-by-side on md+ ─ */}
      <div className="flex flex-col md:flex-row gap-2.5 items-start">

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-2.5">

          {/* ── Dosing & Time (dynamic chemical cards) ─────────────────── */}
          <Card className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Dosing & Time</h4>
              {cipChemicals.length > 0 && (
                <span className="text-2xs text-muted-foreground">
                  {cipChemicals.length} chemical{cipChemicals.length !== 1 ? 's' : ''} configured
                </span>
              )}
            </div>

            {/* Chemical input cards — one per configured CIP chemical */}
            <div className="grid grid-cols-2 gap-2">
              {cipChemicals.map(chem => {
                const val = v.chemicals[chem.name] ?? '';
                const accent = CIP_CHEM_ACCENTS[chem.name] ?? CIP_CUSTOM_ACCENT;
                const isBuiltin = !!CIP_BUILTIN_DB_MAP[chem.name];
                return (
                  <div
                    key={chem.name}
                    className={cn(
                      'rounded-lg border-2 p-2 space-y-1.5 transition-colors',
                      val ? accent.border : 'border-border bg-muted/20',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'inline-flex items-center justify-center w-5 h-5 rounded-full text-3xs font-bold',
                        accent.badge,
                      )}>
                        {isBuiltin ? chem.name.slice(0, 2).toUpperCase() : '✦'}
                      </span>
                      <span className="text-xs font-semibold">{chem.name} ({chem.unit})</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="any"
                        value={val}
                        onChange={e => setChemVal(chem.name, e.target.value)}
                        className="h-7 text-sm flex-1"
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">{chem.unit}</span>
                    </div>
                    <div className="h-0.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', accent.bar, val ? 'w-1/2' : 'w-0')} />
                    </div>
                  </div>
                );
              })}

              {cipChemicals.length === 0 && (
                <div className="col-span-2 rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center text-xs text-muted-foreground">
                  No CIP chemicals configured for this plant.
                  Go to <strong>Plant Configuration → CIP Chemicals</strong> to add them.
                </div>
              )}
            </div>

            {/* Datetime pickers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ciplog-start-d-t" className="text-xs text-muted-foreground">Start Date & Time</Label>
                <DateTimePicker
                  value={v.start}
                  onChange={(val) => setV({ ...v, start: val })}
                  placeholder="Select start time..."
                  size="sm"
                  className="w-full font-mono-num"
                  id="ciplog-start-d-t"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ciplog-end-d-t" className="text-xs text-muted-foreground">End Date & Time</Label>
                <DateTimePicker
                  value={v.end}
                  onChange={(val) => setV({ ...v, end: val })}
                  placeholder="Select end time..."
                  size="sm"
                  className="w-full font-mono-num"
                  id="ciplog-end-d-t"
                />
              </div>
            </div>
            {formDuration != null && formDuration > 0 && (
              <p className="text-2xs text-muted-foreground">
                Duration: <span className="font-semibold text-foreground">{formDuration} min</span>
              </p>
            )}
          </Card>

          {/* Remarks & Prediction */}
          <Card className="p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Remarks & Prediction</h4>
            <div>
              <Label htmlFor="ciplog-remarks" className="text-xs text-muted-foreground">Remarks</Label>
              <Textarea value={v.remarks} onChange={e => setV({ ...v, remarks: e.target.value })}
                placeholder="Any observations..." className="text-xs min-h-[60px] resize-none" id="ciplog-remarks"/>
            </div>
            <div className="rounded-lg border border-accent bg-accent-soft/60 p-2 space-y-0.5">
              <p className="text-2xs font-semibold text-accent uppercase tracking-wide">
                Predicted Recovery Post-CIP:
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-accent">+3% est.</span>
                <span className="text-accent text-base">↑</span>
              </div>
            </div>
          </Card>

          {/* Volumetric Calculator */}
          <CIPVolumetric numVessels={numVessels} />

          {/* CIP History table — editable */}
          <Card className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                CIP History {selectedTrain ? `— Train ${selectedTrain.train_number}` : ''}
              </h4>
              <ExportButton table="cip_logs" label="Export" />
            </div>
            {/* Permission note */}
            <p className="text-2xs text-muted-foreground/70 italic">
              Operators may edit or delete their own records within {EDIT_WINDOW_HOURS} hrs. Managers can edit or delete any record.
            </p>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-1.5 pr-2 font-semibold">Date</th>
                    <th className="text-left py-1.5 pr-2 font-semibold">Duration</th>
                    <th className="text-left py-1.5 pr-2 font-semibold">Chemical Type</th>
                    <th className="text-right py-1.5 pr-2 font-semibold">Cost</th>
                    <th className="text-right py-1.5 font-semibold w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history?.map((c: any) => {
                    const dur = c.start_datetime && c.end_datetime
                      ? Math.round((new Date(c.end_datetime).getTime() - new Date(c.start_datetime).getTime()) / 60000)
                      : null;
                    const hCost = getHistoryCost(c);
                    const canEdit = canEditEntry(cipAdapt(c), isManager, activeOperator?.id);
                    const isPendingDelete = pendingDeleteId === c.id;
                    return (
                      <tr key={c.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                        <td className="py-1.5 pr-2 font-mono-num text-xs">
                          {c.start_datetime ? format(new Date(c.start_datetime), 'MM/dd/yy HH:mm') : '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-muted-foreground">
                          {dur != null && dur > 0 ? `${dur} min` : '—'}
                        </td>
                        <td className="py-1.5 pr-2">{getChemType(c)}</td>
                        <td className="py-1.5 pr-2 text-right font-mono-num">
                          {cipPrices ? `₱ ${fmtNum(hCost, 2)}` : '—'}
                        </td>
                        <td className="py-1.5 text-right">
                          {canEdit && !isPendingDelete && (
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                onClick={() => startEdit(c)}
                                disabled={!!editId || deleting}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                                title="Edit this CIP record"
                                aria-label="Edit CIP record"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setPendingDeleteId(c.id)}
                                disabled={!!editId || deleting}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
                                title="Delete this CIP record"
                                aria-label="Delete CIP record"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                          {isPendingDelete && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => deleteCipRow(c)}
                                disabled={deleting}
                                className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-2xs font-semibold"
                              >
                                {deleting ? <Loader2 className="h-2.5 w-2.5 animate-spin inline" /> : 'Yes'}
                              </button>
                              <button
                                onClick={() => setPendingDeleteId(null)}
                                className="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground text-2xs"
                              >
                                No
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!history?.length && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-muted-foreground">No CIP records yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Edit CIP record Dialog ─────────────────────────────────────────── */}
          {editId && editRow && (
            <Dialog open={!!editId} onOpenChange={o => { if (!o && !saving) { setEditId(null); setEditRow(null); } }}>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Pencil className="h-4 w-4" /> Edit CIP Record
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-1">
                  {/* Start / End datetime */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="ciplog-start-d-amp-t" className="text-xs text-muted-foreground">Start Date & Time</Label>
                      <DateTimePicker
                        value={editStart}
                        onChange={(val) => setEditStart(val)}
                        placeholder="Select start time..."
                        size="sm"
                        className="w-full font-mono-num"
                        id="ciplog-start-d-amp-t"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ciplog-end-d-amp-t" className="text-xs text-muted-foreground">End Date & Time</Label>
                      <DateTimePicker
                        value={editEnd}
                        onChange={(val) => setEditEnd(val)}
                        placeholder="Select end time..."
                        size="sm"
                        className="w-full font-mono-num"
                        id="ciplog-end-d-amp-t"
                      />
                    </div>
                  </div>
                  {/* Duration preview */}
                  {editStart && editEnd && (() => {
                    const dur = Math.round((new Date(editEnd).getTime() - new Date(editStart).getTime()) / 60000);
                    return dur > 0 ? (
                      <p className="text-2xs text-muted-foreground">
                        Duration: <span className="font-semibold text-foreground">{dur} min</span>
                      </p>
                    ) : null;
                  })()}
                  {/* Chemical inputs — one per configured CIP chemical */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Chemicals</p>
                    <div className="grid grid-cols-2 gap-2">
                      {cipChemicals.map(chem => {
                        const accent = CIP_CHEM_ACCENTS[chem.name] ?? CIP_CUSTOM_ACCENT;
                        const val = editChems[chem.name] ?? '';
                        return (
                          <div key={chem.name}
                            className={cn('rounded-lg border-2 p-2 space-y-1 transition-colors',
                              val ? accent.border : 'border-border bg-muted/20'
                            )}>
                            <div className="flex items-center gap-1">
                              <span className={cn(
                                'inline-flex items-center justify-center w-4 h-4 rounded-full text-3xs font-bold shrink-0',
                                accent.badge,
                              )}>
                                {CIP_BUILTIN_DB_MAP[chem.name] ? chem.name.slice(0, 2).toUpperCase() : '✦'}
                              </span>
                              <span className="text-xs font-semibold leading-tight truncate">{chem.name}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number" step="any"
                                value={val}
                                onChange={e => setEditChems({ ...editChems, [chem.name]: e.target.value })}
                                className="h-7 text-sm flex-1"
                                placeholder="0"
                              />
                              <span className="text-xs text-muted-foreground shrink-0">{chem.unit}</span>
                            </div>
                          </div>
                        );
                      })}
                      {cipChemicals.length === 0 && (
                        <p className="col-span-2 text-xs text-muted-foreground italic">
                          No CIP chemicals configured — go to Plant Configuration → CIP Chemicals.
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Remarks */}
                  <div>
                    <Label htmlFor="ciplog-remarks-2" className="text-xs text-muted-foreground">Remarks</Label>
                    <Textarea value={editRemarks}
                      onChange={e => setEditRemarks(e.target.value)}
                      placeholder="Any observations..."
                      className="text-xs min-h-[60px] resize-none" id="ciplog-remarks-2"/>
                  </div>
                  <CorrectionReasonField
                    reason={editReason} onReasonChange={setEditReason}
                    customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
                  />
                </div>
                <DialogFooter>
                  <Button variant="ghost"
                    onClick={() => { setEditId(null); setEditRow(null); setEditReason(''); setEditCustomReason(''); }}
                    disabled={saving}>Cancel</Button>
                  <Button onClick={saveEdit} disabled={saving || !isReasonComplete(editReason, editCustomReason)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {saving && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                    Save Changes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* ── Sidebar: hidden on mobile (shown below instead), visible md+ ── */}
        <div className="hidden md:block w-48 shrink-0">
          <div className="rounded-xl bg-primary text-primary-foreground p-3 space-y-3 sticky top-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">CIP Summary</p>
              <p className="text-3xs text-primary-foreground/60">(Live Calc)</p>
            </div>
            <div className="space-y-2.5"><CIPSummaryContent liveCost={liveCost} totalMassKg={totalMassKg} totalVolumeL={totalVolumeL} comparisonPct={comparisonPct} /></div>
            <div className="border-t border-primary-foreground/20 pt-2.5 space-y-2">
              <Button onClick={submit} className="w-full h-8 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0">Save CIP</Button>
              <Button variant="ghost" onClick={clearForm} className="w-full h-8 text-xs text-primary-foreground/70 hover:text-primary-foreground hover:bg-black/10">Clear Form</Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile summary bar (visible only on mobile) ─────────────────── */}
      <div className="md:hidden rounded-xl bg-primary text-primary-foreground p-3 space-y-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">CIP Summary <span className="text-primary-foreground/60 font-normal">(Live)</span></p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <CIPSummaryContent liveCost={liveCost} totalMassKg={totalMassKg} totalVolumeL={totalVolumeL} comparisonPct={comparisonPct} />
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variant="ghost" onClick={clearForm} className="h-9 text-xs text-primary-foreground/70 hover:text-primary-foreground hover:bg-black/10 border border-primary-foreground/30">Clear Form</Button>
          <Button onClick={submit} className="h-9 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0">Save CIP</Button>
        </div>
      </div>
    </div>
  );
}
