import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Check } from 'lucide-react';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum } from '@/lib/calculations';

export function CostInsights({ rows, totals, from, to }: { rows: any[]; totals: any; from: string; to: string }) {
  const insights = useMemo(() => {
    const out: { label: string; tone: 'accent' | 'warn' | 'danger' | 'info'; text: string }[] = [];
    if (!rows.length) return out;
    const days = rows.length;
    const avgCost = totals.total / days;
    const peak = rows.reduce((m: any, r: any) => ((+r.chem_cost + +r.power_cost) > (+m.chem_cost + +m.power_cost) ? r : m), rows[0]);
    const peakTotal = (+peak.chem_cost || 0) + (+peak.power_cost || 0);
    const chemShare = totals.total ? (totals.chem / totals.total) * 100 : 0;
    out.push({ label: 'Period', tone: 'info', text: `${days} day(s) · ₱${fmtNum(avgCost, 0)} avg/day · ${chemShare.toFixed(0)}% chem / ${(100 - chemShare).toFixed(0)}% power.` });
    if (avgCost > 0 && peakTotal > avgCost * 1.5) {
      out.push({ label: 'Spike', tone: 'warn', text: `${peak.cost_date}: ₱${fmtNum(peakTotal, 0)} (${((peakTotal / avgCost - 1) * 100).toFixed(0)}% above average). Check for tariff change or chemical top-up.` });
    }
    if (totals.perM3 && totals.perM3 > 25) {
      out.push({ label: 'Cost/m³', tone: 'danger', text: `₱${totals.perM3.toFixed(2)}/m³ exceeds ₱25 benchmark. Review power efficiency or chemical dosing.` });
    } else if (totals.perM3) {
      out.push({ label: 'Cost/m³', tone: 'accent', text: `₱${totals.perM3.toFixed(2)}/m³ within healthy range.` });
    }
    if (totals.prod === 0) {
      out.push({ label: 'No production', tone: 'danger', text: 'Production volume is zero — verify well meter readings are recorded.' });
    }
    return out;
  }, [rows, totals]);

  if (!rows.length) return (
    <Card className="p-4 text-center text-sm text-muted-foreground">No cost data in {from} → {to}</Card>
  );

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Auto insights</h4>
        <span className="text-2xs text-muted-foreground">Computed monthly · no manual notes needed</span>
      </div>
      <div className="space-y-1.5">
        {insights.map((i, idx) => (
          <div key={`${i.tone ?? 'none'}-${i.label}-${idx}`} className="flex items-start gap-2 text-xs">
            <StatusPill tone={i.tone}>{i.label}</StatusPill>
            <span className="flex-1 pt-0.5">{i.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
