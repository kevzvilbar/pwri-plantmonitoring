import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil, X, Loader2 } from 'lucide-react';
import { friendlyError } from '@/lib/supabaseErrors';

async function logProductMeterAudit(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('product_meter_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore */ }
}

export function ProductMeterNameInlineBase({
  meter, plantId, userId, canEdit, onChanged, fallbackIndex,
}: {
  meter: any; plantId: string; userId: string | null; canEdit: boolean; onChanged: () => void; fallbackIndex?: number;
}) {
  const [editing, setEditing]       = useState(false);
  const [nameInput, setNameInput]   = useState(meter.name ?? '');
  const [busy, setBusy]             = useState(false);

  useEffect(() => {
    if (!editing) setNameInput(meter.name ?? '');
  }, [meter.name, editing]);

  const saveName = async () => {
    if (!nameInput.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    const { error } = await supabase
      .from('product_meters' as any).update({ name: nameInput.trim() } as any).eq('id', meter.id);
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plantId, meter_id: meter.id, meter_name: nameInput.trim(),
      old_value: meter.name, new_value: nameInput.trim(),
      user_id: userId, timestamp: new Date().toISOString(),
    });
    toast.success('Meter renamed');
    setEditing(false); onChanged();
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 flex-1">
        <Input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          className="h-7 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveName();
            if (e.key === 'Escape') { setEditing(false); setNameInput(meter.name ?? ''); }
          }}
          autoFocus
        />
        <Button size="sm" className="h-7 px-2 text-xs bg-primary hover:bg-primary/90 text-primary-foreground" onClick={saveName} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" onClick={() => { setEditing(false); setNameInput(meter.name ?? ''); }}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="font-medium text-sm truncate">
      {meter.name?.trim()
        ? meter.name
        : canEdit
          ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="italic text-warn hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              title="No name set — click to rename"
            >
              Product Meter {fallbackIndex ?? ''} (click to rename)
            </button>
          )
          : <span className="text-muted-foreground">Product Meter {fallbackIndex ?? ''}</span>
      }
    </div>
  );
}

export function PMEditTriggerBase({
  meter, plantId, userId, canEdit, onChanged,
}: {
  meter: any; plantId: string; userId: string | null; canEdit: boolean; onChanged: () => void;
}) {
  const [open, setOpen]           = useState(false);
  const [nameInput, setNameInput] = useState(meter.name ?? '');
  const [busy, setBusy]           = useState(false);

  useEffect(() => {
    if (!open) setNameInput(meter.name ?? '');
  }, [meter.name, open]);

  const save = async () => {
    if (!nameInput.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    const { error } = await supabase
      .from('product_meters' as any).update({ name: nameInput.trim() } as any).eq('id', meter.id);
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plantId, meter_id: meter.id, meter_name: nameInput.trim(),
      old_value: meter.name, new_value: nameInput.trim(),
      user_id: userId, timestamp: new Date().toISOString(),
    });
    toast.success('Meter renamed');
    onChanged();
    setOpen(false);
  };

  return (
    <>
      <Button
        size="sm" variant="ghost"
        className="h-7 w-7 p-0 rounded-full"
        title="Rename"
        onClick={() => setOpen(true)}
        data-testid={`rename-product-meter-${meter.id}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Product Meter</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="productmeters-meter-name" className="text-xs">Meter Name</Label>
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Main Line, Secondary Line…"
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              autoFocus
            id="productmeters-meter-name"/>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || !nameInput.trim()}>
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const ProductMeterNameInline = Object.assign(ProductMeterNameInlineBase, {
  EditTrigger: PMEditTriggerBase,
});
