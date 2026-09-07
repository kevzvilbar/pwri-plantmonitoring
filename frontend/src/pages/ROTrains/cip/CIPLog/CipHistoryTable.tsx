import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DateTimePicker } from '@/components/ui/date-picker';
import { fmtNum } from '@/lib/calculations';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExportButton } from '@/components/ExportButton';
import { EDIT_WINDOW_HOURS, canEditEntry } from '../../../ro-trains';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';

export function CipHistoryTable({
  history,
  cipPrices,
  cipChemicals,
  getHistoryCost,
  getChemType,
  startEdit,
  deleteCipRow,
  pendingDeleteId,
  setPendingDeleteId,
  editId,
  deleting,
  saving,
  isManager,
  activeOperator,
  format,
  plantId,
  qc,
  selectedTrain,
}: {
  history: any[];
  cipPrices: Record<string, number> | undefined;
  cipChemicals: Array<{ name: string; unit: string }>;
  getHistoryCost: (c: any) => number;
  getChemType: (c: any) => string;
  startEdit: (c: any) => void;
  deleteCipRow: (c: any) => void;
  pendingDeleteId: string | null;
  setPendingDeleteId: (id: string | null) => void;
  editId: string | null;
  deleting: boolean;
  saving: boolean;
  isManager: boolean;
  activeOperator: any;
  format: (date: Date, fmt: string) => string;
  plantId: string;
  qc: ReturnType<typeof useQueryClient>;
  selectedTrain: any;
}) {
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          CIP History {selectedTrain ? `— Train ${selectedTrain.train_number}` : ''}
        </h4>
        <ExportButton table="cip_logs" label="Export" />
      </div>
      <p className="text-2xs text-muted-foreground/70 italic">
        Operators may edit or delete their own records within {EDIT_WINDOW_HOURS} hrs. Managers can edit or delete any record.
      </p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-1.5 pr-2 font-semibold">Date</th>
              <th className="text-left py-1.5 pr-2 font-semibold">Duration</th>
              <th className="text-left py-1.5 pr-2 font-semibold">Chemical Type</th>
              <th className="text-right py-1.5 pr-2 font-semibold">Cost</th>
              <th className="text-right py-1.5 font-semibold w-16">Actions</th>
            </tr>
          </thead>
          <tbody>
            {history?.map((c: any) => {
              const dur = c.start_datetime && c.end_datetime
                ? Math.round((new Date(c.end_datetime).getTime() - new Date(c.start_datetime).getTime()) / 60000)
                : null;
              const hCost = getHistoryCost(c);
              const canEdit = canEditEntry({ recorded_by: c.conducted_by ?? null, created_at: c.created_at ?? null }, isManager, activeOperator?.id);
              const isPendingDelete = pendingDeleteId === c.id;
              return (
                <tr key={c.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                  <td className="py-1.5 pr-2 font-mono-num text-xs">
                    {c.start_datetime ? format(new Date(c.start_datetime), 'MM/dd/yy HH:mm') : '—'}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {dur != null && dur > 0 ? `${dur} min` : '—'}
                  </td>
                  <td className="py-1.5 pr-2">{getChemType(c)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono-num">
                    {cipPrices ? `₱ ${fmtNum(hCost, 2)}` : '—'}
                  </td>
                  <td className="py-1.5 text-right">
                    {canEdit && !isPendingDelete && (
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => startEdit(c)}
                          disabled={!!editId || deleting}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                          title="Edit this CIP record"
                          aria-label="Edit CIP record"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(c.id)}
                          disabled={!!editId || deleting}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
                          title="Delete this CIP record"
                          aria-label="Delete CIP record"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {isPendingDelete && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => deleteCipRow(c)}
                          disabled={deleting}
                          className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-2xs font-semibold"
                        >
                          {deleting ? <Loader2 className="h-2.5 w-2.5 animate-spin inline" /> : 'Yes'}
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground text-2xs"
                        >
                          No
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!history?.length && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted-foreground">No CIP records yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}