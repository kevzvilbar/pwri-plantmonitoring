import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { StatusPill } from '@/components/StatusPill';
import { getCurrentPosition } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { ChevronDown, MapPin, Printer } from 'lucide-react';

const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const TYPES = ['Equipment failure', 'Chemical spill', 'Power outage', 'Safety incident', 'Quality deviation', 'Other'];
const WEATHER = ['Clear', 'Partly cloudy', 'Cloudy', 'Rain', 'Heavy rain'];

// ─── Blank state shapes (defined outside components so references are stable) ──

const REPORT_INITIAL = {
  plant_id: '',
  incident_type: '',
  severity: 'Medium' as 'Low' | 'Medium' | 'High' | 'Critical',
  what_description: '',
  where_location: '',
  gps_lat: null as number | null,
  gps_lng: null as number | null,
  // when_datetime is dynamic; it is merged in at hook initialisation time
  // and subsequently restored from the draft if one exists.
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Incidents() {
  const [tab, setTab] = useTabPersist<'open' | 'report' | 'history'>('tab:incidents', 'open');
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
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
  const { data } = useQuery({
    queryKey: ['incidents-open', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('incidents').select('*,plants(name)').in('status', ['Open', 'InProgress']).order('created_at', { ascending: false });
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      return (await q).data ?? [];
    },
  });

  return (
    <div className="space-y-2">
      {data?.map((i: any) => <IncidentCard key={i.id} incident={i} />)}
      {!data?.length && <Card className="p-4 text-xs text-center text-muted-foreground">No open incidents</Card>}
    </div>
  );
}

// ─── Incident card (close form) ────────────────────────────────────────────────

function IncidentCard({ incident }: { incident: any }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // Draft is keyed by incident ID so each card gets its own saved state.
  const { draft: v, setDraft: setV, hasDraft, clearDraft, discardDraft } = useDraft(
    `incident-close:${incident.id}`,
    CLOSE_INITIAL,
  );

  const close = async () => {
    const { error } = await supabase.from('incidents').update({
      ...v,
      status: 'Closed',
      resolved_by: user?.id,
      resolved_at: new Date().toISOString(),
      closed_by: user?.id,
      closed_at: new Date().toISOString(),
    }).eq('id', incident.id);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Incident closed');
    clearDraft(); // wipes the saved draft for this incident
    qc.invalidateQueries({ queryKey: ['incidents-open'] });
  };

  const sevTone =
    incident.severity === 'Critical' || incident.severity === 'High' ? 'danger' :
    incident.severity === 'Medium' ? 'warn' : 'info';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="p-3">
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs font-mono-num text-muted-foreground">{incident.incident_ref}</div>
              <div className="font-medium text-sm line-clamp-2">{incident.what_description}</div>
              <div className="text-xs text-muted-foreground mt-1">{incident.plants?.name} · {incident.where_location}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill tone={sevTone as any}>{incident.severity}</StatusPill>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-2 border-t pt-3">
          {/* Restore banner — only appears when a partial close was previously typed */}
          {hasDraft && <DraftBanner onDiscard={discardDraft} />}

          <div>
            <Label className="text-xs">Root cause</Label>
            <Textarea rows={2} value={v.root_cause} onChange={e => setV({ ...v, root_cause: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Corrective action</Label>
            <Textarea rows={2} value={v.corrective_action} onChange={e => setV({ ...v, corrective_action: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Preventive measures</Label>
            <Textarea rows={2} value={v.preventive_measures} onChange={e => setV({ ...v, preventive_measures: e.target.value })} />
          </div>
          <Button size="sm" onClick={close} className="w-full">Close incident</Button>
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

  // Draft is keyed by user ID so different users on the same browser don't share drafts.
  const { draft: v, setDraft: setV, hasDraft, clearDraft, discardDraft } = useDraft(
    `incident-report:${user?.id ?? 'anon'}`,
    // Merge the dynamic default datetime into the stable initial shape.
    // useDraft captures this value once at mount; if a stored draft already
    // exists the stored when_datetime wins (restored from localStorage).
    { ...REPORT_INITIAL, when_datetime: format(new Date(), "yyyy-MM-dd'T'HH:mm") },
  );

  const captureGPS = async () => {
    try {
      const pos = await getCurrentPosition();
      setV(s => ({ ...s, gps_lat: pos.coords.latitude, gps_lng: pos.coords.longitude }));
      toast.success('GPS captured');
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
    toast.success('Incident reported');
    // clearDraft resets the form and removes the localStorage entry.
    // Pass keepPlant to avoid the user having to re-select their plant
    // if they're filing multiple reports in one session.
    clearDraft({ plant_id: v.plant_id });
    qc.invalidateQueries();
  };

  return (
    <Card className="p-3 space-y-3 print-page">
      {/* Draft restore banner */}
      {hasDraft && <DraftBanner onDiscard={discardDraft} />}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Plant *</Label>
          <Select value={v.plant_id} onValueChange={(x) => setV({ ...v, plant_id: x })}>
            <SelectTrigger><SelectValue placeholder="Plant" /></SelectTrigger>
            <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Type</Label>
          <Select value={v.incident_type} onValueChange={(x) => setV({ ...v, incident_type: x })}>
            <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Severity</Label>
        <div className="flex gap-1.5 mt-1">
          {SEVERITIES.map(s => (
            <Button key={s} size="sm" variant={v.severity === s ? 'default' : 'outline'} onClick={() => setV({ ...v, severity: s })}>
              {s}
            </Button>
          ))}
        </div>
      </div>

      <section>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">What</Label>
        <Textarea value={v.what_description} onChange={e => setV({ ...v, what_description: e.target.value })} rows={3} placeholder="What happened?" />
      </section>
      <section>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Where</Label>
        <Input value={v.where_location} onChange={e => setV({ ...v, where_location: e.target.value })} placeholder="Location/equipment" />
        <Button size="sm" variant="outline" className="mt-1" onClick={captureGPS}>
          <MapPin className="h-3 w-3 mr-1" />Capture GPS
        </Button>
        {v.gps_lat && (
          <div className="text-xs text-accent mt-1 font-mono-num">
            {v.gps_lat.toFixed(5)}, {v.gps_lng?.toFixed(5)}
          </div>
        )}
      </section>
      <section>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">When</Label>
        <Input type="datetime-local" value={v.when_datetime} onChange={e => setV({ ...v, when_datetime: e.target.value })} />
      </section>
      <section>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Who</Label>
        <Input placeholder="Witness" value={v.witness} onChange={e => setV({ ...v, witness: e.target.value })} />
      </section>
      <section className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Weather</Label>
          <Select value={v.weather} onValueChange={(x) => setV({ ...v, weather: x })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Temp °C</Label>
          <Input type="number" step="any" value={v.temperature_c} onChange={e => setV({ ...v, temperature_c: e.target.value })} />
        </div>
      </section>
      <div>
        <Label>Immediate action taken</Label>
        <Textarea rows={2} value={v.immediate_action} onChange={e => setV({ ...v, immediate_action: e.target.value })} />
      </div>

      <div className="flex gap-2 no-print">
        <Button onClick={submit} className="flex-1">Submit report</Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="h-3 w-3 mr-1" />PDF
        </Button>
      </div>
    </Card>
  );
}

// ─── History ───────────────────────────────────────────────────────────────────

function History() {
  const { selectedPlantId } = useAppStore();
  const [status, setStatus] = useState<string>('all');
  const { data } = useQuery({
    queryKey: ['incidents-hist', selectedPlantId, status],
    queryFn: async () => {
      let q = supabase.from('incidents').select('*,plants(name)').order('created_at', { ascending: false }).limit(50);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      if (status !== 'all') q = q.eq('status', status as any);
      return (await q).data ?? [];
    },
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {['all', 'Open', 'InProgress', 'Resolved', 'Closed'].map(s => (
          <Button key={s} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>{s}</Button>
        ))}
      </div>
      {data?.map((i: any) => {
        const tone = i.status === 'Open' ? 'danger' : i.status === 'InProgress' ? 'warn' : 'accent';
        return (
          <Card key={i.id} className="p-3">
            <div className="flex justify-between items-start text-sm">
              <div>
                <div className="text-xs font-mono-num text-muted-foreground">{i.incident_ref}</div>
                <div className="font-medium">{i.what_description}</div>
                <div className="text-xs text-muted-foreground">{i.plants?.name}</div>
              </div>
              <StatusPill tone={tone as any}>{i.status}</StatusPill>
            </div>
          </Card>
        );
      })}
      {!data?.length && <Card className="p-4 text-xs text-center text-muted-foreground">No incidents</Card>}
    </div>
  );
}
