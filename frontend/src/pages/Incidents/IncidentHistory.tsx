import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { toast } from 'sonner';
import { downloadCSV } from '@/lib/csv';
import { format } from 'date-fns';
import { Search, Download, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export function IncidentHistory({ onInvalidate }: { onInvalidate: () => void }) {
  const { selectedPlantId } = useAppStore();
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['incidents-hist', selectedPlantId, status],
    queryFn: async () => {
      let q = supabase.from('incidents').select('*,plants(name)').order('created_at', { ascending: false }).limit(100);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      if (status !== 'all') q = q.eq('status', status as any);
      return (await q).data ?? [];
    },
  });

  const filtered = useMemo(() => {
    return data.filter((i: any) => {
      return (
        !search ||
        i.what_description?.toLowerCase().includes(search.toLowerCase()) ||
        i.incident_ref?.toLowerCase().includes(search.toLowerCase()) ||
        i.where_location?.toLowerCase().includes(search.toLowerCase())
      );
    });
  }, [data, search]);

  const handleExportCSV = () => {
    if (!filtered.length) {
      toast.error('No incident records to export');
      return;
    }
    const rows = filtered.map((i: any) => ({
      Reference: i.incident_ref || '—',
      Plant: i.plants?.name || '—',
      Severity: i.severity || '—',
      Status: i.status || '—',
      Type: i.incident_type || '—',
      Description: i.what_description || '—',
      Location: i.where_location || '—',
      Date: i.when_datetime || i.created_at || '—',
      Root_Cause: i.root_cause || '—',
      Corrective_Action: i.corrective_action || '—',
      Preventive_Measures: i.preventive_measures || '—',
    }));
    downloadCSV(`HSE_Incident_Log_${format(new Date(), 'yyyyMMdd_HHmm')}`, rows);
    toast.success('Incidents log exported to CSV');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 p-2 rounded-xl bg-card border border-border/80">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search incident history…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs rounded-lg"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto justify-between sm:justify-end">
          {['all', 'Open', 'InProgress', 'Resolved', 'Closed'].map(s => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? 'default' : 'outline'}
              className="h-8 px-2 text-2xs font-semibold"
              onClick={() => setStatus(s)}
            >
              {s}
            </Button>
          ))}

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            className="h-8 px-2.5 text-2xs gap-1.5 font-semibold shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-primary" />
            <span>Export Log</span>
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((i: any) => {
          const tone = i.status === 'Open' ? 'danger' : i.status === 'InProgress' ? 'warn' : 'accent';
          return (
            <Card key={i.id} className="p-3.5 hover:border-foreground/30 transition-all rounded-xl">
              <div className="flex justify-between items-start gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-muted-foreground">{i.incident_ref || 'INC-ARCHIVE'}</span>
                    <span className="text-3xs px-1.5 py-0.5 rounded bg-muted text-foreground font-semibold">{i.incident_type || 'General'}</span>
                    <span className="text-3xs font-semibold text-muted-foreground">({i.severity})</span>
                  </div>
                  <div className="font-bold text-sm text-foreground">{i.what_description}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.plants?.name} · {i.where_location || 'Facility'} · {i.created_at && format(new Date(i.created_at), 'MMM d, yyyy')}
                  </div>
                  {i.root_cause && (
                    <div className="mt-2 text-xs p-2 rounded-lg bg-muted/40 text-foreground">
                      <strong className="text-3xs uppercase font-bold text-muted-foreground block mb-0.5">Root Cause:</strong>
                      {i.root_cause}
                    </div>
                  )}
                </div>
                <StatusPill tone={tone as any}>{i.status}</StatusPill>
              </div>
            </Card>
          );
        })}

        {!filtered.length && !isLoading && (
          <Card className="p-8 text-center text-muted-foreground rounded-xl">
            <ShieldAlert className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <div className="text-xs font-semibold">No incident history matches filter</div>
          </Card>
        )}
      </div>
    </div>
  );
}
