import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { PLANT_CHEMICALS } from '@/lib/chemicals';
import { Card } from '@/components/ui/card';
import { ExportButton } from '@/components/ExportButton';
import { Skeleton } from '@/components/ui/skeleton';
import { DataState } from '@/components/DataState';
import { PriceForm } from './PriceForm';
import { PriceHistoryList } from './PriceHistoryList';
import { useChemicalPriceForm } from './useChemicalPriceForm';
import { useChemicalPriceEdit } from './useChemicalPriceEdit';
import { useChemicalPriceDelete } from './useChemicalPriceDelete';

const CIP_ONLY_CHEMICALS = ['Free Cl Reagent', 'Caustic Soda', 'HCl', 'SLS'];
const KNOWN_CHEMICALS = [...PLANT_CHEMICALS.map((c) => c.name), ...CIP_ONLY_CHEMICALS];

export { CIP_ONLY_CHEMICALS, KNOWN_CHEMICALS };

export function ChemicalPrices() {
  const qc = useQueryClient();
  const { user, isManager, isAdmin } = useAuth();
  const { selectedPlantId } = useAppStore();
  const canEdit = usePermission('costs', 'edit');

  const form = useChemicalPriceForm();
  const edit = useChemicalPriceEdit(user?.id);
  const del  = useChemicalPriceDelete();

  const { data, isLoading } = useQuery({
    queryKey: ['chem-prices'],
    queryFn: async () => (await supabase.from('chemical_prices').select('*').order('effective_date', { ascending: false }).limit(50)).data ?? [],
  });

  return (
    <div className="space-y-3">
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
            <p className="text-2xs text-muted-foreground">Active and historical cost benchmarks</p>
          </div>
          <ExportButton table="chemical_prices" label="Export" />
        </div>

        <DataState
          loading={isLoading}
          isEmpty={!data?.length}
          emptyTitle="No prices yet"
        >
          <PriceHistoryList
            data={data}
            isLoading={isLoading}
            canEdit={canEdit}
            edit={edit}
            del={del}
            onStartEdit={edit.startEdit}
            onRequestDelete={(id) => { edit.editId = null; del.setDeleteId(id); }}
          />
        </DataState>
      </Card>
    </div>
  );
}

