import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ComputedInput } from '@/components/ComputedInput';
import { cn } from '@/lib/utils';
import { HOUSING_REASON_OPTIONS, getUnitReasonText } from '../types';
import { PerUnitReasonRow } from './PerUnitReasonRow';

export interface PretreatmentSectionProps {
  train: any;
  numCartridgeFilters: number;
  numFilterHousings: number;
  cartridgeHousings: Record<number, { inP: string; outP: string }>;
  setCartridgeHousings: (v: Record<number, { inP: string; outP: string }>) => void;
  housings: Record<number, { inP: string; outP: string }>;
  setHousings: (v: Record<number, { inP: string; outP: string }>) => void;
  cartridgeHousingLabel: string;
  changedElementLabel: string;
  bagsChanged: string;
  setBagsChanged: (v: string) => void;
  cartridgeSectionStarted: boolean;
  setCartridgeSectionStarted: (v: boolean) => void;
  housingReasonNeeded: boolean;
  setHousingReasonNeeded: (v: boolean) => void;
  cartridgeUnitReasons: Record<number, { reason: string; custom: string }>;
  setCartridgeUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
  housingUnitReasons: Record<number, { reason: string; custom: string }>;
  setHousingUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
}

export function PretreatmentSection({
  train,
  numCartridgeFilters,
  numFilterHousings,
  cartridgeHousings,
  setCartridgeHousings,
  housings,
  setHousings,
  cartridgeHousingLabel,
  changedElementLabel,
  bagsChanged,
  setBagsChanged,
  cartridgeSectionStarted,
  setCartridgeSectionStarted,
  housingReasonNeeded,
  setHousingReasonNeeded,
  cartridgeUnitReasons,
  setCartridgeUnitReasons,
  housingUnitReasons,
  setHousingUnitReasons,
}: PretreatmentSectionProps) {
  return (
    <>
      {(numCartridgeFilters ?? 0) > 0 && (
        <Card className="p-3 space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
            {cartridgeHousingLabel} ({numCartridgeFilters}) <span className="text-danger">*</span>
          </h4>
          {Array.from({ length: numCartridgeFilters }, (_, i) => i + 1).map((u) => {
            const inP  = +(cartridgeHousings[u]?.inP  ?? '');
            const outP = +(cartridgeHousings[u]?.outP ?? '');
            const cfDp = cartridgeHousings[u]?.inP && cartridgeHousings[u]?.outP
              ? (inP - outP).toFixed(2) : '';
            const cfDpWarn = cfDp !== '' && +cfDp >= 25;
            const isHousingComplete = !!(cartridgeHousings[u]?.inP && cartridgeHousings[u]?.outP);

            return (
              <div key={u} className="border rounded-md p-2 space-y-2">
                <div className="grid grid-cols-4 gap-2 items-end">
                  <div className="text-xs font-medium pb-2">Housing {u}</div>
                  <div>
                    <Label htmlFor={`pretreat-pressure-in-psi-cart-${u}`} className="text-xs text-muted-foreground">Pressure In (psi)</Label>
                    <Input
                      type="number" step="any"
                      value={cartridgeHousings[u]?.inP ?? ''}
                      onChange={(e) => setCartridgeHousings({
                        ...cartridgeHousings,
                        [u]: { ...(cartridgeHousings[u] || { outP: '' }), inP: e.target.value },
                      })}
                    id={`pretreat-pressure-in-psi-cart-${u}`}/>
                  </div>
                  <div>
                    <Label htmlFor={`pretreat-pressure-out-psi-cart-${u}`} className="text-xs text-muted-foreground">Pressure Out (psi)</Label>
                    <Input
                      type="number" step="any"
                      value={cartridgeHousings[u]?.outP ?? ''}
                      onChange={(e) => setCartridgeHousings({
                        ...cartridgeHousings,
                        [u]: { ...(cartridgeHousings[u] || { inP: '' }), outP: e.target.value },
                      })}
                    id={`pretreat-pressure-out-psi-cart-${u}`}/>
                  </div>
                  <div>
                    <Label htmlFor={`pretreat-pressure-cart-${u}`} className={cn('text-xs', cfDpWarn ? 'text-warn' : 'text-muted-foreground')}>
                      ΔPressure{cfDpWarn ? ' ⚠' : ''}
                    </Label>
                    <ComputedInput value={cfDp} className={cfDpWarn ? 'border-warn text-warn-foreground font-semibold' : 'text-foreground font-medium'} id={`pretreat-pressure-cart-${u}`}/>
                  </div>
                </div>

                {housingReasonNeeded && !isHousingComplete && (
                  <PerUnitReasonRow
                    unitLabel={`${cartridgeHousingLabel} ${u}`}
                    options={HOUSING_REASON_OPTIONS}
                    value={cartridgeUnitReasons[u]?.reason}
                    customValue={cartridgeUnitReasons[u]?.custom}
                    onChange={(val) => setCartridgeUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                      ...prev,
                      [u]: { reason: val, custom: val === 'Other' ? (prev[u]?.custom || '') : '' }
                    }))}
                    onCustomChange={(val) => setCartridgeUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                      ...prev,
                      [u]: { reason: prev[u]?.reason || 'Other', custom: val }
                    }))}
                    onApplyAll={() => {
                      const cur = cartridgeUnitReasons[u];
                      if (!cur?.reason) {
                        toast.error(`Select a reason for Housing ${u} first before applying to all.`);
                        return;
                      }
                      const next = { ...cartridgeUnitReasons };
                      Array.from({ length: numCartridgeFilters }, (_, i) => i + 1).forEach((idx) => {
                        const isDone = !!(cartridgeHousings[idx]?.inP && cartridgeHousings[idx]?.outP);
                        if (!isDone) {
                          next[idx] = { ...cur };
                        }
                      });
                      setCartridgeUnitReasons(next);
                      toast.success('Applied reason to all incomplete housings.');
                    }}
                    applyAllLabel="Apply reason to all incomplete housings"
                  />
                )}
              </div>
            );
          })}
          <div className="pt-1">
            <Label htmlFor="pretreat-field" className="text-xs text-muted-foreground">{changedElementLabel}</Label>
            <Input type="number" min="0" value={bagsChanged} onChange={(e) => setBagsChanged(e.target.value)} id="pretreat-field"/>
          </div>
        </Card>
      )}

      {(numFilterHousings ?? 0) > 0 && (
        <Card className="p-3 space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Filter Housings ({numFilterHousings})</h4>
          {Array.from({ length: numFilterHousings }, (_, i) => i + 1).map((u) => {
            const inP = +(housings[u]?.inP ?? '');
            const outP = +(housings[u]?.outP ?? '');
            const housingDp = housings[u]?.inP && housings[u]?.outP ? (inP - outP).toFixed(2) : '';
            const isHousingComplete = !!(housings[u]?.inP && housings[u]?.outP);

            return (
              <div key={u} className="border rounded-md p-2 space-y-2">
                <div className="grid grid-cols-4 gap-2 items-center">
                  <div className="text-xs font-medium self-center">Housing {u}</div>
                  <div>
                    <Label htmlFor={`pretreat-in-psi-filter-${u}`} className="text-xs text-muted-foreground">In (psi)</Label>
                    <Input type="number" step="any" value={housings[u]?.inP ?? ''}
                      onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { outP: '' }), inP: e.target.value } })} id={`pretreat-in-psi-filter-${u}`}/>
                  </div>
                  <div>
                    <Label htmlFor={`pretreat-out-psi-filter-${u}`} className="text-xs text-muted-foreground">Out (psi)</Label>
                    <Input type="number" step="any" value={housings[u]?.outP ?? ''}
                      onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { inP: '' }), outP: e.target.value } })} id={`pretreat-out-psi-filter-${u}`}/>
                  </div>
                  <div>
                    <Label htmlFor={`pretreat-pressure-filter-${u}`} className="text-xs text-muted-foreground">ΔPressure</Label>
                    <ComputedInput value={housingDp} className="text-foreground font-medium" id={`pretreat-pressure-filter-${u}`}/>
                  </div>
                </div>

                {housingReasonNeeded && !isHousingComplete && (
                  <PerUnitReasonRow
                    unitLabel={`Filter Housing ${u}`}
                    options={HOUSING_REASON_OPTIONS}
                    value={housingUnitReasons[u]?.reason}
                    customValue={housingUnitReasons[u]?.custom}
                    onChange={(val) => setHousingUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                      ...prev,
                      [u]: { reason: val, custom: val === 'Other' ? (prev[u]?.custom || '') : '' }
                    }))}
                    onCustomChange={(val) => setHousingUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                      ...prev,
                      [u]: { reason: prev[u]?.reason || 'Other', custom: val }
                    }))}
                    onApplyAll={() => {
                      const cur = housingUnitReasons[u];
                      if (!cur?.reason) {
                        toast.error(`Select a reason for Filter Housing ${u} first before applying to all.`);
                        return;
                      }
                      const next = { ...housingUnitReasons };
                      Array.from({ length: numFilterHousings }, (_, i) => i + 1).forEach((idx) => {
                        const isDone = !!(housings[idx]?.inP && housings[idx]?.outP);
                        if (!isDone) {
                          next[idx] = { ...cur };
                        }
                      });
                      setHousingUnitReasons(next);
                      toast.success('Applied reason to all incomplete filter housings.');
                    }}
                    applyAllLabel="Apply reason to all incomplete filter housings"
                  />
                )}
              </div>
            );
          })}
          {!(numCartridgeFilters > 0) && (
            <div className="pt-2">
              <Label htmlFor="pretreat-field-2" className="text-xs text-muted-foreground">{changedElementLabel}</Label>
              <Input type="number" min="0" value={bagsChanged} onChange={(e) => setBagsChanged(e.target.value)} id="pretreat-field-2"/>
            </div>
          )}
        </Card>
      )}

      {!cartridgeSectionStarted && (
        <Card className="p-3">
          <Button
            type="button"
            size="sm"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
            onClick={() => {
              const totalHousings = (numCartridgeFilters ?? 0) + (numFilterHousings ?? 0);
              if (totalHousings > 0) {
                const unreasonedCartridges: number[] = [];
                const unreasonedFilters: number[] = [];
                let hasIncomplete = false;

                Array.from({ length: numCartridgeFilters ?? 0 }, (_, i) => i + 1).forEach((u) => {
                  const isComplete = !!(cartridgeHousings[u]?.inP && cartridgeHousings[u]?.outP);
                  if (!isComplete) {
                    hasIncomplete = true;
                    if (!getUnitReasonText(cartridgeUnitReasons[u])) {
                      unreasonedCartridges.push(u);
                    }
                  }
                });

                Array.from({ length: numFilterHousings ?? 0 }, (_, i) => i + 1).forEach((u) => {
                  const isComplete = !!(housings[u]?.inP && housings[u]?.outP);
                  if (!isComplete) {
                    hasIncomplete = true;
                    if (!getUnitReasonText(housingUnitReasons[u])) {
                      unreasonedFilters.push(u);
                    }
                  }
                });

                if (hasIncomplete) {
                  setHousingReasonNeeded(true);
                  if (unreasonedCartridges.length > 0 || unreasonedFilters.length > 0) {
                    const parts: string[] = [];
                    if (unreasonedCartridges.length > 0) {
                      parts.push(`Housing ${unreasonedCartridges.join(', ')}`);
                    }
                    if (unreasonedFilters.length > 0) {
                      parts.push(`Filter Housing ${unreasonedFilters.join(', ')}`);
                    }
                    toast.error(
                      `Missing reading for ${parts.join(' and ')}: please specify a reason for each incomplete unit.`,
                    );
                    return;
                  }
                }
              }
              setCartridgeSectionStarted(true);
            }}
          >
            Proceed to RO Vessels →
          </Button>
          <p className="text-2xs text-muted-foreground text-center mt-1">
            {(numCartridgeFilters ?? 0) + (numFilterHousings ?? 0) === 0
              ? 'No housings configured — click to proceed to RO Vessels.'
              : 'Fill in In & Out pressure for every housing above, or provide a reason for incomplete units.'}
          </p>
        </Card>
      )}
    </>
  );
}
