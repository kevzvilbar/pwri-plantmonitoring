import { Loader2, Save, Settings2, Droplets, Gauge, Beaker } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Thresholds } from '../types';

interface ThresholdEditorProps {
  local: Thresholds | null;
  editing: boolean;
  saving: boolean;
  canEdit: boolean;
  thresholdScope: string;
  plants: Array<{ id: string; name: string }> | undefined;
  onLocalChange: (updater: (prev: Thresholds | null) => Thresholds | null) => void;
  onScopeChange: (scope: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
}

export function ThresholdEditor({
  local,
  editing,
  saving,
  canEdit,
  thresholdScope,
  plants,
  onLocalChange,
  onScopeChange,
  onStartEdit,
  onCancelEdit,
  onSave,
}: ThresholdEditorProps) {
  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">Surveillance Scope:</span>
            <Select value={thresholdScope} onValueChange={onScopeChange}>
              <SelectTrigger className="h-7 w-[210px] text-xs font-semibold">
                <SelectValue placeholder="Select scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global" className="text-xs font-bold text-primary">
                  🌐 Global Fleet Standard
                </SelectItem>
                {(plants ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    🏭 {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            {thresholdScope === 'global'
              ? 'Default baseline thresholds applied across all production facilities unless overridden.'
              : `Plant-specific threshold override for ${(plants ?? []).find((p) => p.id === thresholdScope)?.name ?? thresholdScope}.`}
          </div>
        </div>
        <div className="flex gap-2">
          {!canEdit ? null : !editing ? (
            <Button variant="outline" size="sm" onClick={onStartEdit}>
              <Settings2 className="h-3.5 w-3.5 mr-1" />
              Configure Thresholds
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onCancelEdit}>Cancel</Button>
              <Button size="sm" disabled={saving} onClick={onSave}>
                {saving
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <Save className="h-3.5 w-3.5 mr-1" />}
                Save Thresholds
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Group 1: Water Quality */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
          <div className="flex items-center gap-1.5 mb-2.5 text-xs font-bold text-foreground">
            <Droplets className="h-4 w-4 text-sky-500" />
            <span>Water Quality &amp; Permeate Regulatory Limits</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="permeate_tds_max" className="text-2xs font-semibold text-muted-foreground">Permeate TDS Max (ppm)</Label>
              <Input id="permeate_tds_max" type="number" value={local?.permeate_tds_max ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, permeate_tds_max: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="permeate_ph_min" className="text-2xs font-semibold text-muted-foreground">Permeate pH Min</Label>
              <Input id="permeate_ph_min" type="number" step="0.1" value={local?.permeate_ph_min ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, permeate_ph_min: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="permeate_ph_max" className="text-2xs font-semibold text-muted-foreground">Permeate pH Max</Label>
              <Input id="permeate_ph_max" type="number" step="0.1" value={local?.permeate_ph_max ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, permeate_ph_max: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="product_turbidity_max" className="text-2xs font-semibold text-muted-foreground">Product Turbidity Max (NTU)</Label>
              <Input id="product_turbidity_max" type="number" step="0.1"
                value={local?.product_turbidity_max ?? local?.raw_turbidity_max ?? ''} disabled={!editing}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  onLocalChange((l) => l ? ({ ...l, product_turbidity_max: val, raw_turbidity_max: val }) : l);
                }}
                className="mt-1 font-mono text-xs" />
            </div>
          </div>
        </div>

        {/* Group 2: Hydraulic & Operations */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
          <div className="flex items-center gap-1.5 mb-2.5 text-xs font-bold text-foreground">
            <Gauge className="h-4 w-4 text-emerald-500" />
            <span>Hydraulic &amp; Plant Efficiency Limits</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label htmlFor="nrw_pct_max" className="text-2xs font-semibold text-muted-foreground">NRW % Max</Label>
              <Input id="nrw_pct_max" type="number" value={local?.nrw_pct_max ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, nrw_pct_max: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="recovery_pct_min" className="text-2xs font-semibold text-muted-foreground">Recovery % Min</Label>
              <Input id="recovery_pct_min" type="number" value={local?.recovery_pct_min ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, recovery_pct_min: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="downtime_hrs_per_day_max" className="text-2xs font-semibold text-muted-foreground">Downtime Max (hrs/day)</Label>
              <Input id="downtime_hrs_per_day_max" type="number" step="0.5" value={local?.downtime_hrs_per_day_max ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, downtime_hrs_per_day_max: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="dp_psi_max" className="text-2xs font-semibold text-muted-foreground">Differential Pressure Max (psi)</Label>
              <Input id="dp_psi_max" type="number" value={local?.dp_psi_max ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, dp_psi_max: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="pv_ratio_max" className="text-2xs font-semibold text-muted-foreground">PV Ratio Max</Label>
              <Input id="pv_ratio_max" type="number" step="0.1" value={local?.pv_ratio_max ?? ''} disabled={!editing}
                onChange={(e) => onLocalChange((l) => l ? ({ ...l, pv_ratio_max: parseFloat(e.target.value) || 0 }) : l)}
                className="mt-1 font-mono text-xs" />
            </div>
          </div>
        </div>

        {/* Group 3: Chemical Autonomy */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
          <div className="flex items-center gap-1.5 mb-2.5 text-xs font-bold text-foreground">
            <Beaker className="h-4 w-4 text-amber-500" />
            <span>Chemical Autonomy &amp; Inventory Alarm Limit</span>
          </div>
          <div className="max-w-xs">
            <Label htmlFor="chem_low_stock_days_min" className="text-2xs font-semibold text-muted-foreground">Chemical Low-Stock Warning (Days of Supply)</Label>
            <Input id="chem_low_stock_days_min" type="number" value={local?.chem_low_stock_days_min ?? ''} disabled={!editing}
              onChange={(e) => onLocalChange((l) => l ? ({ ...l, chem_low_stock_days_min: parseFloat(e.target.value) || 0 }) : l)}
              className="mt-1 font-mono text-xs" />
            <p className="text-3xs text-muted-foreground mt-1">Raises warning alert if projected run-out is under this duration.</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
