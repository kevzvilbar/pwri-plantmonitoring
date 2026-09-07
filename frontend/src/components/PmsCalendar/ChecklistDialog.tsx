import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import type { DueItem, Template } from './pmsTypes';
import { format } from 'date-fns';

export function ChecklistDialog({ item, isManager, onClose, onEdit, onDelete }: {
  item: DueItem;
  isManager: boolean;
  onClose: () => void;
  onEdit: (t: Template) => void;
  onDelete: (t: Template) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const steps = item.template.checklist_steps ?? [];
  const dateKey = format(item.date, 'yyyy-MM-dd');

  const { data: existingExec } = useQuery({
    queryKey: ['pms-exec-for', item.template.id, dateKey],
    queryFn: async () => {
      const { data } = await supabase.from('checklist_executions')
        .select('*')
        .eq('template_id', item.template.id)
        .eq('execution_date', dateKey)
        .limit(1);
      return data?.[0] ?? null;
    },
  });

  const { data: existingSteps } = useQuery({
    queryKey: ['pms-step-execs', existingExec?.id],
    queryFn: async () => {
      if (!existingExec?.id) return [];
      const { data } = await supabase.from('checklist_step_executions')
        .select('*').eq('execution_id', existingExec.id).order('step_index');
      return data ?? [];
    },
    enabled: !!existingExec?.id,
  });

  const [findings, setFindings] = useState('');
  const [stepState, setStepState] = useState<Record<number, { completed: boolean; value: string; notes: string }>>({});
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (existingExec?.findings) setFindings(existingExec.findings);
    if (existingSteps?.length) {
      const next: typeof stepState = {};
      existingSteps.forEach((s: any) => {
        next[s.step_index] = { completed: s.completed, value: s.value ?? '', notes: s.notes ?? '' };
      });
      setStepState(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingExec?.id, existingSteps?.length]);

  const setStep = (i: number, patch: Partial<{ completed: boolean; value: string; notes: string }>) => {
    setStepState(prev => ({
      ...prev,
      [i]: { completed: false, value: '', notes: '', ...prev[i], ...patch },
    }));
  };

  const allDone = steps.length > 0 && steps.every((_, i) => stepState[i]?.completed);

  const save = async () => {
    setSaving(true);
    try {
      let execId = existingExec?.id;
      if (!execId) {
        const { data: ins, error } = await supabase.from('checklist_executions').insert({
          template_id: item.template.id,
          plant_id: item.template.plant_id,
          frequency: item.template.frequency,
          execution_date: dateKey,
          completed: allDone,
          completed_by: allDone ? user?.id : null,
          completed_at: allDone ? new Date().toISOString() : null,
          findings: findings || null,
        }).select('id').single();
        if (error) throw error;
        execId = ins.id;
      } else {
        const { error } = await supabase.from('checklist_executions').update({
          completed: allDone,
          completed_by: allDone ? user?.id : null,
          completed_at: allDone ? new Date().toISOString() : null,
          findings: findings || null,
        }).eq('id', execId);
        if (error) throw error;
      }

      if (execId) {
        await supabase.from('checklist_step_executions').delete().eq('execution_id', execId);
        const stepRows = steps.map((text, i) => {
          const s = stepState[i] ?? { completed: false, value: '', notes: '' };
          return {
            execution_id: execId!,
            template_id: item.template.id,
            plant_id: item.template.plant_id,
            step_index: i,
            step_text: text,
            completed: !!s.completed,
            value: s.value || null,
            notes: s.notes || null,
            completed_by: s.completed ? user?.id ?? null : null,
            completed_at: s.completed ? new Date().toISOString() : null,
          };
        });
        if (stepRows.length) {
          const { error } = await supabase.from('checklist_step_executions').insert(stepRows);
          if (error) throw error;
        }
      }

      toast.success(allDone ? 'Checklist completed' : 'Progress saved');
      qc.invalidateQueries({ queryKey: ['pms-executions'] });
      qc.invalidateQueries({ queryKey: ['pms-exec-for', item.template.id, dateKey] });
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={(
        <div className="flex items-start justify-between gap-2 pr-6">
          <div className="min-w-0">
            <span className="text-base truncate block">{item.template.equipment_name}</span>
            <p className="text-xs text-muted-foreground font-normal">
              {item.template.category} · {item.template.frequency} · {format(item.date, 'EEE, MMM d, yyyy')}
            </p>
          </div>
          {isManager && (
            <div className="flex items-center gap-1 shrink-0">
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                aria-label="Edit this PMS schedule" data-testid="button-edit-open-item"
                onClick={() => onEdit(item.template)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-danger hover:text-danger"
                aria-label="Delete this PMS schedule" data-testid="button-delete-open-item"
                onClick={() => onDelete(item.template)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
      className="max-w-lg w-[95vw]"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : allDone ? 'Mark Complete' : 'Save Progress'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 pb-4">
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            This template has no checklist steps. Edit the template to add some.
          </p>
        ) : (
          <div className="space-y-2">
            {steps.map((text, i) => {
              const s = stepState[i] ?? { completed: false, value: '', notes: '' };
              const isMeasurement = /\(.*\)$/.test(text) && !text.includes('—') && !text.includes('/');
              return (
                <div key={`${i}-${text.slice(0, 24)}`}
                  className={`rounded-md border p-2 transition-colors ${s.completed ? 'bg-accent-soft/50 border-accent/40' : 'bg-card'}`}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox checked={s.completed} className="mt-0.5"
                      onCheckedChange={(c) => setStep(i, { completed: !!c })} />
                    <span className="text-xs flex-1 leading-snug">{text}</span>
                  </label>
                  {isMeasurement && (
                    <Input value={s.value} placeholder="Reading / value"
                      className="mt-2 h-8 text-xs"
                      onChange={(e) => setStep(i, { value: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="pms-findings" className="text-xs font-medium">Findings / Notes (Optional)</label>
          <Textarea id="pms-findings" value={findings} onChange={(e) => setFindings(e.target.value)} rows={2} />
        </div>
      </div>
    </ResponsiveDialog>
  );
}
