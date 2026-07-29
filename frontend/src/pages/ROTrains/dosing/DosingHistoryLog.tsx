import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { ExportButton } from '@/components/ExportButton';
import { Loader2, Pencil, History, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DOSING_KEYS, canEditEntry, diffFields, logReadingEdit } from '../../ro-trains';

// ─── Chemical Dosing Historical Log ──────────────────────────────────────────
export function DosingHistoryLog() {
  const qc = useQueryClient();
  const { isManager, activeOperator, user } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filterPlantId, setFilterPlantId] = useState(selectedPlantId ?? '');
  const [days, setDays] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');

  // Sync global plant selector
  useEffect(() => {
    if (selectedPlantId && !filterPlantId) setFilterPlantId(selectedPlantId);
  }, [selectedPlantId]);

  const { from, to } = useMemo(() => {
    if (days === 'custom') return { from: customFrom, to: customTo };
    const now  = new Date();
    const past = new Date(now); past.setDate(past.getDate() - +days);
    return { from: past.toISOString(), to: now.toISOString() };
  }, [days, customFrom, customTo]);

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const { data: logs, isLoading } = useQuery({
    queryKey: ['dosing-history', filterPlantId, from, to],
    queryFn: async () => {
      let q = supabase
        .from('chemical_dosing_logs')
        .select('id, plant_id, log_datetime, chlorine_kg, smbs_kg, anti_scalant_l, soda_ash_kg, free_chlorine_reagent_pcs, product_water_free_cl_ppm, calculated_cost, recorded_by, created_at')
        .order('log_datetime', { ascending: false })
        .limit(200);
      if (filterPlantId) q = q.eq('plant_id', filterPlantId);
      if (from) q = q.gte('log_datetime', from);
      if (to)   q = q.lte('log_datetime', to);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const plantName = (id: string) => plants?.find(p => p.id === id)?.name ?? id;

  // ── Prices for cost display ────────────────────────────────────────────────
  const { data: prices } = useQuery({
    queryKey: ['chem-current-prices'],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase.from('chemical_prices').select('*').lte('effective_date', today).order('effective_date', { ascending: false });
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => {
        const fullName = p.chemical_name as string;
        if (!(fullName in map)) map[fullName] = p.unit_price;
        // Prices are stored as "Chemical (unit)" — also index by base name for plain-name lookups
        const baseName = fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(baseName in map)) map[baseName] = p.unit_price;
      });
      return map;
    },
  });

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [editV, setEditV]   = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const startEdit = (row: any) => {
    if (!canEditEntry(row, isManager, activeOperator?.id)) {
      toast.error('You can only edit your own entries, within 8 hours of submitting them.');
      return;
    }
    setEditId(row.id);
    setEditRow(row);
    setEditV({
      log_datetime: row.log_datetime ? format(new Date(row.log_datetime), "yyyy-MM-dd'T'HH:mm") : '',
      chlorine_kg:               String(row.chlorine_kg    ?? ''),
      smbs_kg:                   String(row.smbs_kg        ?? ''),
      anti_scalant_l:            String(row.anti_scalant_l ?? ''),
      soda_ash_kg:               String(row.soda_ash_kg    ?? ''),
      free_chlorine_reagent_pcs: String(row.free_chlorine_reagent_pcs ?? ''),
      product_water_free_cl_ppm: String(row.product_water_free_cl_ppm ?? ''),
    });
  };

  const saveEdit = async () => {
    if (!editId || !editRow) return;
    if (!canEditEntry(editRow, isManager, activeOperator?.id)) {
      toast.error('You no longer have permission to edit this entry.');
      return;
    }
    setSaving(true);
    const num = (k: string) => editV[k] !== '' ? +editV[k] : null;
    const costCalc = DOSING_KEYS.reduce((s, c) => {
      const qty = num(c.key) ?? 0;
      return s + qty * (prices?.[c.name] ?? 0);
    }, 0);
    const payload = {
      log_datetime:               new Date(editV.log_datetime).toISOString(),
      chlorine_kg:                num('chlorine_kg')               ?? 0,
      smbs_kg:                    num('smbs_kg')                   ?? 0,
      anti_scalant_l:             num('anti_scalant_l')            ?? 0,
      soda_ash_kg:                num('soda_ash_kg')               ?? 0,
      free_chlorine_reagent_pcs:  num('free_chlorine_reagent_pcs') ?? 0,
      product_water_free_cl_ppm:  num('product_water_free_cl_ppm'),
      calculated_cost:            +costCalc.toFixed(2),
    };
    const { error } = await supabase.from('chemical_dosing_logs').update(payload).eq('id', editId);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name: 'chemical_dosing_logs',
      record_id: editId,
      plant_id: editRow.plant_id ?? null,
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel,
      changes: diffFields(editRow, payload),
    });

    toast.success('Dosing record updated');
    setEditId(null);
    setEditRow(null);
    qc.invalidateQueries({ queryKey: ['dosing-history'] });
    qc.invalidateQueries({ queryKey: ['chem-stock-computed'] });
  };

  // ── Delete state ───────────────────────────────────────────────────────────
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteRow = async (row: any) => {
    if (!canEditEntry(row, isManager, activeOperator?.id)) {
      toast.error('You can only delete your own entries, within 8 hours of submitting them.');
      return;
    }
    setDeleting(true);
    const { error } = await supabase.from('chemical_dosing_logs').delete().eq('id', row.id);
    setDeleting(false);
    setPendingDeleteId(null);
    if (error) { toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name: 'chemical_dosing_logs',
      record_id: row.id,
      plant_id: row.plant_id ?? null,
      action: 'delete',
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel,
    });

    toast.success('Record deleted');
    qc.invalidateQueries({ queryKey: ['dosing-history'] });
    qc.invalidateQueries({ queryKey: ['chem-stock-computed'] });
  };

  // ── Aggregate totals strip ─────────────────────────────────────────────────
  // `calculated_cost` on old records is 0 (saved before prices were configured).
  // Fall back to live qty × price computation whenever the stored value is zero.
  const totals = useMemo(() => {
    if (!logs?.length) return null;
    return logs.reduce((acc: any, r: any) => {
      const storedCost = +r.calculated_cost || 0;
      const liveCost   = DOSING_KEYS.reduce(
        (s, c) => s + (+r[c.key] || 0) * (prices?.[c.name] ?? 0), 0,
      );
      return {
        chlorine_kg:    acc.chlorine_kg    + (+r.chlorine_kg    || 0),
        smbs_kg:        acc.smbs_kg        + (+r.smbs_kg        || 0),
        anti_scalant_l: acc.anti_scalant_l + (+r.anti_scalant_l || 0),
        soda_ash_kg:    acc.soda_ash_kg    + (+r.soda_ash_kg    || 0),
        cost:           acc.cost           + (storedCost > 0 ? storedCost : liveCost),
      };
    }, { chlorine_kg: 0, smbs_kg: 0, anti_scalant_l: 0, soda_ash_kg: 0, cost: 0 });
  }, [logs, prices]);

  const FIELD_LABELS: { key: string; label: string; unit: string }[] = [
    { key: 'chlorine_kg',               label: 'Chlorine',    unit: 'kg' },
    { key: 'smbs_kg',                   label: 'SMBS',        unit: 'kg' },
    { key: 'anti_scalant_l',            label: 'Anti Scalant',unit: 'L'  },
    { key: 'soda_ash_kg',               label: 'Soda Ash',    unit: 'kg' },
    { key: 'free_chlorine_reagent_pcs', label: 'Free Cl',     unit: 'pcs'},
    { key: 'product_water_free_cl_ppm', label: 'Avg Cl ppm',  unit: 'ppm'},
  ];

  return (
    <div className="space-y-3">

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Card className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <History className="h-4 w-4 text-primary shrink-0" />
          <h4 className="text-sm font-semibold text-foreground">Dosing History</h4>
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            <ExportButton table="chemical_dosing_logs" label="Export" />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {/* Plant filter */}
          <div>
            <Label className="text-xs text-muted-foreground">Plant</Label>
            <Select value={filterPlantId || '__all__'} onValueChange={(v) => setFilterPlantId(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All plants" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All plants</SelectItem>
                {plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {/* Period filter */}
          <div>
            <Label className="text-xs text-muted-foreground">Period</Label>
            <Select value={days} onValueChange={(v: any) => setDays(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Custom date range */}
        {days === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
        )}
      </Card>

      {/* ── Aggregate totals ────────────────────────────────────────────────── */}
      {totals && (
        <div className="rounded-xl bg-primary-soft border border-primary p-3 space-y-1.5">
          <p className="text-2xs font-bold uppercase tracking-wider text-primary">
            Period Totals — {logs?.length ?? 0} record{logs?.length !== 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
            {totals.chlorine_kg > 0 && (
              <div>
                <p className="text-3xs text-muted-foreground uppercase tracking-wide">Chlorine</p>
                <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.chlorine_kg, 2)} kg</p>
              </div>
            )}
            {totals.smbs_kg > 0 && (
              <div>
                <p className="text-3xs text-muted-foreground uppercase tracking-wide">SMBS</p>
                <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.smbs_kg, 2)} kg</p>
              </div>
            )}
            {totals.anti_scalant_l > 0 && (
              <div>
                <p className="text-3xs text-muted-foreground uppercase tracking-wide">Anti Scalant</p>
                <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.anti_scalant_l, 2)} L</p>
              </div>
            )}
            {totals.soda_ash_kg > 0 && (
              <div>
                <p className="text-3xs text-muted-foreground uppercase tracking-wide">Soda Ash</p>
                <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.soda_ash_kg, 2)} kg</p>
              </div>
            )}
            <div>
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Total Cost</p>
              <p className="text-xs font-bold font-mono-num text-primary">₱ {fmtNum(totals.cost, 2)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Log table ───────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading records…
        </div>
      )}

      {!isLoading && !logs?.length && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No dosing records found for this period.
        </Card>
      )}

      {!isLoading && !!logs?.length && (
        <div className="space-y-2">
          {logs.map((row: any) => {
            const isEditing = editId === row.id;
            const isPendingDelete = pendingDeleteId === row.id;
            const rowCost = DOSING_KEYS.reduce((s, c) => s + (+row[c.key] || 0) * (prices?.[c.name] ?? 0), 0);

            return (
              <Card key={row.id} className={cn(
                'p-3 space-y-2 transition-colors',
                isEditing && 'border-primary bg-primary-soft/30',
              )}>
                {/* ── Row header ── */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-0.5">
                    {/* Date & plant */}
                    {isEditing ? (
                      <Input
                        type="datetime-local"
                        value={editV.log_datetime}
                        onChange={e => setEditV({ ...editV, log_datetime: e.target.value })}
                        className="h-7 text-xs w-48"
                      />
                    ) : (
                      <p className="text-xs font-semibold text-foreground font-mono-num">
                        {row.log_datetime ? format(new Date(row.log_datetime), 'MMM dd, yyyy  HH:mm') : '—'}
                      </p>
                    )}
                    <p className="text-2xs text-muted-foreground">{plantName(row.plant_id)}</p>
                  </div>

                  {/* Cost badge + action buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isEditing && (
                      <span className="text-xs font-bold font-mono-num text-primary bg-primary-soft border border-primary rounded px-1.5 py-0.5">
                        ₱ {fmtNum(+row.calculated_cost > 0 ? row.calculated_cost : rowCost, 2)}
                      </span>
                    )}

                    {/* Edit / Save / Cancel */}
                    {canEditEntry(row, isManager, activeOperator?.id) && !isEditing && !isPendingDelete && (
                      <button
                        onClick={() => startEdit(row)}
                        disabled={!!editId || deleting}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                        title="Edit record"
                        aria-label="Edit record"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {isEditing && (
                      <>
                        <Button
                          size="sm"
                          className="h-6 px-2 text-2xs bg-primary text-white hover:bg-primary/90"
                          onClick={saveEdit}
                          disabled={saving}
                        >
                          {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Save'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-2xs"
                          onClick={() => { setEditId(null); setEditRow(null); }}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                      </>
                    )}

                    {/* Delete confirm */}
                    {canEditEntry(row, isManager, activeOperator?.id) && !isEditing && (
                      isPendingDelete ? (
                        <>
                          <button
                            onClick={() => deleteRow(row)}
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
                        </>
                      ) : (
                        <button
                          onClick={() => setPendingDeleteId(row.id)}
                          disabled={!!editId || deleting}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
                          title="Delete record"
                          aria-label="Delete record"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* ── Chemical values grid ── */}
                {isEditing ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-border/40">
                    {FIELD_LABELS.map(({ key, label, unit }) => (
                      <div key={key}>
                        <Label className="text-2xs text-muted-foreground">{label}</Label>
                        <div className="relative">
                          <Input
                            type="number" step="any"
                            value={editV[key] ?? ''}
                            onChange={e => setEditV({ ...editV, [key]: e.target.value })}
                            className="h-7 text-xs pr-7"
                            placeholder="0"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground pointer-events-none">{unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {DOSING_KEYS.map(({ key, name, unit }) => {
                      const val = +row[key] || 0;
                      if (!val) return null;
                      return (
                        <span key={key} className="text-xs text-foreground font-mono-num">
                          <span className="text-muted-foreground">{name}: </span>
                          {fmtNum(val, 2)} {unit}
                        </span>
                      );
                    })}
                    {(+row.free_chlorine_reagent_pcs || 0) > 0 && (
                      <span className="text-xs text-foreground font-mono-num">
                        <span className="text-muted-foreground">Free Cl: </span>
                        {row.free_chlorine_reagent_pcs} pcs
                      </span>
                    )}
                    {row.product_water_free_cl_ppm != null && (
                      <span className="text-xs text-foreground font-mono-num">
                        <span className="text-muted-foreground">Avg ppm: </span>
                        {fmtNum(+row.product_water_free_cl_ppm, 2)}
                      </span>
                    )}
                    {/* Show empty state if no chemicals were entered */}
                    {DOSING_KEYS.every(({ key }) => !+row[key]) && (
                      <span className="text-xs text-muted-foreground italic">No chemicals logged</span>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
