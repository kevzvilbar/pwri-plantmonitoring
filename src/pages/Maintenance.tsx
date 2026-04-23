import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Sparkles } from 'lucide-react';
import { PMS_TEMPLATES } from '@/lib/pmsTemplates';
import { PmsCalendar } from '@/components/PmsCalendar';

const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const;
type Freq = typeof FREQUENCIES[number];
const CATEGORIES = [
  'Controllers', 'Pumps & Motors', 'Genset', 'RO Membranes', 'Dosing Pump',
  'pH Meter', 'TDS Meter', 'Colorimeter', 'Nephelometer',
  'Filter Media', 'Safety Equipment', 'Other',
];

export default function Maintenance() {
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Maintenance</h1>
      <Tabs defaultValue="calendar">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="add">Add</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar" className="mt-3 space-y-3">
          <AutoGenerateCard />
          <PmsCalendar />
        </TabsContent>
        <TabsContent value="add" className="mt-3"><AddTemplate /></TabsContent>
        <TabsContent value="records" className="mt-3"><Records /></TabsContent>
      </Tabs>
    </div>
  );
}

function AutoGenerateCard() {
  const qc = useQueryClient();
  const { user, isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const [generating, setGenerating] = useState(false);
  if (!isManager) return null;

  const generatePms = async () => {
    if (!selectedPlantId) { toast.error('Select a plant first (top bar)'); return; }
    setGenerating(true);
    try {
      const { data: existing } = await supabase
        .from('checklist_templates')
        .select('equipment_name,frequency,category')
        .eq('plant_id', selectedPlantId);
      const existsKey = new Set((existing ?? []).map((r: any) =>
        `${r.category}|${r.equipment_name}|${r.frequency}`));
      const startDate = format(new Date(), 'yyyy-MM-dd');
      const rows = PMS_TEMPLATES
        .filter(t => !existsKey.has(`${t.category}|${t.equipment_name}|${t.frequency}`))
        .map(t => ({
          plant_id: selectedPlantId, category: t.category,
          equipment_name: t.equipment_name, frequency: t.frequency,
          checklist_steps: t.steps, schedule_start_date: startDate,
          created_by: user?.id,
        }));
      if (!rows.length) { toast.info('All standard PMS templates already exist'); return; }
      const { error } = await supabase.from('checklist_templates').insert(rows);
      if (error) throw error;
      toast.success(`Generated ${rows.length} PMS templates`);
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to generate');
    } finally { setGenerating(false); }
  };

  return (
    <Card className="p-3 flex items-start gap-3 bg-accent-soft/40 border-accent/30">
      <Sparkles className="h-4 w-4 text-accent mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold">Auto-Generate Standard PMS</div>
        <p className="text-[11px] text-muted-foreground">
          Creates Genset, RO, Dosing Pump, Controllers, Cartridge Filter, Pump &amp; Motor, pH/NTU/Colorimeter
          templates for the selected plant. Skips templates that already exist.
        </p>
      </div>
      <Button size="sm" onClick={generatePms} disabled={generating || !selectedPlantId}>
        {generating ? 'Generating…' : 'Generate'}
      </Button>
    </Card>
  );
}

function AddTemplate() {
  const qc = useQueryClient();
  const { user, isManager } = useAuth();
  const { data: plants } = usePlants();
  const [v, setV] = useState({
    plant_id: '', category: 'Pumps & Motors', equipment_name: '',
    schedule_start_date: format(new Date(), 'yyyy-MM-dd'),
    extra_steps: '',
  });
  const [freqs, setFreqs] = useState<Record<Freq, boolean>>({
    Daily: false, Weekly: false, Monthly: true, Quarterly: false, Yearly: false,
  });
  const toggle = (f: Freq) => setFreqs(prev => ({ ...prev, [f]: !prev[f] }));

  if (!isManager) return <Card className="p-4 text-xs text-center text-muted-foreground">Manager/Admin only</Card>;

  const submit = async () => {
    if (!v.plant_id || !v.equipment_name) { toast.error('Plant and equipment name required'); return; }
    const selectedFreqs = (Object.keys(freqs) as Freq[]).filter(f => freqs[f]);
    if (!selectedFreqs.length) { toast.error('Pick at least one frequency'); return; }
    const extra = v.extra_steps.split('\n').map(s => s.trim()).filter(Boolean);

    const rows = selectedFreqs.map(freq => {
      // Pull preset checklist steps from PMS_TEMPLATES that match this category + frequency
      const preset = PMS_TEMPLATES.find(t => t.category === v.category && t.frequency === freq);
      const steps = [...(preset?.steps ?? []), ...extra];
      return {
        plant_id: v.plant_id,
        category: v.category,
        equipment_name: v.equipment_name,
        frequency: freq,
        checklist_steps: steps,
        schedule_start_date: v.schedule_start_date,
        created_by: user?.id,
      };
    });

    const { error } = await supabase.from('checklist_templates').insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${rows.length} schedule${rows.length === 1 ? '' : 's'} for ${v.equipment_name}`);
    setV({ ...v, equipment_name: '', extra_steps: '' });
    qc.invalidateQueries({ queryKey: ['pms-templates'] });
  };

  return (
    <Card className="p-3 space-y-3">
      <div>
        <Label>Plant *</Label>
        <Select value={v.plant_id} onValueChange={(x) => setV({ ...v, plant_id: x })}>
          <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
          <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label>Category *</Label>
        <Select value={v.category} onValueChange={(x) => setV({ ...v, category: x })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label>Equipment name *</Label>
        <Input value={v.equipment_name} onChange={e => setV({ ...v, equipment_name: e.target.value })}
          placeholder="e.g. Booster Pump #2" />
      </div>
      <div>
        <Label className="block mb-2">Frequencies (pick one or more)</Label>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {FREQUENCIES.map(f => (
            <label key={f} className="flex items-center gap-2 text-sm border rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent/30">
              <Checkbox checked={freqs[f]} onCheckedChange={() => toggle(f)} />
              <span>{f}</span>
            </label>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          A separate schedule will be created for each chosen frequency, pre-filled with the standard checklist for that category.
        </p>
      </div>
      <div>
        <Label>Start date *</Label>
        <Input type="date" value={v.schedule_start_date} onChange={e => setV({ ...v, schedule_start_date: e.target.value })} />
      </div>
      <div>
        <Label>Extra checklist steps (one per line, optional)</Label>
        <Textarea value={v.extra_steps} onChange={e => setV({ ...v, extra_steps: e.target.value })}
          rows={3} placeholder="Appended to the standard category checklist" />
      </div>
      <Button onClick={submit} className="w-full">Create schedules</Button>
    </Card>
  );
}

function Records() {
  const { selectedPlantId } = useAppStore();
  const { data } = useQuery({
    queryKey: ['pms-records', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_executions')
        .select('*,checklist_templates(equipment_name,category),user_profiles(first_name,last_name)')
        .order('completed_at', { ascending: false }).limit(50);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      return (await q).data ?? [];
    },
  });
  return (
    <div className="space-y-2">
      {data?.map((r: any) => (
        <Card key={r.id} className="p-3">
          <div className="flex justify-between items-start text-sm">
            <div>
              <div className="font-medium">{r.checklist_templates?.equipment_name}</div>
              <div className="text-xs text-muted-foreground">{r.checklist_templates?.category} · {r.frequency}</div>
            </div>
            <StatusPill tone="accent">Done</StatusPill>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            By {r.user_profiles?.first_name} · {r.completed_at && format(new Date(r.completed_at), 'MMM d, HH:mm')}
          </div>
          {r.findings && <div className="text-xs mt-1 p-1.5 bg-secondary rounded">{r.findings}</div>}
        </Card>
      ))}
      {!data?.length && <Card className="p-4 text-xs text-center text-muted-foreground">No records yet</Card>}
    </div>
  );
}
