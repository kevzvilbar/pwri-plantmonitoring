import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { usePlantMeterConfig } from '@/features/plants/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-picker';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { Upload, Building2, Droplets, FlaskConical, Sliders, Zap } from 'lucide-react';
import { KNOWN_CHEMICALS, computeDosingLogCost } from '@/features/ro-trains';
import { fmtNum } from '@/lib/calculations';

import { ChemPlantPick } from './ChemPlantPick';
import { DosingMobileSummary } from './DosingMobileSummary';
import { ImportDosingDialog } from './ImportDosingDialog';
import { useChemCatalog } from './useChemCatalog';
import {
  buildQuickUnitOptions,
  findQuickUnit,
  quickToBase,
  DEFAULT_QUICK_UNITS,
  QuickChemKey,
} from './quickUnits';
import { ChemProductCard, ChemProductCardItem } from './components/ChemProductCard';
import { ResidualTestsCard, ResidualTestSample } from './components/ResidualTestsCard';
import { ConsumablesCard } from './components/ConsumablesCard';
import { ChemCard } from './ChemCard';

export function ChemDosingForm() {
  const qc = useQueryClient();
  const { activeOperator } = useAuth();
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [showImport, setShowImport] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [entryView, setEntryView] = useState<'catalog' | 'quick'>('catalog');

  // ── Catalog Data ───────────────────────────────────────────────────────────
  const { data: catalogData } = useChemCatalog(plantId || selectedPlantId || null);
  const catalogProducts = catalogData?.catalog ?? [];
  const allUnits = catalogData?.units ?? [];
  const dayTanks = catalogData?.dayTanks ?? [];

  // ── Per-plant chemical config ───────────────────────────────────────────────
  const { config: plantConfig } = usePlantMeterConfig(plantId || selectedPlantId || null);
  const enabledChemicals: string[] = plantConfig.enabled_chemicals ?? [];
  const isChemEnabled = (name: string) =>
    enabledChemicals.length === 0 || enabledChemicals.some((c) => c.toLowerCase() === name.toLowerCase());

  // ── Prices ─────────────────────────────────────────────────────────────────
  const { data: prices } = useQuery({
    queryKey: ['chem-current-prices'],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase
        .from('chemical_prices')
        .select('*')
        .lte('effective_date', today)
        .order('effective_date', { ascending: false });
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => {
        const fullName = p.chemical_name as string;
        if (!(fullName in map)) map[fullName] = p.unit_price;
        const baseName = fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(baseName in map)) map[baseName] = p.unit_price;
      });
      return map;
    },
  });

  // ── Process Chemical State (Catalog mode) ──────────────────────────────────
  const [chlorineItems, setChlorineItems] = useState<ChemProductCardItem[]>([]);
  const [smbsItems, setSmbsItems] = useState<ChemProductCardItem[]>([]);
  const [antiScalantItems, setAntiScalantItems] = useState<ChemProductCardItem[]>([]);
  const [sodaAshItems, setSodaAshItems] = useState<ChemProductCardItem[]>([]);

  // ── Quick Mode Legacy State ────────────────────────────────────────────────
  const [quickV, setQuickV] = useState({
    chlorine_kg: '',
    smbs_kg: '',
    anti_scalant_l: '',
    soda_ash_kg: '',
    free_chlorine_reagent_pcs: '0',
  });

  // Unit each Quick Mode amount is typed in. The saved values are always kg / L
  // (see quickBase), so changing the unit never changes what the database holds.
  const [quickUnits, setQuickUnits] = useState<Record<QuickChemKey, string>>({
    ...DEFAULT_QUICK_UNITS,
  });

  const quickPlantId = plantId || selectedPlantId || null;
  const quickUnitOptions = useMemo(
    () => ({
      chlorine_kg: buildQuickUnitOptions('chlorine_kg', catalogData?.catalog, catalogData?.units, quickPlantId),
      smbs_kg: buildQuickUnitOptions('smbs_kg', catalogData?.catalog, catalogData?.units, quickPlantId),
      soda_ash_kg: buildQuickUnitOptions('soda_ash_kg', catalogData?.catalog, catalogData?.units, quickPlantId),
      anti_scalant_l: buildQuickUnitOptions('anti_scalant_l', catalogData?.catalog, catalogData?.units, quickPlantId),
    }),
    [catalogData?.catalog, catalogData?.units, quickPlantId],
  );

  // Quick Mode amounts converted to the base unit (kg / L): this is what feeds
  // the sidebar, the cost and the saved legacy columns.
  const quickBase = useMemo(() => {
    const conv = (k: QuickChemKey) =>
      quickToBase(quickV[k], findQuickUnit(quickUnitOptions[k], quickUnits[k]).factorToBase);
    return {
      chlorine_kg: conv('chlorine_kg'),
      smbs_kg: conv('smbs_kg'),
      anti_scalant_l: conv('anti_scalant_l'),
      soda_ash_kg: conv('soda_ash_kg'),
      free_chlorine_reagent_pcs: +quickV.free_chlorine_reagent_pcs || 0,
    };
  }, [quickV, quickUnits, quickUnitOptions]);

  // Small "= 50 kg" hint under a card, shown only when a non-base unit is picked.
  // Converted units (litres on a kg column, kg on the litre column) also say
  // which density was used. On a kg column the result is kg of PRODUCT, costed
  // at the per-kg list price like every other Quick Mode amount.
  const quickHint = (k: QuickChemKey, base: 'kg' | 'L'): string | undefined => {
    const opts = quickUnitOptions[k];
    const opt = findQuickUnit(opts, quickUnits[k]);
    if (opt.id === opts[0].id || !(quickBase[k] > 0)) return undefined;
    const saved = `= ${fmtNum(quickBase[k], 3)} ${base} will be saved`;
    if (!opt.note) return saved;
    return base === 'kg'
      ? `${saved} (${opt.note}). Costed at your per-kg price.`
      : `${saved} (${opt.note}).`;
  };

  // ── Residual Tests State ───────────────────────────────────────────────────
  const [residualSamples, setResidualSamples] = useState<ResidualTestSample[]>([]);

  // ── Extra Consumables State ────────────────────────────────────────────────
  const [extraConsumables, setExtraConsumables] = useState<
    Record<string, { extraQty: number; extraReason: string }>
  >({});

  // Reagents list from catalog
  const catalogReagents = useMemo(() => {
    return catalogProducts.filter((p) => p.category === 'test_consumable');
  }, [catalogProducts]);

  // Aggregate process items
  const allProcessItems = useMemo(() => {
    return [...chlorineItems, ...smbsItems, ...antiScalantItems, ...sodaAshItems];
  }, [chlorineItems, smbsItems, antiScalantItems, sodaAshItems]);

  // ── Sidebar live sums ──────────────────────────────────────────────────────
  const { totalMassKg, totalVolumeL, freePcs, cost, unpriced } = useMemo(() => {
    if (entryView === 'quick') {
      const { cost: quickCost, unpriced: quickUnpriced } = computeDosingLogCost(quickBase, prices);
      const mass = quickBase.chlorine_kg + quickBase.smbs_kg + quickBase.soda_ash_kg;
      const vol = quickBase.anti_scalant_l;
      const pcs = quickBase.free_chlorine_reagent_pcs;
      return {
        totalMassKg: mass,
        totalVolumeL: vol,
        freePcs: pcs,
        cost: quickCost,
        unpriced: quickUnpriced,
      };
    }

    // Catalog Mode:
    let mass = 0;
    let vol = 0;
    let totalCost = 0;
    const unpricedSet = new Set<string>();

    allProcessItems.forEach((it) => {
      if (it.unit === 'kg') {
        mass += it.qtyBase;
      } else if (it.unit === 'L') {
        vol += it.qtyBase;
      }
      if (it.lineCost !== null && it.lineCost !== undefined) {
        totalCost += it.lineCost;
      } else if (it.qtyBase > 0) {
        unpricedSet.add(it.chemicalName);
      }
    });

    // Reagents:
    let reagentPcs = 0;
    catalogReagents.forEach((cat) => {
      let autoQty = 0;
      if (cat.base_unit === 'pcs') {
        if (cat.methods?.includes('dpd_free')) {
          autoQty += residualSamples.filter((s) => s.method === 'dpd_free').length;
        }
        if (cat.methods?.includes('dpd_total')) {
          autoQty += residualSamples.filter((s) => s.method === 'dpd_total').length;
        }
      } else if (cat.base_unit === 'mL') {
        const otoCount = residualSamples.filter(
          (s) =>
            s.method === 'oto' ||
            (s.method === 'dpd_free' && cat.methods?.includes('dpd_free') && cat.form === 'drops')
        ).length;
        const drops = cat.drops_per_test ?? 5;
        const mlPerDrop = cat.ml_per_drop ?? 0.05;
        autoQty = +(otoCount * drops * mlPerDrop).toFixed(3);
      }
      const extra = extraConsumables[cat.id]?.extraQty || 0;
      const totalQty = autoQty + extra;

      if (cat.family === 'reagent' && cat.base_unit === 'pcs') {
        reagentPcs += totalQty;
      }

      const pKey = cat.price_key;
      const uPrice = prices?.[pKey];
      if (uPrice !== undefined && uPrice !== null) {
        totalCost += +(totalQty * uPrice).toFixed(2);
      } else if (totalQty > 0) {
        unpricedSet.add(cat.name);
      }
    });

    return {
      totalMassKg: mass,
      totalVolumeL: vol,
      freePcs: reagentPcs,
      cost: totalCost,
      unpriced: Array.from(unpricedSet),
    };
  }, [entryView, quickBase, prices, allProcessItems, catalogReagents, residualSamples, extraConsumables]);

  const plantName = plants?.find((p) => p.id === plantId)?.name ?? '';

  const clearAll = () => {
    setQuickV({
      chlorine_kg: '',
      smbs_kg: '',
      anti_scalant_l: '',
      soda_ash_kg: '',
      free_chlorine_reagent_pcs: '0',
    });
    setChlorineItems([]);
    setSmbsItems([]);
    setAntiScalantItems([]);
    setSodaAshItems([]);
    setResidualSamples([]);
    setExtraConsumables({});
  };

  const submit = async () => {
    if (!plantId) {
      toast.error('Select plant');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Calculate average product water residual
      const validProductResiduals = residualSamples
        .filter((s) => s.pointRole === 'product' && s.residualPpm !== '' && !isNaN(+s.residualPpm))
        .map((s) => +s.residualPpm);

      const avgResidual = validProductResiduals.length
        ? +(
            validProductResiduals.reduce((a, b) => a + b, 0) / validProductResiduals.length
          ).toFixed(3)
        : null;

      // 2. Prepare parent dosing log values
      let parentChlorineKg = 0;
      let parentSmbsKg = 0;
      let parentAntiScalantL = 0;
      let parentSodaAshKg = 0;
      let parentReagentPcs = freePcs;

      if (entryView === 'quick') {
        parentChlorineKg = quickBase.chlorine_kg;
        parentSmbsKg = quickBase.smbs_kg;
        parentAntiScalantL = quickBase.anti_scalant_l;
        parentSodaAshKg = quickBase.soda_ash_kg;
        parentReagentPcs = quickBase.free_chlorine_reagent_pcs;
      } else {
        chlorineItems.forEach((it) => {
          parentChlorineKg += it.activeKg ?? it.productKg ?? it.qtyBase ?? 0;
        });
        smbsItems.forEach((it) => {
          parentSmbsKg += it.productKg ?? it.qtyBase ?? 0;
        });
        antiScalantItems.forEach((it) => {
          if (it.unit === 'L') parentAntiScalantL += it.qtyBase ?? 0;
          else if (it.densityKgPerL && it.densityKgPerL > 0)
            parentAntiScalantL += (it.qtyBase ?? 0) / it.densityKgPerL;
          else parentAntiScalantL += it.qtyBase ?? 0;
        });
        sodaAshItems.forEach((it) => {
          parentSodaAshKg += it.productKg ?? it.qtyBase ?? 0;
        });
      }

      // 3. Insert parent chemical_dosing_logs
      const { data: inserted, error: logError } = await supabase
        .from('chemical_dosing_logs')
        .insert({
          plant_id: plantId,
          log_datetime: new Date(dt).toISOString(),
          chlorine_kg: +parentChlorineKg.toFixed(4),
          smbs_kg: +parentSmbsKg.toFixed(4),
          anti_scalant_l: +parentAntiScalantL.toFixed(4),
          soda_ash_kg: +parentSodaAshKg.toFixed(4),
          free_chlorine_reagent_pcs: parentReagentPcs,
          product_water_free_cl_ppm: avgResidual,
          calculated_cost: +cost.toFixed(2),
          recorded_by: activeOperator?.id || null,
          has_items: entryView === 'catalog',
        })
        .select('id')
        .single();

      if (logError || !inserted) {
        throw logError;
      }

      const dosingLogId = inserted.id;

      // 4. If catalog mode, insert child chemical_dosing_items
      if (entryView === 'catalog') {
        const itemRows: any[] = [];

        // Process items
        allProcessItems
          .filter((it) => it.qtyBase > 0 || (it.qtyExtra && it.qtyExtra > 0))
          .forEach((it) => {
            itemRows.push({
              dosing_log_id: dosingLogId,
              plant_id: plantId,
              catalog_id: it.catalogId,
              chemical_name: it.chemicalName,
              entry_mode: it.entryMode,
              entry_qty: it.entryQty,
              entry_unit: it.entryUnit,
              factor_to_base: it.factorToBase,
              day_tank_id: it.dayTankId || null,
              qty: it.qtyBase,
              qty_extra: it.qtyExtra || 0,
              extra_reason: it.extraReason || null,
              unit: it.unit,
              strength_pct: it.strengthPct || null,
              density_kg_per_l: it.densityKgPerL || null,
              product_kg: it.productKg,
              active_kg: it.activeKg,
              unit_price: it.unitPrice,
              line_cost: it.lineCost,
            });
          });

        // Consumables items
        catalogReagents.forEach((cat) => {
          let autoQty = 0;
          if (cat.base_unit === 'pcs') {
            if (cat.methods?.includes('dpd_free')) {
              autoQty += residualSamples.filter((s) => s.method === 'dpd_free').length;
            }
            if (cat.methods?.includes('dpd_total')) {
              autoQty += residualSamples.filter((s) => s.method === 'dpd_total').length;
            }
          } else if (cat.base_unit === 'mL') {
            const otoCount = residualSamples.filter(
              (s) =>
                s.method === 'oto' ||
                (s.method === 'dpd_free' && cat.methods?.includes('dpd_free') && cat.form === 'drops')
            ).length;
            const drops = cat.drops_per_test ?? 5;
            const mlPerDrop = cat.ml_per_drop ?? 0.05;
            autoQty = +(otoCount * drops * mlPerDrop).toFixed(3);
          }
          const extra = extraConsumables[cat.id] ?? { extraQty: 0, extraReason: 'retest' };
          const totalQty = autoQty + (extra.extraQty || 0);
          if (totalQty <= 0) return;

          const uPrice = prices?.[cat.price_key] ?? null;
          const lineCost = uPrice !== null ? +(totalQty * uPrice).toFixed(2) : null;

          itemRows.push({
            dosing_log_id: dosingLogId,
            plant_id: plantId,
            catalog_id: cat.id,
            chemical_name: cat.name,
            entry_mode: 'batch',
            entry_qty: totalQty,
            entry_unit: cat.base_unit,
            factor_to_base: 1,
            qty: autoQty,
            qty_extra: extra.extraQty || 0,
            extra_reason: extra.extraQty > 0 ? extra.extraReason : null,
            unit: cat.base_unit,
            unit_price: uPrice,
            line_cost: lineCost,
          });
        });

        if (itemRows.length > 0) {
          const { error: itemsErr } = await (supabase
            .from('chemical_dosing_items' as any) as any)
            .insert(itemRows);
          if (itemsErr) console.warn('Child items insert note:', itemsErr);
        }
      }

      // 5. Insert chemical_residual_samples
      if (residualSamples.length > 0) {
        const sampleRows = residualSamples.map((s, i) => {
          // Find matching reagent catalog ID
          let reagentCatId: string | null = null;
          if (s.method === 'dpd_free') {
            reagentCatId =
              catalogReagents.find((r) => r.methods?.includes('dpd_free') && r.base_unit === 'pcs')?.id ||
              null;
          } else if (s.method === 'dpd_total') {
            reagentCatId =
              catalogReagents.find((r) => r.methods?.includes('dpd_total') && r.base_unit === 'pcs')?.id ||
              null;
          } else if (s.method === 'oto') {
            reagentCatId =
              catalogReagents.find((r) => r.methods?.includes('oto') || r.base_unit === 'mL')?.id ||
              null;
          }

          return {
            dosing_log_id: dosingLogId,
            plant_id: plantId,
            sample_index: i + 1,
            sampling_point: s.samplingPoint || null,
            point_role: s.pointRole || 'other',
            method: s.method,
            parameter: s.parameter,
            residual_ppm: s.residualPpm ? +s.residualPpm : null,
            tested_at: s.testedAt ? new Date(s.testedAt).toISOString() : new Date().toISOString(),
            tested_by: activeOperator?.id || null,
            reagent_catalog_id: reagentCatId,
            reagent_qty: s.method === 'online' ? 0 : 1,
          };
        });

        const { error: sampleErr } = await supabase
          .from('chemical_residual_samples')
          .insert(sampleRows as any);
        if (sampleErr) console.warn('Sample rows insert note:', sampleErr);
      }

      toast.success('Dosing log saved successfully');
      clearAll();
      qc.invalidateQueries({ queryKey: ['dosing-history'] });
      qc.invalidateQueries({ queryKey: ['chem-stock-computed'] });
    } catch (err: any) {
      toast.error(friendlyError(err) || err.message || 'Failed to save dosing log');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Import dialog */}
      {showImport && (
        <ImportDosingDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            qc.invalidateQueries();
          }}
        />
      )}

      {/* ── Main + Sidebar ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-2.5 items-start">
        {/* ── Main Content ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Plant header card */}
          <Card className="p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              {plantName ? (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-bold uppercase tracking-wide">
                    {plantName} — RO Operations Plant
                  </h3>
                </div>
              ) : (
                <div className="text-sm font-semibold text-muted-foreground">Select a Plant</div>
              )}

              <div className="flex items-center gap-2">
                <Tabs
                  value={entryView}
                  onValueChange={(v: any) => setEntryView(v)}
                  className="h-7"
                >
                  <TabsList className="h-7 p-0.5">
                    <TabsTrigger value="catalog" className="text-3xs h-6 px-2.5 gap-1">
                      <Sliders className="h-3 w-3" /> Catalog & Containers
                    </TabsTrigger>
                    <TabsTrigger value="quick" className="text-3xs h-6 px-2.5 gap-1">
                      <Zap className="h-3 w-3" /> Quick Mode
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0 h-7 text-xs"
                  onClick={() => setShowImport(true)}
                >
                  <Upload className="h-3 w-3" /> Import
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="chemdosingform-plant" className="text-xs text-muted-foreground">
                  Plant
                </Label>
                <ChemPlantPick value={plantId} onChange={setPlantId} id="chemdosingform-plant" />
              </div>
              <div>
                <Label
                  htmlFor="chemdosingform-date-time"
                  className="text-xs text-muted-foreground"
                >
                  Date & time
                </Label>
                <DateTimePicker
                  id="chemdosingform-date-time"
                  value={dt}
                  onChange={(d) => setDt(d)}
                  className="h-8.5 text-xs w-full mt-1"
                />
              </div>
            </div>

            {plantId && enabledChemicals.length > 0 && enabledChemicals.length < KNOWN_CHEMICALS.length && (
              <p className="text-2xs text-muted-foreground border-t border-border/40 pt-2 mt-1">
                Showing {enabledChemicals.length} of {KNOWN_CHEMICALS.length} chemicals configured
                for this plant.
              </p>
            )}
          </Card>

          {/* ── CATALOG ENTRY MODE ─────────────────────────────────────── */}
          {entryView === 'catalog' ? (
            <div className="space-y-3">
              {/* Chlorine Group */}
              {isChemEnabled('Chlorine') && (
                <ChemProductCard
                  family="chlorine"
                  displayName="Chlorine"
                  formula="Cl₂"
                  accent="teal"
                  catalogProducts={catalogProducts}
                  allUnits={allUnits}
                  dayTanks={dayTanks}
                  prices={prices}
                  items={chlorineItems}
                  onChange={setChlorineItems}
                />
              )}

              {/* SMBS Group */}
              {isChemEnabled('SMBS') && (
                <ChemProductCard
                  family="smbs"
                  displayName="Sodium Metabisulfite (SMBS)"
                  formula="Na₂S₂O₅"
                  accent="default"
                  catalogProducts={catalogProducts}
                  allUnits={allUnits}
                  dayTanks={dayTanks}
                  prices={prices}
                  items={smbsItems}
                  onChange={setSmbsItems}
                />
              )}

              {/* Anti Scalant Group */}
              {isChemEnabled('Anti Scalant') && (
                <ChemProductCard
                  family="anti_scalant"
                  displayName="Anti Scalant"
                  formula="RO Chem"
                  accent="olive"
                  catalogProducts={catalogProducts}
                  allUnits={allUnits}
                  dayTanks={dayTanks}
                  prices={prices}
                  items={antiScalantItems}
                  onChange={setAntiScalantItems}
                />
              )}

              {/* Soda Ash Group */}
              {isChemEnabled('Soda Ash') && (
                <ChemProductCard
                  family="soda_ash"
                  displayName="Soda Ash (pH Booster)"
                  formula="Na₂CO₃"
                  accent="default"
                  catalogProducts={catalogProducts}
                  allUnits={allUnits}
                  dayTanks={dayTanks}
                  prices={prices}
                  items={sodaAshItems}
                  onChange={setSodaAshItems}
                />
              )}

              {/* Residual Tests */}
              <ResidualTestsCard
                samples={residualSamples}
                onChange={setResidualSamples}
              />

              {/* Consumables Card */}
              <ConsumablesCard
                plantId={plantId}
                operatorId={activeOperator?.id}
                catalogReagents={catalogReagents}
                residualSamples={residualSamples}
                prices={prices}
                extraConsumables={extraConsumables}
                onExtraChange={setExtraConsumables}
              />
            </div>
          ) : (
            /* ── QUICK ENTRY MODE ───────────────────────────────────────── */
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-0.5">
                  Mass-Based Dosing Group
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {isChemEnabled('Chlorine') && (
                    <ChemCard
                      name="Chlorine"
                      icon={
                        <span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">
                          Cl₂
                        </span>
                      }
                      value={quickV.chlorine_kg}
                      onChange={(val) => setQuickV({ ...quickV, chlorine_kg: val })}
                      unit="kg"
                      unitOptions={quickUnitOptions.chlorine_kg}
                      unitId={quickUnits.chlorine_kg}
                      onUnitChange={(id) => setQuickUnits((u) => ({ ...u, chlorine_kg: id }))}
                      hint={quickHint('chlorine_kg', 'kg')}
                      accent="teal"
                    />
                  )}
                  {isChemEnabled('SMBS') && (
                    <ChemCard
                      name="SMBS"
                      icon={
                        <span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">
                          S₂O₅
                        </span>
                      }
                      value={quickV.smbs_kg}
                      onChange={(val) => setQuickV({ ...quickV, smbs_kg: val })}
                      unit="kg"
                      unitOptions={quickUnitOptions.smbs_kg}
                      unitId={quickUnits.smbs_kg}
                      onUnitChange={(id) => setQuickUnits((u) => ({ ...u, smbs_kg: id }))}
                      hint={quickHint('smbs_kg', 'kg')}
                      accent="default"
                    />
                  )}
                  {isChemEnabled('Soda Ash') && (
                    <ChemCard
                      name="Soda Ash"
                      icon={
                        <span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">
                          Na₂CO₃
                        </span>
                      }
                      value={quickV.soda_ash_kg}
                      onChange={(val) => setQuickV({ ...quickV, soda_ash_kg: val })}
                      unit="kg"
                      unitOptions={quickUnitOptions.soda_ash_kg}
                      unitId={quickUnits.soda_ash_kg}
                      onUnitChange={(id) => setQuickUnits((u) => ({ ...u, soda_ash_kg: id }))}
                      hint={quickHint('soda_ash_kg', 'kg')}
                      accent="default"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-0.5">
                  Volume-Based & Ancillary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {isChemEnabled('Anti Scalant') && (
                    <ChemCard
                      name="Anti Scalant"
                      icon={
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-muted rounded text-muted-foreground">
                          <Droplets className="h-3.5 w-3.5" />
                        </span>
                      }
                      value={quickV.anti_scalant_l}
                      onChange={(val) => setQuickV({ ...quickV, anti_scalant_l: val })}
                      unit="L"
                      unitOptions={quickUnitOptions.anti_scalant_l}
                      unitId={quickUnits.anti_scalant_l}
                      onUnitChange={(id) => setQuickUnits((u) => ({ ...u, anti_scalant_l: id }))}
                      hint={quickHint('anti_scalant_l', 'L')}
                      accent="olive"
                    />
                  )}
                  <ChemCard
                    name="Free Cl Reagent (pcs)"
                    icon={
                      <span className="inline-flex items-center justify-center w-6 h-6 bg-muted rounded text-muted-foreground">
                        <FlaskConical className="h-3.5 w-3.5" />
                      </span>
                    }
                    value={quickV.free_chlorine_reagent_pcs}
                    onChange={(val) =>
                      setQuickV({ ...quickV, free_chlorine_reagent_pcs: val })
                    }
                    unit="pcs"
                    accent="default"
                    inputProps={{ min: '0', max: '20' }}
                  />
                </div>
              </div>

              {/* Residual samples */}
              <ResidualTestsCard
                samples={residualSamples}
                onChange={setResidualSamples}
              />
            </div>
          )}
        </div>

        {/* ── Right Sidebar — sticky on desktop ────────────────────────── */}
        <div className="hidden md:block w-48 shrink-0">
          <div className="rounded-xl bg-primary text-primary-foreground p-3 space-y-3 sticky top-2">
            <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">
              Dosing Summary
            </p>
            <div className="space-y-2.5">
              <DosingMobileSummary
                totalMassKg={totalMassKg}
                totalVolumeL={totalVolumeL}
                freePcs={freePcs}
                cost={cost}
              />
              {unpriced.length > 0 && (
                <p className="text-2xs text-amber-200 bg-amber-950/40 p-1.5 rounded border border-amber-400/30">
                  ⚠️ No price on file for {unpriced.join(', ')} — cost not counted
                </p>
              )}
            </div>
            <div className="border-t border-primary-foreground/20 pt-2 space-y-2">
              <button
                onClick={clearAll}
                className="w-full text-xs text-primary-foreground/70 hover:text-primary-foreground underline underline-offset-2 transition-colors"
              >
                Clear All
              </button>
              <Button
                onClick={submit}
                disabled={isSubmitting}
                className="w-full h-8 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0"
              >
                {isSubmitting ? 'Saving...' : 'Save Dosing'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile summary bar ────────────────────────────────────────── */}
      <div className="md:hidden rounded-xl bg-primary text-primary-foreground p-3 space-y-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">
          Dosing Summary <span className="text-primary-foreground/60 font-normal">(Live)</span>
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <DosingMobileSummary
            totalMassKg={totalMassKg}
            totalVolumeL={totalVolumeL}
            freePcs={freePcs}
            cost={cost}
          />
        </div>
        {unpriced.length > 0 && (
          <p className="text-2xs text-amber-200 bg-amber-950/40 p-1.5 rounded border border-amber-400/30">
            ⚠️ No price on file for {unpriced.join(', ')} — cost not counted
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={clearAll}
            className="h-9 text-xs text-primary-foreground/70 hover:text-primary-foreground border border-primary-foreground/30 rounded-md transition-colors"
          >
            Clear All
          </button>
          <Button
            onClick={submit}
            disabled={isSubmitting}
            className="h-9 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0"
          >
            {isSubmitting ? 'Saving...' : 'Save Dosing'}
          </Button>
        </div>
      </div>
    </div>
  );
}
