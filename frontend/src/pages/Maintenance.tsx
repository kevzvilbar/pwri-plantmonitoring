import { useState, useMemo } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { StatCard } from '@/components/dashboard/StatCard';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import {
  ShieldCheck, Calendar, PlusCircle, ClipboardList, Search,
  Download, Building2, Wrench, CheckCircle2, AlertTriangle, Filter,
} from 'lucide-react';
import { PMS_TEMPLATES, PMS_CATEGORIES, PMS_FREQUENCIES } from '@/lib/pmsTemplates';
import { PmsCalendar } from '@/components/PmsCalendar';
import { downloadCSV } from '@/lib/csv';

const FREQUENCIES = PMS_FREQUENCIES;
type Frequency = typeof FREQUENCIES[number];
const CATEGORIES = PMS_CATEGORIES;

export default function Maintenance() {
  const [tab, setTab] = useTabPersist<'calendar' | 'add' | 'records'>('tab:maintenance', 'calendar');
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const activePlant = plants?.find((p) => p.id === selectedPlantId) ?? plants?.[0];

  // ── Executive KPI Queries ──────────────────────────────────────────────────
  const { data: templatesCount = 0 } = useQuery({
    queryKey: ['pms-templates-count', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_templates').select('id', { count: 'exact', head: true });
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const { count } = await q;
      return count ?? 0;
    },
  });

  const { data: completed30dCount = 0 } = useQuery({
    queryKey: ['pms-completed-30d', selectedPlantId],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      let q = supabase.from('checklist_executions')
        .select('id', { count: 'exact', head: true })
        .gte('completed_at', since);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const { count } = await q;
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <PageHeader title="Preventive Maintenance Schedule (PMS)" />
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage routine service intervals, checklist executions, and equipment reliability records.
          </p>
        </div>
      </div>

      {/* ── Executive PMS KPI Ribbon ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Building2}
          label="Active Plant"
          value={activePlant?.name ?? 'All Plants'}
          tone={activePlant ? 'accent' : undefined}
        />
        <StatCard
          icon={Wrench}
          label="Active PMS Schedules"
          value={`${templatesCount} Routines`}
        />
        <StatCard
          icon={CheckCircle2}
          label="Executions (30D)"
          value={`${completed30dCount} Done`}
          tone="accent"
        />
        <StatCard
          icon={ShieldCheck}
          label="Equipment Standard"
          value="ISO/PWRI Compliant"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-3 w-full bg-muted/60 p-1 rounded-xl">
          <TabsTrigger value="calendar" className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
            <Calendar className="h-3.5 w-3.5" />
            <span>Calendar & Tasks</span>
          </TabsTrigger>
          <TabsTrigger value="records" className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Execution Logbook</span>
          </TabsTrigger>
          <TabsTrigger value="add" className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
            <PlusCircle className="h-3.5 w-3.5" />
            <span>Equipment Setup</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="calendar" className="mt-3"><PmsCalendar /></TabsContent>
        <TabsContent value="records" className="mt-3"><Records /></TabsContent>
        <TabsContent value="add" className="mt-3"><AddTemplate /></TabsContent>
      </Tabs>
    </div>
  );
}

function AddTemplate() {
  const qc = useQueryClient();
  const { user, isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [generating, setGenerating] = useState(false);
  const [v, setV] = useState({
    plant_id: selectedPlantId ?? '',
    category: 'Controllers',
    equipment_name: '',
    frequencies: new Set<Frequency>(['Monthly']),
    checklist_steps: '',
    schedule_start_date: format(new Date(), 'yyyy-MM-dd'),
  });

  if (!isManager) return <Card className="p-4 text-xs text-center text-muted-foreground">Manager/Admin only</Card>;

  const toggleFreq = (f: Frequency) => {
    const next = new Set(v.frequencies);
    if (next.has(f)) next.delete(f); else next.add(f);
    setV({ ...v, frequencies: next });
  };

  const submit = async () => {
    if (!v.plant_id || !v.equipment_name) { toast.error('Plant and equipment name are required'); return; }
    if (!v.frequencies.size) { toast.error('Pick at least one frequency'); return; }

    const userSteps = v.checklist_steps.split('\n').map(s => s.trim()).filter(Boolean);
    const rows = Array.from(v.frequencies).map((freq) => {
      const seed = PMS_TEMPLATES.find(t =>
        t.category === v.category &&
        t.equipment_name.toLowerCase() === v.equipment_name.toLowerCase() &&
        t.frequency === freq
      );
      return {
        plant_id: v.plant_id,
        category: v.category,
        equipment_name: v.equipment_name,
        frequency: freq,
        checklist_steps: userSteps.length ? userSteps : (seed?.steps ?? []),
        schedule_start_date: v.schedule_start_date,
        created_by: user?.id,
      };
    });
    const { error } = await supabase.from('checklist_templates').insert(rows);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`Created ${rows.length} schedule${rows.length === 1 ? '' : 's'} for ${v.equipment_name}`);
    setV({ ...v, equipment_name: '', frequencies: new Set(['Monthly']), checklist_steps: '' });
    qc.invalidateQueries({ queryKey: ['pms-templates'] });
    qc.invalidateQueries({ queryKey: ['pms-templates-count'] });
  };

  const generatePms = async () => {
    if (!v.plant_id) { toast.error('Pick a plant first'); return; }
    setGenerating(true);
    try {
      const { data: existing } = await supabase
        .from('checklist_templates')
        .select('equipment_name,frequency,category')
        .eq('plant_id', v.plant_id);
      const existsKey = new Set((existing ?? []).map((r: any) =>
        `${r.category}|${r.equipment_name}|${r.frequency}`));
      const startDate = v.schedule_start_date;
      const rows = PMS_TEMPLATES
        .filter(t => !existsKey.has(`${t.category}|${t.equipment_name}|${t.frequency}`))
        .map(t => ({
          plant_id: v.plant_id, category: t.category,
          equipment_name: t.equipment_name, frequency: t.frequency,
          checklist_steps: t.steps, schedule_start_date: startDate,
          created_by: user?.id,
        }));
      if (!rows.length) { toast.info('All standard PMS templates already exist'); return; }
      const { error } = await supabase.from('checklist_templates').insert(rows);
      if (error) throw error;
      toast.success(`Generated ${rows.length} standard PMS schedules`);
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
      qc.invalidateQueries({ queryKey: ['pms-templates-count'] });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setGenerating(false); }
  };

  return (
    <div className="space-y-3">
      <Card className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-accent-soft/40 border-accent/30 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-accent/20 text-accent">
            <Wrench className="h-4 w-4 shrink-0" />
          </div>
          <div>
            <div className="text-xs font-bold text-foreground">Standard Plant PMS Generator</div>
            <p className="text-2xs text-muted-foreground mt-0.5">
              Instantly bootstrap standard routines (Genset, RO Trains, Dosing Pumps, Controllers, Cartridge Filters, Pumps & Motors, pH/NTU/Colorimeters).
            </p>
          </div>
        </div>
        <Button size="sm" onClick={generatePms} disabled={generating || !v.plant_id} className="w-full sm:w-auto shrink-0">
          {generating ? 'Generating…' : 'Generate Standard Library'}
        </Button>
      </Card>

      <Card className="p-4 space-y-4 rounded-xl">
        <div className="text-sm font-bold text-foreground">Add Custom Equipment & Service Intervals</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="maintenance-plant" className="text-xs font-semibold">Target Plant Facility *</Label>
            <Select value={v.plant_id} onValueChange={(x) => setV({ ...v, plant_id: x })}>
              <SelectTrigger id="maintenance-plant"><SelectValue placeholder="Select facility" /></SelectTrigger>
              <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="maintenance-category" className="text-xs font-semibold">Equipment Category *</Label>
            <Select value={v.category} onValueChange={(x) => setV({ ...v, category: x })}>
              <SelectTrigger id="maintenance-category"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="maintenance-equipment-name" className="text-xs font-semibold">Equipment Name *</Label>
          <Input
            value={v.equipment_name}
            placeholder="e.g. RO High Pressure Pump #2"
            onChange={e => setV({ ...v, equipment_name: e.target.value })}
            id="maintenance-equipment-name"
          />
        </div>
        <div>
          <Label className="text-xs font-semibold">Maintenance Frequencies (Multi-Select)</Label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-1.5">
            {FREQUENCIES.map(f => (
              <label key={f}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 cursor-pointer text-xs font-medium transition-colors
                  ${v.frequencies.has(f) ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border hover:bg-muted/40'}`}>
                <Checkbox checked={v.frequencies.has(f)} onCheckedChange={() => toggleFreq(f)} />
                {f}
              </label>
            ))}
          </div>
          <p className="text-3xs text-muted-foreground mt-1">
            One PMS schedule will be generated per selected frequency, starting from the baseline date.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="maintenance-schedule-start-date" className="text-xs font-semibold">Schedule Baseline Start Date</Label>
            <Input type="date" value={v.schedule_start_date} onChange={e => setV({ ...v, schedule_start_date: e.target.value })} id="maintenance-schedule-start-date"/>
          </div>
        </div>
        <div>
          <Label htmlFor="maintenance-custom-steps-optional-one-per-line" className="text-xs font-semibold">Custom Checklist Steps (Optional, One Per Line)</Label>
          <Textarea value={v.checklist_steps} rows={3}
            placeholder="Leave blank to automatically use standard OEM steps for this category."
            onChange={e => setV({ ...v, checklist_steps: e.target.value })} id="maintenance-custom-steps-optional-one-per-line"/>
        </div>
        <Button onClick={submit} className="w-full font-bold">
          Create {v.frequencies.size} Service Schedule{v.frequencies.size === 1 ? '' : 's'}
        </Button>
      </Card>
    </div>
  );
}

function Records() {
  const { selectedPlantId } = useAppStore();
  const [search, setSearch] = useState('');
  const [freqFilter, setFreqFilter] = useState('all');

  const { data = [], isLoading } = useQuery({
    queryKey: ['records', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_executions')
        .select('*,checklist_templates(equipment_name,category,plant_id),user_profiles(first_name,last_name)')
        .order('completed_at', { ascending: false }).limit(100);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const res = await q;
      return res.data ?? [];
    },
  });

  const filtered = useMemo(() => {
    return data.filter((r: any) => {
      const equip = r.checklist_templates?.equipment_name?.toLowerCase() || '';
      const cat = r.checklist_templates?.category?.toLowerCase() || '';
      const tech = `${r.user_profiles?.first_name || ''} ${r.user_profiles?.last_name || ''}`.toLowerCase();
      const matchSearch = !search || equip.includes(search.toLowerCase()) || cat.includes(search.toLowerCase()) || tech.includes(search.toLowerCase());
      const matchFreq = freqFilter === 'all' || r.frequency === freqFilter;
      return matchSearch && matchFreq;
    });
  }, [data, search, freqFilter]);

  const handleExportCSV = () => {
    if (!filtered.length) {
      toast.error('No maintenance records to export');
      return;
    }
    const rows = filtered.map((r: any) => ({
      Equipment: r.checklist_templates?.equipment_name || '—',
      Category: r.checklist_templates?.category || '—',
      Frequency: r.frequency || '—',
      Completed_At: r.completed_at || '—',
      Technician: `${r.user_profiles?.first_name || ''} ${r.user_profiles?.last_name || ''}`.trim() || '—',
      Findings: r.findings || 'None',
      Status: 'Completed',
    }));
    downloadCSV(`PMS_Execution_Records_${format(new Date(), 'yyyyMMdd_HHmm')}`, rows);
    toast.success('Maintenance records exported to CSV');
  };

  return (
    <div className="space-y-3">
      {/* ── Search & Filter Controls ── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 p-2 rounded-xl bg-card border border-border/80">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search equipment, category, technician…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs rounded-lg"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <Select value={freqFilter} onValueChange={setFreqFilter}>
            <SelectTrigger className="h-8 text-2xs w-32">
              <SelectValue placeholder="Frequency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Frequencies</SelectItem>
              {FREQUENCIES.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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

      {/* ── Records List ── */}
      <div className="space-y-2">
        {filtered.map((r: any) => (
          <Card key={r.id} className="p-3 hover:border-foreground/30 transition-all rounded-xl">
            <div className="flex justify-between items-start text-sm">
              <div>
                <div className="font-bold text-foreground">{r.checklist_templates?.equipment_name || 'Equipment Maintenance'}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{r.checklist_templates?.category}</span>
                  <span>·</span>
                  <span className="px-1.5 py-0.5 rounded bg-muted text-3xs font-semibold">{r.frequency}</span>
                </div>
              </div>
              <StatusPill tone="accent">Completed</StatusPill>
            </div>
            <div className="text-xs text-muted-foreground mt-2 flex items-center justify-between border-t border-border/40 pt-2">
              <span>
                Technician: <strong className="text-foreground">{r.user_profiles?.first_name} {r.user_profiles?.last_name}</strong>
              </span>
              <span>
                {r.completed_at && format(new Date(r.completed_at), 'MMM d, yyyy · HH:mm')}
              </span>
            </div>
            {r.findings && (
              <div className="text-xs mt-2 p-2 bg-muted/50 rounded-lg text-foreground font-mono">
                <span className="text-3xs uppercase font-bold text-muted-foreground block mb-0.5">Technician Findings:</span>
                {r.findings}
              </div>
            )}
          </Card>
        ))}

        {!filtered.length && !isLoading && (
          <Card className="p-8 text-center text-muted-foreground rounded-xl">
            <Wrench className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <div className="text-xs font-semibold">No maintenance execution records found</div>
            <p className="text-3xs text-muted-foreground mt-1">Execute tasks from the calendar tab to log maintenance history.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
