import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Zap } from 'lucide-react';
import { SeverityBadge } from './SeverityBadge';
import { computeComplianceScore, scoreLabel, labelize } from '../types';
import type { Violation, Thresholds } from '../types';

interface WhatIfSimulatorProps {
  overrideMetrics: Record<string, string>;
  previewMetrics: Record<string, number | undefined> | null;
  whatIfViolations: Violation[] | null;
  local: Thresholds | null;
  onOverrideChange: (key: string, value: string) => void;
  onClear: () => void;
}

const WHAT_IF_KEYS = [
  'nrw_pct', 'downtime_hrs', 'permeate_tds', 'permeate_ph',
  'product_turbidity', 'dp_psi', 'recovery_pct', 'pv_ratio',
];

export function WhatIfSimulator({
  overrideMetrics,
  previewMetrics,
  whatIfViolations,
  onOverrideChange,
  onClear,
}: WhatIfSimulatorProps) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-4 w-4 text-warn" />
          <span className="text-sm font-bold text-foreground">Real-Time What-If Simulation Sandbox</span>
          <Badge variant="outline" className="text-2xs ml-auto border-warn text-warn bg-warn-soft font-bold">
            Live Sandbox
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          Tweak values below to stress-test your compliance score and preview alerts without altering production readings.
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {WHAT_IF_KEYS.map((k) => {
            const fetched = previewMetrics?.[k];
            return (
              <div key={k}>
                <Label htmlFor={`whatif-${k}`} className="text-xs font-semibold">{labelize(k)}</Label>
                {fetched !== undefined && overrideMetrics[k] === undefined && (
                  <div className="text-2xs text-muted-foreground font-mono">
                    Live value: {Math.round((fetched as number) * 100) / 100}
                  </div>
                )}
                <Input
                  id={`whatif-${k}`}
                  type="number"
                  step="0.01"
                  placeholder={fetched !== undefined ? String(Math.round((fetched as number) * 100) / 100) : '—'}
                  className="mt-1 font-mono text-xs"
                  value={overrideMetrics[k] ?? ''}
                  onChange={(e) => onOverrideChange(k, e.target.value)}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onClear}>
            Clear Sandbox Overrides
          </Button>
        </div>
      </Card>

      {/* What-if violations live preview */}
      {whatIfViolations !== null && (
        <Card className={cn(
          'p-3 border-l-4',
          whatIfViolations.length === 0
            ? 'border-accent bg-accent-soft/50'
            : whatIfViolations.some((v) => v.severity === 'high')
              ? 'border-danger bg-danger-soft/50'
              : 'border-warn bg-warn-soft/50',
        )}>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-warn" />
            <span className="text-xs font-bold text-foreground">
              Simulated Compliance Score: {computeComplianceScore(whatIfViolations)}/100 ({scoreLabel(computeComplianceScore(whatIfViolations))})
            </span>
            {whatIfViolations.length === 0
              ? <Badge className="text-2xs bg-accent ml-auto">No violations</Badge>
              : <Badge className="text-2xs bg-danger ml-auto">{whatIfViolations.length} violation{whatIfViolations.length > 1 ? 's' : ''}</Badge>}
          </div>
          {whatIfViolations.length > 0 && (
            <div className="space-y-1 mt-2">
              {whatIfViolations.map((v) => (
                <div key={v.code} className="flex items-center gap-2 text-xs">
                  <SeverityBadge sev={v.severity} />
                  <span className="font-mono font-bold text-foreground">{v.metric}</span>
                  <span className="font-bold text-destructive">{v.value}</span>
                  <span className="text-muted-foreground">
                    {v.comparator} {v.threshold}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
