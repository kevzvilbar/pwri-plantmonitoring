import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';

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
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="overview" className="data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-none text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="pretreat-ro" className="data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-none text-2xs sm:text-sm leading-tight">Pre-Treatment & RO</TabsTrigger>
          <TabsTrigger value="cip" className="data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-none text-xs sm:text-sm">CIP</TabsTrigger>
          <TabsTrigger value="chemical-dosing" className="data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-none text-2xs sm:text-sm leading-tight">Chemical Dosing</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-3"><Overview /></TabsContent>
        <TabsContent value="pretreat-ro" className="mt-3"><PretreatmentAndROLog /></TabsContent>
        <TabsContent value="cip" className="mt-3"><CIPLog /></TabsContent>
        <TabsContent value="chemical-dosing" className="mt-3"><ChemicalDosing /></TabsContent>
      </Tabs>
    </div>
  );
}
