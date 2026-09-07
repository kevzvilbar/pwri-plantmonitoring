import { PLANT_CHEMICALS } from '@/lib/chemicals';
import { FILTER_ITEMS, FILTER_UNITS } from '@/lib/filterReplacements';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { CategoryToggle } from './CategoryToggle';

const CIP_ONLY_CHEMICALS = ['Free Cl Reagent', 'Caustic Soda', 'HCl', 'SLS'];
const KNOWN_CHEMICALS = [...PLANT_CHEMICALS.map((c) => c.name), ...CIP_ONLY_CHEMICALS];

const UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal', '__custom__'] as const;

interface PriceFormProps {
  itemCategory: 'chemical' | 'filter' | 'power';
  switchCategory: (cat: 'chemical' | 'filter' | 'power') => void;
  handleItemChange: (name: string) => void;
  v: {
    chemical_name: string;
    custom: string;
    unit: string;
    customUnit: string;
    unit_price: string;
    effective_date: string;
    plant_id: string;
    provider: string;
  };
  setV: (updater: any) => void;
  onSubmit: () => void;
  recentTariffs: any[] | undefined;
}

export function PriceForm({ itemCategory, switchCategory, handleItemChange, v, setV, onSubmit, recentTariffs }: PriceFormProps) {
  return (
    <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Add Price Record</h4>
          <p className="text-2xs text-muted-foreground">Register unit pricing for chemicals, filter media, or power tariffs</p>
        </div>
        <CategoryToggle itemCategory={itemCategory} setItemCategory={switchCategory} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
        <div className="sm:col-span-4 space-y-1">
          <Label className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            {itemCategory === 'power' ? 'Facility' : 'Item Name'}
          </Label>
          {itemCategory === 'power' ? (
            <PlantPicker value={v.plant_id} onChange={(id) => setV({ ...v, plant_id: id })} />
          ) : (
            <>
              <Select value={v.chemical_name} onValueChange={handleItemChange}>
                <SelectTrigger className="h-8.5 text-xs bg-background">
                  <SelectValue placeholder={itemCategory === 'filter' ? 'Pick filter' : 'Pick chemical'} />
                </SelectTrigger>
                <SelectContent>
                  {itemCategory === 'chemical'
                    ? <>
                        {KNOWN_CHEMICALS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        <SelectItem value="__custom__">+ Custom…</SelectItem>
                      </>
                    : FILTER_ITEMS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)
                  }
                </SelectContent>
              </Select>
              {v.chemical_name === '__custom__' && (
                <Input className="mt-1.5 h-8.5 text-xs" placeholder="Custom item name" value={v.custom} onChange={(e) => setV({ ...v, custom: e.target.value })} />
              )}
            </>
          )}
        </div>

        <div className="sm:col-span-3 space-y-1">
          <Label htmlFor="costs-field" className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            {itemCategory === 'power' ? 'Provider (optional)' : 'Unit'}
          </Label>
          {itemCategory === 'power' ? (
            <Input placeholder="VECO / NGCP" className="h-8.5 text-xs" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} id="costs-field"/>
          ) : (
            <>
              <Select value={v.unit} onValueChange={(x) => setV({ ...v, unit: x })}>
                <SelectTrigger className="h-8.5 text-xs bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {itemCategory === 'filter'
                    ? FILTER_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)
                    : <>
                        {UNITS.filter(u => u !== '__custom__').map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        <SelectItem value="__custom__">+ Custom…</SelectItem>
                      </>
                  }
                </SelectContent>
              </Select>
              {v.unit === '__custom__' && itemCategory === 'chemical' && (
                <Input className="mt-1.5 h-8.5 text-xs" placeholder="e.g. drum" value={v.customUnit} onChange={(e) => setV({ ...v, customUnit: e.target.value })} />
              )}
            </>
          )}
        </div>

        <div className="sm:col-span-2 space-y-1">
          <Label htmlFor="costs-price" className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            Price ₱ / {itemCategory === 'power' ? 'kWh' : (v.unit === '__custom__' ? (v.customUnit || 'unit') : v.unit)}
          </Label>
          <Input type="number" step="any" className="h-8.5 text-xs font-mono-num" placeholder="0.00" value={v.unit_price} onChange={(e) => setV({ ...v, unit_price: e.target.value })} id="costs-price"/>
        </div>

        <div className="sm:col-span-3 space-y-1">
          <Label htmlFor="costs-effective-date" className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            Effective Date
          </Label>
          <DatePicker
            id="costs-effective-date"
            value={v.effective_date}
            onChange={(d) => setV({ ...v, effective_date: d })}
            className="h-8.5 text-xs w-full"
          />
        </div>
      </div>

      <div className="flex items-center justify-end pt-1">
        <button onClick={onSubmit} className="inline-flex items-center gap-1.5 h-8.5 px-4 text-xs gap-1.5 font-medium shadow-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-md">
          Add Price
        </button>
      </div>

      {itemCategory === 'power' && v.plant_id && (
        <div className="pt-2 border-t border-border/40">
          <div className="text-3xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Recent rates for this plant</div>
          <div className="space-y-1">
            {recentTariffs?.map((t: any) => (
              <div key={t.id} className="flex justify-between items-center text-xs py-1 px-2 rounded bg-muted/30">
                <span className="text-muted-foreground">{t.effective_date}{t.provider ? ` · ${t.provider}` : ''}</span>
                <span className="font-mono-num font-semibold">₱{(+t.rate_per_kwh).toFixed(4)}/kWh</span>
              </div>
            ))}
            {!recentTariffs?.length && <p className="text-xs text-center text-muted-foreground py-1">No rates on file yet for this plant</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
