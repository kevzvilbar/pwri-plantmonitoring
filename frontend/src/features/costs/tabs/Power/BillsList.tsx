import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { ExportButton } from '@/components/ExportButton';
import { AlertTriangle } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { format, parseISO } from 'date-fns';

interface BillsListProps {
  plantId: string;
}

export function BillsList({ plantId }: BillsListProps) {
  const { data: bills } = useQuery({
    queryKey: ['bills', plantId],
    queryFn: async () => plantId ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false }).limit(12)).data ?? [] : [],
    enabled: !!plantId,
  });

  return (
    <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Recent Bills</h4>
          <p className="text-2xs text-muted-foreground">Recorded power utility charges</p>
        </div>
        {plantId && <ExportButton table="electric_bills" label="Export" filters={{ plant_id: plantId }} />}
      </div>

      <div className="divide-y divide-border/40">
        {bills?.map((b: any) => {
          const isNegativeKwh = b.total_kwh != null && +b.total_kwh < 0;
          return (
            <div key={b.id} className={`flex justify-between items-center text-xs py-2 hover:bg-muted/20 transition-colors ${isNegativeKwh ? 'bg-destructive/5 rounded px-2' : ''}`}>
              <div>
                <div className="font-mono-num font-semibold text-foreground flex items-center gap-1.5">
                  {b.billing_month ? format(parseISO(b.billing_month), 'MMM yyyy') : '—'}
                  {isNegativeKwh && (
                    <span className="inline-flex items-center gap-0.5 text-3xs font-bold text-destructive border border-destructive/40 rounded px-1.5 py-0.2">
                      <AlertTriangle className="h-2.5 w-2.5" /> Reversed
                    </span>
                  )}
                </div>
                <div className={`font-mono-num text-3xs ${isNegativeKwh ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                  {fmtNum(b.total_kwh, 0)} kWh · ₱{b.total_kwh && +b.total_kwh > 0 ? (+b.total_amount / +b.total_kwh).toFixed(4) : '—'}/kWh · ×{b.multiplier}
                </div>
              </div>
              <div className="font-mono-num font-bold text-foreground">₱{fmtNum(b.total_amount, 2)}</div>
            </div>
          );
        })}
        {!bills?.length && plantId && <p className="text-xs text-center text-muted-foreground py-4">No bills on record</p>}
      </div>
    </Card>
  );
}
