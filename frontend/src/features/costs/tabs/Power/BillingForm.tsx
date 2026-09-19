import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ComputedInput } from '@/components/ComputedInput';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Zap } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { fmtNum } from '@/lib/calculations';
import type { BillingFormValues } from './usePowerBilling';

interface BillingFormProps {
  plantId: string;
  v: BillingFormValues;
  setV: React.Dispatch<React.SetStateAction<BillingFormValues>>;
  totalKwh: number | null;
  derivedRate: number | null;
  canEdit: boolean;
  monthOptions: { value: string; label: string }[];
  onSubmit: () => void;
  onMultiplierChange: (val: string) => void;
}

export function BillingForm({
  plantId, v, setV, totalKwh, derivedRate, canEdit,
  monthOptions, onSubmit, onMultiplierChange,
}: BillingFormProps) {
  return (
    <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Log Electric Bill</h4>
        <p className="text-2xs text-muted-foreground">Record monthly power utility bill and derive effective kWh rate</p>
      </div>

      <div className="p-3 rounded-xl border border-border/50 bg-muted/20 space-y-2">
        <div className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Billing Period &amp; Utility</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div>
            <Label htmlFor="costs-billing-month" className="text-3xs uppercase tracking-wider text-muted-foreground">Billing Month</Label>
            <Select value={v.billing_month} onValueChange={(val) => setV({ ...v, billing_month: val })}>
              <SelectTrigger className="h-8.5 text-xs bg-background" id="costs-billing-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="costs-provider" className="text-3xs uppercase tracking-wider text-muted-foreground">Provider</Label>
            <Input className="h-8.5 text-xs" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} placeholder="VECO / NGCP" id="costs-provider"/>
          </div>
          <div>
            <Label htmlFor="costs-period-from" className="text-3xs uppercase tracking-wider text-muted-foreground">Period From</Label>
            <DatePicker id="costs-period-from" value={v.period_start} onChange={(d) => setV({ ...v, period_start: d })} className="h-8.5 text-xs w-full" />
          </div>
          <div>
            <Label htmlFor="costs-period-to" className="text-3xs uppercase tracking-wider text-muted-foreground">Period To</Label>
            <DatePicker id="costs-period-to" value={v.period_end} onChange={(d) => setV({ ...v, period_end: d })} className="h-8.5 text-xs w-full" />
          </div>
        </div>
      </div>

      <div className="p-3 rounded-xl border border-border/50 bg-muted/20 space-y-2">
        <div className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Meter Telemetry</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div>
            <Label htmlFor="costs-previous" className="text-3xs uppercase tracking-wider text-muted-foreground">Previous Reading</Label>
            <Input type="number" step="any" className="h-8.5 text-xs font-mono-num" placeholder="0.00" value={v.previous_reading} onChange={(e) => setV({ ...v, previous_reading: e.target.value })} id="costs-previous"/>
          </div>
          <div>
            <Label htmlFor="costs-current" className="text-3xs uppercase tracking-wider text-muted-foreground">Current Reading</Label>
            <Input type="number" step="any" className="h-8.5 text-xs font-mono-num" placeholder="0.00" value={v.current_reading} onChange={(e) => setV({ ...v, current_reading: e.target.value })} id="costs-current"/>
          </div>
          <div>
            <Label htmlFor="costs-multiplier" className="text-3xs uppercase tracking-wider text-muted-foreground">Multiplier</Label>
            <Input type="number" step="any" value={v.multiplier} readOnly={!canEdit} className={`h-8.5 text-xs font-mono-num ${!canEdit ? 'bg-muted cursor-not-allowed' : ''}`} onChange={(e) => onMultiplierChange(e.target.value)} id="costs-multiplier" />
          </div>
          <div>
            <Label htmlFor="costs-total-kwh-auto" className="text-3xs uppercase tracking-wider text-muted-foreground">Total kWh (Auto)</Label>
            <ComputedInput value={totalKwh != null ? fmtNum(totalKwh, 2) : ''} id="costs-total-kwh-auto"/>
          </div>
        </div>
      </div>

      <div className="p-3 rounded-xl border border-border/50 bg-muted/20 space-y-2">
        <div className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Charges Breakdown (₱)</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div>
            <Label htmlFor="costs-generation" className="text-3xs uppercase tracking-wider text-muted-foreground">Generation</Label>
            <Input type="number" step="any" className="h-8.5 text-xs font-mono-num" placeholder="0.00" value={v.generation_charge} onChange={(e) => setV({ ...v, generation_charge: e.target.value })} id="costs-generation"/>
          </div>
          <div>
            <Label htmlFor="costs-distribution" className="text-3xs uppercase tracking-wider text-muted-foreground">Distribution</Label>
            <Input type="number" step="any" className="h-8.5 text-xs font-mono-num" placeholder="0.00" value={v.distribution_charge} onChange={(e) => setV({ ...v, distribution_charge: e.target.value })} id="costs-distribution"/>
          </div>
          <div>
            <Label htmlFor="costs-other" className="text-3xs uppercase tracking-wider text-muted-foreground">Other Charges</Label>
            <Input type="number" step="any" className="h-8.5 text-xs font-mono-num" placeholder="0.00" value={v.other_charges} onChange={(e) => setV({ ...v, other_charges: e.target.value })} id="costs-other"/>
          </div>
          <div>
            <Label htmlFor="costs-total" className="text-3xs uppercase tracking-wider font-bold text-foreground">Total Amount</Label>
            <Input type="number" step="any" className="h-8.5 text-xs font-mono-num font-semibold" placeholder="0.00" value={v.total_amount} onChange={(e) => setV({ ...v, total_amount: e.target.value })} id="costs-total"/>
          </div>
        </div>
      </div>

      {derivedRate && (
        <div className="rounded-lg bg-accent-soft border border-accent/30 p-2.5 text-xs flex items-center justify-between">
          <div>
            <span className="font-semibold text-accent">Auto-Derived Tariff:</span>{' '}
            <span className="font-mono-num font-bold text-accent">₱{derivedRate.toFixed(4)} / kWh</span>
          </div>
          <span className="text-3xs text-muted-foreground">Effective {v.period_start}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end pt-1">
        <div className="sm:col-span-9 space-y-1">
          <Label htmlFor="costs-remarks" className="text-3xs uppercase tracking-wider text-muted-foreground">Remarks (Optional)</Label>
          <Input className="h-8.5 text-xs" placeholder="e.g. Peak rate adjustment" value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} id="costs-remarks"/>
        </div>
        <div className="sm:col-span-3 flex justify-end">
          <Button onClick={onSubmit} className="h-8.5 w-full sm:w-auto px-4 text-xs gap-1.5 font-medium shadow-xs">
            <Zap className="h-3.5 w-3.5" />
            Save Bill {derivedRate ? '+ Tariff' : ''}
          </Button>
        </div>
      </div>
    </Card>
  );
}
