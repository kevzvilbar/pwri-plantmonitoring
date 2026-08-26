import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { KNOWN_CHEMICALS, CHEM_UNITS } from '../../ro-trains';

import { ChemPlantPick } from '../dosing/ChemPlantPick';

export function AddStockDialog() {
  const qc = useQueryClient();
  // ── Use activeOperator, not user — same shared-email fix
  const { activeOperator } = useAuth();
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
      supplier: supplier || null, delivery_date: date, remarks: remarks || null, recorded_by: activeOperator?.id,
    });
    if (error) { toast.error(friendlyError(error)); return; }
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
          <div><Label htmlFor="addstockdialog-plant">Plant</Label><ChemPlantPick value={plantId} onChange={setPlantId} id="addstockdialog-plant" /></div>
          <div>
            <Label htmlFor="addstockdialog-chemical">Chemical</Label>
            <Select value={name} onValueChange={(v) => { setName(v); const k = KNOWN_CHEMICALS.find((x) => x.name === v); if (k) setUnit(k.defaultUnit); }}>
              <SelectTrigger id="addstockdialog-chemical"><SelectValue placeholder="Pick chemical" /></SelectTrigger>
              <SelectContent>
                {KNOWN_CHEMICALS.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                <SelectItem value="__custom__">+ Custom…</SelectItem>
              </SelectContent>
            </Select>
            {name === '__custom__' && (
              <Input className="mt-2" placeholder="Custom chemical name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="addstockdialog-quantity" className="text-xs">Quantity</Label>
              <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} id="addstockdialog-quantity"/>
            </div>
            <div>
              <Label htmlFor="addstockdialog-unit" className="text-xs">Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="addstockdialog-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHEM_UNITS.filter(u => u !== '__custom__').map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  <SelectItem value="__custom__">+ Custom…</SelectItem>
                </SelectContent>
              </Select>
              {unit === '__custom__' && (
                <Input className="mt-2" placeholder="e.g. drum" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="addstockdialog-supplier" className="text-xs">Supplier</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} id="addstockdialog-supplier"/></div>
            <div><Label htmlFor="addstockdialog-delivery-date" className="text-xs">Delivery date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} id="addstockdialog-delivery-date"/></div>
          </div>
          <div><Label htmlFor="addstockdialog-remarks" className="text-xs">Remarks</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} id="addstockdialog-remarks"/></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>Save delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
