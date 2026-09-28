import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { KNOWN_CHEMICALS, CHEM_UNITS } from '@/features/ro-trains';
import { useChemCatalog } from '../dosing/useChemCatalog';
import { ChemPlantPick } from '../dosing/ChemPlantPick';
import { fmtNum } from '@/lib/calculations';

export function AddStockDialog() {
  const qc = useQueryClient();
  const { activeOperator } = useAuth();
  const [open, setOpen] = useState(false);
  const [plantId, setPlantId] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [customName, setCustomName] = useState('');
  const [unit, setUnit] = useState('kg');
  const [customUnit, setCustomUnit] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [remarks, setRemarks] = useState('');

  // Catalog items
  const { data: catData } = useChemCatalog(plantId || null);
  const catalog = catData?.catalog ?? [];
  const allUnits = catData?.units ?? [];

  const selectedProduct = useMemo(() => {
    return catalog.find((c) => c.id === catalogId);
  }, [catalog, catalogId]);

  const productUnits = useMemo(() => {
    if (!catalogId) return [];
    return allUnits.filter((u) => u.catalog_id === catalogId);
  }, [allUnits, catalogId]);

  // Determine factor to base
  const factorToBase = useMemo(() => {
    if (unit === selectedProduct?.base_unit) return 1;
    const found = productUnits.find((u) => u.unit_label === unit);
    if (found) return found.factor_to_base;
    if (unit === 'Carboy (20 L)') return 20;
    if (unit === 'Drum (200 L)') return 200;
    if (unit === 'IBC (1000 L)') return 1000;
    if (unit === 'Bag (25 kg)') return 25;
    if (unit === 'Drum (50 kg)') return 50;
    return 1;
  }, [unit, selectedProduct, productUnits]);

  const qtyBase = useMemo(() => {
    const q = +qty || 0;
    return +(q * factorToBase).toFixed(4);
  }, [qty, factorToBase]);

  const submit = async () => {
    const finalName = catalogId === '__custom__' ? customName.trim() : (selectedProduct?.name || '');
    const finalUnit = unit === '__custom__' ? customUnit.trim() : unit;
    if (!plantId || !finalName || !qty || !finalUnit) {
      toast.error('Plant, chemical, unit and quantity required');
      return;
    }

    const { error } = await supabase.from('chemical_deliveries').insert({
      plant_id: plantId,
      catalog_id: catalogId === '__custom__' ? null : catalogId,
      chemical_name: finalName,
      quantity: +qty,
      unit: finalUnit,
      qty_base: qtyBase,
      unit_cost: unitCost ? +unitCost : null,
      supplier: supplier || null,
      delivery_date: date,
      remarks: remarks || null,
      recorded_by: activeOperator?.id || null,
    } as any);

    if (error) {
      toast.error(friendlyError(error));
      return;
    }

    const { data: existing } = await supabase
      .from('chemical_inventory')
      .select('id')
      .eq('plant_id', plantId)
      .eq('chemical_name', finalName)
      .maybeSingle();

    if (!existing) {
      await supabase.from('chemical_inventory').insert({
        plant_id: plantId,
        chemical_name: finalName,
        unit: selectedProduct?.base_unit || finalUnit,
        current_stock: 0,
        low_stock_threshold: 10,
      });
    }

    toast.success('Stock received');
    setOpen(false);
    setCatalogId('');
    setCustomName('');
    setQty('');
    setUnitCost('');
    setSupplier('');
    setRemarks('');
    setCustomUnit('');
    qc.invalidateQueries({ queryKey: ['chem-stock-computed'] });
    qc.invalidateQueries({ queryKey: ['chem-stock-rpc'] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">+ Add stock</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Receive chemical delivery</DialogTitle></DialogHeader>
        <div className="space-y-2.5 text-xs">
          <div>
            <Label htmlFor="addstockdialog-plant">Plant</Label>
            <ChemPlantPick value={plantId} onChange={setPlantId} id="addstockdialog-plant" />
          </div>

          <div>
            <Label htmlFor="addstockdialog-chemical">Chemical Product / Form</Label>
            <Select
              value={catalogId}
              onValueChange={(v) => {
                setCatalogId(v);
                const p = catalog.find((x) => x.id === v);
                if (p) {
                  setUnit(p.base_unit);
                }
              }}
            >
              <SelectTrigger id="addstockdialog-chemical" className="mt-1">
                <SelectValue placeholder="Pick chemical product" />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {c.form ? `(${c.form})` : ''}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">+ Custom Chemical…</SelectItem>
              </SelectContent>
            </Select>

            {catalogId === '__custom__' && (
              <Input
                className="mt-2"
                placeholder="Custom chemical name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="addstockdialog-quantity" className="text-xs">Quantity</Label>
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                id="addstockdialog-quantity"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="addstockdialog-unit" className="text-xs">Package / Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="addstockdialog-unit" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedProduct ? (
                    <>
                      <SelectItem value={selectedProduct.base_unit}>
                        {selectedProduct.base_unit} (Base)
                      </SelectItem>
                      {selectedProduct.base_unit === 'L' ? (
                        <>
                          <SelectItem value="Carboy (20 L)">Carboy (20 L)</SelectItem>
                          <SelectItem value="Drum (200 L)">Drum (200 L)</SelectItem>
                          <SelectItem value="IBC (1000 L)">IBC Tote (1,000 L)</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="Bag (25 kg)">Bag (25 kg)</SelectItem>
                          <SelectItem value="Drum (50 kg)">Drum (50 kg)</SelectItem>
                        </>
                      )}
                      {productUnits.map((u) => (
                        <SelectItem key={u.id} value={u.unit_label}>
                          {u.unit_label} ({u.factor_to_base} {selectedProduct.base_unit})
                        </SelectItem>
                      ))}
                    </>
                  ) : (
                    CHEM_UNITS.filter((u) => u !== '__custom__').map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))
                  )}
                  <SelectItem value="__custom__">+ Custom Unit…</SelectItem>
                </SelectContent>
              </Select>
              {unit === '__custom__' && (
                <Input
                  className="mt-2"
                  placeholder="e.g. drum"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                />
              )}
            </div>
          </div>

          {+qty > 0 && selectedProduct && factorToBase !== 1 && (
            <div className="p-2 rounded bg-muted text-3xs font-mono text-muted-foreground">
              Converted Base Qty: <span className="font-semibold text-foreground">{fmtNum(qtyBase, 2)} {selectedProduct.base_unit}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="addstockdialog-unit-cost" className="text-xs">Unit Cost (₱)</Label>
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="Optional actual cost"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                id="addstockdialog-unit-cost"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="addstockdialog-supplier" className="text-xs">Supplier</Label>
              <Input
                placeholder="e.g. Chemcorp"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                id="addstockdialog-supplier"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="addstockdialog-delivery-date" className="text-xs">Delivery date</Label>
            <DatePicker
              id="addstockdialog-delivery-date"
              value={date}
              onChange={(d) => setDate(d)}
              className="w-full mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="addstockdialog-remarks" className="text-xs">Remarks</Label>
            <Input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              id="addstockdialog-remarks"
              className="mt-1"
            />
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
