import { useState, useEffect } from 'react';
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
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, calc } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';

const CHEMICALS = [
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
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="dosing">Dosing</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="prices">Prices</TabsTrigger>
        </TabsList>
        <TabsContent value="dosing" className="mt-3"><DosingForm /></TabsContent>
        <TabsContent value="inventory" className="mt-3"><Inventory /></TabsContent>
        <TabsContent value="prices" className="mt-3"><Prices /></TabsContent>
      </Tabs>
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
  const [v, setV] = useState({ chlorine_kg: '', smbs_kg: '', anti_scalant_l: '', soda_ash_kg: '', free_chlorine_reagent_pcs: '', product_water_free_cl_ppm: '' });

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

  const cost = CHEMICALS.reduce((s, c) => {
    const qty = +(v as any)[c.key] || 0;
    const price = prices?.[c.name] ?? 0;
    return s + qty * price;
  }, 0);

  const submit = async () => {
    if (!plantId) return;
    const payload: any = {
      plant_id: plantId, log_datetime: new Date(dt).toISOString(),
      chlorine_kg: +v.chlorine_kg || 0, smbs_kg: +v.smbs_kg || 0,
      anti_scalant_l: +v.anti_scalant_l || 0, soda_ash_kg: +v.soda_ash_kg || 0,
      free_chlorine_reagent_pcs: +v.free_chlorine_reagent_pcs || 0,
      product_water_free_cl_ppm: v.product_water_free_cl_ppm ? +v.product_water_free_cl_ppm : null,
      calculated_cost: +cost.toFixed(2), recorded_by: user?.id,
    };
    const { error } = await supabase.from('chemical_dosing_logs').insert(payload);
    if (error) { toast.error(error.message); return; }
    // Decrement inventory
    for (const c of CHEMICALS) {
      const qty = +(v as any)[c.key] || 0;
      if (qty > 0) {
        const { data: inv } = await supabase.from('chemical_inventory').select('*').eq('plant_id', plantId).eq('chemical_name', c.name).maybeSingle();
        if (inv) await supabase.from('chemical_inventory').update({ current_stock: Math.max(0, inv.current_stock - qty) }).eq('id', inv.id);
      }
    }
    toast.success('Dosing logged');
    setV({ chlorine_kg: '', smbs_kg: '', anti_scalant_l: '', soda_ash_kg: '', free_chlorine_reagent_pcs: '', product_water_free_cl_ppm: '' });
    qc.invalidateQueries();
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Plant</Label><PlantPick value={plantId} onChange={setPlantId} /></div>
        <div><Label>Date & time</Label><Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {CHEMICALS.map(c => (
          <div key={c.key}>
            <Label className="text-xs">{c.name} ({c.unit})</Label>
            <Input type="number" step="any" value={(v as any)[c.key]} onChange={e => setV({ ...v, [c.key]: e.target.value })} />
          </div>
        ))}
        <div><Label className="text-xs">Free Cl reagent (pcs)</Label><Input type="number" value={v.free_chlorine_reagent_pcs} onChange={e => setV({ ...v, free_chlorine_reagent_pcs: e.target.value })} /></div>
        <div><Label className="text-xs">Product Free Cl (ppm)</Label><Input type="number" step="any" value={v.product_water_free_cl_ppm} onChange={e => setV({ ...v, product_water_free_cl_ppm: e.target.value })} /></div>
      </div>
      <div className="bg-accent-soft p-2 rounded text-sm flex justify-between">
        <span>Calculated cost</span><span className="font-mono-num font-semibold text-accent">₱ {fmtNum(cost, 2)}</span>
      </div>
      <Button onClick={submit} className="w-full">Save dosing</Button>
    </Card>
  );
}

function Inventory() {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const ids = selectedPlantId ? [selectedPlantId] : plants?.map(p => p.id) ?? [];
  const { data } = useQuery({
    queryKey: ['inventory', ids],
    queryFn: async () => ids.length ? (await supabase.from('chemical_inventory').select('*,plants(name)').in('plant_id', ids)).data ?? [] : [],
    enabled: ids.length > 0,
  });
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-2">
      {isManager && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>+ Add stock</Button>}
      {data?.map((c: any) => {
        const ratio = c.low_stock_threshold ? (c.current_stock / (c.low_stock_threshold * 4)) * 100 : 0;
        const tone = ratio < 20 ? 'danger' : ratio < 40 ? 'warn' : 'accent';
        return (
          <Card key={c.id} className="p-3">
            <div className="flex justify-between text-sm">
              <div><div className="font-medium">{c.chemical_name}</div><div className="text-xs text-muted-foreground">{c.plants?.name}</div></div>
              <div className="text-right">
                <div className="font-mono-num">{c.current_stock} {c.unit}</div>
                {c.current_stock < c.low_stock_threshold && <StatusPill tone="danger">Low stock</StatusPill>}
              </div>
            </div>
            <Progress value={Math.min(100, ratio)} className="mt-2 h-1.5" />
          </Card>
        );
      })}
      {!data?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No inventory</Card>}
      {adding && <AddInventory onClose={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['inventory'] }); }} />}
    </div>
  );
}

function AddInventory({ onClose }: { onClose: () => void }) {
  const [plantId, setPlantId] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('kg');
  const [stock, setStock] = useState('');
  const [threshold, setThreshold] = useState('10');
  const submit = async () => {
    if (!plantId || !name) return;
    const { error } = await supabase.from('chemical_inventory').upsert({
      plant_id: plantId, chemical_name: name, unit, current_stock: +stock || 0, low_stock_threshold: +threshold || 10,
    }, { onConflict: 'plant_id,chemical_name' });
    if (error) { toast.error(error.message); return; }
    toast.success('Saved'); onClose();
  };
  return (
    <Card className="p-3 space-y-2">
      <PlantPick value={plantId} onChange={setPlantId} />
      <Input placeholder="Chemical name" value={name} onChange={e => setName(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <Input placeholder="Unit" value={unit} onChange={e => setUnit(e.target.value)} />
        <Input type="number" placeholder="Stock" value={stock} onChange={e => setStock(e.target.value)} />
        <Input type="number" placeholder="Threshold" value={threshold} onChange={e => setThreshold(e.target.value)} />
      </div>
      <div className="flex gap-2"><Button onClick={submit} className="flex-1">Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
    </Card>
  );
}

function Prices() {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [v, setV] = useState({ chemical_name: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') });
  const { data } = useQuery({
    queryKey: ['chem-prices'],
    queryFn: async () => (await supabase.from('chemical_prices').select('*').order('effective_date', { ascending: false }).limit(50)).data ?? [],
  });
  const submit = async () => {
    if (!v.chemical_name || !v.unit_price) return;
    const { error } = await supabase.from('chemical_prices').insert({
      chemical_name: v.chemical_name, unit_price: +v.unit_price, effective_date: v.effective_date,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Price added'); setV({ chemical_name: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') });
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
  };
  return (
    <div className="space-y-3">
      {isManager && (
        <Card className="p-3 space-y-2">
          <h4 className="text-sm font-semibold">Add price</h4>
          <Input placeholder="Chemical name" value={v.chemical_name} onChange={e => setV({ ...v, chemical_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="any" placeholder="Price" value={v.unit_price} onChange={e => setV({ ...v, unit_price: e.target.value })} />
            <Input type="date" value={v.effective_date} onChange={e => setV({ ...v, effective_date: e.target.value })} />
          </div>
          <Button onClick={submit} className="w-full">Add</Button>
        </Card>
      )}
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Price history</h4>
        {data?.map((p: any) => (
          <div key={p.id} className="flex justify-between text-xs py-1.5 border-t">
            <span>{p.chemical_name}</span>
            <span className="text-muted-foreground">{p.effective_date}</span>
            <span className="font-mono-num font-semibold">₱{p.unit_price}</span>
          </div>
        ))}
        {!data?.length && <p className="text-xs text-muted-foreground">No prices yet</p>}
      </Card>
    </div>
  );
}
