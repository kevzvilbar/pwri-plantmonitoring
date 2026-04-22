import { useState, useEffect, useMemo } from 'react';
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
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { StatusPill } from '@/components/StatusPill';
import { ComputedInput } from '@/components/ComputedInput';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';

const KNOWN_CHEMICALS = [
  { name: 'Chlorine', defaultUnit: 'kg' },
  { name: 'SMBS', defaultUnit: 'kg' },
  { name: 'Anti Scalant', defaultUnit: 'L' },
  { name: 'Soda Ash', defaultUnit: 'kg' },
  { name: 'Caustic Soda', defaultUnit: 'kg' },
  { name: 'HCl', defaultUnit: 'L' },
  { name: 'SLS', defaultUnit: 'g' },
];
const UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal', '__custom__'];

const DOSING_KEYS = [
  { key: 'chlorine_kg', name: 'Chlorine', unit: 'kg' },
  { key: 'smbs_kg', name: 'SMBS', unit: 'kg' },
  { key: 'anti_scalant_l', name: 'Anti Scalant', unit: 'L' },
  { key: 'soda_ash_kg', name: 'Soda Ash', unit: 'kg' },
];

export default function Chemicals() {
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Chemicals</h1>
      <Tabs defaultValue="dosing">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="dosing">Dosing</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>
        <TabsContent value="dosing" className="mt-3"><DosingForm /></TabsContent>
        <TabsContent value="inventory" className="mt-3"><Inventory /></TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground text-center">
        Chemical Prices moved to <a href="/costs" className="underline text-accent">Costs</a>.
      </p>
    </div>
  );
}

function PlantPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  useEffect(() => { if (selectedPlantId && !value) onChange(selectedPlantId); }, [selectedPlantId]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Plant" /></SelectTrigger>
      <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function DosingForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [v, setV] = useState({
    chlorine_kg: '', smbs_kg: '', anti_scalant_l: '', soda_ash_kg: '',
    free_chlorine_reagent_pcs: '0',
  });
  const [samples, setSamples] = useState<Array<{ point: string; ppm: string }>>([]);

  // Sync sample rows with reagent count
  useEffect(() => {
    const n = Math.max(0, Math.min(20, +v.free_chlorine_reagent_pcs || 0));
    setSamples((prev) => {
      const next = [...prev];
      while (next.length < n) next.push({ point: '', ppm: '' });
      while (next.length > n) next.pop();
      return next;
    });
  }, [v.free_chlorine_reagent_pcs]);

  const { data: prices } = useQuery({
    queryKey: ['chem-current-prices'],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase.from('chemical_prices').select('*').lte('effective_date', today).order('effective_date', { ascending: false });
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => { if (!(p.chemical_name in map)) map[p.chemical_name] = p.unit_price; });
      return map;
    },
  });

  const cost = DOSING_KEYS.reduce((s, c) => {
    const qty = +(v as any)[c.key] || 0;
    const price = prices?.[c.name] ?? 0;
    return s + qty * price;
  }, 0);

  const submit = async () => {
    if (!plantId) { toast.error('Select plant'); return; }
    // Average residual for the legacy column
    const validResiduals = samples.filter((s) => s.ppm !== '').map((s) => +s.ppm);
    const avgResidual = validResiduals.length ? validResiduals.reduce((a, b) => a + b, 0) / validResiduals.length : null;

    const { data: inserted, error } = await supabase.from('chemical_dosing_logs').insert({
      plant_id: plantId, log_datetime: new Date(dt).toISOString(),
      chlorine_kg: +v.chlorine_kg || 0, smbs_kg: +v.smbs_kg || 0,
      anti_scalant_l: +v.anti_scalant_l || 0, soda_ash_kg: +v.soda_ash_kg || 0,
      free_chlorine_reagent_pcs: +v.free_chlorine_reagent_pcs || 0,
      product_water_free_cl_ppm: avgResidual,
      calculated_cost: +cost.toFixed(2), recorded_by: user?.id,
    }).select('id').single();
    if (error || !inserted) { toast.error(error?.message ?? 'Save failed'); return; }

    if (samples.length > 0) {
      const sampleRows = samples.map((s, i) => ({
        dosing_log_id: inserted.id, plant_id: plantId, sample_index: i + 1,
        sampling_point: s.point || null, residual_ppm: s.ppm ? +s.ppm : null,
      }));
      await supabase.from('chemical_residual_samples').insert(sampleRows);
    }

    toast.success('Dosing logged');
    setV({ chlorine_kg: '', smbs_kg: '', anti_scalant_l: '', soda_ash_kg: '', free_chlorine_reagent_pcs: '0' });
    setSamples([]);
    qc.invalidateQueries();
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Plant</Label><PlantPick value={plantId} onChange={setPlantId} /></div>
        <div><Label>Date & time</Label><Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DOSING_KEYS.map(c => (
          <div key={c.key}>
            <Label className="text-xs">{c.name} ({c.unit})</Label>
            <Input type="number" step="any" value={(v as any)[c.key]} onChange={e => setV({ ...v, [c.key]: e.target.value })} />
          </div>
        ))}
        <div>
          <Label className="text-xs">Free Cl Reagent (pcs)</Label>
          <Input type="number" min="0" max="20" value={v.free_chlorine_reagent_pcs}
            onChange={e => setV({ ...v, free_chlorine_reagent_pcs: e.target.value })} />
        </div>
      </div>

      {samples.length > 0 && (
        <div className="space-y-2 pt-2 border-t">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Product Cl Residual samples</h4>
          {samples.map((s, i) => (
            <div key={i} className="grid grid-cols-[24px_1fr_100px] gap-2 items-end">
              <div className="text-xs font-mono-num pt-2">#{i + 1}</div>
              <div>
                <Label className="text-xs">Sampling point</Label>
                <Input value={s.point} placeholder="e.g. Tank outlet"
                  onChange={(e) => setSamples(samples.map((x, j) => j === i ? { ...x, point: e.target.value } : x))} />
              </div>
              <div>
                <Label className="text-xs">ppm</Label>
                <Input type="number" step="any" value={s.ppm}
                  onChange={(e) => setSamples(samples.map((x, j) => j === i ? { ...x, ppm: e.target.value } : x))} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-accent-soft p-2 rounded text-sm flex justify-between">
        <span>Calculated cost</span>
        <span className="font-mono-num font-semibold text-accent">₱ {fmtNum(cost, 2)}</span>
      </div>
      <Button onClick={submit} className="w-full">Save dosing</Button>
    </Card>
  );
}

function Inventory() {
  const { isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const ids = selectedPlantId ? [selectedPlantId] : plants?.map(p => p.id) ?? [];

  // Compute stock = sum(deliveries) − sum(dosing) per plant+chemical
  const { data: stockRows } = useQuery({
    queryKey: ['chem-stock-computed', ids],
    queryFn: async () => {
      if (!ids.length) return [];
      const [{ data: deliveries }, { data: dosing }, { data: plantsData }] = await Promise.all([
        supabase.from('chemical_deliveries').select('plant_id,chemical_name,quantity,unit').in('plant_id', ids),
        supabase.from('chemical_dosing_logs').select('plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg').in('plant_id', ids),
        supabase.from('plants').select('id,name').in('id', ids),
      ]);
      const plantName = new Map((plantsData ?? []).map((p: any) => [p.id, p.name]));
      const map = new Map<string, { plant_id: string; plant_name: string; chemical_name: string; unit: string; received: number; used: number }>();
      const key = (p: string, c: string) => `${p}::${c}`;

      (deliveries ?? []).forEach((d: any) => {
        const k = key(d.plant_id, d.chemical_name);
        const cur = map.get(k) ?? { plant_id: d.plant_id, plant_name: plantName.get(d.plant_id) ?? '', chemical_name: d.chemical_name, unit: d.unit, received: 0, used: 0 };
        cur.received += +d.quantity || 0;
        map.set(k, cur);
      });
      const dosingMap: Array<[string, string, number]> = [
        ['Chlorine', 'kg', 0], ['SMBS', 'kg', 0], ['Anti Scalant', 'L', 0], ['Soda Ash', 'kg', 0],
      ];
      const dosingKeyMap: Record<string, keyof any> = {
        'Chlorine': 'chlorine_kg', 'SMBS': 'smbs_kg', 'Anti Scalant': 'anti_scalant_l', 'Soda Ash': 'soda_ash_kg',
      };
      (dosing ?? []).forEach((row: any) => {
        for (const [name, unit] of dosingMap.map(([n, u]) => [n, u] as [string, string])) {
          const usedQty = +row[dosingKeyMap[name]] || 0;
          if (!usedQty) continue;
          const k = key(row.plant_id, name);
          const cur = map.get(k) ?? { plant_id: row.plant_id, plant_name: plantName.get(row.plant_id) ?? '', chemical_name: name, unit, received: 0, used: 0 };
          cur.used += usedQty;
          map.set(k, cur);
        }
      });
      return Array.from(map.values()).map((r) => ({ ...r, current: r.received - r.used }));
    },
    enabled: ids.length > 0,
  });

  // Low stock thresholds from chemical_inventory
  const { data: thresholds } = useQuery({
    queryKey: ['chem-thresholds', ids],
    queryFn: async () => ids.length
      ? (await supabase.from('chemical_inventory').select('plant_id,chemical_name,low_stock_threshold').in('plant_id', ids)).data ?? []
      : [],
    enabled: ids.length > 0,
  });
  const thresholdMap = useMemo(() => {
    const m = new Map<string, number>();
    (thresholds ?? []).forEach((t: any) => m.set(`${t.plant_id}::${t.chemical_name}`, +t.low_stock_threshold || 0));
    return m;
  }, [thresholds]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Stock = Deliveries − Dosing usage</p>
        {isManager && <AddStockDialog />}
      </div>
      {stockRows?.map((c) => {
        const threshold = thresholdMap.get(`${c.plant_id}::${c.chemical_name}`) ?? 10;
        const ratio = threshold ? (c.current / (threshold * 4)) * 100 : 0;
        return (
          <Card key={`${c.plant_id}::${c.chemical_name}`} className="p-3">
            <div className="flex justify-between text-sm">
              <div>
                <div className="font-medium">{c.chemical_name}</div>
                <div className="text-xs text-muted-foreground">{c.plant_name}</div>
                <div className="text-[10px] text-muted-foreground font-mono-num">
                  +{fmtNum(c.received, 1)} / -{fmtNum(c.used, 1)} {c.unit}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono-num text-base">{fmtNum(c.current, 1)} {c.unit}</div>
                {c.current < threshold && <StatusPill tone="danger">Low stock</StatusPill>}
              </div>
            </div>
            <Progress value={Math.max(0, Math.min(100, ratio))} className="mt-2 h-1.5" />
          </Card>
        );
      })}
      {!stockRows?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No stock yet — log a delivery to begin tracking.</Card>}
    </div>
  );
}

function AddStockDialog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [plantId, setPlantId] = useState('');
  const [name, setName] = useState('');
  const [customName, setCustomName] = useState('');
  const [unit, setUnit] = useState('kg');
  const [customUnit, setCustomUnit] = useState('');
  const [qty, setQty] = useState('');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [remarks, setRemarks] = useState('');

  const submit = async () => {
    const finalName = name === '__custom__' ? customName.trim() : name;
    const finalUnit = unit === '__custom__' ? customUnit.trim() : unit;
    if (!plantId || !finalName || !qty || !finalUnit) { toast.error('Plant, chemical, unit and quantity required'); return; }
    const { error } = await supabase.from('chemical_deliveries').insert({
      plant_id: plantId, chemical_name: finalName, quantity: +qty, unit: finalUnit,
      supplier: supplier || null,
      delivery_date: date, remarks: remarks || null, recorded_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }

    // Ensure inventory threshold row exists
    const { data: existing } = await supabase.from('chemical_inventory')
      .select('id').eq('plant_id', plantId).eq('chemical_name', finalName).maybeSingle();
    if (!existing) {
      await supabase.from('chemical_inventory').insert({
        plant_id: plantId, chemical_name: finalName, unit: finalUnit, current_stock: 0, low_stock_threshold: 10,
      });
    }

    toast.success('Stock received'); setOpen(false);
    setName(''); setCustomName(''); setQty(''); setSupplier(''); setRemarks(''); setCustomUnit('');
    qc.invalidateQueries({ queryKey: ['chem-stock-computed'] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">+ Add stock</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Receive chemical delivery</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Plant</Label><PlantPick value={plantId} onChange={setPlantId} /></div>
          <div>
            <Label>Chemical</Label>
            <Select value={name} onValueChange={(v) => { setName(v); const k = KNOWN_CHEMICALS.find((x) => x.name === v); if (k) setUnit(k.defaultUnit); }}>
              <SelectTrigger><SelectValue placeholder="Pick chemical" /></SelectTrigger>
              <SelectContent>
                {KNOWN_CHEMICALS.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                <SelectItem value="__custom__">+ Custom…</SelectItem>
              </SelectContent>
            </Select>
            {name === '__custom__' && (
              <Input className="mt-2" placeholder="Custom chemical name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Quantity</Label>
              <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Unit cost ₱</Label>
              <Input type="number" step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Supplier</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
            <div><Label className="text-xs">Delivery date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Remarks</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
          <div className="bg-accent-soft p-2 rounded text-xs flex justify-between">
            <span>Total value</span>
            <ComputedInput className="w-32 h-7 text-right" value={qty && unitCost ? `₱ ${fmtNum(+qty * +unitCost, 2)}` : ''} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>Save delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
