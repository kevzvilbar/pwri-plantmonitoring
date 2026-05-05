import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

import { StatusPill } from '@/components/StatusPill';
import { ExportButton } from '@/components/ExportButton';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';

export default function Costs() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'rollup';
  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Costs</h1>
        <p className="text-sm text-muted-foreground">Production cost, power bills & tariffs, chemical prices</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="grid grid-cols-4 w-full h-auto bg-muted rounded-xl p-1">
          <TabsTrigger value="rollup" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Rollup</TabsTrigger>
          <TabsTrigger value="power" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Power</TabsTrigger>
          <TabsTrigger value="compare" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Compare</TabsTrigger>
          <TabsTrigger value="prices" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Prices</TabsTrigger>
        </TabsList>
        <TabsContent value="rollup" className="mt-3"><Rollup /></TabsContent>
        <TabsContent value="power" className="mt-3"><Power /></TabsContent>
        {/* "tariff" and "bills" tabs removed — both merged into the Power tab */}
        <TabsContent value="compare" className="mt-3"><Compare /></TabsContent>
        <TabsContent value="prices" className="mt-3"><ChemicalPrices /></TabsContent>
      </Tabs>
    </div>
  );
}

function ChemicalPrices() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const KNOWN = ['Chlorine', 'SMBS', 'Anti Scalant', 'Soda Ash', 'Caustic Soda', 'HCl', 'SLS'];
  const UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal', '__custom__'];
  const [v, setV] = useState({ chemical_name: '', custom: '', unit: 'kg', customUnit: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') });
  const { data } = useQuery({
    queryKey: ['chem-prices'],
    queryFn: async () => (await supabase.from('chemical_prices').select('*').order('effective_date', { ascending: false }).limit(50)).data ?? [],
  });
  const submit = async () => {
    const finalName = v.chemical_name === '__custom__' ? v.custom.trim() : v.chemical_name;
    const finalUnit = v.unit === '__custom__' ? v.customUnit.trim() : v.unit;
    if (!finalName || !v.unit_price || !finalUnit) { toast.error('Chemical, unit and price required'); return; }
    const { error } = await supabase.from('chemical_prices').insert({
      chemical_name: `${finalName} (${finalUnit})`, unit_price: +v.unit_price,
      effective_date: v.effective_date, updated_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Price added');
    setV({ chemical_name: '', custom: '', unit: 'kg', customUnit: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') });
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
  };
  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <h4 className="text-sm font-semibold">Add price</h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">Chemical</Label>
            <Select value={v.chemical_name} onValueChange={(x) => setV({ ...v, chemical_name: x })}>
              <SelectTrigger><SelectValue placeholder="Pick chemical" /></SelectTrigger>
              <SelectContent>
                {KNOWN.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                <SelectItem value="__custom__">+ Custom…</SelectItem>
              </SelectContent>
            </Select>
            {v.chemical_name === '__custom__' && (
              <Input className="mt-2" placeholder="Custom name" value={v.custom} onChange={(e) => setV({ ...v, custom: e.target.value })} />
            )}
          </div>
          <div>
            <Label className="text-xs">Unit</Label>
            <Select value={v.unit} onValueChange={(x) => setV({ ...v, unit: x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.filter(u => u !== '__custom__').map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                <SelectItem value="__custom__">+ Custom…</SelectItem>
              </SelectContent>
            </Select>
            {v.unit === '__custom__' && (
              <Input className="mt-2" placeholder="e.g. drum" value={v.customUnit} onChange={(e) => setV({ ...v, customUnit: e.target.value })} />
            )}
          </div>
          <div>
            <Label className="text-xs">Price ₱ / {v.unit === '__custom__' ? (v.customUnit || 'unit') : v.unit}</Label>
            <Input type="number" step="any" value={v.unit_price} onChange={(e) => setV({ ...v, unit_price: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Effective date</Label>
            <Input type="date" value={v.effective_date} onChange={(e) => setV({ ...v, effective_date: e.target.value })} />
          </div>
        </div>
        <Button onClick={submit} className="w-full" size="sm">Add price</Button>
      </Card>
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Price history</h4>
          <ExportButton table="chemical_prices" label="Export" />
        </div>
        <div className="grid grid-cols-[1fr_100px_90px] gap-2 text-[10px] text-muted-foreground pb-1 border-b">
          <div>Chemical</div><div className="text-right">Price</div><div className="text-right">Date</div>
        </div>
        {data?.map((p: any) => (
          <div key={p.id} className="grid grid-cols-[1fr_100px_90px] gap-2 text-xs py-1.5 border-b last:border-0 items-center">
            <span>{p.chemical_name}</span>
            <span className="font-mono-num font-semibold text-right">₱{(+p.unit_price).toFixed(2)}</span>
            <span className="text-muted-foreground font-mono-num text-right">{p.effective_date}</span>
          </div>
        ))}
        {!data?.length && <p className="text-xs text-muted-foreground py-2 text-center">No prices yet</p>}
      </Card>
    </div>
  );
}

function PlantPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>{plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Rollup() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [from, setFrom] = useState(format(subMonths(new Date(), 1), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data, refetch } = useQuery({
    queryKey: ['cost-rollup', plantId, from, to],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase.from('production_costs')
        .select('*').eq('plant_id', plantId)
        .gte('cost_date', from).lte('cost_date', to)
        .order('cost_date');
      return data ?? [];
    },
    enabled: !!plantId,
  });

  const totals = useMemo(() => {
    const r = (data ?? []).reduce((acc: any, x: any) => {
      acc.chem += +x.chem_cost || 0; acc.power += +x.power_cost || 0;
      acc.prod += +x.production_m3 || 0;
      return acc;
    }, { chem: 0, power: 0, prod: 0 });
    return { ...r, total: r.chem + r.power, perM3: r.prod ? (r.chem + r.power) / r.prod : null };
  }, [data]);

  const chartData = (data ?? []).map((d: any) => ({
    date: format(parseISO(d.cost_date), 'MMM d'),
    chem: +d.chem_cost || 0,
    power: +d.power_cost || 0,
    perM3: +d.cost_per_m3 || 0,
  }));

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div><Label className="text-xs">Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="flex-1 min-w-0"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </div>
      </Card>
      {plantId && (
        <>
          <div className="flex justify-end">
            <ExportButton table="production_costs" label="Export rollup" filters={{ plant_id: plantId }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="text-xs text-muted-foreground">Chem cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.chem, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Power cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.power, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Production</div><div className="font-mono-num text-lg">{fmtNum(totals.prod, 0)} m³</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Cost/m³</div><div className="font-mono-num text-lg">{totals.perM3 ? `₱${totals.perM3.toFixed(2)}` : '—'}</div></Card>
          </div>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Daily costs</h4>
            <div className="h-64 sm:h-72">
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="chem" stackId="c" fill="hsl(var(--chart-2))" name="Chem ₱" />
                  <Bar dataKey="power" stackId="c" fill="hsl(var(--chart-1))" name="Power ₱" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <CostInsights rows={data ?? []} totals={totals} from={from} to={to} />
        </>
      )}
      {!plantId && <Card className="p-6 text-center text-sm text-muted-foreground">Select a plant</Card>}
    </div>
  );
}

function CostInsights({ rows, totals, from, to }: { rows: any[]; totals: any; from: string; to: string }) {
  const insights = useMemo(() => {
    const out: { label: string; tone: 'accent' | 'warn' | 'danger' | 'info'; text: string }[] = [];
    if (!rows.length) return out;
    const days = rows.length;
    const avgCost = totals.total / days;
    const peak = rows.reduce((m: any, r: any) => ((+r.chem_cost + +r.power_cost) > (+m.chem_cost + +m.power_cost) ? r : m), rows[0]);
    const peakTotal = (+peak.chem_cost || 0) + (+peak.power_cost || 0);
    const chemShare = totals.total ? (totals.chem / totals.total) * 100 : 0;
    out.push({ label: 'Period', tone: 'info', text: `${days} day(s) · ₱${fmtNum(avgCost, 0)} avg/day · ${chemShare.toFixed(0)}% chem / ${(100 - chemShare).toFixed(0)}% power.` });
    if (avgCost > 0 && peakTotal > avgCost * 1.5) {
      out.push({ label: 'Spike', tone: 'warn', text: `${peak.cost_date}: ₱${fmtNum(peakTotal, 0)} (${((peakTotal / avgCost - 1) * 100).toFixed(0)}% above average). Check for tariff change or chemical top-up.` });
    }
    if (totals.perM3 && totals.perM3 > 25) {
      out.push({ label: 'Cost/m³', tone: 'danger', text: `₱${totals.perM3.toFixed(2)}/m³ exceeds ₱25 benchmark. Review power efficiency or chemical dosing.` });
    } else if (totals.perM3) {
      out.push({ label: 'Cost/m³', tone: 'accent', text: `₱${totals.perM3.toFixed(2)}/m³ within healthy range.` });
    }
    if (totals.prod === 0) {
      out.push({ label: 'No production', tone: 'danger', text: 'Production volume is zero — verify well meter readings are recorded.' });
    }
    return out;
  }, [rows, totals]);

  if (!rows.length) return (
    <Card className="p-4 text-center text-sm text-muted-foreground">No cost data in {from} → {to}</Card>
  );

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Auto insights</h4>
        <span className="text-[10px] text-muted-foreground">Computed monthly · no manual notes needed</span>
      </div>
      <div className="space-y-1.5">
        {insights.map((i, idx) => (
          <div key={`${i.tone ?? 'none'}-${i.label}-${idx}`} className="flex items-start gap-2 text-xs">
            <StatusPill tone={i.tone}>{i.label}</StatusPill>
            <span className="flex-1 pt-0.5">{i.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Power() {
  const qc = useQueryClient();
  const { user, isManager, isAdmin } = useAuth();
  const canEdit = isManager || isAdmin;
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

  // Auto-populate multiplier from last bill when plant changes
  useEffect(() => {
    if (bills && bills.length > 0) {
      const lastBill = bills[0] as any;
      if (lastBill.multiplier && lastBill.multiplier !== 1) {
        setV(prev => ({ ...prev, multiplier: String(lastBill.multiplier) }));
      }
    }
  }, [bills]);

  const handleMultiplierChange = (val: string) => {
    if (!canEdit) return;
    const current = v.multiplier;
    if (val !== current && bills && bills.length > 0) {
      // Has existing bills — require confirmation
      setPendingMultiplier(val);
      setConfirmOpen(true);
    } else {
      setV({ ...v, multiplier: val });
    }
  };

  const submit = async () => {
    if (!plantId || !v.total_amount) { toast.error('Plant and total required'); return; }
    if (totalKwh !== null && totalKwh < 0) { toast.error('Current reading is less than previous — check meter values'); return; }
    const billRes = await supabase.from('electric_bills').insert({
      plant_id: plantId, billing_month: v.billing_month,
      period_start: v.period_start, period_end: v.period_end,
      previous_reading: +v.previous_reading || 0, current_reading: +v.current_reading || 0,
      multiplier: +v.multiplier || 1, total_kwh: totalKwh ?? 0,
      generation_charge: v.generation_charge ? +v.generation_charge : null,
      distribution_charge: v.distribution_charge ? +v.distribution_charge : null,
      other_charges: v.other_charges ? +v.other_charges : null,
      total_amount: +v.total_amount, remarks: v.remarks || null, recorded_by: user?.id,
    });
    if (billRes.error) { toast.error(billRes.error.message); return; }
    if (derivedRate) {
      await supabase.from('power_tariffs').insert({
        plant_id: plantId, effective_date: v.period_start,
        rate_per_kwh: derivedRate, multiplier: +v.multiplier || 1,
        provider: v.provider || null,
        remarks: `Derived from bill ${format(parseISO(v.billing_month), 'MMM yyyy')}`,
        created_by: user?.id,
      });
    }
    toast.success(derivedRate ? 'Bill saved · tariff auto-derived' : 'Bill saved');
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['tariffs'] });
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div><Label className="text-xs">Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Billing</div>
          <div className="grid grid-cols-2 gap-2">
            {/* Billing Month — dropdown instead of date picker */}
            <div>
              <Label className="text-xs">Billing month</Label>
              <Select value={v.billing_month} onValueChange={(val) => setV({ ...v, billing_month: val })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Provider</Label><Input value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} placeholder="VECO / NGCP" /></div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0"><Label className="text-xs">Period from</Label><Input type="date" value={v.period_start} onChange={(e) => setV({ ...v, period_start: e.target.value })} /></div>
            <div className="flex-1 min-w-0"><Label className="text-xs">Period to</Label><Input type="date" value={v.period_end} onChange={(e) => setV({ ...v, period_end: e.target.value })} /></div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Meter</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Previous</Label><Input type="number" step="any" value={v.previous_reading} onChange={(e) => setV({ ...v, previous_reading: e.target.value })} /></div>
            <div><Label className="text-xs">Current</Label><Input type="number" step="any" value={v.current_reading} onChange={(e) => setV({ ...v, current_reading: e.target.value })} /></div>
          </div>
          {/* Multiplier + Total kWh on same row */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs flex items-center gap-1">
                Multiplier
                {!canEdit && <span className="text-[10px] text-muted-foreground">(read-only)</span>}
              </Label>
              <Input
                type="number" step="any" value={v.multiplier}
                readOnly={!canEdit}
                className={!canEdit ? 'bg-muted cursor-not-allowed' : ''}
                onChange={(e) => handleMultiplierChange(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Total kWh (auto)</Label>
              <Input value={totalKwh != null ? fmtNum(totalKwh, 2) : ''} readOnly className="bg-muted" />
            </div>
          </div>
          {canEdit && (
            <p className="text-[10px] text-muted-foreground">
              Multiplier auto-fills from the last saved bill. Change only if the meter transformer ratio changes.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Charges (₱)</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Generation</Label><Input type="number" step="any" value={v.generation_charge} onChange={(e) => setV({ ...v, generation_charge: e.target.value })} /></div>
            <div><Label className="text-xs">Distribution</Label><Input type="number" step="any" value={v.distribution_charge} onChange={(e) => setV({ ...v, distribution_charge: e.target.value })} /></div>
            <div><Label className="text-xs">Other</Label><Input type="number" step="any" value={v.other_charges} onChange={(e) => setV({ ...v, other_charges: e.target.value })} /></div>
            <div><Label className="text-xs font-semibold">Total</Label><Input type="number" step="any" value={v.total_amount} onChange={(e) => setV({ ...v, total_amount: e.target.value })} /></div>
          </div>
        </div>

        {derivedRate && (
          <div className="rounded-md bg-accent-soft border border-accent/30 p-2 text-xs">
            <span className="font-semibold">Auto-derived tariff:</span>{' '}
            <span className="font-mono-num">₱{derivedRate.toFixed(4)}/kWh</span>
            <span className="text-muted-foreground"> · effective {v.period_start}</span>
          </div>
        )}

        <div><Label className="text-xs">Remarks</Label><Input value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} /></div>
        <Button onClick={submit} className="w-full">Save bill {derivedRate ? '+ tariff' : ''}</Button>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Recent bills</h4>
          {plantId && <ExportButton table="electric_bills" label="Export" filters={{ plant_id: plantId }} />}
        </div>
        <div className="space-y-1.5">
          {bills?.map((b: any) => (
            <div key={b.id} className="flex justify-between items-center text-xs border-b last:border-0 py-1.5">
              <div>
                <div className="font-mono-num">{format(parseISO(b.billing_month), 'MMM yyyy')}</div>
                <div className="text-muted-foreground font-mono-num">{fmtNum(b.total_kwh, 0)} kWh · ₱{b.total_kwh && +b.total_kwh > 0 ? (+b.total_amount / +b.total_kwh).toFixed(4) : '—'}/kWh · ×{b.multiplier}</div>
              </div>
              <div className="font-mono-num font-semibold">₱{fmtNum(b.total_amount, 2)}</div>
            </div>
          ))}
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
function Compare() {
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');

  const { data: bills } = useQuery({
    queryKey: ['bills-cmp', plantId],
    queryFn: async () => plantId ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false }).limit(6)).data ?? [] : [],
    enabled: !!plantId,
  });

  const { data: dailyKwh } = useQuery({
    queryKey: ['daily-kwh-cmp', plantId, bills?.length],
    queryFn: async () => {
      if (!plantId || !bills?.length) return [];
      const earliest = bills[bills.length - 1].period_start ?? '';
      const latest = bills[0].period_end ?? '';
      if (!earliest || !latest) return [];
      // Also select multiplier so we can compute effective kWh = daily_consumption × multiplier
      const { data } = await supabase.from('power_readings')
        .select('reading_datetime,daily_consumption_kwh,multiplier')
        .eq('plant_id', plantId)
        .gte('reading_datetime', earliest)
        .lte('reading_datetime', `${latest}T23:59:59.999Z`);
      return data ?? [];
    },
    enabled: !!plantId && !!bills?.length,
  });

  const rows = (bills ?? []).map((b: any) => {
    const periodReadings = (dailyKwh ?? [])
      .filter((d: any) => d.reading_datetime >= b.period_start && d.reading_datetime <= `${b.period_end}T23:59:59.999Z`);
    const sumDaily = periodReadings.reduce((s: number, d: any) => s + (+d.daily_consumption_kwh || 0), 0);
    // Effective kWh = Σ(daily_consumption × multiplier) — reflects CT ratio applied to each day
    const sumEffective = periodReadings.reduce((s: number, d: any) => {
      const mult = d.multiplier != null ? +d.multiplier : (b.multiplier ? +b.multiplier : 1);
      return s + (+d.daily_consumption_kwh || 0) * mult;
    }, 0);
    const variance = b.total_kwh ? ((sumEffective - +b.total_kwh) / +b.total_kwh) * 100 : null;
    return { ...b, sumDaily, sumEffective, variance };
  });

  const chartData = rows.slice().reverse().map((r: any) => ({
    month: format(parseISO(r.billing_month), 'MMM yy'),
    billed: +r.total_kwh || 0,
    daily: r.sumDaily || 0,
    effective: r.sumEffective || 0,
  }));

  return (
    <div className="space-y-3">
      <Card className="p-3"><div><Label>Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div></Card>
      {plantId && rows.length > 0 && (
        <>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Billed vs Daily Sum</h4>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="billed" fill="hsl(var(--chart-1))" name="Billed kWh" />
                  <Bar dataKey="daily" fill="hsl(var(--chart-2))" name="Sum daily kWh" />
                  <Bar dataKey="effective" fill="hsl(var(--chart-3))" name="Eff. kWh (×mult)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Variance table</h4>
            <div className="space-y-1.5">
              {rows.map((r: any) => (
                <div key={r.id} className="grid grid-cols-5 gap-2 text-xs border-b last:border-0 py-1.5 items-center">
                  <div className="font-mono-num">{format(parseISO(r.billing_month), 'MMM yy')}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.total_kwh, 0)}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.sumDaily, 0)}</div>
                  {/* Effective kWh = daily_consumption × multiplier — what actually gets billed */}
                  <div className="font-mono-num text-right text-amber-700 dark:text-amber-400">
                    {fmtNum(r.sumEffective, 0)}
                  </div>
                  <div className="text-right">
                    {r.variance != null && (
                      <StatusPill tone={Math.abs(r.variance) > 15 ? 'danger' : Math.abs(r.variance) > 5 ? 'warn' : 'accent'}>
                        {r.variance > 0 ? '+' : ''}{r.variance.toFixed(1)}%
                      </StatusPill>
                    )}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-5 gap-2 text-[10px] text-muted-foreground pt-1">
                <div>Month</div><div className="text-right">Billed kWh</div><div className="text-right">Daily Σ</div>
                <div className="text-right text-amber-600">Eff. kWh×</div><div className="text-right">Δ%</div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Eff. kWh× = Σ(daily reading × CT multiplier). Variance compares effective kWh to billed.
              </p>
            </div>
          </Card>
        </>
      )}
      {plantId && !rows.length && <Card className="p-6 text-center text-sm text-muted-foreground">No bills entered yet</Card>}
    </div>
  );
}
