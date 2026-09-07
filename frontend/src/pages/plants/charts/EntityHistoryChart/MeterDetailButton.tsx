import React from 'react';
import { ChevronLeft, ChevronDown, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export interface MeterDetailButtonProps {
  label: string;
  icon?: React.ReactNode;
  fields: { label: string; value: string | null | undefined }[];
  children?: React.ReactNode;
}

export function MeterDetailButton({ label, icon, fields, children }: MeterDetailButtonProps) {
  const [open, setOpen] = React.useState(false);
  const filledCount = fields.filter(f => f.value && f.value !== '—').length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors group text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <span className="text-sm font-medium truncate">{label}</span>
          {filledCount > 0 && (
            <span className="text-2xs px-1.5 py-0.5 rounded-full bg-primary-soft text-primary font-medium shrink-0">
              {filledCount} field{filledCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 -rotate-90" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {icon}
              <span>{label}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {fields.map((f, i) => (
                <div key={i} className={f.label === 'Installed' ? 'col-span-2' : ''}>
                  <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">{f.label}</div>
                  <div className="font-mono-num font-medium">{f.value || '—'}</div>
                </div>
              ))}
            </div>
            {children && <div className="pt-2 border-t">{children}</div>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
