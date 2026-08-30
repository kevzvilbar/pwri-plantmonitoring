import { useState, useMemo } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useDraft } from '@/hooks/useDraft';
import { DraftBanner } from '@/components/DraftBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-picker';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const TYPES = ['Equipment failure', 'Chemical spill', 'Power outage', 'Safety incident', 'Quality deviation', 'Other'];
const WEATHER = ['Clear', 'Partly cloudy', 'Cloudy', 'Rain', 'Heavy rain'];

const REPORT_INITIAL = {
  plant_id: '',
  incident_type: '',
  severity: 'Medium' as 'Low' | 'Medium' | 'High' | 'Critical',
  what_description: '',
  where_location: '',
  gps_lat: null as number | null,
  gps_lng: null as number | null,
  when_datetime: '',
  witness: '',
  weather: 'Clear',
  temperature_c: '',
  immediate_action: '',
};

const CLOSE_INITIAL = {
  root_cause: '',
  corrective_action: '',
  preventive_measures: '',
};

export default function Incidents() {
  const [tab, setTab] = useTabPersist<'open' | 'report' | 'history'>('tab:incidents', 'open');
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const activePlant = plants?.find((p) => p.id === selectedPlantId) ?? plants?.[0];

  // ── Executive KPI Queries ──────────────────────────────────────────────────
  const { data: openIncidents = [] } = useQuery({
    queryKey: ['incidents-open-count', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('incidents').select('id,severity,status').in('status', ['Open', 'InProgress']);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: resolved30dCount = 0 } = useQuery({
    queryKey: ['incidents-resolved-30d', selectedPlantId],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      let q = supabase.from('incidents')
        .select('id', { count: 'exact', head: true })
        .in('status', ['Resolved', 'Closed'])
        .gte('created_at', since);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const { count } = await q;
      return count ?? 0;
    },
  });

  const criticalHighCount = openIncidents.filter((i) => i.severity === 'Critical' || i.severity === 'High').length;

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
        <TabsContent value="report" className="mt-3"><Report /></TabsContent>
        <TabsContent value="history" className="mt-3"><History /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Open incidents list ───────────────────────────────────────────────────────

function OpenList() {
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
      {/* ── Filter Bar ── */}
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

// ─── Incident card (close form) ────────────────────────────────────────────────

function IncidentCard({ incident }: { incident: any }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const { draft: v, setDraft: setV, hasDraft, clearDraft, discardDraft } = useDraft(
    `incident-close:${incident.id}`,
    CLOSE_INITIAL,
  );

  const close = async () => {
    if (!v.root_cause && !v.corrective_action) {
      toast.error('Please specify root cause or corrective action before closing');
      return;
    }
    const { error } = await supabase.from('incidents').update({
      ...v,
      status: 'Closed',
      resolved_by: user?.id,
      resolved_at: new Date().toISOString(),
      closed_by: user?.id,
      closed_at: new Date().toISOString(),
    }).eq('id', incident.id);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Incident resolved & closed');
    clearDraft();
    qc.invalidateQueries({ queryKey: ['incidents-open'] });
    qc.invalidateQueries({ queryKey: ['incidents-open-count'] });
    qc.invalidateQueries({ queryKey: ['incidents-resolved-30d'] });
  };

  const sevTone =
    incident.severity === 'Critical' || incident.severity === 'High' ? 'danger' :
    incident.severity === 'Medium' ? 'warn' : 'info';

  const isCritical = incident.severity === 'Critical';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={cn(
        'p-3.5 transition-all rounded-xl border',
        isCritical ? 'border-danger/60 bg-danger/5 shadow-xs' : 'border-border/80 hover:border-foreground/30',
      )}>
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex justify-between items-start gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold text-muted-foreground">{incident.incident_ref || 'INC-PENDING'}</span>
                {incident.incident_type && (
                  <span className="text-3xs px-2 py-0.5 rounded-full bg-muted font-semibold text-foreground">
                    {incident.incident_type}
                  </span>
                )}
                {isCritical && (
                  <span className="flex items-center gap-1 text-3xs px-1.5 py-0.5 rounded bg-danger text-white font-bold animate-pulse">
                    <Flame className="h-2.5 w-2.5" /> Urgent
                  </span>
                )}
              </div>
              <div className="font-bold text-sm text-foreground line-clamp-2">{incident.what_description}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-foreground">{incident.plants?.name}</span>
                <span>·</span>
                <span>{incident.where_location || 'Location unassigned'}</span>
                {incident.when_datetime && (
                  <>
                    <span>·</span>
                    <span>{format(new Date(incident.when_datetime), 'MMM d, yyyy · HH:mm')}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <StatusPill tone={sevTone as any}>{incident.severity}</StatusPill>
              <div className="flex items-center gap-1 text-3xs text-primary font-semibold">
                <span>{open ? 'Hide Actions' : 'Resolve'}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', open ? 'rotate-180' : '')} />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3 space-y-3 border-t border-border/60 pt-3">
          {hasDraft && <DraftBanner onDiscard={discardDraft} />}

          {incident.immediate_action && (
            <div className="p-2.5 rounded-lg bg-muted/50 text-xs">
              <span className="text-3xs uppercase font-bold text-muted-foreground block mb-0.5">Immediate Action Logged:</span>
              <p className="text-foreground">{incident.immediate_action}</p>
            </div>
          )}

          <div className="space-y-2">
            <div>
              <Label htmlFor={`root-cause-${incident.id}`} className="text-xs font-semibold">Root Cause Analysis (RCA)</Label>
              <Textarea
                rows={2}
                value={v.root_cause}
                onChange={e => setV({ ...v, root_cause: e.target.value })}
                placeholder="What was the fundamental cause of this occurrence?"
                id={`root-cause-${incident.id}`}
                className="text-xs mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`corrective-action-${incident.id}`} className="text-xs font-semibold">Corrective Action Taken</Label>
              <Textarea
                rows={2}
                value={v.corrective_action}
                onChange={e => setV({ ...v, corrective_action: e.target.value })}
                placeholder="What immediate repairs or adjustments were completed?"
                id={`corrective-action-${incident.id}`}
                className="text-xs mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`preventive-measures-${incident.id}`} className="text-xs font-semibold">Preventive Measures</Label>
              <Textarea
                rows={2}
                value={v.preventive_measures}
                onChange={e => setV({ ...v, preventive_measures: e.target.value })}
                placeholder="What changes will prevent recurrence?"
                id={`preventive-measures-${incident.id}`}
                className="text-xs mt-1"
              />
            </div>
          </div>

          <Button size="sm" onClick={close} className="w-full font-bold">
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            Complete Investigation & Close Incident
          </Button>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Report form ───────────────────────────────────────────────────────────────

function Report() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: plants } = usePlants();

  const { draft: v, setDraft: setV, hasDraft, clearDraft, discardDraft } = useDraft(
    `incident-report:${user?.id ?? 'anon'}`,
    { ...REPORT_INITIAL, when_datetime: format(new Date(), "yyyy-MM-dd'T'HH:mm") },
  );

  const captureGPS = async () => {
    try {
      const pos = await getCurrentPosition();
      setV(s => ({ ...s, gps_lat: pos.coords.latitude, gps_lng: pos.coords.longitude }));
      toast.success('GPS coordinates captured');
    } catch { toast.error('Could not capture GPS'); }
  };

  const submit = async () => {
    if (!v.plant_id || !v.what_description) { toast.error('Plant and description required'); return; }
    const { error } = await supabase.from('incidents').insert({
      plant_id: v.plant_id,
      incident_type: v.incident_type || null,
      severity: v.severity,
      what_description: v.what_description,
      where_location: v.where_location || null,
      gps_lat: v.gps_lat,
      gps_lng: v.gps_lng,
      when_datetime: new Date(v.when_datetime).toISOString(),
      who_reporter: user?.id,
      witness: v.witness || null,
      weather: v.weather,
      temperature_c: v.temperature_c ? +v.temperature_c : null,
      immediate_action: v.immediate_action || null,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Incident logged successfully');
    clearDraft({ plant_id: v.plant_id });
    qc.invalidateQueries();
  };

  return (
    <Card className="p-4 space-y-4 rounded-xl print-page">
      {hasDraft && <DraftBanner onDiscard={discardDraft} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="incidents-plant" className="text-xs font-semibold">Plant Facility *</Label>
          <Select value={v.plant_id} onValueChange={(x) => setV({ ...v, plant_id: x })}>
            <SelectTrigger id="incidents-plant"><SelectValue placeholder="Select facility" /></SelectTrigger>
            <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="incidents-type" className="text-xs font-semibold">Incident Classification</Label>
          <Select value={v.incident_type} onValueChange={(x) => setV({ ...v, incident_type: x })}>
            <SelectTrigger id="incidents-type"><SelectValue placeholder="Classification" /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs font-semibold">Severity Rating</Label>
        <div className="grid grid-cols-4 gap-2 mt-1.5">
          {SEVERITIES.map(s => {
            const isSelected = v.severity === s;
            return (
              <Button
                key={s}
                size="sm"
                type="button"
                variant={isSelected ? 'default' : 'outline'}
                className={cn('font-bold text-xs', isSelected ? 'shadow-xs' : '')}
                onClick={() => setV({ ...v, severity: s })}
              >
                {s}
              </Button>
            );
          })}
        </div>
      </div>

      <section>
        <Label htmlFor="incidents-what" className="text-xs font-semibold">What Happened? (Detailed Description) *</Label>
        <Textarea
          value={v.what_description}
          onChange={e => setV({ ...v, what_description: e.target.value })}
          rows={3}
          placeholder="Describe the sequence of events, equipment affected, or safety deviation…"
          id="incidents-what"
          className="text-xs mt-1"
        />
      </section>

      <section>
        <Label htmlFor="incidents-where" className="text-xs font-semibold">Where (Specific Location / Area)</Label>
        <div className="flex gap-2 mt-1">
          <Input
            value={v.where_location}
            onChange={e => setV({ ...v, where_location: e.target.value })}
            placeholder="e.g. RO Train 2 HP Pump Skid"
            id="incidents-where"
            className="text-xs flex-1"
          />
          <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={captureGPS}>
            <MapPin className="h-3.5 w-3.5 mr-1 text-primary" />
            Capture GPS
          </Button>
        </div>
        {v.gps_lat && (
          <div className="text-2xs text-accent mt-1 font-mono">
            GPS: {v.gps_lat.toFixed(5)}, {v.gps_lng?.toFixed(5)}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="incidents-when" className="text-xs font-semibold">When Did It Occur?</Label>
          <DateTimePicker
            value={v.when_datetime}
            onChange={(val) => setV({ ...v, when_datetime: val })}
            placeholder="Select incident date & time..."
            size="sm"
            className="w-full font-mono-num"
            id="incidents-when"
          />
        </div>
        <div>
          <Label htmlFor="incidents-who" className="text-xs font-semibold">Witnesses / Personnel Present</Label>
          <Input
            placeholder="Personnel names or roles"
            value={v.witness}
            onChange={e => setV({ ...v, witness: e.target.value })}
            id="incidents-who"
            className="text-xs mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="incidents-weather" className="text-xs font-semibold">Weather Conditions</Label>
          <Select value={v.weather} onValueChange={(x) => setV({ ...v, weather: x })}>
            <SelectTrigger id="incidents-weather" className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="incidents-temp-c" className="text-xs font-semibold">Ambient Temp (°C)</Label>
          <Input
            type="number"
            step="any"
            placeholder="e.g. 32"
            value={v.temperature_c}
            onChange={e => setV({ ...v, temperature_c: e.target.value })}
            id="incidents-temp-c"
            className="text-xs mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="incidents-immediate-action-taken" className="text-xs font-semibold">Immediate Containment Action Taken</Label>
        <Textarea
          rows={2}
          value={v.immediate_action}
          onChange={e => setV({ ...v, immediate_action: e.target.value })}
          placeholder="Emergency shutdown, spill barrier deployed, bypass opened…"
          id="incidents-immediate-action-taken"
          className="text-xs mt-1"
        />
      </div>

      <div className="flex gap-2 no-print pt-1">
        <Button onClick={submit} className="flex-1 font-bold">
          Submit Incident Report
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="shrink-0">
          <Printer className="h-4 w-4 mr-1.5" />
          Print PDF
        </Button>
      </div>
    </Card>
  );
}

// ─── History ───────────────────────────────────────────────────────────────────

function History() {
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
      {/* ── Search & Filter Controls ── */}
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
