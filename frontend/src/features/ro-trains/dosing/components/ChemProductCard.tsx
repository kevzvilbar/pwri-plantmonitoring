import { useState, useMemo, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Droplets, Cylinder, Scale, AlertTriangle, Layers } from 'lucide-react';
import { ChemicalCatalogItem, CatalogUnitItem, PlantDayTank } from '../useChemCatalog';
import { convertProductQty, convertDayTankDrop, computeLineCost } from '../dosingMath';
import { fmtNum } from '@/lib/calculations';

export interface ChemProductCardItem {
  id: string;
  catalogId: string;
  chemicalName: string;
  family: string;
  entryMode: 'containers' | 'batch' | 'tank_level';
  entryQty: number;
  entryUnit: string;
  factorToBase: number;
  qtyBase: number;
  qtyExtra: number;
  extraReason?: string;
  unit: string;
  strengthPct?: number | null;
  densityKgPerL?: number | null;
  productKg: number | null;
  activeKg: number | null;
  dayTankId?: string;
  dayTankStartLevel?: number;
  dayTankEndLevel?: number;
  unitPrice?: number | null;
  lineCost?: number | null;
}

interface ChemProductCardProps {
  family: string; // 'chlorine' | 'smbs' | 'anti_scalant' | 'soda_ash'
  displayName: string;
  formula: string;
  accent?: 'teal' | 'olive' | 'default';
  catalogProducts: ChemicalCatalogItem[];
  allUnits: CatalogUnitItem[];
  dayTanks: PlantDayTank[];
  prices?: Record<string, number>;
  items: ChemProductCardItem[];
  onChange: (items: ChemProductCardItem[]) => void;
}

export function ChemProductCard({
  family,
  displayName,
  formula,
  accent = 'default',
  catalogProducts,
  allUnits,
  dayTanks,
  prices,
  items,
  onChange,
}: ChemProductCardProps) {
  // Filter products belonging to this family
  const familyProducts = useMemo(() => {
    return catalogProducts.filter(
      (p) => p.family.toLowerCase() === family.toLowerCase() && p.category === 'process'
    );
  }, [catalogProducts, family]);

  // Default product
  const defaultProduct = familyProducts[0] ?? null;

  // Filter day tanks for this family
  const familyDayTanks = useMemo(() => {
    const validCatIds = new Set(familyProducts.map((p) => p.id));
    return dayTanks.filter((t) => validCatIds.has(t.catalog_id));
  }, [dayTanks, familyProducts]);

  // If no items exist for this family yet, initialize with one empty/default item
  const currentItems = useMemo(() => {
    if (items.length > 0) return items;
    if (!defaultProduct) return [];
    return [
      {
        id: `item-${family}-0`,
        catalogId: defaultProduct.id,
        chemicalName: defaultProduct.name,
        family,
        entryMode: 'batch' as const,
        entryQty: 0,
        entryUnit: defaultProduct.base_unit,
        factorToBase: 1,
        qtyBase: 0,
        qtyExtra: 0,
        unit: defaultProduct.base_unit,
        strengthPct: defaultProduct.strength_pct,
        densityKgPerL: defaultProduct.density_kg_per_l,
        productKg: null,
        activeKg: null,
        unitPrice: prices?.[defaultProduct.price_key] ?? null,
        lineCost: 0,
      },
    ];
  }, [items, family, defaultProduct, prices]);

  const updateItem = (index: number, patch: Partial<ChemProductCardItem>) => {
    const updated = currentItems.map((it, idx) => {
      if (idx !== index) return it;
      const merged = { ...it, ...patch };

      // Find active catalog product
      const cat = familyProducts.find((p) => p.id === merged.catalogId) || defaultProduct;
      const baseUnit = cat?.base_unit ?? (merged.unit as 'kg' | 'L');
      const strengthPct = cat?.strength_pct ?? merged.strengthPct;
      const strengthBasis = cat?.strength_basis ?? null;
      const densityKgPerL = cat?.density_kg_per_l ?? merged.densityKgPerL;
      const unitPrice = prices?.[cat?.price_key ?? ''] ?? null;

      let qtyBase = 0;
      let productKg: number | null = null;
      let activeKg: number | null = null;

      if (merged.entryMode === 'tank_level') {
        const tank = familyDayTanks.find((t) => t.id === merged.dayTankId);
        const lDosed = Math.max(0, (merged.dayTankStartLevel ?? 0) - (merged.dayTankEndLevel ?? 0));
        const neatPer100 = tank?.neat_per_100l ?? 10;
        qtyBase = convertDayTankDrop(lDosed, neatPer100);
        merged.entryQty = lDosed;
        merged.entryUnit = 'L drop';
        merged.factorToBase = neatPer100 / 100;
        const conv = convertProductQty({
          entryQty: qtyBase,
          entryUnit: baseUnit,
          factorToBase: 1,
          baseUnit,
          strengthPct,
          strengthBasis,
          densityKgPerL,
        });
        productKg = conv.productKg;
        activeKg = conv.activeKg;
      } else {
        const conv = convertProductQty({
          entryQty: merged.entryQty || 0,
          entryUnit: merged.entryUnit || baseUnit,
          factorToBase: merged.factorToBase || 1,
          baseUnit,
          strengthPct,
          strengthBasis,
          densityKgPerL,
        });
        qtyBase = conv.qtyBase;
        productKg = conv.productKg;
        activeKg = conv.activeKg;
      }

      const lineCost = computeLineCost(qtyBase, merged.qtyExtra || 0, unitPrice);

      return {
        ...merged,
        chemicalName: cat?.name ?? merged.chemicalName,
        unit: baseUnit,
        strengthPct,
        densityKgPerL,
        qtyBase,
        productKg,
        activeKg,
        unitPrice,
        lineCost,
      };
    });

    onChange(updated);
  };

  const addItem = () => {
    if (!defaultProduct) return;
    const newItem: ChemProductCardItem = {
      id: `item-${family}-${Date.now()}`,
      catalogId: defaultProduct.id,
      chemicalName: defaultProduct.name,
      family,
      entryMode: 'containers',
      entryQty: 0,
      entryUnit: defaultProduct.base_unit,
      factorToBase: 1,
      qtyBase: 0,
      qtyExtra: 0,
      unit: defaultProduct.base_unit,
      strengthPct: defaultProduct.strength_pct,
      densityKgPerL: defaultProduct.density_kg_per_l,
      productKg: null,
      activeKg: null,
      unitPrice: prices?.[defaultProduct.price_key] ?? null,
      lineCost: 0,
    };
    onChange([...currentItems, newItem]);
  };

  const removeItem = (index: number) => {
    if (currentItems.length <= 1) {
      // Just reset the single item
      updateItem(0, { entryQty: 0, qtyBase: 0, lineCost: 0 });
      return;
    }
    onChange(currentItems.filter((_, idx) => idx !== index));
  };

  // Card summary calculations
  const totalBaseQty = currentItems.reduce((acc, it) => acc + (it.qtyBase || 0), 0);
  const totalActiveKg = currentItems.reduce((acc, it) => acc + (it.activeKg || 0), 0);
  const totalLineCost = currentItems.reduce((acc, it) => acc + (it.lineCost || 0), 0);
  const primaryUnit = currentItems[0]?.unit || defaultProduct?.base_unit || 'kg';
  const hasUnpriced = currentItems.some((it) => it.qtyBase > 0 && it.unitPrice === null);

  const getAccentBorder = () => {
    if (accent === 'teal') return 'border-teal-500/30 dark:border-teal-500/20';
    if (accent === 'olive') return 'border-emerald-500/30 dark:border-emerald-500/20';
    return 'border-border';
  };

  return (
    <Card className={`p-3 space-y-3 relative overflow-hidden ${getAccentBorder()}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-bold font-mono bg-muted rounded-md text-foreground">
            {formula}
          </span>
          <div>
            <h4 className="text-sm font-semibold leading-tight">{displayName}</h4>
            <span className="text-2xs text-muted-foreground">
              {familyProducts.map((p) => p.form).filter(Boolean).join(' · ') || 'Process Chemical'}
            </span>
          </div>
        </div>

        {/* Live Card Totals */}
        <div className="text-right">
          <div className="text-xs font-mono font-semibold">
            {totalBaseQty > 0 ? (
              <span>
                {fmtNum(totalBaseQty, 2)} {primaryUnit}
                {family === 'chlorine' && totalActiveKg > 0 && (
                  <span className="text-muted-foreground font-normal ml-1">
                    (≈{fmtNum(totalActiveKg, 1)} kg Cl₂)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">0 {primaryUnit}</span>
            )}
          </div>
          {totalLineCost > 0 && (
            <div className="text-2xs text-emerald-600 dark:text-emerald-400 font-mono">
              ₱{fmtNum(totalLineCost, 2)}
            </div>
          )}
          {hasUnpriced && (
            <div className="text-3xs text-amber-500 font-medium">⚠️ Unpriced</div>
          )}
        </div>
      </div>

      {/* Item Rows */}
      <div className="space-y-3">
        {currentItems.map((item, index) => {
          const product = familyProducts.find((p) => p.id === item.catalogId) || defaultProduct;
          const productUnits = allUnits.filter((u) => u.catalog_id === product?.id);

          return (
            <div
              key={item.id || index}
              className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-2.5 text-xs"
            >
              {/* Product Form Selection & Entry Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-3xs uppercase tracking-wider text-muted-foreground">
                    Product Form
                  </Label>
                  <Select
                    value={item.catalogId}
                    onValueChange={(val) => {
                      const p = familyProducts.find((x) => x.id === val);
                      if (p) {
                        updateItem(index, {
                          catalogId: p.id,
                          chemicalName: p.name,
                          unit: p.base_unit,
                          entryUnit: p.base_unit,
                          factorToBase: 1,
                          strengthPct: p.strength_pct,
                          densityKgPerL: p.density_kg_per_l,
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs mt-0.5">
                      <SelectValue placeholder="Select form" />
                    </SelectTrigger>
                    <SelectContent>
                      {familyProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} {p.strength_pct ? `(${p.strength_pct}%)` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-3xs uppercase tracking-wider text-muted-foreground">
                    Input Method
                  </Label>
                  <div className="flex gap-1 mt-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={item.entryMode === 'containers' ? 'default' : 'outline'}
                      className="h-7 text-2xs px-2 flex-1 gap-1"
                      onClick={() => updateItem(index, { entryMode: 'containers' })}
                    >
                      <Layers className="h-3 w-3" /> Containers
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={item.entryMode === 'batch' ? 'default' : 'outline'}
                      className="h-7 text-2xs px-2 flex-1 gap-1"
                      onClick={() => updateItem(index, { entryMode: 'batch' })}
                    >
                      <Scale className="h-3 w-3" /> Batch
                    </Button>
                    {familyDayTanks.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant={item.entryMode === 'tank_level' ? 'default' : 'outline'}
                        className="h-7 text-2xs px-2 flex-1 gap-1"
                        onClick={() =>
                          updateItem(index, {
                            entryMode: 'tank_level',
                            dayTankId: familyDayTanks[0]?.id,
                          })
                        }
                      >
                        <Droplets className="h-3 w-3" /> Day Tank
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Mode-Specific Input Controls */}
              {item.entryMode === 'containers' && (
                <div className="space-y-2">
                  {/* Quick Container Increments */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-3xs text-muted-foreground">Quick Add:</span>
                    {product?.base_unit === 'L' ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-6 text-3xs px-2 font-mono"
                          onClick={() =>
                            updateItem(index, {
                              entryQty: (item.entryQty || 0) + 1,
                              entryUnit: 'Carboy (20 L)',
                              factorToBase: 20,
                            })
                          }
                        >
                          +1 Carboy (20L)
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-6 text-3xs px-2 font-mono"
                          onClick={() =>
                            updateItem(index, {
                              entryQty: (item.entryQty || 0) + 1,
                              entryUnit: 'Drum (200 L)',
                              factorToBase: 200,
                            })
                          }
                        >
                          +1 Drum (200L)
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-6 text-3xs px-2 font-mono"
                          onClick={() =>
                            updateItem(index, {
                              entryQty: (item.entryQty || 0) + 1,
                              entryUnit: 'IBC (1000 L)',
                              factorToBase: 1000,
                            })
                          }
                        >
                          +1 IBC (1000L)
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-6 text-3xs px-2 font-mono"
                          onClick={() =>
                            updateItem(index, {
                              entryQty: (item.entryQty || 0) + 1,
                              entryUnit: 'Bag (25 kg)',
                              factorToBase: 25,
                            })
                          }
                        >
                          +1 Bag (25kg)
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-6 text-3xs px-2 font-mono"
                          onClick={() =>
                            updateItem(index, {
                              entryQty: (item.entryQty || 0) + 1,
                              entryUnit: 'Drum (50 kg)',
                              factorToBase: 50,
                            })
                          }
                        >
                          +1 Drum (50kg)
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-[1fr_1.5fr] gap-2">
                    <div>
                      <Label className="text-3xs text-muted-foreground">Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0"
                        className="h-7 text-xs font-mono mt-0.5"
                        value={item.entryQty || ''}
                        onChange={(e) =>
                          updateItem(index, { entryQty: Math.max(0, +e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-3xs text-muted-foreground">Container Type</Label>
                      <Select
                        value={`${item.factorToBase}`}
                        onValueChange={(val) => {
                          const factor = +val;
                          const label =
                            val === '20'
                              ? 'Carboy (20 L)'
                              : val === '200'
                              ? 'Drum (200 L)'
                              : val === '1000'
                              ? 'IBC (1000 L)'
                              : val === '25'
                              ? 'Bag (25 kg)'
                              : val === '50'
                              ? 'Drum (50 kg)'
                              : `Container (${factor} ${product?.base_unit})`;
                          updateItem(index, { factorToBase: factor, entryUnit: label });
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs mt-0.5">
                          <SelectValue placeholder="Select container" />
                        </SelectTrigger>
                        <SelectContent>
                          {product?.base_unit === 'L' ? (
                            <>
                              <SelectItem value="20">Carboy (20 L)</SelectItem>
                              <SelectItem value="200">Drum (200 L)</SelectItem>
                              <SelectItem value="1000">IBC Tote (1,000 L)</SelectItem>
                              <SelectItem value="1">1 Litre Bottle</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value="25">Bag (25 kg)</SelectItem>
                              <SelectItem value="50">Drum (50 kg)</SelectItem>
                              <SelectItem value="68">Gas Cylinder (68 kg)</SelectItem>
                              <SelectItem value="1">1 Kilogram</SelectItem>
                            </>
                          )}
                          {productUnits.map((u) => (
                            <SelectItem key={u.id} value={`${u.factor_to_base}`}>
                              {u.unit_label} ({u.factor_to_base} {product?.base_unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {item.entryMode === 'batch' && (
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <div>
                    <Label className="text-3xs text-muted-foreground">Batch Dosed Amount</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.0"
                      className="h-7 text-xs font-mono mt-0.5"
                      value={item.entryQty || ''}
                      onChange={(e) =>
                        updateItem(index, {
                          entryQty: Math.max(0, +e.target.value),
                          factorToBase: 1,
                          entryUnit: product?.base_unit ?? 'kg',
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-3xs text-muted-foreground">Unit</Label>
                    <div className="h-7 mt-0.5 px-2.5 flex items-center justify-center font-mono font-medium rounded-md bg-muted text-xs border border-input">
                      {product?.base_unit ?? 'kg'}
                    </div>
                  </div>
                </div>
              )}

              {item.entryMode === 'tank_level' && (
                <div className="space-y-2">
                  <div>
                    <Label className="text-3xs text-muted-foreground">Day Tank</Label>
                    <Select
                      value={item.dayTankId || familyDayTanks[0]?.id}
                      onValueChange={(val) => updateItem(index, { dayTankId: val })}
                    >
                      <SelectTrigger className="h-7 text-xs mt-0.5">
                        <SelectValue placeholder="Pick tank" />
                      </SelectTrigger>
                      <SelectContent>
                        {familyDayTanks.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} ({t.neat_per_100l} neat / 100L)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-3xs text-muted-foreground">Start Level (L)</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="e.g. 500"
                        className="h-7 text-xs font-mono mt-0.5"
                        value={item.dayTankStartLevel ?? ''}
                        onChange={(e) =>
                          updateItem(index, { dayTankStartLevel: +e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-3xs text-muted-foreground">End Level (L)</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="e.g. 350"
                        className="h-7 text-xs font-mono mt-0.5"
                        value={item.dayTankEndLevel ?? ''}
                        onChange={(e) =>
                          updateItem(index, { dayTankEndLevel: +e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Conversion Result Footer */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30 text-3xs text-muted-foreground">
                <div className="font-mono">
                  = <span className="font-semibold text-foreground">{fmtNum(item.qtyBase, 2)} {item.unit}</span>
                  {item.activeKg !== null && (
                    <span className="ml-1.5">
                      (≈ {fmtNum(item.activeKg, 2)} kg active)
                    </span>
                  )}
                  {item.lineCost !== null && item.lineCost > 0 && (
                    <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                      · ₱{fmtNum(item.lineCost, 2)}
                    </span>
                  )}
                </div>

                {currentItems.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Container / Line button */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="w-full h-6 text-2xs text-muted-foreground hover:text-foreground gap-1 border border-dashed border-border/60"
        onClick={addItem}
      >
        <Plus className="h-3 w-3" /> Add another {displayName} batch / container
      </Button>
    </Card>
  );
}
