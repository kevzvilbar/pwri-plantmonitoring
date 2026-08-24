import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { type RawReading } from '@/lib/regressionCorrection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { fmtIsoDate } from '@/lib/format';
import { Pencil, RefreshCw, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAIRED_COL_TABLES } from './shared';

// ── Edit Raw Value Dialog ──────────────────────────────────────────────────────

interface EditRawDialogProps {
  open: boolean;
  onClose: () => void;
  reading: RawReading | null;
  column: string;
  onSuccess: () => void;
}

export function EditRawDialog({ open, onClose, reading, column, onSuccess }: EditRawDialogProps) {
  const { session, isAdmin, roles } = useAuth();
  const [newValue,       setNewValue]       = useState('');
  const [pairedOldValue, setPairedOldValue] = useState('');   // existing DB value (read-only display)
  const [pairedNewValue, setPairedNewValue] = useState('');   // value being edited
  const [note,           setNote]           = useState('');
  const [saving,         setSaving]         = useState(false);
  const [loadingPaired,  setLoadingPaired]  = useState(false);

  const srcTable  = (reading?._sourceTable as string) ?? '';
  const isPaired  = (column === 'current_reading' || column === 'previous_reading')
                    && PAIRED_COL_TABLES.has(srcTable);
  const pairedCol = column === 'current_reading' ? 'previous_reading' : 'current_reading';

  const oldValue = reading ? (reading[column] as number | null) : null;

  // Fetch the paired column value from the same row when dialog opens
  useEffect(() => {
    if (!open || !reading) return;
    setNewValue('');
    setNote('');
    setPairedOldValue('');
    setPairedNewValue('');
    if (!isPaired) return;

    setLoadingPaired(true);
    (supabase.from(srcTable as never) as any)
      .select(`id, ${pairedCol}`)
      .eq('id', reading.id)
      .maybeSingle()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        const pv = data?.[pairedCol] as number | null;
        const pvStr = pv != null ? String(pv) : '';
        setPairedOldValue(pvStr);   // lock in the existing DB value for display
        setPairedNewValue(pvStr);   // pre-fill the editable field with the same value
        setLoadingPaired(false);
      })
      .catch(() => setLoadingPaired(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reading?.id]);

  // Auto-compute daily_volume = current_reading – previous_reading
  const computedDelta = (() => {
    if (!isPaired) return null;
    const curr = column === 'current_reading'
      ? parseFloat(newValue  || String(oldValue ?? ''))
      : parseFloat(pairedNewValue);
    const prev = column === 'previous_reading'
      ? parseFloat(newValue  || String(oldValue ?? ''))
      : parseFloat(pairedNewValue);
    if (isNaN(curr) || isNaN(prev)) return null;
    return curr - prev;
  })();

  const handleSave = async () => {
    if (!reading) return;
    const parsed = parseFloat(newValue);
    if (isNaN(parsed)) { toast.error('Enter a valid number'); return; }
    const pairedParsed = isPaired ? parseFloat(pairedNewValue) : NaN;

    setSaving(true);
    try {
      // Build update payload — include paired column when both are being saved
      const updatePayload: Record<string, number> = { [column]: parsed };
      if (isPaired && !isNaN(pairedParsed)) updatePayload[pairedCol] = pairedParsed;

      // 1. Update source table (both columns in one call if paired)
      const { error: updateErr } = await (supabase
        .from(srcTable as never) as any)
        .update(updatePayload)
        .eq('id', reading.id);
      if (updateErr) throw new Error(updateErr.message);

      // 2. Log to audit table — one entry per changed column
      const userRole = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');
      const auditRows: Record<string, unknown>[] = [{
        source_table: srcTable,
        source_id:    reading.id,
        column_name:  column,
        old_value:    oldValue,
        new_value:    parsed,
        edited_by:    session?.user?.id ?? null,
        edited_role:  userRole,
        edited_at:    new Date().toISOString(),
        note:         note || '',
      }];
      if (isPaired && !isNaN(pairedParsed)) {
        auditRows.push({
          source_table: srcTable,
          source_id:    reading.id,
          column_name:  pairedCol,
          old_value:    pairedOldValue !== '' ? parseFloat(pairedOldValue) : null,
          new_value:    pairedParsed,
          edited_by:    session?.user?.id ?? null,
          edited_role:  userRole,
          edited_at:    new Date().toISOString(),
          note:         note ? `[paired] ${note}` : `[paired edit with ${column}]`,
        });
      }
      await supabase.from('raw_edit_log').insert(auditRows as any);

      toast.success(isPaired ? 'Both values updated and logged' : 'Value updated and logged');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={(
        <span className="flex items-center gap-2">
          <Pencil className="h-4 w-4" /> Edit Raw Value
          {isPaired && (
            <Badge variant="outline" className="text-2xs ml-1 border-primary text-primary">
              Paired Edit
            </Badge>
          )}
        </span>
      )}
      className="max-w-sm"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !newValue}>
            {saving ? 'Saving…' : isPaired ? 'Save pair' : 'Save edit'}
          </Button>
        </div>
      )}
    >
        <div className="space-y-3 pb-4">
          <div className="text-xs text-muted-foreground">
            {isPaired ? (
              <>Editing pair: <span className="font-mono font-semibold">{column}</span> &amp; <span className="font-mono font-semibold">{pairedCol}</span></>
            ) : (
              <>Column: <span className="font-mono font-semibold">{column}</span></>
            )}
            <br />
            Reading: <span className="font-mono">{fmtIsoDate(reading?.reading_datetime)}</span>
          </div>

          {/* Primary column */}
          <div>
            <Label htmlFor="dataanalysis-field" className="text-xs font-semibold">{column}</Label>
            <div className="flex gap-2 mt-1 items-center">
              <div className="w-1/2">
                <p className="text-2xs text-muted-foreground mb-0.5">Current</p>
                <Input value={oldValue ?? '—'} disabled className="font-mono text-sm bg-muted/40 h-8" id="dataanalysis-field"/>
              </div>
              <div className="w-1/2">
                <p className="text-2xs text-muted-foreground mb-0.5">New value <span className="text-danger">*</span></p>
                <Input
                  className="font-mono text-sm h-8"
                  placeholder="e.g. 123.45"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          </div>

          {/* Paired column */}
          {isPaired && (
            <div className="border-t pt-3">
              <Label htmlFor="dataanalysis-linked-editable" className="text-xs font-semibold flex items-center gap-1.5">
                {pairedCol}
                <span className="text-2xs font-normal text-muted-foreground">(linked — editable)</span>
                {loadingPaired && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
              </Label>
              <div className="flex gap-2 mt-1 items-center">
                <div className="w-1/2">
                  <p className="text-2xs text-muted-foreground mb-0.5">Current</p>
                  <Input value={loadingPaired ? 'Loading…' : (pairedOldValue || '—')} disabled className="font-mono text-sm bg-muted/40 h-8" id="dataanalysis-linked-editable"/>
                </div>
                <div className="w-1/2">
                  <p className="text-2xs text-muted-foreground mb-0.5">New value</p>
                  <Input
                    className="font-mono text-sm h-8"
                    placeholder="optional"
                    value={pairedNewValue}
                    onChange={e => setPairedNewValue(e.target.value)}
                    disabled={loadingPaired}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Auto-computed daily_volume indicator */}
          {isPaired && computedDelta != null && (
            <div className="rounded bg-primary-soft border border-primary px-3 py-1.5 flex items-center justify-between text-xs">
              <span className="text-primary font-medium">Computed daily_volume</span>
              <span className={cn('font-mono font-semibold', computedDelta < 0 ? 'text-danger' : 'text-primary')}>
                {computedDelta >= 0 ? '+' : ''}{computedDelta.toFixed(3)}
              </span>
            </div>
          )}

          <div>
            <Label htmlFor="dataanalysis-reason-note" className="text-xs">Reason / note</Label>
            <Input className="mt-1 text-sm" placeholder="Optional" value={note} onChange={e => setNote(e.target.value)} id="dataanalysis-reason-note"/>
          </div>
          <div className="rounded bg-warn-soft border border-warn p-2 text-xs text-warn">
            <Info className="inline h-3 w-3 mr-1" />
            {isPaired
              ? 'Both columns are saved together and each change is logged in the audit trail.'
              : 'All edits are logged in the audit trail and cannot be deleted.'}
          </div>
        </div>
    </ResponsiveDialog>
  );
}

