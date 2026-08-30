import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { LayoutGrid, Recycle } from 'lucide-react';
import { ROTrainIcon, ChemicalsIcon } from '@/components/icons/water-icons';

import { CIPLog } from './cip/CIPLog';
import { ChemicalDosing } from './dosing/ChemicalDosing';
import { Overview } from './Overview';
import { PretreatmentAndROLog } from './pretreatment/PretreatmentAndROLog';

// Mirrors the ?tab= pattern already used by operations/index.tsx, so alerts
// (Dashboard.tsx) and notifications can deep-link straight to a tab instead
// of always landing on Overview.
const VALID_TABS = new Set(['overview', 'pretreat-ro', 'cip', 'chemical-dosing']);

export default function ROTrains() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = VALID_TABS.has(searchParams.get('tab') || '') ? searchParams.get('tab')! : 'overview';
  const [tab, setTab] = useState<string>(urlTab);

  // Keep local tab state in sync if the URL changes from outside this
  // component (e.g. clicking another alert while already on this page).
  useEffect(() => { if (urlTab !== tab) setTab(urlTab); }, [urlTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (next: string) => {
    if (!VALID_TABS.has(next)) return;
    setTab(next);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', next);
    // Manual tab clicks shouldn't also carry over a train/plant deep-link
    // from a previous alert click — that's confusing once the operator has
    // moved on to a different train.
    sp.delete('train');
    setSearchParams(sp, { replace: true });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="RO Trains & Pre-Treatment" />
      <Tabs value={tab} onValueChange={handleTabChange} className="space-y-3">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto p-1.5 rounded-2xl bg-card/80 backdrop-blur-md border border-border/70 shadow-2xs gap-1">
          <TabsTrigger
            value="overview"
            className="min-h-[44px] rounded-xl py-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-xs sm:text-sm font-semibold gap-2 transition-all"
          >
            <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
            <span>Overview</span>
          </TabsTrigger>

          <TabsTrigger
            value="pretreat-ro"
            className="min-h-[44px] rounded-xl py-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-xs sm:text-sm font-semibold gap-2 transition-all leading-tight"
          >
            <ROTrainIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span>Pre-Treatment & RO</span>
          </TabsTrigger>

          <TabsTrigger
            value="cip"
            className="min-h-[44px] rounded-xl py-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-xs sm:text-sm font-semibold gap-2 transition-all"
          >
            <Recycle className="h-4 w-4 shrink-0" aria-hidden />
            <span>CIP</span>
          </TabsTrigger>

          <TabsTrigger
            value="chemical-dosing"
            className="min-h-[44px] rounded-xl py-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-xs sm:text-sm font-semibold gap-2 transition-all leading-tight"
          >
            <ChemicalsIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span>Chemical Dosing</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-2"><Overview /></TabsContent>
        <TabsContent value="pretreat-ro" className="mt-2"><PretreatmentAndROLog /></TabsContent>
        <TabsContent value="cip" className="mt-2"><CIPLog /></TabsContent>
        <TabsContent value="chemical-dosing" className="mt-2"><ChemicalDosing /></TabsContent>
      </Tabs>
    </div>
  );
}
