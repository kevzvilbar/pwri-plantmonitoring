import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, FlaskConical, AlertCircle, CheckCircle2 } from 'lucide-react';
import { ChemicalCatalogItem } from '../useChemCatalog';
import { computeLiquidReagentMl, computeLineCost, computeBottleYieldVariance } from '../dosingMath';
import { fmtNum } from '@/lib/calculations';
import { ResidualTestSample } from './ResidualTestsCard';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ConsumableItem {
  catalogId: string;
  chemicalName: string;
  baseUnit: 'pcs' | 'mL';
  autoQty: number;
  extraQty: number;
  extraReason: string;
  totalQty: number;
  unitPrice: number | null;
  lineCost: number | null;
}

interface ConsumablesCardProps {
  plantId: string;
  operatorId?: string | null;
  catalogReagents: ChemicalCatalogItem[];
  residualSamples: ResidualTestSample[];
  prices?: Record<string, number>;
  extraConsumables: Record<string, { extraQty: number; extraReason: string }>;
  onExtraChange: (extras: Record<string, { extraQty: number; extraReason: string }>) => void;
}

const EXTRA_REASONS = [
  { value: 'retest', label: 'Re-test / Verification' },
  { value: 'spill', label: 'Spilled / Damaged' },
  { value: 'qc_check', label: 'QC / Calibration Check' },
  { value: 'expired', label: 'Expired / Defective' },
  { value: 'other', label: 'Other Reason' },
] as const;

export function ConsumablesCard({
  plantId,
  operatorId,
  catalogReagents,
  residualSamples,
  prices,
  extraConsumables,
  onExtraChange,
}: ConsumablesCardProps) {
  // Bottle finish dialog state
  const [packModalOpen, setPackModalOpen] = useState(false);
  const [selectedPackCatId, setSelectedPackCatId] = useState('');
  const [packTestsRun, setPackTestsRun] = useState('200');
  const [packRatedTests, setPackRatedTests] = useState('200');
  const [isSubmittingPack, setIsSubmittingPack] = useState(false);

  // Compute automatic usage per catalog reagent
  const consumableLines = useMemo<ConsumableItem[]>(() => {
    return catalogReagents.map((cat) => {
      let autoQty = 0;

      if (cat.base_unit === 'pcs') {
        // Count matching samples
        if (cat.methods?.includes('dpd_free')) {
          autoQty += residualSamples.filter((s) => s.method === 'dpd_free').length;
        }
        if (cat.methods?.includes('dpd_total')) {
          autoQty += residualSamples.filter((s) => s.method === 'dpd_total').length;
        }
      } else if (cat.base_unit === 'mL') {
        // Liquid reagent
        const otoCount = residualSamples.filter(
          (s) => s.method === 'oto' || (s.method === 'dpd_free' && cat.methods?.includes('dpd_free') && cat.form === 'drops')
        ).length;
        const drops = cat.drops_per_test ?? 5;
        const mlPerDrop = cat.ml_per_drop ?? 0.05;
        autoQty = computeLiquidReagentMl(otoCount, drops, mlPerDrop);
      }

      const extra = extraConsumables[cat.id] ?? { extraQty: 0, extraReason: 'retest' };
      const totalQty = autoQty + (extra.extraQty || 0);
      const unitPrice = prices?.[cat.price_key] ?? null;
      const lineCost = computeLineCost(totalQty, 0, unitPrice);

      return {
        catalogId: cat.id,
        chemicalName: cat.name,
        baseUnit: cat.base_unit as 'pcs' | 'mL',
        autoQty,
        extraQty: extra.extraQty,
        extraReason: extra.extraReason,
        totalQty,
        unitPrice,
        lineCost,
      };
    });
  }, [catalogReagents, residualSamples, extraConsumables, prices]);

  const updateExtra = (catalogId: string, patch: Partial<{ extraQty: number; extraReason: string }>) => {
    const current = extraConsumables[catalogId] ?? { extraQty: 0, extraReason: 'retest' };
    onExtraChange({
      ...extraConsumables,
      [catalogId]: { ...current, ...patch },
    });
  };

  const handleFinishBottle = async () => {
    if (!plantId || !selectedPackCatId) {
      toast.error('Select plant and reagent bottle');
      return;
    }
    const testsRun = +packTestsRun || 0;
    const ratedTests = +packRatedTests || 200;
    const yieldPct = ratedTests > 0 ? +((testsRun / ratedTests) * 100).toFixed(1) : 100;

    setIsSubmittingPack(true);
    try {
      const { error } = await supabase.from('reagent_pack_events' as any).insert({
        plant_id: plantId,
        catalog_id: selectedPackCatId,
        event_at: new Date().toISOString(),
        recorded_by: operatorId || null,
        tests_since_prev: testsRun,
        rated_tests: ratedTests,
        yield_pct: yieldPct,
      });

      if (error) throw error;

      toast.success(`Logged bottle completion: ${yieldPct}% yield (${testsRun}/${ratedTests} tests)`);
      setPackModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to log pack event');
    } finally {
      setIsSubmittingPack(false);
    }
  };

  const totalCost = consumableLines.reduce((sum, l) => sum + (l.lineCost || 0), 0);
  const liquidReagents = catalogReagents.filter((r) => r.base_unit === 'mL' || r.form === 'drops');

  return (
    <Card className="p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-bold bg-muted rounded-md text-foreground">
            <FlaskConical className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-sm font-semibold leading-tight">Testing Consumables & Reagents</h4>
            <span className="text-2xs text-muted-foreground">
              Auto-tracked pillow and liquid reagent stock & costing
            </span>
          </div>
        </div>

        {totalCost > 0 && (
          <div className="text-right">
            <div className="text-2xs text-muted-foreground">Consumables Cost</div>
            <div className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              ₱{fmtNum(totalCost, 2)}
            </div>
          </div>
        )}
      </div>

      {/* Consumable Rows */}
      <div className="space-y-2">
        {consumableLines.map((line) => (
          <div
            key={line.catalogId}
            className="p-2.5 rounded-lg bg-muted/30 border border-border/40 space-y-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-foreground">{line.chemicalName}</span>
                <span className="text-3xs text-muted-foreground ml-2">
                  (Auto: {fmtNum(line.autoQty, line.baseUnit === 'mL' ? 2 : 0)} {line.baseUnit})
                </span>
              </div>
              <div className="text-right font-mono">
                <span className="font-semibold">
                  {fmtNum(line.totalQty, line.baseUnit === 'mL' ? 2 : 0)} {line.baseUnit}
                </span>
                {line.lineCost !== null && line.lineCost > 0 && (
                  <span className="text-3xs text-emerald-600 dark:text-emerald-400 ml-1.5 font-semibold">
                    ₱{fmtNum(line.lineCost, 2)}
                  </span>
                )}
              </div>
            </div>

            {/* Extra Reagents Entry */}
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center pt-1 border-t border-border/30">
              <div>
                <Label className="text-3xs text-muted-foreground">Extra Used</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0"
                  className="h-7 text-xs font-mono mt-0.5"
                  value={line.extraQty || ''}
                  onChange={(e) =>
                    updateExtra(line.catalogId, { extraQty: Math.max(0, +e.target.value) })
                  }
                />
              </div>
              <div>
                <Label className="text-3xs text-muted-foreground">Reason for Extra</Label>
                <Select
                  value={line.extraReason || 'retest'}
                  onValueChange={(val) => updateExtra(line.catalogId, { extraReason: val })}
                  disabled={!line.extraQty}
                >
                  <SelectTrigger className="h-7 text-xs mt-0.5">
                    <SelectValue placeholder="Reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXTRA_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottle Finished Action */}
      {liquidReagents.length > 0 && (
        <div className="pt-1">
          <Dialog open={packModalOpen} onOpenChange={setPackModalOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs gap-1.5"
                onClick={() => {
                  setSelectedPackCatId(liquidReagents[0]?.id || '');
                  setPackModalOpen(true);
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Log Finished Liquid Reagent Bottle
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Finish Reagent Bottle & Log Yield</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <p className="text-muted-foreground">
                  Record when a liquid reagent dropper bottle is depleted to track actual test yield
                  versus manufacturer specifications.
                </p>
                <div>
                  <Label>Reagent Product</Label>
                  <Select value={selectedPackCatId} onValueChange={setSelectedPackCatId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select reagent" />
                    </SelectTrigger>
                    <SelectContent>
                      {liquidReagents.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Actual Tests Run</Label>
                    <Input
                      type="number"
                      min="1"
                      className="mt-1 font-mono"
                      value={packTestsRun}
                      onChange={(e) => setPackTestsRun(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Rated Bottle Tests</Label>
                    <Input
                      type="number"
                      min="1"
                      className="mt-1 font-mono"
                      value={packRatedTests}
                      onChange={(e) => setPackRatedTests(e.target.value)}
                    />
                  </div>
                </div>

                {+packTestsRun > 0 && +packRatedTests > 0 && (
                  <div className="p-2.5 rounded-lg bg-muted border font-mono text-center">
                    <span className="text-muted-foreground">Bottle Yield: </span>
                    <span className="font-bold text-foreground">
                      {fmtNum((+packTestsRun / +packRatedTests) * 100, 1)}%
                    </span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPackModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleFinishBottle} disabled={isSubmittingPack}>
                  {isSubmittingPack ? 'Saving...' : 'Save Yield Record'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Card>
  );
}
