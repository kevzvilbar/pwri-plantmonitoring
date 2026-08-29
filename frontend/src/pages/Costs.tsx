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
import { BarChart2, Zap, TrendingUp, FlaskConical, Layers, DollarSign } from 'lucide-react';

export default function Costs() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'rollup';
  const { isManager, isAdmin } = useAuth();
  const canViewBudget = usePermission('costs', 'budget');

  return (
    <div className="space-y-4 animate-fade-in max-w-[1600px] mx-auto pb-10" data-testid="costs-page">
      <PageHeader
        title="Costs"
        subtitle="Production cost, power bills & tariffs, chemical & filter prices"
      />

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className={`grid ${canViewBudget ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-5'} w-full`}>
          <TabsTrigger value="rollup" className="gap-1.5">
            <BarChart2 className="h-3.5 w-3.5" />
            <span>Rollup</span>
          </TabsTrigger>
          <TabsTrigger value="power" className="gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            <span>Power</span>
          </TabsTrigger>
          <TabsTrigger value="compare" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Compare</span>
          </TabsTrigger>
          <TabsTrigger value="prices" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />
            <span>Prices</span>
          </TabsTrigger>
          <TabsTrigger value="filters" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            <span>Filters</span>
          </TabsTrigger>
          {canViewBudget && (
            <TabsTrigger value="budget" className="gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              <span>Budget</span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="rollup" className="mt-4"><Rollup /></TabsContent>
        <TabsContent value="power" className="mt-4"><Power /></TabsContent>
        <TabsContent value="compare" className="mt-4"><Compare /></TabsContent>
        <TabsContent value="prices" className="mt-4"><ChemicalPrices /></TabsContent>
        <TabsContent value="filters" className="mt-4"><FiltersTab /></TabsContent>
        {canViewBudget && <TabsContent value="budget" className="mt-4"><BudgetTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
