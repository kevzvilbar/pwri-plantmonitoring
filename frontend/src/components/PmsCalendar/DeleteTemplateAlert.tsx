import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ResponsiveAlertDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import type { Template } from './pmsTypes';

export function DeleteTemplateAlert({ template, onClose, onDeleted }: {
  template: Template;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.from('checklist_templates').delete().eq('id', template.id);
      if (error) throw error;
      toast.success(`Deleted "${template.equipment_name}" schedule`);
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
      qc.invalidateQueries({ queryKey: ['pms-executions'] });
      onDeleted();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={(o) => { if (!o && !deleting) onClose(); }}
      title={<span className="text-danger">Delete PMS schedule?</span>}
      description={(
        <>
          This permanently removes <strong>{template.equipment_name}</strong> ({template.category} · {template.frequency}),
          including its checklist history. This cannot be undone.
        </>
      )}
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" disabled={deleting} data-testid="button-cancel-delete-template" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirmDelete} disabled={deleting}
            className="bg-danger text-danger-foreground hover:bg-danger/90"
            data-testid="button-confirm-delete-template">
            {deleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      )}
    >
      {null}
    </ResponsiveAlertDialog>
  );
}
