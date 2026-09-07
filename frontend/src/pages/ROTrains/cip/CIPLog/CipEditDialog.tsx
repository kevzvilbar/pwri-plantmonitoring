import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CIP_CHEM_ACCENTS, CIP_CUSTOM_ACCENT, CIP_BUILTIN_DB_MAP } from '../../../ro-trains';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';

export function CipEditDialog({
  editId,
  editRow,
  editChems,
  setEditChems,
  editStart,
  setEditStart,
  editEnd,
  setEditEnd,
  editRemarks,
  setEditRemarks,
  editReason,
  setEditReason,
  editCustomReason,
  setEditCustomReason,
  saving,
  onClose,
  cipChemicals,
  isReasonComplete,
  saveEdit,
  format,
}: {
  editId: string | null;
  editRow: any;
  editChems: Record<string, string>;
  setEditChems: (v: Record<string, string>) => void;
  editStart: string;
  setEditStart: (v: string) => void;
  editEnd: string;
  setEditEnd: (v: string) => void;
  editRemarks: string;
  setEditRemarks: (v: string) => void;
  editReason: string;
  setEditReason: (v: string) => void;
  editCustomReason: string;
  setEditCustomReason: (v: string) => void;
  saving: boolean;
  onClose: () => void;
  cipChemicals: Array<{ name: string; unit: string }>;
  isReasonComplete: (reason: string, custom: string) => boolean;
  saveEdit: () => void;
  format: (date: Date, fmt: string) => string;
}) {
  if (!editId || !editRow) return null;

  const dur = editStart && editEnd
    ? Math.round((new Date(editEnd).getTime() - new Date(editStart).getTime()) / 60000)
    : null;

  return (
    <Dialog open={!!editId} onOpenChange={o => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit CIP Record
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ciplog-start-d-amp-t" className="text-xs text-muted-foreground">Start Date & Time</Label>
              <DateTimePicker
                value={editStart}
                onChange={setEditStart}
                placeholder="Select start time..."
                size="sm"
                className="w-full font-mono-num"
                id="ciplog-start-d-amp-t"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ciplog-end-d-amp-t" className="text-xs text-muted-foreground">End Date & Time</Label>
              <DateTimePicker
                value={editEnd}
                onChange={setEditEnd}
                placeholder="Select end time..."
                size="sm"
                className="w-full font-mono-num"
                id="ciplog-end-d-amp-t"
              />
            </div>
          </div>
          {editStart && editEnd && dur != null && dur > 0 && (
            <p className="text-2xs text-muted-foreground">
              Duration: <span className="font-semibold text-foreground">{dur} min</span>
            </p>
          )}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Chemicals</p>
            <div className="grid grid-cols-2 gap-2">
              {cipChemicals.map(chem => {
                const accent = CIP_CHEM_ACCENTS[chem.name] ?? CIP_CUSTOM_ACCENT;
                const val = editChems[chem.name] ?? '';
                return (
                  <div key={chem.name}
                    className={cn('rounded-lg border-2 p-2 space-y-1 transition-colors',
                      val ? accent.border : 'border-border bg-muted/20'
                    )}>
                    <div className="flex items-center gap-1">
                      <span className={cn(
                        'inline-flex items-center justify-center w-4 h-4 rounded-full text-3xs font-bold shrink-0',
                        accent.badge,
                      )}>
                        {CIP_BUILTIN_DB_MAP[chem.name] ? chem.name.slice(0, 2).toUpperCase() : '✦'}
                      </span>
                      <span className="text-xs font-semibold leading-tight truncate">{chem.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" step="any"
                        value={val}
                        onChange={e => setEditChems({ ...editChems, [chem.name]: e.target.value })}
                        className="h-7 text-sm flex-1"
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">{chem.unit}</span>
                    </div>
                  </div>
                );
              })}
              {cipChemicals.length === 0 && (
                <p className="col-span-2 text-xs text-muted-foreground italic">
                  No CIP chemicals configured — go to Plant Configuration → CIP Chemicals.
                </p>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="ciplog-remarks-2" className="text-xs text-muted-foreground">Remarks</Label>
            <Textarea value={editRemarks}
              onChange={e => setEditRemarks(e.target.value)}
              placeholder="Any observations..."
              className="text-xs min-h-[60px] resize-none" id="ciplog-remarks-2"/>
          </div>
          <CorrectionReasonField
            reason={editReason} onReasonChange={setEditReason}
            customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost"
            onClick={onClose}
            disabled={saving}>Cancel</Button>
          <Button onClick={saveEdit} disabled={saving || !isReasonComplete(editReason, editCustomReason)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}