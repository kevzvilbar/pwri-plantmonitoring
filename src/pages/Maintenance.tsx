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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { PMS_TEMPLATES } from '@/lib/pmsTemplates';

const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const;
const CATEGORIES = [
  'Controllers', 'Pumps & Motors', 'Genset', 'RO Membranes', 'Dosing Pump',
  'pH Meter', 'TDS Meter', 'Colorimeter', 'Nephelometer',
  'Filter Media', 'Safety Equipment', 'Other',
];

export default function Maintenance() {
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Maintenance</h1>
      <Tabs defaultValue="checklists">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
          <TabsTrigger value="add">Add</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
        </TabsList>
        <TabsContent value="checklists" className="mt-3"><Checklists /></TabsContent>
        <TabsContent value="add" className="mt-3"><AddTemplate /></TabsContent>
        <TabsContent value="records" className="mt-3"><Records /></TabsContent>
      </Tabs>
    </div>
  );
}

function Checklists() {
  const qc = useQueryClient();
  const { user, isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const [freq, setFreq] = useState<typeof FREQUENCIES[number]>('Daily');
  const [generating, setGenerating] = useState(false);
  const { data } = useQuery({
    queryKey: ['templates', freq, selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_templates').select('*').eq('frequency', freq as any);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      return (await q).data ?? [];
    },
  });

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
      qc.invalidateQueries({ queryKey: ['templates'] });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to generate');
    } finally { setGenerating(false); }
  };

  const markDone = async (template: any) => {
    const findings = prompt('Findings (optional):') ?? '';
    const { error } = await supabase.from('checklist_executions').insert({
      template_id: template.id, plant_id: template.plant_id, frequency: template.frequency,
      completed: true, completed_by: user?.id, completed_at: new Date().toISOString(), findings: findings || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Marked complete'); qc.invalidateQueries({ queryKey: ['records'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {FREQUENCIES.map(f => (
          <Button key={f} size="sm" variant={freq === f ? 'default' : 'outline'} onClick={() => setFreq(f)}>{f}</Button>
        ))}
      </div>
      {isManager && (
        <Card className="p-3 flex items-start gap-3 bg-accent-soft/40 border-accent/30">
          <Sparkles className="h-4 w-4 text-accent mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold">Auto-Generate PMS Checklist</div>
            <p className="text-[11px] text-muted-foreground">
              Creates standard PMS templates (Genset, RO, Dosing Pump, Controllers, Cartridge Filter, Pumps & Motors, pH/NTU/Colorimeter)
              for the selected plant, scheduled by their natural frequency. Skips templates that already exist.
            </p>
          </div>
          <Button size="sm" onClick={generatePms} disabled={generating || !selectedPlantId}>
            {generating ? 'Generating…' : 'Generate'}
          </Button>
        </Card>
      )}
      {data?.map((t: any) => (
        <Card key={t.id} className="p-3">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="font-medium text-sm">{t.equipment_name}</div>
              <div className="text-xs text-muted-foreground">{t.category}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => markDone(t)}><CheckCircle2 className="h-3 w-3 mr-1" />Done</Button>
          </div>
          {t.checklist_steps?.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {t.checklist_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </Card>
      ))}
      {!data?.length && <Card className="p-4 text-xs text-center text-muted-foreground">No checklists for {freq}</Card>}
    </div>
  );
}

function AddTemplate() {
  const qc = useQueryClient();
  const { user, isManager } = useAuth();
  const { data: plants } = usePlants();
  const [v, setV] = useState({
    plant_id: '', category: 'Controllers', equipment_name: '', frequency: 'Monthly' as any,
    checklist_steps: '', schedule_start_date: format(new Date(), 'yyyy-MM-dd'),
  });
  if (!isManager) return <Card className="p-4 text-xs text-center text-muted-foreground">Manager/Admin only</Card>;
  const submit = async () => {
    if (!v.plant_id || !v.equipment_name) { toast.error('Fill required'); return; }
    const { error } = await supabase.from('checklist_templates').insert({
      plant_id: v.plant_id, category: v.category, equipment_name: v.equipment_name, frequency: v.frequency,
      checklist_steps: v.checklist_steps.split('\n').map(s => s.trim()).filter(Boolean),
      schedule_start_date: v.schedule_start_date, created_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Template added');
    setV({ plant_id: '', category: 'Controllers', equipment_name: '', frequency: 'Monthly' as any, checklist_steps: '', schedule_start_date: format(new Date(), 'yyyy-MM-dd') });
    qc.invalidateQueries({ queryKey: ['templates'] });
  };
  return (
    <Card className="p-3 space-y-2">
      <div><Label>Plant</Label>
        <Select value={v.plant_id} onValueChange={(x) => setV({ ...v, plant_id: x })}>
          <SelectTrigger><SelectValue placeholder="Plant" /></SelectTrigger>
          <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Category</Label>
        <Select value={v.category} onValueChange={(x) => setV({ ...v, category: x })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Equipment name</Label><Input value={v.equipment_name} onChange={e => setV({ ...v, equipment_name: e.target.value })} /></div>
      <div><Label>Frequency</Label>
        <Select value={v.frequency} onValueChange={(x: any) => setV({ ...v, frequency: x })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{FREQUENCIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Steps (one per line)</Label><Textarea value={v.checklist_steps} onChange={e => setV({ ...v, checklist_steps: e.target.value })} rows={4} /></div>
      <div><Label>Start date</Label><Input type="date" value={v.schedule_start_date} onChange={e => setV({ ...v, schedule_start_date: e.target.value })} /></div>
      <Button onClick={submit} className="w-full">Save template</Button>
    </Card>
  );
}

function Records() {
  const { selectedPlantId } = useAppStore();
  const { data } = useQuery({
    queryKey: ['records', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_executions').select('*,checklist_templates(equipment_name,category),user_profiles(first_name,last_name)').order('completed_at', { ascending: false }).limit(30);
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
      {!data?.length && <Card className="p-4 text-xs text-center text-muted-foreground">No records</Card>}
    </div>
  );
}
