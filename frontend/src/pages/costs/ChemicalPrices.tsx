import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { PLANT_CHEMICALS } from '@/lib/chemicals';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Pencil, Trash2, Check, X, FlaskConical, Layers, Zap, Plus } from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { FILTER_ITEMS, FILTER_UNITS, isFilterPriceEntry } from '@/lib/filterReplacements';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';


// Filter items selectable from the same "Add price" form as chemicals.
// FILTER_ITEMS/FILTER_UNITS/isFilterPriceEntry live in lib/filterReplacements
// (not here) so FilterReplacementDialog can import the exact same labels
// when it looks up / writes back to this same chemical_prices list — see
// that file's getPriceListEntry()/syncPriceToPriceList() — and so this page
// component doesn't export non-component values (breaks fast refresh).

// Prices needs to cover both the closed dosed-chemical set (PLANT_CHEMICALS,
// canonical in @/lib/chemicals — previously re-hardcoded here independently)
// and the CIP-only chemicals, which aren't dosed per-train and so aren't in
// PLANT_CHEMICALS at all (see ROTrains/cip/CIPLog.tsx's built-in CIP list).
const CIP_ONLY_CHEMICALS = ['Free Cl Reagent', 'Caustic Soda', 'HCl', 'SLS'];
const KNOWN_CHEMICALS = [...PLANT_CHEMICALS.map((c) => c.name), ...CIP_ONLY_CHEMICALS];

export function ChemicalPrices() {
  const qc = useQueryClient();
  const { user, isManager, isAdmin } = useAuth();
  const { selectedPlantId } = useAppStore();
  const canEdit = usePermission('costs', 'edit');
  const UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal', '__custom__'];

  // ── Add form state ───────────────────────────────────────────────────────────
  // plant_id/provider are only used when itemCategory === 'power' (power_tariffs
  // is plant-scoped, unlike the global chemical_prices table the rest of this
  // form writes to) — kept in the same state object so the form has one place
  // to reset/reason about.
  const [v, setV] = useState({
    chemical_name: '', custom: '', unit: 'kg', customUnit: '',
    unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd'),
    plant_id: selectedPlantId ?? '', provider: '',
  });

  // Chemical/Filter/Power toggle above the Item dropdown — picked up after
  // feedback that scrolling past 8 chemicals to reach Bag/Cartridge Filter
  // (previously grouped in one long list) wasn't convenient. Now the
  // dropdown only ever lists the ~2–9 items in the selected category, so it
  // never needs to scroll. "Power" isn't an item pick at all — it's wired
  // straight to the same power_tariffs table the Power tab's bill-derived
  // tariffs already live in, so a rate entered here shows up there too.
  const [itemCategory, setItemCategory] = useState<'chemical' | 'filter' | 'power'>('chemical');

  const switchCategory = (cat: 'chemical' | 'filter' | 'power') => {
    if (cat === itemCategory) return;
    setItemCategory(cat);
    setV((prev) => ({
      ...prev,
      chemical_name: '',
      custom: '',
      unit: cat === 'filter' ? 'pcs' : cat === 'power' ? 'kWh' : 'kg',
    }));
  };

  // Picking an item resets the unit to something that actually makes sense
  // for its category — filters are priced per pcs/set, never per kg or L,
  // and vice versa. Keeps whatever the user had picked when it's still valid.
  const handleItemChange = (name: string) => {
    setV((prev) => {
      const filterUnits: readonly string[] = FILTER_UNITS;
      return {
        ...prev,
        chemical_name: name,
        unit: itemCategory === 'filter' ? (filterUnits.includes(prev.unit) ? prev.unit : 'pcs') : (prev.unit === 'set' ? 'kg' : prev.unit),
      };
    });
  };

  // ── Inline edit state ────────────────────────────────────────────────────────
  const [editId, setEditId]     = useState<string | null>(null);
  const [editV, setEditV]       = useState({ chemical_name: '', unit_price: '', effective_date: '' });
  const [saving, setSaving]     = useState(false);

  // ── Delete confirm state ─────────────────────────────────────────────────────
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['chem-prices'],
    queryFn: async () => (await supabase.from('chemical_prices').select('*').order('effective_date', { ascending: false }).limit(50)).data ?? [],
  });

  // Same queryKey shape the Power tab's own tariff history uses (['tariffs', plantId])
  // so a rate saved from either place invalidates/refetches the other's view too.
  const { data: recentTariffs } = useQuery({
    queryKey: ['tariffs', v.plant_id],
    queryFn: async () => v.plant_id ? (await supabase.from('power_tariffs').select('*').eq('plant_id', v.plant_id).order('effective_date', { ascending: false }).limit(5)).data ?? [] : [],
    enabled: itemCategory === 'power' && !!v.plant_id,
  });

  // ── Add new price ────────────────────────────────────────────────────────────
  const submit = async () => {
    if (itemCategory === 'power') {
      if (!v.plant_id) { toast.error('Select a plant'); return; }
      if (!v.unit_price) { toast.error('Rate per kWh is required'); return; }
      const { error } = await supabase.from('power_tariffs').insert({
        plant_id: v.plant_id,
        effective_date: v.effective_date,
        rate_per_kwh: +v.unit_price,
        provider: v.provider.trim() || null,
        remarks: 'Entered from Costs → Prices',
        created_by: user?.id,
      });
      if (error) { toast.error(friendlyError(error)); return; }
      toast.success('Power rate added');
      setV((prev) => ({ ...prev, provider: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') }));
      // Same queryKey the Power tab reads from — its Tariff history card
      // will show this rate next time it's rendered.
      qc.invalidateQueries({ queryKey: ['tariffs', v.plant_id] });
      return;
    }

    const finalName = v.chemical_name === '__custom__' ? v.custom.trim() : v.chemical_name;
    const finalUnit = v.unit === '__custom__' ? v.customUnit.trim() : v.unit;
    if (!finalName || !v.unit_price || !finalUnit) { toast.error('Item, unit and price required'); return; }
    const { error } = await supabase.from('chemical_prices').insert({
      chemical_name: `${finalName} (${finalUnit})`, unit_price: +v.unit_price,
      effective_date: v.effective_date, updated_by: user?.id,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Price record added');
    setV((prev) => ({ ...prev, chemical_name: '', custom: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') }));
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  };

  // ── Inline edit save ─────────────────────────────────────────────────────────
  const saveEdit = async (id: string) => {
    if (!editV.chemical_name || !editV.unit_price) { toast.error('Name and price required'); return; }
    setSaving(true);
    const { error } = await supabase.from('chemical_prices').update({
      chemical_name: editV.chemical_name, unit_price: +editV.unit_price,
      effective_date: editV.effective_date, updated_by: user?.id,
    }).eq('id', id);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Price record updated');
    setEditId(null);
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  };

  // ── Start editing a row ──────────────────────────────────────────────────────
  const startEdit = (p: any) => {
    setDeleteId(null);
    setEditId(p.id);
    setEditV({
      chemical_name: p.chemical_name ?? '',
      unit_price: String(p.unit_price ?? ''),
      effective_date: p.effective_date ?? '',
    });
  };

  const cancelEdit = () => setEditId(null);

  // ── Delete a row ─────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase.from('chemical_prices').delete().eq('id', deleteId);
    setDeleting(false);
    setDeleteId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Price record deleted');
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  };

  return (
    <div className="space-y-3">
      {/* ── Add price form ─────────────────────────────────────────────────── */}
      <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Add Price Record</h4>
            <p className="text-2xs text-muted-foreground">Register unit pricing for chemicals, filter media, or power tariffs</p>
          </div>

          {/* Segmented Category Control */}
          <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-lg border border-border/40" role="tablist" aria-label="Item category">
            <button
              type="button"
              role="tab"
              aria-selected={itemCategory === 'chemical'}
              onClick={() => switchCategory('chemical')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
                itemCategory === 'chemical' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FlaskConical className="h-3 w-3" />
              <span>Chemicals</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={itemCategory === 'filter'}
              onClick={() => switchCategory('filter')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
                itemCategory === 'filter' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Layers className="h-3 w-3" />
              <span>Filters</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={itemCategory === 'power'}
              onClick={() => switchCategory('power')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
                itemCategory === 'power' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Zap className="h-3 w-3" />
              <span>Power</span>
            </button>
          </div>
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
            <Input type="date" className="h-8.5 text-xs" value={v.effective_date} onChange={(e) => setV({ ...v, effective_date: e.target.value })} id="costs-effective-date"/>
          </div>
        </div>

        <div className="flex items-center justify-end pt-1">
          <Button onClick={submit} size="sm" className="h-8.5 px-4 text-xs gap-1.5 font-medium shadow-xs">
            <Plus className="h-3.5 w-3.5" />
            Add Price
          </Button>
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

      {/* ── Price history table ────────────────────────────────────────────── */}
      <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Price History</h4>
            <p className="text-2xs text-muted-foreground">Active and historical cost benchmarks</p>
          </div>
          <ExportButton table="chemical_prices" label="Export" />
        </div>

        {/* Column headers */}
        <div className={`grid gap-2 text-3xs uppercase tracking-wider font-semibold text-muted-foreground pb-2 border-b ${canEdit ? 'grid-cols-[1fr_100px_90px_60px]' : 'grid-cols-[1fr_110px_100px]'}`}>
          <div>Item</div>
          <div className="text-right">Price</div>
          <div className="text-right">Date</div>
          {canEdit && <div className="text-right">Actions</div>}
        </div>

        {/* Rows */}
        {isLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`grid gap-2 items-center py-2 border-b last:border-0 ${canEdit ? 'grid-cols-[1fr_90px_80px_56px]' : 'grid-cols-[1fr_100px_90px]'}`}>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-14 justify-self-end" />
            <Skeleton className="h-3 w-16 justify-self-end" />
            {canEdit && <Skeleton className="h-3 w-10 justify-self-end" />}
          </div>
        ))}
        {data?.map((p: any) => {
          const isEditing = editId === p.id;
          const isPendingDelete = deleteId === p.id;

          // ── Inline edit row ──────────────────────────────────────────────
          if (isEditing) {
            return (
              <div key={p.id} className="py-2 border-b last:border-0 space-y-2">
                <div className="grid grid-cols-[1fr_90px_80px] gap-2 items-start">
                  <Input
                    className="h-7 text-xs"
                    value={editV.chemical_name}
                    onChange={(e) => setEditV({ ...editV, chemical_name: e.target.value })}
                    placeholder="Item name"
                  />
                  <Input
                    className="h-7 text-xs font-mono-num"
                    type="number"
                    step="any"
                    min="0"
                    value={editV.unit_price}
                    onChange={(e) => setEditV({ ...editV, unit_price: e.target.value })}
                    placeholder="Price"
                  />
                  <Input
                    className="h-7 text-xs"
                    type="date"
                    value={editV.effective_date}
                    onChange={(e) => setEditV({ ...editV, effective_date: e.target.value })}
                  />
                </div>
                <div className="flex gap-1.5 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => saveEdit(p.id)}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </Button>
                </div>
              </div>
            );
          }

          // ── Delete confirm row ───────────────────────────────────────────
          if (isPendingDelete) {
            return (
              <div key={p.id} className="py-2 border-b last:border-0">
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-2">
                  <p className="text-xs text-destructive font-medium">
                    Delete <strong>{p.chemical_name}</strong> — ₱{(+p.unit_price).toFixed(2)} ({p.effective_date})?
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-1"
                      onClick={() => setDeleteId(null)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1 gap-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                      onClick={confirmDelete}
                      disabled={deleting}
                    >
                      {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Normal read row ──────────────────────────────────────────────
          const isFilter = isFilterPriceEntry(p.chemical_name);
          return (
            <div key={p.id} className={`grid gap-2 text-xs py-1.5 border-b last:border-0 items-center ${canEdit ? 'grid-cols-[1fr_90px_80px_56px]' : 'grid-cols-[1fr_100px_90px]'}`}>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{p.chemical_name}</span>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-2xs px-1.5 py-0 font-normal ${isFilter ? 'border-warn/50 text-warn bg-warn-soft' : 'border-info/50 text-info bg-info-soft'}`}
                >
                  {isFilter ? 'Filter' : 'Chemical'}
                </Badge>
              </span>
              <span className="font-mono-num font-semibold text-right">₱{(+p.unit_price).toFixed(2)}</span>
              <span className="text-muted-foreground font-mono-num text-right">{p.effective_date}</span>
              {canEdit && (
                <div className="flex gap-1 justify-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    title="Edit"
                    aria-label="Edit"
                    onClick={() => startEdit(p)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    title="Delete"
                    aria-label="Delete"
                    onClick={() => { setEditId(null); setDeleteId(p.id); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {!data?.length && <p className="text-xs text-muted-foreground py-2 text-center">No prices yet</p>}
      </Card>
    </div>
  );
}
