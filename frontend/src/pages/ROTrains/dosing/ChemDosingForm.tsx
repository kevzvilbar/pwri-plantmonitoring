import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { usePlantMeterConfig } from '../../plants/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-picker';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { Upload } from 'lucide-react';
import { KNOWN_CHEMICALS, DOSING_KEYS } from '../../ro-trains';

import { ChemCard } from './ChemCard';
import { ChemPlantPick } from './ChemPlantPick';
import { DosingMobileSummary } from './DosingMobileSummary';
import { ImportDosingDialog } from './ImportDosingDialog';

export function ChemDosingForm() {
  const qc = useQueryClient();
  // ── Use activeOperator, not user — same shared-email fix as PretreatmentAndROLog
  const { activeOperator } = useAuth();
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [v, setV] = useState({
    chlorine_kg: '', smbs_kg: '', anti_scalant_l: '', soda_ash_kg: '',
    free_chlorine_reagent_pcs: '0',
  });
  const [samples, setSamples] = useState<Array<{ id: string; point: string; ppm: string }>>([]);
  const [showImport, setShowImport] = useState(false);

  // ── Load per-plant chemical config — filters which chemicals are shown ──────
  // Pass selectedPlantId as a fallback so usePlantMeterConfig always receives a
  // non-null value on the first render (before ChemPlantPick's auto-select effect
  // fires). Without this, the null → real-ID transition causes React error #300
  // if usePlantMeterConfig has conditional hook logic keyed on the null check.
  const { config: plantConfig } = usePlantMeterConfig(plantId || selectedPlantId || null);
  // empty enabled_chemicals = all chemicals visible (backwards compat with existing plants)
  const enabledChemicals: string[] = plantConfig.enabled_chemicals ?? [];
  const isChemEnabled = (name: string) =>
    enabledChemicals.length === 0 || enabledChemicals.includes(name);

  useEffect(() => {
    const n = Math.max(0, Math.min(20, +v.free_chlorine_reagent_pcs || 0));
    setSamples((prev) => {
      const next = [...prev];
      while (next.length < n) {
        next.push({
          id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID()
            : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          point: '', ppm: '',
        });
      }
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

  const cost = DOSING_KEYS.reduce((s, c) => {
    const qty = +(v as any)[c.key] || 0;
    const price = prices?.[c.name] ?? 0;
    return s + qty * price;
  }, 0);

  // Sidebar live sums
  const totalMassKg  = (+v.chlorine_kg || 0) + (+v.smbs_kg || 0) + (+v.soda_ash_kg || 0);
  const totalVolumeL = +v.anti_scalant_l || 0;
  const freePcs      = +v.free_chlorine_reagent_pcs || 0;

  const plantName = plants?.find(p => p.id === plantId)?.name ?? '';

  const clearAll = () => setV({ chlorine_kg: '', smbs_kg: '', anti_scalant_l: '', soda_ash_kg: '', free_chlorine_reagent_pcs: '0' });

  const submit = async () => {
    if (!plantId) { toast.error('Select plant'); return; }
    const validResiduals = samples.filter((s) => s.ppm !== '').map((s) => +s.ppm);
    const avgResidual = validResiduals.length ? validResiduals.reduce((a, b) => a + b, 0) / validResiduals.length : null;
    const { data: inserted, error } = await supabase.from('chemical_dosing_logs').insert({
      plant_id: plantId, log_datetime: new Date(dt).toISOString(),
      chlorine_kg: +v.chlorine_kg || 0, smbs_kg: +v.smbs_kg || 0,
      anti_scalant_l: +v.anti_scalant_l || 0, soda_ash_kg: +v.soda_ash_kg || 0,
      free_chlorine_reagent_pcs: +v.free_chlorine_reagent_pcs || 0,
      product_water_free_cl_ppm: avgResidual,
      calculated_cost: +cost.toFixed(2), recorded_by: activeOperator?.id,
    }).select('id').single();
    if (error || !inserted) { toast.error(friendlyError(error)); return; }
    if (samples.length > 0) {
      const sampleRows = samples.map((s, i) => ({
        dosing_log_id: inserted.id, plant_id: plantId, sample_index: i + 1,
        sampling_point: s.point || null, residual_ppm: s.ppm ? +s.ppm : null,
      }));
      await supabase.from('chemical_residual_samples').insert(sampleRows);
    }
    toast.success('Dosing logged');
    clearAll(); setSamples([]);
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-2.5">
      {/* Import dialog */}
      {showImport && (
        <ImportDosingDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); qc.invalidateQueries(); }}
        />
      )}

      {/* ── Main + Sidebar: stacked mobile, side-by-side md+ ─────────── */}
      <div className="flex flex-col md:flex-row gap-2.5 items-start">

        {/* ── Main Content ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* Plant header card */}
          <Card className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              {plantName && (
                <div className="flex items-center gap-2">
                  <span className="text-base">🏭</span>
                  <h3 className="text-sm font-bold uppercase tracking-wide">{plantName} — RO Operations Plant</h3>
                </div>
              )}
              {/* Import CSV button */}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0 ml-auto h-7 text-xs"
                onClick={() => setShowImport(true)}
              >
                <Upload className="h-3 w-3" /> Import
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="chemdosingform-plant" className="text-xs text-muted-foreground">Plant</Label>
                <ChemPlantPick value={plantId} onChange={setPlantId} id="chemdosingform-plant" />
              </div>
              <div>
                <Label htmlFor="chemdosingform-date-time" className="text-xs text-muted-foreground">Date & time</Label>
                <DateTimePicker
                  id="chemdosingform-date-time"
                  value={dt}
                  onChange={(d) => setDt(d)}
                  className="h-8.5 text-xs w-full mt-1"
                />
              </div>
            </div>
            {/* Show a notice when some chemicals are hidden for this plant */}
            {plantId && enabledChemicals.length > 0 && enabledChemicals.length < KNOWN_CHEMICALS.length && (
              <p className="text-2xs text-muted-foreground border-t border-border/40 pt-2 mt-1">
                Showing {enabledChemicals.length} of {KNOWN_CHEMICALS.length} chemicals configured for this plant.{' '}
                Managers can update this in <strong>Plants → Configuration</strong>.
              </p>
            )}
          </Card>

          {/* Mass-Based Dosing Group */}
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-0.5">Mass-Based Dosing Group</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {isChemEnabled('Chlorine') && (
                <ChemCard
                  name="Chlorine (kg)"
                  icon={<span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">Cl₂</span>}
                  value={v.chlorine_kg} onChange={val => setV({ ...v, chlorine_kg: val })}
                  unit="kg" accent="teal"
                />
              )}
              {isChemEnabled('SMBS') && (
                <ChemCard
                  name="SMBS (kg)"
                  icon={<span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">S₂O₅</span>}
                  value={v.smbs_kg} onChange={val => setV({ ...v, smbs_kg: val })}
                  unit="kg" accent="default"
                />
              )}
              {isChemEnabled('Soda Ash') && (
                <ChemCard
                  name="Soda Ash (kg)"
                  icon={<span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">Na₂CO₃</span>}
                  value={v.soda_ash_kg} onChange={val => setV({ ...v, soda_ash_kg: val })}
                  unit="kg" accent="default"
                />
              )}
            </div>
          </div>

          {/* Volume-Based + Ancillary row */}
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-0.5">Volume-Based & Ancillary</p>
            <div className="grid grid-cols-2 gap-2">
              {isChemEnabled('Anti Scalant') && (
                <ChemCard
                  name="Anti Scalant (L)"
                  icon={<span className="text-base leading-none">🚛</span>}
                  value={v.anti_scalant_l} onChange={val => setV({ ...v, anti_scalant_l: val })}
                  unit="L" accent="olive"
                />
              )}
              <ChemCard
                name="Free Cl Reagent (pcs)"
                icon={<span className="text-base leading-none">🧪</span>}
                value={v.free_chlorine_reagent_pcs}
                onChange={val => setV({ ...v, free_chlorine_reagent_pcs: val })}
                unit="pcs" accent="default"
                inputProps={{ min: '0', max: '20' }}
              />
            </div>
          </div>

          {/* Residual samples */}
          {samples.length > 0 && (
            <Card className="p-3 space-y-2 border-t">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Product Cl Residual Samples</h4>
              {samples.map((s, i) => (
                <div key={s.id} className="grid grid-cols-[20px_1fr_80px] gap-2 items-end">
                  <div className="text-xs font-mono-num pt-2 text-muted-foreground">#{i + 1}</div>
                  <div>
                    <Label htmlFor="chemdosingform-sampling-point" className="text-xs">Sampling point</Label>
                    <Input value={s.point} placeholder="e.g. Tank outlet"
                      onChange={(e) => setSamples(samples.map((x) => x.id === s.id ? { ...x, point: e.target.value } : x))} id="chemdosingform-sampling-point"/>
                  </div>
                  <div>
                    <Label htmlFor="chemdosingform-ppm" className="text-xs">ppm</Label>
                    <Input type="number" step="any" value={s.ppm}
                      onChange={(e) => setSamples(samples.map((x) => x.id === s.id ? { ...x, ppm: e.target.value } : x))} id="chemdosingform-ppm"/>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* ── Right Sidebar — hidden on mobile ─────────────────────────── */}
        <div className="hidden md:block w-48 shrink-0">
          <div className="rounded-xl bg-primary text-primary-foreground p-3 space-y-3 sticky top-2">
            <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">Dosing Summary</p>
            <div className="space-y-2.5"><DosingMobileSummary totalMassKg={totalMassKg} totalVolumeL={totalVolumeL} freePcs={freePcs} cost={cost} /></div>
            <div className="border-t border-primary-foreground/20 pt-2 space-y-2">
              <button onClick={clearAll} className="w-full text-xs text-primary-foreground/70 hover:text-primary-foreground underline underline-offset-2 transition-colors">Clear All</button>
              <Button onClick={submit} className="w-full h-8 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0">Save Dosing</Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile summary bar — visible only on mobile ───────────────── */}
      <div className="md:hidden rounded-xl bg-primary text-primary-foreground p-3 space-y-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">Dosing Summary <span className="text-primary-foreground/60 font-normal">(Live)</span></p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <DosingMobileSummary totalMassKg={totalMassKg} totalVolumeL={totalVolumeL} freePcs={freePcs} cost={cost} />
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={clearAll} className="h-9 text-xs text-primary-foreground/70 hover:text-primary-foreground border border-primary-foreground/30 rounded-md transition-colors">Clear All</button>
          <Button onClick={submit} className="h-9 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0">Save Dosing</Button>
        </div>
      </div>
    </div>
  );
}
