import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';

import { CIPLog } from './cip/CIPLog';
import { ChemicalDosing } from './dosing/ChemicalDosing';
import { Overview } from './Overview';
import { PretreatmentAndROLog } from './pretreatment/PretreatmentAndROLog';

export default function ROTrains() {
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="RO Trains & Pre-Treatment" />
      <Tabs defaultValue="overview">
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
