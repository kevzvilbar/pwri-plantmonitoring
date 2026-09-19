import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { PMS_CATEGORIES, PMS_FREQUENCIES } from '@/lib/pmsTemplates';
import type { Template } from './pmsTypes';
import { format } from 'date-fns';

export function EditTemplateDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    category: template.category,
    equipment_name: template.equipment_name,
    frequency: template.frequency,
    schedule_start_date: template.schedule_start_date ?? format(new Date(), 'yyyy-MM-dd'),
    checklist_steps: (template.checklist_steps ?? []).join('\n'),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!v.equipment_name.trim()) { toast.error('Equipment name is required'); return; }
    setSaving(true);
    try {
      const steps = v.checklist_steps.split('\n').map(s => s.trim()).filter(Boolean);
      const { error } = await supabase.from('checklist_templates').update({
        category: v.category,
        equipment_name: v.equipment_name.trim(),
        frequency: v.frequency,
        schedule_start_date: v.schedule_start_date || null,
        checklist_steps: steps.length ? steps : null,
      }).eq('id', template.id);
      if (error) throw error;
      toast.success('PMS schedule updated');
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
      qc.invalidateQueries({ queryKey: ['pms-exec-for'] });
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
      title="Edit PMS Schedule"
      description="Changes apply going forward. Already-completed checklist history is kept."
      className="max-w-lg w-[95vw]"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="button-save-edit-template">
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label htmlFor="pmscalendar-category">Category</Label>
            <Select value={v.category} onValueChange={(x) => setV({ ...v, category: x })}>
              <SelectTrigger data-testid="select-edit-category" id="pmscalendar-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PMS_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pmscalendar-frequency">Frequency</Label>
            <Select value={v.frequency} onValueChange={(x) => setV({ ...v, frequency: x as Template['frequency'] })}>
              <SelectTrigger data-testid="select-edit-frequency" id="pmscalendar-frequency"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PMS_FREQUENCIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="pmscalendar-equipment-name">Equipment Name</Label>
          <Input value={v.equipment_name} data-testid="input-edit-equipment-name"
            onChange={(e) => setV({ ...v, equipment_name: e.target.value })} id="pmscalendar-equipment-name"/>
        </div>
        <div>
          <Label htmlFor="pmscalendar-schedule-start-date">Schedule Start Date</Label>
          <Input type="date" value={v.schedule_start_date} data-testid="input-edit-start-date"
            onChange={(e) => setV({ ...v, schedule_start_date: e.target.value })} id="pmscalendar-schedule-start-date"/>
        </div>
        <div>
          <Label htmlFor="pmscalendar-checklist-steps-one-per-line">Checklist Steps (One Per Line)</Label>
          <Textarea value={v.checklist_steps} rows={6} data-testid="textarea-edit-steps"
            onChange={(e) => setV({ ...v, checklist_steps: e.target.value })} id="pmscalendar-checklist-steps-one-per-line"/>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
