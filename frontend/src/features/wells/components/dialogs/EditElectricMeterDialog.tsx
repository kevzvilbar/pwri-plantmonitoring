import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';

export function EditElectricMeterDialog({ well, onClose }: { well: any; onClose: () => void }) {
  const [form, setForm] = useState({
    has_power_meter: !!well.has_power_meter,
    electric_meter_brand: well.electric_meter_brand ?? '',
    electric_meter_size: well.electric_meter_size ?? '',
    electric_meter_serial: well.electric_meter_serial ?? '',
    electric_meter_installed_date: well.electric_meter_installed_date ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const payload: any = {
      has_power_meter: form.has_power_meter,
      electric_meter_brand: form.electric_meter_brand || null,
      electric_meter_size: form.electric_meter_size || null,
      electric_meter_serial: form.electric_meter_serial || null,
      electric_meter_installed_date: form.electric_meter_installed_date || null,
    };
    const { error } = await supabase.from('wells').update(payload).eq('id', well.id);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Electric meter updated');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Electric Meter — {well.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Switch (Radix) renders button[role=switch], not a native input; same false positive as ThemeSelector's Switch. */}
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.has_power_meter}
              onCheckedChange={(v) => setForm({ ...form, has_power_meter: v })}
              data-testid="edit-em-has-power"
              className="h-8 w-14 sm:h-6 sm:w-11 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-5 sm:[&>span]:w-5 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-5"
            />
            Has dedicated electric meter
          </label>
          {form.has_power_meter && (
            <div className="grid grid-cols-3 gap-2">
              <div><Label htmlFor="welldialogs-brand-3" className="text-xs">Brand</Label><Input value={form.electric_meter_brand} onChange={e => setForm({ ...form, electric_meter_brand: e.target.value })} id="welldialogs-brand-3"/></div>
              <div><Label htmlFor="welldialogs-size-3" className="text-xs">Size</Label><Input value={form.electric_meter_size} onChange={e => setForm({ ...form, electric_meter_size: e.target.value })} id="welldialogs-size-3" placeholder="kWh"/></div>
              <div><Label htmlFor="welldialogs-serial-3" className="text-xs">Serial</Label><Input value={form.electric_meter_serial} onChange={e => setForm({ ...form, electric_meter_serial: e.target.value })} id="welldialogs-serial-3"/></div>
              <div className="col-span-3">
                <Label htmlFor="welldialogs-installed-2" className="text-xs">Installed</Label>
                <Input type="date" value={form.electric_meter_installed_date} onChange={e => setForm({ ...form, electric_meter_installed_date: e.target.value })} id="welldialogs-installed-2"/>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving} data-testid="save-electric-meter">
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
