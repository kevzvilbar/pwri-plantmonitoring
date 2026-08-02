import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, Calendar, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format, differenceInDays } from 'date-fns';
import { DataState } from '@/components/DataState';
import { cn } from '@/lib/utils';

const BASE = (import.meta.env.VITE_BACKEND_URL as string) || '';

type Template = {
  id: string;
  equipment_name: string;
  category: string;
  frequency: string;
  schedule_start_date: string | null;
  plant_id: string | null;
};

type ForecastResponse = {
  recommended_next_date: string | null;
  confidence: 'low' | 'medium' | 'high' | string;
  rationale: string;
  risk_factors: string[];
};

export function PmForecastTab() {
  const { selectedPlantId } = useAppStore();
  const [templateId, setTemplateId] = useState<string>('');
  const [downtime, setDowntime] = useState<string>('');
  const [trend, setTrend] = useState<'rising' | 'stable' | 'falling' | ''>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ForecastResponse | null>(null);

  const { data: templates, isLoading, error } = useQuery({
    queryKey: ['pm-templates', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_templates')
        .select('id,equipment_name,category,frequency,schedule_start_date,plant_id')
        .order('equipment_name');
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });

  const chosen = templates?.find((t) => t.id === templateId);

  const runForecast = useCallback(async () => {
    if (!chosen) { toast.error('Pick an equipment template'); return; }
    setLoading(true);
    setResult(null);

    // Get the last execution date for this template
    let lastExec: string | null = null;
    try {
      const { data } = await supabase
        .from('checklist_executions')
        .select('execution_date,completed')
        .eq('template_id', chosen.id)
        .eq('completed', true)
        .order('execution_date', { ascending: false })
        .limit(1);
      lastExec = data?.[0]?.execution_date ?? null;
    } catch { /* ignore */ }

    // Last ~10 execution dates for history context
    let history: any[] = [];
    try {
      const { data } = await supabase
        .from('checklist_executions')
        .select('execution_date,completed,findings')
        .eq('template_id', chosen.id)
        .order('execution_date', { ascending: false })
        .limit(10);
      history = (data ?? []).map((r: any) => ({
        date: r.execution_date, completed: r.completed, findings: r.findings,
      }));
    } catch { /* ignore */ }

    try {
      const body = {
        equipment_name: chosen.equipment_name,
        category: chosen.category,
        frequency: chosen.frequency,
        last_execution_date: lastExec ?? chosen.schedule_start_date,
        history,
        downtime_hrs_last_30d: downtime ? parseFloat(downtime) : undefined,
        chem_consumption_trend: trend || undefined,
        notes: notes || undefined,
      };
      const res = await fetch(`${BASE}/api/ai/pm-forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? `HTTP ${res.status}`);
      const json: ForecastResponse = await res.json();
      setResult(json);
      toast.success('Forecast generated');
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [chosen, downtime, trend, notes]);

  return (
    <div className="space-y-3">
      {!BASE && (
        <DataState
          unavailable
          unavailableTitle="PM Forecast needs a backend that isn't configured"
          unavailableDescription="This calls backend/server.py's /api/ai/pm-forecast route, which needs VITE_BACKEND_URL set to a reachable, deployed instance."
        />
      )}
      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <div>
            <Label className="text-xs">Equipment / PM template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a template…" /></SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.equipment_name} · {t.frequency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Downtime last 30d (hrs)</Label>
            <Input type="number" step="0.1" className="mt-1 font-mono-num"
              value={downtime} onChange={(e) => setDowntime(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Chem consumption trend</Label>
            <Select value={trend} onValueChange={(v) => setTrend(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rising">Rising</SelectItem>
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="falling">Falling</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs">Notes (optional)</Label>
          <Textarea className="mt-1 text-sm" rows={2}
            placeholder="e.g. Differential pressure has crept up 15% in the last month."
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={runForecast} disabled={loading || !templateId || !BASE}>
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            Forecast next PM
          </Button>
        </div>
      </Card>

      {isLoading || error ? (
        <DataState loading={isLoading} error={error} />
      ) : (!templates || templates.length === 0) ? (
        <DataState isEmpty emptyTitle="No equipment templates yet"
          emptyDescription="Add an equipment template first in the Add Equipment tab." />
      ) : null}

      {result && (
        <Card className={cn(
          'p-4 border-l-2',
          !result.recommended_next_date ? 'border-slate-300'
            : isOverdue(result.recommended_next_date) ? 'border-danger bg-danger-soft/40'
            : isSoon(result.recommended_next_date) ? 'border-warn bg-warn-soft/40'
            : 'border-accent bg-accent-soft/40',
        )}>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-md bg-gradient-to-br from-info to-kpi-ro text-white flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold">
                  {result.recommended_next_date
                    ? `Recommended next PM: ${result.recommended_next_date}`
                    : 'Unable to forecast next PM date'}
                </div>
                <Badge variant="outline" className="capitalize">{result.confidence} confidence</Badge>
                {result.recommended_next_date && (() => {
                  const diff = differenceInDays(new Date(result.recommended_next_date), new Date());
                  return (
                    <Badge variant="outline" className={cn(
                      'font-mono-num',
                      diff < 0 && 'bg-danger-soft text-danger border-danger',
                      diff >= 0 && diff <= 14 && 'bg-warn-soft text-warn border-warn',
                      diff > 14 && 'bg-accent-soft text-accent border-accent',
                    )}>
                      <Calendar className="h-3 w-3 mr-1" />
                      {diff === 0 ? 'today' : diff < 0 ? `${-diff}d overdue` : `in ${diff}d`}
                    </Badge>
                  );
                })()}
              </div>
              <p className="text-sm mt-2">{result.rationale}</p>
              {result.risk_factors.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Risk factors
                  </div>
                  <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                    {result.risk_factors.map((r, i) => <li key={`${i}-${r.slice(0, 32)}`}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
          {chosen && (
            <div className="mt-3 text-xs text-muted-foreground pl-13">
              Asset: <b>{chosen.equipment_name}</b> · Frequency: <b>{chosen.frequency}</b> · Category: {chosen.category}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function isOverdue(dateStr: string): boolean {
  return differenceInDays(new Date(dateStr), new Date()) < 0;
}
function isSoon(dateStr: string): boolean {
  const d = differenceInDays(new Date(dateStr), new Date());
  return d >= 0 && d <= 14;
}

export default PmForecastTab;
