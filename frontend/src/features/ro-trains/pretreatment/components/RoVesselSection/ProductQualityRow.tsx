import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PerUnitReasonRow } from '../PerUnitReasonRow';
import { RO_REASON_OPTIONS } from '../../types';

export interface ProductQualityRowProps {
  f: (key: string) => { value: string; onChange: (e: any) => void };
  roReasonNeeded?: boolean;
  roEntryReasons?: Record<string, { reason: string; custom: string }>;
  onReasonChange?: (key: string, reason: string) => void;
  onCustomReasonChange?: (key: string, custom: string) => void;
  onApplyAll?: (sourceKey: string) => void;
}

export function ProductQualityRow({
  f,
  roReasonNeeded,
  roEntryReasons,
  onReasonChange,
  onCustomReasonChange,
  onApplyAll,
}: ProductQualityRowProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Product Quality</p>
      <div className="grid grid-cols-3 gap-2">
        <div><Label htmlFor="pretreat-product-turbidity-ntu" className="text-xs text-muted-foreground">Product Turbidity (NTU)</Label><Input type="number" step="any" {...f('turbidity_ntu')} id="pretreat-product-turbidity-ntu"/></div>
        <div><Label htmlFor="pretreat-product-temperature-c" className="text-xs text-muted-foreground">Product Temperature (°C)</Label><Input type="number" step="any" {...f('temperature_c')} id="pretreat-product-temperature-c"/></div>
        <div><Label htmlFor="pretreat-product-chlorine-residual-mg-l" className="text-xs text-muted-foreground">Product Chlorine Residual (mg/L)</Label><Input type="number" step="any" min="0" {...f('chlorine_residual_mg_l')} id="pretreat-product-chlorine-residual-mg-l"/></div>
      </div>
      {roReasonNeeded && (
        <div className="space-y-2 mt-2">
          {!f('turbidity_ntu').value && (
            <PerUnitReasonRow
              unitLabel="Product Turbidity"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['turbidity_ntu']?.reason}
              customValue={roEntryReasons?.['turbidity_ntu']?.custom}
              onChange={(val) => onReasonChange?.('turbidity_ntu', val)}
              onCustomChange={(val) => onCustomReasonChange?.('turbidity_ntu', val)}
              onApplyAll={() => onApplyAll?.('turbidity_ntu')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
          {!f('temperature_c').value && (
            <PerUnitReasonRow
              unitLabel="Product Temperature"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['temperature_c']?.reason}
              customValue={roEntryReasons?.['temperature_c']?.custom}
              onChange={(val) => onReasonChange?.('temperature_c', val)}
              onCustomChange={(val) => onCustomReasonChange?.('temperature_c', val)}
              onApplyAll={() => onApplyAll?.('temperature_c')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
        </div>
      )}
    </div>
  );
}
