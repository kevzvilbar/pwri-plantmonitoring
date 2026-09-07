import { useMemo } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { ShieldAlert, PlusCircle, History as HistoryIcon } from 'lucide-react';
import { useIncidentsData } from './useIncidentsData';
import { OpenList } from './OpenList';
import { ReportForm, REPORT_INITIAL } from './ReportForm';
import { IncidentHistory } from './IncidentHistory';
import { useQueryClient } from '@tanstack/react-query';

export default function Incidents() {
  const [tab, setTab] = useTabPersist<'open' | 'report' | 'history'>('tab:incidents', 'open');
  const qc = useQueryClient();
  const { openIncidents, criticalHighCount } = useIncidentsData();

  const reportInitial = useMemo(() => ({
    ...REPORT_INITIAL,
    when_datetime: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }), []);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <PageHeader title="Incident Management & HSE Log" />
          <p className="text-xs text-muted-foreground mt-0.5">
            Log equipment malfunctions, chemical spills, plant security events, and environmental safety reports.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-3 w-full bg-muted/60 p-1 rounded-xl">
          <TabsTrigger value="open" className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Open Incidents</span>
            {openIncidents.length > 0 && (
              <span className="text-3xs px-1.5 py-0.5 rounded-full bg-danger/15 text-danger font-bold">
                {openIncidents.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="report" className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
            <PlusCircle className="h-3.5 w-3.5" />
            <span>Report Incident</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
            <HistoryIcon className="h-3.5 w-3.5" />
            <span>History & RCA</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-3"><OpenList /></TabsContent>
        <TabsContent value="report" className="mt-3"><ReportForm initial={reportInitial} /></TabsContent>
        <TabsContent value="history" className="mt-3"><IncidentHistory onInvalidate={() => qc.invalidateQueries()} /></TabsContent>
      </Tabs>
    </div>
  );
}
