import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { PLANT_CHEMICALS } from '@/lib/chemicals';
import { Card } from '@/components/ui/card';
import { ExportButton } from '@/components/ExportButton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataState } from '@/components/DataState';
import { PriceForm } from './PriceForm';
import { PriceHistoryList } from './PriceHistoryList';
import { ChemicalVariance } from './ChemicalVariance';
import { useChemicalPriceForm } from './useChemicalPriceForm';
import { useChemicalPriceEdit } from './useChemicalPriceEdit';
import { useChemicalPriceDelete } from './useChemicalPriceDelete';
import { FlaskConical, TrendingUp } from 'lucide-react';

const CIP_ONLY_CHEMICALS = ['Free Cl Reagent', 'Caustic Soda', 'HCl', 'SLS'];
const KNOWN_CHEMICALS = [...PLANT_CHEMICALS.map((c) => c.name), ...CIP_ONLY_CHEMICALS];

export { CIP_ONLY_CHEMICALS, KNOWN_CHEMICALS };

export function ChemicalPrices() {
  const { user } = useAuth();
  const canEdit = usePermission('costs', 'edit');
  const [subTab, setSubTab] = useState<'benchmarks' | 'variance'>('benchmarks');

  const form = useChemicalPriceForm();
  const edit = useChemicalPriceEdit(user?.id);
  const del = useChemicalPriceDelete();

  const { data, isLoading } = useQuery({
    queryKey: ['chem-prices'],
    queryFn: async () =>
      (
        await supabase
          .from('chemical_prices')
          .select('*')
          .order('effective_date', { ascending: false })
          .limit(50)
      ).data ?? [],
  });

  return (
    <div className="space-y-3">
      {/* Subtab Toggle */}
      <div className="flex items-center justify-between gap-2">
        <Tabs value={subTab} onValueChange={(v: any) => setSubTab(v)}>
          <TabsList className="h-8 p-0.5">
            <TabsTrigger value="benchmarks" className="text-xs h-7 gap-1.5 px-3">
              <FlaskConical className="h-3.5 w-3.5" /> Price Benchmarks
            </TabsTrigger>
            <TabsTrigger value="variance" className="text-xs h-7 gap-1.5 px-3">
              <TrendingUp className="h-3.5 w-3.5" /> Chemical Variance & Yields
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {subTab === 'variance' ? (
        <ChemicalVariance />
      ) : (
        <>
          <PriceForm
            itemCategory={form.itemCategory}
            switchCategory={form.switchCategory}
            handleItemChange={form.handleItemChange}
            v={form.v}
            setV={form.setV}
            onSubmit={form.submit}
            recentTariffs={form.recentTariffs}
          />

          <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Price History</h4>
                <p className="text-2xs text-muted-foreground">
                  Active and historical cost benchmarks
                </p>
              </div>
              <ExportButton table="chemical_prices" label="Export" />
            </div>

            <DataState loading={isLoading} isEmpty={!data?.length} emptyTitle="No prices yet">
              <PriceHistoryList
                data={data ?? []}
                isLoading={isLoading}
                canEdit={canEdit}
                edit={edit}
                del={del}
                onStartEdit={edit.startEdit}
                onRequestDelete={(id) => {
                  edit.editId = null;
                  del.setDeleteId(id);
                }}
              />
            </DataState>
          </Card>
        </>
      )}
    </div>
  );
}
