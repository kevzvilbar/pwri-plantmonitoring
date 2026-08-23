import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ComputedInput } from '@/components/ComputedInput';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';
import { resolveBillingDuplicate } from './importHelpers';
import { ImportReadingsDialog } from './ImportReadingsDialog';

// ─── Power Billing CSV config ─────────────────────────────────────────────────

const BILLING_SCHEMA = 'billing_month* (YYYY-MM-DD), period_start, period_end, previous_reading, current_reading, multiplier, generation_charge, distribution_charge, other_charges, total_amount*, remarks';

const BILLING_TEMPLATE_ROW: Record<string, string> = {
  billing_month: '2026-05-01',
  period_start: '2026-04-01',
  period_end: '2026-04-30',
  previous_reading: '12000',
  current_reading: '12950',
  multiplier: '120',
  generation_charge: '15000',
  distribution_charge: '8000',
  other_charges: '2000',
  total_amount: '25000',
  remarks: '',
};

function validateBillingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.billing_month?.trim()) e.push(`Row ${i}: billing_month is required`);
  else if (isNaN(Date.parse(r.billing_month))) e.push(`Row ${i}: billing_month must be a valid date (YYYY-MM-DD)`);
  if (!r.total_amount?.trim() || isNaN(Number(r.total_amount)) || Number(r.total_amount) < 0)
    e.push(`Row ${i}: total_amount is required and must be a non-negative number`);
  if (r.period_start && isNaN(Date.parse(r.period_start))) e.push(`Row ${i}: period_start is not a valid date`);
  if (r.period_end   && isNaN(Date.parse(r.period_end)))   e.push(`Row ${i}: period_end is not a valid date`);
  if (r.previous_reading    && isNaN(Number(r.previous_reading)))    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.current_reading     && isNaN(Number(r.current_reading)))     e.push(`Row ${i}: current_reading must be a number`);
  // Guard against reversed meter readings — the DB GENERATED column total_kwh =
  // (current - previous) × multiplier would be negative, corrupting production_costs.
  if (
    r.previous_reading?.trim() && r.current_reading?.trim() &&
    !isNaN(Number(r.previous_reading)) && !isNaN(Number(r.current_reading)) &&
    Number(r.current_reading) < Number(r.previous_reading)
  ) {
    e.push(`Row ${i}: current_reading (${r.current_reading}) is less than previous_reading (${r.previous_reading}) — readings appear reversed, which produces negative kWh and corrupts power costs`);
  }
  if (r.multiplier          && isNaN(Number(r.multiplier)))          e.push(`Row ${i}: multiplier must be a number`);
  if (r.generation_charge   && isNaN(Number(r.generation_charge)))   e.push(`Row ${i}: generation_charge must be a number`);
  if (r.distribution_charge && isNaN(Number(r.distribution_charge))) e.push(`Row ${i}: distribution_charge must be a number`);
  if (r.other_charges       && isNaN(Number(r.other_charges)))       e.push(`Row ${i}: other_charges must be a number`);
  return e;
}

// Normalise any parseable date string to YYYY-MM-DD (local date, no timezone shift).
// Handles M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD, and ISO strings.
function normDate(val: string | undefined): string | null {
  if (!val?.trim()) return null;
  const s = val.trim();
  // Already YYYY-MM-DD — return as-is to avoid any UTC shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Format in local time so M/D/YYYY dates don't shift by a day
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// PERFORMANCE FIX: the previous version did one duplicate-check SELECT per CSV
// row, sequentially awaited — up to N round-trips for an N-row (N-month)
// billing file. This version batches the duplicate check into a single query
// and bulk-inserts new rows in chunks, following the same pattern applied to
// the well/locator/power importers.
const BILLING_INSERT_CHUNK_SIZE = 200;

async function insertBillingRows(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  // ── Pass 1: normalise dates + build payloads up front, skipping invalid rows ──
  type Prepared = { billingMonth: string; payload: Record<string, any> };
  const prepared: Prepared[] = [];
  for (const r of rows) {
    // Normalise billing_month → first-of-month YYYY-MM-DD regardless of input format
    const parsedBillingDate = normDate(r.billing_month);
    if (!parsedBillingDate) { errors.push(`billing_month invalid: "${r.billing_month}"`); continue; }
    const billingMonth = parsedBillingDate.slice(0, 7) + '-01'; // always first of month

    // Normalise all other date fields
    const periodStart = normDate(r.period_start);
    const periodEnd   = normDate(r.period_end);

    const payload: Record<string, any> = {
      plant_id: plantId,
      billing_month: billingMonth,
      period_start:        periodStart,
      period_end:          periodEnd,
      previous_reading:    r.previous_reading    !== '' && r.previous_reading    != null ? +r.previous_reading    : null,
      current_reading:     r.current_reading     !== '' && r.current_reading     != null ? +r.current_reading     : null,
      multiplier:          r.multiplier          !== '' && r.multiplier          != null ? +r.multiplier          : 1,
      generation_charge:   r.generation_charge   !== '' && r.generation_charge   != null ? +r.generation_charge   : null,
      distribution_charge: r.distribution_charge !== '' && r.distribution_charge != null ? +r.distribution_charge : null,
      other_charges:       r.other_charges       !== '' && r.other_charges       != null ? +r.other_charges       : null,
      total_amount:        +r.total_amount,
      remarks:             r.remarks             || 'Imported',
      recorded_by:         userId,
    };

    // Safety net: if both readings are present and current < previous, the DB
    // GENERATED column total_kwh would be negative, poisoning production_costs.
    // Reject the row here even if it somehow passed validateBillingRow.
    if (payload.previous_reading != null && payload.current_reading != null &&
        payload.current_reading < payload.previous_reading) {
      errors.push(`${billingMonth}: current_reading (${payload.current_reading}) < previous_reading (${payload.previous_reading}) — row skipped to prevent negative kWh`);
      continue;
    }

    prepared.push({ billingMonth, payload });
  }
  if (prepared.length === 0) return { count, errors };

  // ── Pass 2: ONE batched query for every existing bill that could collide,
  // instead of one SELECT per row. ──
  const { data: existingBills } = await supabase
    .from('electric_bills')
    .select('id, billing_month')
    .eq('plant_id', plantId)
    .in('billing_month', Array.from(new Set(prepared.map(p => p.billingMonth))));
  const existingByMonth = new Map<string, string>(); // billing_month -> bill id
  (existingBills ?? []).forEach((row: any) => existingByMonth.set(row.billing_month, row.id));

  // ── Pass 3: split into duplicates (need the interactive prompt + individual
  // UPDATE) vs new rows (safe to bulk-insert). ──
  const toInsert: Record<string, any>[] = [];
  for (const { billingMonth, payload } of prepared) {
    const existingId = existingByMonth.get(billingMonth);
    if (existingId) {
      const label = `Bill @ ${billingMonth.slice(0, 7)}`;
      const decision = await resolveBillingDuplicate(`${plantId}|${billingMonth}`, label, true);
      if (decision === 'skip') continue;
      const { error } = await supabase.from('electric_bills').update(payload as any).eq('id', existingId);
      if (error) errors.push(`${billingMonth}: ${error.message}`); else count++;
      continue;
    }
    toInsert.push(payload);
  }

  // ── Pass 4: bulk-insert new rows in chunks instead of one INSERT per row.
  // A chunk that fails falls back to per-row inserts so one bad row in an
  // otherwise-good batch doesn't discard the rest of that chunk. ──
  for (let i = 0; i < toInsert.length; i += BILLING_INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + BILLING_INSERT_CHUNK_SIZE);
    const { error: chunkError } = await supabase.from('electric_bills').insert(chunk as any);
    if (!chunkError) { count += chunk.length; continue; }
    for (const payload of chunk) {
      const { error } = await supabase.from('electric_bills').insert(payload as any);
      if (error) errors.push(`${payload.billing_month}: ${error.message}`);
      else count++;
    }
  }

  return { count, errors };
}

// ─── Filters tab wrapper ──────────────────────────────────────────────────

export function Power() {
  const qc = useQueryClient();
  const { user, isManager, isAdmin } = useAuth();
  const canEdit = usePermission('costs', 'edit');
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');

  // Month dropdown: generate last 24 months + next 2
  const monthOptions = useMemo(() => {
    const opts = [];
    for (let i = -2; i <= 23; i++) {
      const d = subMonths(startOfMonth(new Date()), i);
      opts.push({ value: format(d, 'yyyy-MM-dd'), label: format(d, 'MMMM yyyy') });
    }
    return opts.reverse();
  }, []);

  const [v, setV] = useState({
    billing_month: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    period_start: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    period_end: format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    previous_reading: '', current_reading: '', multiplier: '1',
    generation_charge: '', distribution_charge: '', other_charges: '', total_amount: '',
    provider: '', remarks: '',
  });

  // Multiplier confirmation dialog state
  const [pendingMultiplier, setPendingMultiplier] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Track whether auto-populate from useEffect is running so we skip the confirm dialog
  const skipConfirmRef = { current: false };

  const totalKwh = v.previous_reading && v.current_reading
    ? (+v.current_reading - +v.previous_reading) * (+v.multiplier || 1) : null;
  const derivedRate = totalKwh && totalKwh > 0 && +v.total_amount ? (+v.total_amount / totalKwh) : null;

  const { data: bills } = useQuery({
    queryKey: ['bills', plantId],
    queryFn: async () => plantId ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false })).data ?? [] : [],
    enabled: !!plantId,
  });
  const { data: tariffs } = useQuery({
    queryKey: ['tariffs', plantId],
    queryFn: async () => plantId ? (await supabase.from('power_tariffs').select('*').eq('plant_id', plantId).order('effective_date', { ascending: false })).data ?? [] : [],
    enabled: !!plantId,
  });

  // Auto-populate multiplier from last bill — skip confirm dialog during init
  useEffect(() => {
    if (bills && bills.length > 0) {
      const lastBill = bills[0] as any;
      if (lastBill.multiplier && lastBill.multiplier !== 1) {
        skipConfirmRef.current = true;
        setV(prev => ({ ...prev, multiplier: String(lastBill.multiplier) }));
      }
    }
  }, [bills]);

  const handleMultiplierChange = (val: string) => {
    if (!canEdit) return;
    if (skipConfirmRef.current) { skipConfirmRef.current = false; return; }
    const current = v.multiplier;
    if (val !== current && bills && bills.length > 0) {
      setPendingMultiplier(val);
      setConfirmOpen(true);
    } else {
      setV({ ...v, multiplier: val });
    }
  };

  const submit = async () => {
    if (!plantId) { toast.error('Select a plant first'); return; }
    if (!v.total_amount) { toast.error('Total amount is required'); return; }
    if (totalKwh !== null && totalKwh < 0) { toast.error('Current reading is less than previous — check meter values'); return; }

    // Build payload — omit total_kwh entirely: it is a GENERATED column in the DB
    // and Supabase will throw "cannot insert a non-DEFAULT value" if we supply it.
    // The DB computes it as (current_reading - previous_reading) * multiplier automatically.
    const payload: Record<string, any> = {
      plant_id: plantId,
      billing_month: v.billing_month,
      period_start: v.period_start || null,
      period_end: v.period_end || null,
      previous_reading: v.previous_reading ? +v.previous_reading : null,
      current_reading: v.current_reading ? +v.current_reading : null,
      multiplier: +v.multiplier || 1,
      generation_charge: v.generation_charge ? +v.generation_charge : null,
      distribution_charge: v.distribution_charge ? +v.distribution_charge : null,
      other_charges: v.other_charges ? +v.other_charges : null,
      total_amount: +v.total_amount,
      remarks: v.remarks || null,
      recorded_by: user?.id,
    };

    const billRes = await supabase.from('electric_bills').insert(payload as any);
    if (billRes.error) { toast.error(friendlyError(billRes.error)); return; }

    if (derivedRate) {
      await supabase.from('power_tariffs').insert({
        plant_id: plantId, effective_date: v.period_start || v.billing_month,
        rate_per_kwh: derivedRate, multiplier: +v.multiplier || 1,
        provider: v.provider || null,
        remarks: `Derived from bill ${format(parseISO(v.billing_month), 'MMM yyyy')}`,
        created_by: user?.id,
      });
    }
    toast.success(derivedRate ? 'Bill saved · tariff auto-derived' : 'Bill saved');
    // Reset meter reading fields but keep plant/month context for quick re-entry
    setV(prev => ({ ...prev, previous_reading: '', current_reading: '', total_amount: '', generation_charge: '', distribution_charge: '', other_charges: '', remarks: '' }));
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['tariffs'] });
  };

  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="space-y-3">
      {importOpen && (
        <ImportReadingsDialog
          title="Import Power Billing from CSV"
          module="power_billing"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={BILLING_SCHEMA}
          templateFilename="power_billing_template.csv"
          templateRow={BILLING_TEMPLATE_ROW}
          validateRow={validateBillingRow}
          insertRows={(rows, pid) => insertBillingRows(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            qc.invalidateQueries({ queryKey: ['bills'] });
            qc.invalidateQueries({ queryKey: ['tariffs'] });
          }}
        />
      )}

      <Card className="p-3 space-y-3">
        <div>
          <Label htmlFor="costs-plant-3" className="text-xs">Plant</Label>
          <div className="flex gap-2 items-center">
            <div className="flex-1"><PlantPicker value={plantId} onChange={setPlantId} id="costs-plant-3" /></div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 h-9 text-xs whitespace-nowrap"
              onClick={() => { if (!plantId) { toast.error('Select a plant first'); return; } setImportOpen(true); }}
            >
              Import
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Billing</div>
          <div className="grid grid-cols-2 gap-2">
            {/* Billing Month — dropdown instead of date picker */}
            <div>
              <Label htmlFor="costs-billing-month" className="text-xs">Billing month</Label>
              <Select value={v.billing_month} onValueChange={(val) => setV({ ...v, billing_month: val })}>
                <SelectTrigger className="h-9 text-sm" id="costs-billing-month"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="costs-provider" className="text-xs">Provider</Label><Input value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} placeholder="VECO / NGCP" id="costs-provider"/></div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0"><Label htmlFor="costs-period-from" className="text-xs">Period from</Label><Input type="date" value={v.period_start} onChange={(e) => setV({ ...v, period_start: e.target.value })} id="costs-period-from"/></div>
            <div className="flex-1 min-w-0"><Label htmlFor="costs-period-to" className="text-xs">Period to</Label><Input type="date" value={v.period_end} onChange={(e) => setV({ ...v, period_end: e.target.value })} id="costs-period-to"/></div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Meter</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="costs-previous" className="text-xs">Previous</Label><Input type="number" step="any" value={v.previous_reading} onChange={(e) => setV({ ...v, previous_reading: e.target.value })} id="costs-previous"/></div>
            <div><Label htmlFor="costs-current" className="text-xs">Current</Label><Input type="number" step="any" value={v.current_reading} onChange={(e) => setV({ ...v, current_reading: e.target.value })} id="costs-current"/></div>
          </div>
          {/* Multiplier + Total kWh on same row */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="costs-multiplier" className="text-xs flex items-center gap-1">
                Multiplier
                {!canEdit && <span className="text-2xs text-muted-foreground">(read-only)</span>}
              </Label>
              <Input
                type="number" step="any" value={v.multiplier}
                readOnly={!canEdit}
                className={!canEdit ? 'bg-muted cursor-not-allowed' : ''}
                onChange={(e) => handleMultiplierChange(e.target.value)}
              id="costs-multiplier"/>
            </div>
            <div className="flex-1">
              <Label htmlFor="costs-total-kwh-auto" className="text-xs">Total kWh (auto)</Label>
              <ComputedInput value={totalKwh != null ? fmtNum(totalKwh, 2) : ''} id="costs-total-kwh-auto"/>
            </div>
          </div>
          {canEdit && (
            <p className="text-2xs text-muted-foreground">
              Multiplier auto-fills from the last saved bill. Change only if the meter transformer ratio changes.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Charges (₱)</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="costs-generation" className="text-xs">Generation</Label><Input type="number" step="any" value={v.generation_charge} onChange={(e) => setV({ ...v, generation_charge: e.target.value })} id="costs-generation"/></div>
            <div><Label htmlFor="costs-distribution" className="text-xs">Distribution</Label><Input type="number" step="any" value={v.distribution_charge} onChange={(e) => setV({ ...v, distribution_charge: e.target.value })} id="costs-distribution"/></div>
            <div><Label htmlFor="costs-other" className="text-xs">Other</Label><Input type="number" step="any" value={v.other_charges} onChange={(e) => setV({ ...v, other_charges: e.target.value })} id="costs-other"/></div>
            <div><Label htmlFor="costs-total" className="text-xs font-semibold">Total</Label><Input type="number" step="any" value={v.total_amount} onChange={(e) => setV({ ...v, total_amount: e.target.value })} id="costs-total"/></div>
          </div>
        </div>

        {derivedRate && (
          <div className="rounded-md bg-accent-soft border border-accent/30 p-2 text-xs">
            <span className="font-semibold">Auto-derived tariff:</span>{' '}
            <span className="font-mono-num">₱{derivedRate.toFixed(4)}/kWh</span>
            <span className="text-muted-foreground"> · effective {v.period_start}</span>
          </div>
        )}

        <div><Label htmlFor="costs-remarks" className="text-xs">Remarks</Label><Input value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} id="costs-remarks"/></div>
        <Button onClick={submit} className="w-full">Save bill {derivedRate ? '+ tariff' : ''}</Button>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Recent bills</h4>
          {plantId && <ExportButton table="electric_bills" label="Export" filters={{ plant_id: plantId }} />}
        </div>
        <div className="space-y-1.5">
          {bills?.map((b: any) => {
            const isNegativeKwh = b.total_kwh != null && +b.total_kwh < 0;
            return (
              <div key={b.id} className={`flex justify-between items-center text-xs border-b last:border-0 py-1.5 ${isNegativeKwh ? 'bg-destructive/5 rounded px-1.5' : ''}`}>
                <div>
                  <div className="font-mono-num flex items-center gap-1.5">
                    {b.billing_month ? format(parseISO(b.billing_month), 'MMM yyyy') : '—'}
                    {isNegativeKwh && (
                      <span className="inline-flex items-center gap-0.5 text-2xs font-semibold text-destructive border border-destructive/40 rounded px-1 py-0.5">
                        <AlertTriangle className="h-2.5 w-2.5" /> Reversed readings
                      </span>
                    )}
                  </div>
                  <div className={`font-mono-num ${isNegativeKwh ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                    {fmtNum(b.total_kwh, 0)} kWh · ₱{b.total_kwh && +b.total_kwh > 0 ? (+b.total_amount / +b.total_kwh).toFixed(4) : '—'}/kWh · ×{b.multiplier}
                  </div>
                </div>
                <div className="font-mono-num font-semibold">₱{fmtNum(b.total_amount, 2)}</div>
              </div>
            );
          })}
          {!bills?.length && plantId && <p className="text-xs text-center text-muted-foreground py-2">No bills yet</p>}
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Tariff history</h4>
          {plantId && <ExportButton table="power_tariffs" label="Export" filters={{ plant_id: plantId }} />}
        </div>
        <div className="space-y-1.5">
          {tariffs?.map((t: any) => (
            <div key={t.id} className="flex justify-between items-center text-xs border-b last:border-0 py-1.5">
              <div>
                <div className="font-mono-num">{t.effective_date}</div>
                <div className="text-muted-foreground">{t.provider ?? '—'} · ×{t.multiplier}</div>
              </div>
              <div className="font-mono-num font-semibold">₱{(+t.rate_per_kwh).toFixed(4)}/kWh</div>
            </div>
          ))}
          {!tariffs?.length && plantId && <p className="text-xs text-center text-muted-foreground py-2">No tariffs</p>}
        </div>
      </Card>

      {/* Multiplier change confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Multiplier?</AlertDialogTitle>
            <AlertDialogDescription>
              The multiplier is changing from <strong>×{v.multiplier}</strong> to <strong>×{pendingMultiplier}</strong>.
              This should only be done if the CT/PT transformer ratio on the meter has physically changed.
              All future kWh calculations for this plant will use the new value.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingMultiplier(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingMultiplier !== null) setV(prev => ({ ...prev, multiplier: pendingMultiplier }));
                setPendingMultiplier(null);
                setConfirmOpen(false);
              }}
            >
              Yes, change multiplier
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
