import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import { Timer, Plus, ChevronDown, CheckCircle2, AlertCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { fmtNum } from '@/lib/calculations';
import { usePlants } from '@/hooks/usePlants';

interface DowntimeEvent {
  id: string;
  plant_id: string;
  event_date: string;
  cause: string;
  duration_hrs: number;
  addressed: boolean;
  resolution: string | null;
  notes: string | null;
}

const CAUSE_OPTIONS = [
  'Power outage',
  'Pump failure',
  'RO membrane fouling',
  'Pretreatment issue',
  'Chemical dosing fault',
  'Scheduled maintenance',
  'CIP cleaning',
  'Source water quality',
  'Operator action',
  'Other',
];

export function DowntimeEventsCard({ plantIds }: { plantIds: string[] }) {
  const qc = useQueryClient();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const { data: events } = useQuery({
    queryKey: ['downtime-events', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as DowntimeEvent[];
      const { data, error } = await supabase
        .from('downtime_events')
        .select('*')
        .in('plant_id', plantIds)
        .order('event_date', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as DowntimeEvent[];
    },
    enabled: plantIds.length > 0,
  });

  const totalHrs = useMemo(
    () => (events ?? []).reduce((s, e) => s + (+e.duration_hrs || 0), 0),
    [events],
  );
  const openCount = (events ?? []).filter((e) => !e.addressed).length;

  const plantName = (id: string) => plants?.find((p) => p.id === id)?.name ?? '—';

  // form state
  const [form, setForm] = useState({
    plant_id: selectedPlantId ?? '',
    event_date: format(new Date(), 'yyyy-MM-dd'),
    cause: '',
    cause_other: '',
    duration_hrs: '',
    addressed: false,
    resolution: '',
    notes: '',
  });

  const submit = async () => {
    const cause = form.cause === 'Other' ? form.cause_other.trim() : form.cause;
    const plant_id = form.plant_id || selectedPlantId || plantIds[0];
    if (!plant_id) return toast.error('Pick a plant');
    if (!cause) return toast.error('Cause is required');
    if (!form.duration_hrs) return toast.error('Duration is required');

    const { error } = await supabase.from('downtime_events').insert({
      plant_id,
      event_date: form.event_date,
      cause,
      duration_hrs: +form.duration_hrs,
      addressed: form.addressed,
      resolution: form.resolution || null,
      notes: form.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success('Downtime logged');
    setAddOpen(false);
    setForm({
      plant_id: selectedPlantId ?? '',
      event_date: format(new Date(), 'yyyy-MM-dd'),
      cause: '', cause_other: '', duration_hrs: '',
      addressed: false, resolution: '', notes: '',
    });
    qc.invalidateQueries({ queryKey: ['downtime-events'] });
  };

  const markAddressed = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from('downtime_events')
      .update({ addressed: !current })
      .eq('id', id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['downtime-events'] });
  };

  return (
    <Card className="p-3 space-y-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-start justify-between gap-2">
          <CollapsibleTrigger className="flex items-start gap-2 flex-1 text-left">
            <Timer className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-mono-num text-xl text-foreground leading-none">
                {fmtNum(totalHrs, 1)}
                <span className="text-xs font-sans text-muted-foreground ml-1">hr</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-tight flex items-center gap-1.5">
                Downtime · {(events ?? []).length} events
                {openCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-danger">
                    <AlertCircle className="h-3 w-3" />{openCount} open
                  </span>
                )}
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 px-2">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Log downtime event</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Plant</Label>
                    <Select value={form.plant_id} onValueChange={(v) => setForm({ ...form, plant_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Plant" /></SelectTrigger>
                      <SelectContent>
                        {(plants ?? []).filter((p) => plantIds.includes(p.id)).map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={form.event_date}
                      onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Caused by</Label>
                  <Select value={form.cause} onValueChange={(v) => setForm({ ...form, cause: v })}>
                    <SelectTrigger><SelectValue placeholder="Select cause" /></SelectTrigger>
                    <SelectContent>
                      {CAUSE_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {form.cause === 'Other' && (
                    <Input className="mt-2" placeholder="Specify cause"
                      value={form.cause_other} onChange={(e) => setForm({ ...form, cause_other: e.target.value })} />
                  )}
                </div>
                <div>
                  <Label className="text-xs">How long (hours)</Label>
                  <Input type="number" step="0.1" placeholder="e.g. 2.5"
                    value={form.duration_hrs}
                    onChange={(e) => setForm({ ...form, duration_hrs: e.target.value })} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-2">
                  <Label htmlFor="addressed" className="text-xs cursor-pointer">Was it addressed?</Label>
                  <Switch id="addressed" checked={form.addressed}
                    onCheckedChange={(v) => setForm({ ...form, addressed: v })} />
                </div>
                {form.addressed && (
                  <div>
                    <Label className="text-xs">How was it addressed</Label>
                    <Textarea rows={2} value={form.resolution}
                      onChange={(e) => setForm({ ...form, resolution: e.target.value })} />
                  </div>
                )}
                <div>
                  <Label className="text-xs">Notes (optional)</Label>
                  <Textarea rows={2} value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submit} className="w-full">Save event</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <CollapsibleContent className="space-y-1.5 pt-2">
          {(events ?? []).length === 0 && (
            <div className="text-xs text-muted-foreground italic py-2">No downtime events recorded.</div>
          )}
          {(events ?? []).map((e) => (
            <div key={e.id} className="rounded-md border bg-card p-2 text-xs space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{e.cause}</div>
                  <div className="text-muted-foreground text-[10px] mt-0.5">
                    {format(parseISO(e.event_date), 'MMM d, yyyy')} · {plantName(e.plant_id)}
                    {' · '}<span className="font-mono-num">{fmtNum(+e.duration_hrs, 1)}h</span>
                  </div>
                </div>
                <button
                  onClick={() => markAddressed(e.id, e.addressed)}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    e.addressed
                      ? 'bg-accent-soft text-accent-foreground'
                      : 'bg-danger/10 text-danger'
                  }`}
                >
                  {e.addressed ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {e.addressed ? 'Addressed' : 'Open'}
                </button>
              </div>
              {e.resolution && (
                <div className="text-muted-foreground border-l-2 border-accent pl-2">
                  <span className="font-medium text-foreground">Resolution:</span> {e.resolution}
                </div>
              )}
              {e.notes && <div className="text-muted-foreground italic">{e.notes}</div>}
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
