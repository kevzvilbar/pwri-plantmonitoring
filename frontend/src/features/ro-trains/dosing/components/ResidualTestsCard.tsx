import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, FlaskConical, Gauge, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { fmtNum } from '@/lib/calculations';

export interface ResidualTestSample {
  id: string;
  samplingPoint: string;
  pointRole: 'product' | 'feed' | 'pretreatment_outlet' | 'ro_feed' | 'distribution' | 'other';
  method: 'dpd_free' | 'dpd_total' | 'oto' | 'online';
  parameter: 'free' | 'total';
  residualPpm: string;
  testedAt: string;
  reagentCatalogId?: string;
  reagentQty?: number;
}

interface ResidualTestsCardProps {
  samples: ResidualTestSample[];
  onChange: (samples: ResidualTestSample[]) => void;
}

const POINT_ROLE_OPTIONS = [
  { value: 'product', label: 'Product Water Tank Outlet' },
  { value: 'pretreatment_outlet', label: 'Pretreatment Outlet' },
  { value: 'ro_feed', label: 'RO Feed Water' },
  { value: 'feed', label: 'Raw Water Intake' },
  { value: 'distribution', label: 'Distribution Network' },
  { value: 'other', label: 'Other Sampling Point' },
] as const;

export function ResidualTestsCard({ samples, onChange }: ResidualTestsCardProps) {
  const addSample = () => {
    const newSample: ResidualTestSample = {
      id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      samplingPoint: 'Product Water Tank Outlet',
      pointRole: 'product',
      method: 'dpd_free',
      parameter: 'free',
      residualPpm: '',
      testedAt: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    };
    onChange([...samples, newSample]);
  };

  const updateSample = (id: string, patch: Partial<ResidualTestSample>) => {
    onChange(
      samples.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, ...patch };
        if (patch.method) {
          if (patch.method === 'dpd_free') updated.parameter = 'free';
          else if (patch.method === 'dpd_total') updated.parameter = 'total';
        }
        return updated;
      })
    );
  };

  const removeSample = (id: string) => {
    onChange(samples.filter((s) => s.id !== id));
  };

  // Computations
  const productSamples = samples.filter((s) => s.pointRole === 'product' && s.residualPpm !== '' && !isNaN(+s.residualPpm));
  const avgProductPpm = productSamples.length
    ? productSamples.reduce((sum, s) => sum + +s.residualPpm, 0) / productSamples.length
    : null;

  return (
    <Card className="p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-bold bg-muted rounded-md text-foreground">
            <FlaskConical className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-sm font-semibold leading-tight">Residual Testing Samples</h4>
            <span className="text-2xs text-muted-foreground">
              Chlorine residual checks (DPD Pillows, OTO Liquid, or Online Sensor)
            </span>
          </div>
        </div>

        {avgProductPpm !== null && (
          <div className="text-right">
            <div className="text-2xs text-muted-foreground">Avg Product Cl₂</div>
            <div className="text-xs font-mono font-bold text-foreground">
              {fmtNum(avgProductPpm, 2)} ppm
            </div>
          </div>
        )}
      </div>

      {/* Samples Table / List */}
      {samples.length === 0 ? (
        <div className="p-4 text-center border border-dashed rounded-lg bg-muted/20 text-xs text-muted-foreground space-y-2">
          <p>No residual chlorine tests logged for this shift.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={addSample}
          >
            <Plus className="h-3 w-3" /> Add Test Sample
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {samples.map((sample, idx) => (
            <div
              key={sample.id}
              className="p-2.5 rounded-lg bg-muted/30 border border-border/40 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-mono text-2xs font-semibold text-muted-foreground">
                  <span>Sample #{idx + 1}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeSample(sample.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-3xs text-muted-foreground">Sampling Location</Label>
                  <Select
                    value={sample.pointRole}
                    onValueChange={(val: any) => {
                      const matched = POINT_ROLE_OPTIONS.find((o) => o.value === val);
                      updateSample(sample.id, {
                        pointRole: val,
                        samplingPoint: matched ? matched.label : sample.samplingPoint,
                      });
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs mt-0.5">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {POINT_ROLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-3xs text-muted-foreground">Custom Point Name</Label>
                  <Input
                    className="h-7 text-xs mt-0.5"
                    placeholder="e.g. Tank 2 outlet"
                    value={sample.samplingPoint}
                    onChange={(e) => updateSample(sample.id, { samplingPoint: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-3xs text-muted-foreground">Method</Label>
                  <Select
                    value={sample.method}
                    onValueChange={(val: any) => updateSample(sample.id, { method: val })}
                  >
                    <SelectTrigger className="h-7 text-xs mt-0.5">
                      <SelectValue placeholder="Method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dpd_free">DPD Free (Pillow)</SelectItem>
                      <SelectItem value="dpd_total">DPD Total (Pillow)</SelectItem>
                      <SelectItem value="oto">OTO (Liquid Reagent)</SelectItem>
                      <SelectItem value="online">Online Sensor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-3xs text-muted-foreground">Residual (ppm)</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="e.g. 0.5"
                    className="h-7 text-xs font-mono mt-0.5"
                    value={sample.residualPpm}
                    onChange={(e) => updateSample(sample.id, { residualPpm: e.target.value })}
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <Label className="text-3xs text-muted-foreground">Test Time</Label>
                  <Input
                    type="datetime-local"
                    className="h-7 text-xs mt-0.5"
                    value={sample.testedAt}
                    onChange={(e) => updateSample(sample.id, { testedAt: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full h-7 text-xs gap-1 border-dashed"
            onClick={addSample}
          >
            <Plus className="h-3 w-3" /> Add Another Sample
          </Button>
        </div>
      )}
    </Card>
  );
}
