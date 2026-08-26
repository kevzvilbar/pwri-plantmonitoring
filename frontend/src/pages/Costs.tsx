import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { BudgetTab } from '@/components/costs/BudgetTab';
import { FiltersTab } from './costs/FiltersTab';
import { ChemicalPrices } from './costs/ChemicalPrices';
import { Rollup } from './costs/Rollup';
import { Power } from './costs/Power';
import { Compare } from './costs/Compare';

export default function Costs() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'rollup';
  const { isManager, isAdmin } = useAuth();
  // Budget tab is visible AND editable to Manager/Admin only — enforced again at
  // the RLS layer (opex_budgets policies), this is just keeping it out of the UI too.
  const canViewBudget = usePermission('costs', 'budget');
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Costs" subtitle="Production cost, power bills & tariffs, chemical & filter prices" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className={`grid ${canViewBudget ? 'grid-cols-6' : 'grid-cols-5'} w-full h-auto bg-muted rounded-xl p-1`}>
          <TabsTrigger value="rollup" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm">Rollup</TabsTrigger>
          <TabsTrigger value="power" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm">Power</TabsTrigger>
          <TabsTrigger value="compare" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm">Compare</TabsTrigger>
          <TabsTrigger value="prices" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm">Prices</TabsTrigger>
          <TabsTrigger value="filters" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm">Filters</TabsTrigger>
          {canViewBudget && (
            <TabsTrigger value="budget" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm">Budget</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="rollup" className="mt-3"><Rollup /></TabsContent>
        <TabsContent value="power" className="mt-3"><Power /></TabsContent>
        {/* "tariff" and "bills" tabs removed — both merged into the Power tab */}
        <TabsContent value="compare" className="mt-3"><Compare /></TabsContent>
        <TabsContent value="prices" className="mt-3"><ChemicalPrices /></TabsContent>
        <TabsContent value="filters" className="mt-3"><FiltersTab /></TabsContent>
        {canViewBudget && <TabsContent value="budget" className="mt-3"><BudgetTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
