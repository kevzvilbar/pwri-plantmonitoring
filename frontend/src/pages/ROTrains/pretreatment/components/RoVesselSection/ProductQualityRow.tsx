import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ProductQualityRowProps {
  f: (key: string) => { value: string; onChange: (e: any) => void };
}

export function ProductQualityRow({ f }: ProductQualityRowProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Product Quality</p>
      <div className="grid grid-cols-3 gap-2">
        <div><Label htmlFor="pretreat-product-turbidity-ntu" className="text-xs text-muted-foreground">Product Turbidity (NTU)</Label><Input type="number" step="any" {...f('turbidity_ntu')} id="pretreat-product-turbidity-ntu"/></div>
        <div><Label htmlFor="pretreat-product-temperature-c" className="text-xs text-muted-foreground">Product Temperature (°C)</Label><Input type="number" step="any" {...f('temperature_c')} id="pretreat-product-temperature-c"/></div>
        <div><Label htmlFor="pretreat-product-chlorine-residual-mg-l" className="text-xs text-muted-foreground">Product Chlorine Residual (mg/L)</Label><Input type="number" step="any" min="0" {...f('chlorine_residual_mg_l')} id="pretreat-product-chlorine-residual-mg-l"/></div>
      </div>
    </div>
  );
}
