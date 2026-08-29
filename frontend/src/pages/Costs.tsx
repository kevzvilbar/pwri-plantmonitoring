import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BudgetTab } from '@/components/costs/BudgetTab';
import { FiltersTab } from './costs/FiltersTab';
import { ChemicalPrices } from './costs/ChemicalPrices';
import { Rollup } from './costs/Rollup';
import { Power } from './costs/Power';
import { Compare } from './costs/Compare';
import { BarChart2, Zap, TrendingUp, FlaskConical, Layers, CircleDollarSign, DollarSign, Wallet } from 'lucide-react';

export default function Costs() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'rollup';
  const { isManager, isAdmin } = useAuth();
  const canViewBudget = usePermission('costs', 'budget');

  return (
    <div className="space-y-5 animate-fade-in max-w-[1600px] mx-auto pb-10" data-testid="costs-page">
      {/* ── Executive OPEX Header Banner ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card to-muted/40 p-5 sm:p-6 shadow-sm">
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-primary to-accent text-white flex items-center justify-center shrink-0 shadow-md">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                  OPEX &amp; Financial Governance
                </h1>
                <span className="inline-flex items-center gap-1 text-2xs font-extrabold px-2.5 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/30">
                  <CircleDollarSign className="h-3 w-3" />
                  Cost Analytics
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Production cost breakdown, power tariffs &amp; billing reconciliation, chemical dosing costs, and filter replacements.
              </p>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className={`grid ${canViewBudget ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-5'} w-full h-auto bg-muted/60 border border-border/60 rounded-2xl p-1.5 gap-1 shadow-2xs`}>
          <TabsTrigger
            value="rollup"
            className="text-xs py-2.5 rounded-xl font-bold gap-1.5 transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
          >
            <BarChart2 className="h-3.5 w-3.5" />
            <span>Rollup</span>
          </TabsTrigger>
          <TabsTrigger
            value="power"
            className="text-xs py-2.5 rounded-xl font-bold gap-1.5 transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Power</span>
          </TabsTrigger>
          <TabsTrigger
            value="compare"
            className="text-xs py-2.5 rounded-xl font-bold gap-1.5 transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Compare</span>
          </TabsTrigger>
          <TabsTrigger
            value="prices"
            className="text-xs py-2.5 rounded-xl font-bold gap-1.5 transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span>Prices</span>
          </TabsTrigger>
          <TabsTrigger
            value="filters"
            className="text-xs py-2.5 rounded-xl font-bold gap-1.5 transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Filters</span>
          </TabsTrigger>
          {canViewBudget && (
            <TabsTrigger
              value="budget"
              className="text-xs py-2.5 rounded-xl font-bold gap-1.5 transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
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
