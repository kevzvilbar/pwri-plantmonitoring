import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { getCurrentPosition } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import {
  ChevronDown, MapPin, Printer, AlertOctagon, ShieldAlert,
  AlertTriangle, CheckCircle2, Search, Download,
  Flame, PlusCircle, History as HistoryIcon,
} from 'lucide-react';
import { downloadCSV } from '@/lib/csv';
import { cn } from '@/lib/utils';
import { IncidentCard } from './IncidentCard';

const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export function OpenList() {
  const { selectedPlantId } = useAppStore();
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');

  const { data = [], isLoading } = useQuery({
    queryKey: ['incidents-open', selectedPlantId],
    queryFn: async () => {
      let q = supabase
        .from('incidents')
        .select('*,plants(name)')
        .in('status', ['Open', 'InProgress'])
        .order('created_at', { ascending: false });
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      return (await q).data ?? [];
    },
  });

  const filtered = useMemo(() => {
    return data.filter((i: any) => {
      const matchSearch =
        !search ||
        i.what_description?.toLowerCase().includes(search.toLowerCase()) ||
        i.where_location?.toLowerCase().includes(search.toLowerCase()) ||
        i.incident_ref?.toLowerCase().includes(search.toLowerCase());
      const matchSev = severityFilter === 'all' || i.severity === severityFilter;
      return matchSearch && matchSev;
    });
  }, [data, search, severityFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 p-2 rounded-xl bg-card border border-border/80">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search open incidents or ref #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs rounded-lg"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="h-8 text-2xs w-36">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2.5">
        {filtered.map((i: any) => <IncidentCard key={i.id} incident={i} />)}
        {!filtered.length && !isLoading && (
          <Card className="p-8 text-center text-muted-foreground rounded-xl">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-accent" />
            <div className="text-xs font-semibold text-foreground">Zero Open Incidents</div>
            <p className="text-3xs text-muted-foreground mt-1">All reported incidents for this facility have been successfully resolved.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
