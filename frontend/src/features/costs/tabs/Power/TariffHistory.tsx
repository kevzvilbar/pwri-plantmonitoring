import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { ExportButton } from '@/components/ExportButton';

interface TariffHistoryProps {
  plantId: string;
}

export function TariffHistory({ plantId }: TariffHistoryProps) {
  const { data: tariffs } = useQuery({
    queryKey: ['tariffs', plantId],
    queryFn: async () => plantId ? (await supabase.from('power_tariffs').select('*').eq('plant_id', plantId).order('effective_date', { ascending: false }).limit(12)).data ?? [] : [],
    enabled: !!plantId,
  });

  return (
    <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Tariff History</h4>
          <p className="text-2xs text-muted-foreground">Effective energy rates per kWh</p>
        </div>
        {plantId && <ExportButton table="power_tariffs" label="Export" filters={{ plant_id: plantId }} />}
      </div>

      <div className="divide-y divide-border/40">
        {tariffs?.map((t: any) => (
          <div key={t.id} className="flex justify-between items-center text-xs py-2 hover:bg-muted/20 transition-colors">
            <div>
              <div className="font-mono-num font-semibold text-foreground">{t.effective_date}</div>
              <div className="text-3xs text-muted-foreground">{t.provider ?? '—'} · ×{t.multiplier}</div>
            </div>
            <div className="font-mono-num font-bold text-primary">₱{(+t.rate_per_kwh).toFixed(4)} <span className="text-3xs text-muted-foreground">/ kWh</span></div>
          </div>
        ))}
        {!tariffs?.length && plantId && <p className="text-xs text-center text-muted-foreground py-4">No tariffs on record</p>}
      </div>
    </Card>
  );
}
