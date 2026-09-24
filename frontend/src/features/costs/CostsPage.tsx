import { useUrlTab } from '@/hooks/useUrlTab';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { BudgetTab } from './components/BudgetTab';
import { FiltersTab } from './tabs/FiltersTab';
import { ChemicalPrices } from './tabs/ChemicalPrices';
import { Rollup } from './tabs/Rollup';
import { Power } from './tabs/Power';
import { Compare } from './tabs/Compare';
import { BarChart2, Zap, TrendingUp, FlaskConical, Layers, DollarSign } from 'lucide-react';

const COSTS_TABS = ['rollup', 'power', 'compare', 'prices', 'filters'] as const;
const COSTS_TABS_WITH_BUDGET = [...COSTS_TABS, 'budget'] as const;

export default function Costs() {
  const { isManager, isAdmin } = useAuth();
  const canViewBudget = usePermission('costs', 'budget');
  // Budget is permission-gated: without it, the Dashboard's ?tab=budget link
  // opens Rollup instead of an empty page.
  const [tab, setTab] = useUrlTab('tab', canViewBudget ? COSTS_TABS_WITH_BUDGET : COSTS_TABS, 'rollup');

  return (
    <div className="space-y-4 animate-fade-in max-w-[1600px] mx-auto pb-10" data-testid="costs-page">
      <PageHeader
        title="Costs & Tariffs"
        subtitle="Production cost, power bills & tariffs, chemical & filter prices"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={`grid ${canViewBudget ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-5'} w-full h-auto sm:h-10 p-1 gap-1`}>
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
