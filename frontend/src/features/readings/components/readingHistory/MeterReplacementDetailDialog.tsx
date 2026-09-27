/* eslint-disable @typescript-eslint/no-explicit-any */
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Pencil, ExternalLink, Trash2 } from 'lucide-react';
import type { NormalizedReplacement, ReplacementDetailHost } from './replacementTypes';

function Field({ label, value, span }: { label: string; value: any; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="font-mono-num font-medium text-sm">{value ?? '—'}</div>
    </div>
  );
}

function fmtDT(v: any): string | null {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v))
    ? format(d, 'MMM d, yyyy')
    : format(d, 'MMM d, yyyy HH:mm');
}

const KIND_LABEL: Record<string, string> = {
  well: 'Well meter', locator: 'Locator meter', product: 'Product meter',
  power: 'Power meter', train: 'RO train meter', blending: 'Blending entry',
};

export function MeterReplacementDetailDialog({
  host, records, isLoading, onClose, onEdit, onDelete,
}: {
  host: ReplacementDetailHost | null;
  records: NormalizedReplacement[];
  isLoading: boolean;
  onClose: () => void;
  onEdit: (record: NormalizedReplacement | null) => void;
  onDelete?: (record: NormalizedReplacement) => void;
}) {
  if (!host) return null;
  const { target, settingsHref, canEdit = true } = host;
  const titleBits = [
    target.entityName ?? KIND_LABEL[target.kind] ?? 'Meter replacement',
    target.readingDatetime ? fmtDT(target.readingDatetime) : null,
  ].filter(Boolean);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Meter replacement — {titleBits.join(' · ')}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading replacement details…
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground text-sm">No replacement record linked</p>
            <p>{target.kind === 'blending' ? 'Blending entries only carry a replacement flag.' : 'This row was flagged without logging the old/new meter details.'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {records.map((rec) => (
              <div key={rec.id} className="space-y-3 rounded-lg border border-border/60 p-2.5">
                {(records.length > 1 || rec.meterLabel) && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">{rec.meterLabel ?? 'Meter swap'}</p>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-2xs gap-1" onClick={() => onEdit(rec)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        {onDelete && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-2xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(rec)}>
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Old meter {rec.replacementDate ? `· removed ${fmtDT(rec.replacementDate)}` : ''}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/30 p-2.5">
                    <Field label="Serial" value={rec.oldSerial} />
                    <Field label="Final reading" value={rec.oldFinal} />
                    <Field label="Brand" value={rec.oldBrand} />
                    <Field label="Size" value={rec.oldSize} />
                  </div>
                </div>
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">New meter {rec.installedDate ? `· installed ${fmtDT(rec.installedDate)}` : ''}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/30 p-2.5">
                    <Field label="Brand" value={rec.newBrand} />
                    <Field label="Size" value={rec.newSize} />
                    <Field label="Serial" value={rec.newSerial} />
                    <Field label="Initial reading" value={rec.newInitial} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Field label="Replaced by" value={rec.replacerName ?? rec.replacedBy} />
                  <Field label="Remarks" value={rec.remarks} span />
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="gap-2 flex-wrap">
          {canEdit && target.kind !== 'blending' && records.length === 1 && onDelete && (
            <Button size="sm" variant="destructive" onClick={() => onDelete(records[0])} disabled={isLoading} className="gap-1.5 mr-auto">
              <Trash2 className="h-3 w-3" /> Delete
            </Button>
          )}
          {canEdit && target.kind !== 'blending' && records.length <= 1 && (
            <Button size="sm" onClick={() => onEdit(records[0] ?? null)} disabled={isLoading} className="gap-1.5">
              <Pencil className="h-3 w-3" />{records.length ? 'Edit replacement…' : 'Log details…'}
            </Button>
          )}
          {settingsHref && (
            <a href={settingsHref}><Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="h-3 w-3" /> Open meter settings</Button></a>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

