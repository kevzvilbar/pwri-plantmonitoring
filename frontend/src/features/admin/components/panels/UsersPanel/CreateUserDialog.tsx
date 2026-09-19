import { useState } from 'react';
import { usePlants } from '@/hooks/usePlants';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DesignationCombobox, OPERATOR_DESIGNATION,
} from '@/components/DesignationCombobox';
import { friendlyError } from '@/lib/supabaseErrors';
import { cn } from '@/lib/utils';

function CreateUserDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: plants } = usePlants();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: '', password: '', first_name: '', last_name: '',
    middle_name: '', suffix: '', username: '', designation: '',
  });
  const [plantId, setPlantId] = useState('');
  const [plantIds, setPlantIds] = useState<string[]>([]);

  const isOperator = form.designation === OPERATOR_DESIGNATION;
  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const reset = () => {
    setForm({ email: '', password: '', first_name: '', last_name: '', middle_name: '', suffix: '', username: '', designation: '' });
    setPlantId('');
    setPlantIds([]);
    setBusy(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!form.email || !form.password || !form.first_name || !form.last_name || !form.username) {
      toast.error('Email, password, username, first name and last name are required.');
      return;
    }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters.'); return; }
    if (isOperator && !plantId) { toast.error('Select a plant for this Operator.'); return; }
    if (!isOperator && plantIds.length === 0) { toast.error('Assign at least one plant.'); return; }

    setBusy(true);
    const assignedPlants = isOperator ? [plantId] : plantIds;
    try {
      const { data: adminSession } = await supabase.auth.getSession();
      const { error: upErr } = await supabase.auth.signUp({ email: form.email, password: form.password });
      if (upErr) throw new Error(upErr.message);
      const { error: inErr } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
      if (inErr) throw new Error(inErr.message);
      const { error: rpErr } = await (supabase.rpc as any)('complete_onboarding', {
        _username: form.username,
        _first_name: form.first_name,
        _middle_name: form.middle_name || null,
        _last_name: form.last_name,
        _suffix: form.suffix || null,
        _designation: form.designation || null,
        _plant_assignments: assignedPlants,
      });
      if (rpErr) throw new Error(rpErr.message);
      await supabase.auth.signOut();
      if (adminSession.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: adminSession.session.access_token,
          refresh_token: adminSession.session.refresh_token,
        });
      }
      toast.success(`${form.first_name} ${form.last_name} created — click Approve to activate.`);
      setBusy(false);
      onCreated();
      handleClose();
    } catch (err) {
      toast.error(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create new user</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Login credentials</p>
            <div><Label htmlFor="userspanel-email">Email *</Label><Input type="email" value={form.email} onChange={field('email')} placeholder="user@example.com" id="userspanel-email" /></div>
            <div><Label htmlFor="userspanel-password">Password *</Label><Input type="password" value={form.password} onChange={field('password')} placeholder="Min. 6 characters" id="userspanel-password" /></div>
          </div>
          <div className="space-y-2 pt-1 border-t">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Profile</p>
            <div><Label htmlFor="userspanel-username">Username *</Label><Input value={form.username} onChange={field('username')} placeholder="e.g. jdelacruz" id="userspanel-username" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="userspanel-first-name">First name *</Label><Input value={form.first_name} onChange={field('first_name')} id="userspanel-first-name" /></div>
              <div><Label htmlFor="userspanel-last-name">Last name *</Label><Input value={form.last_name} onChange={field('last_name')} id="userspanel-last-name" /></div>
              <div><Label htmlFor="userspanel-middle-name">Middle name</Label><Input value={form.middle_name} onChange={field('middle_name')} id="userspanel-middle-name" /></div>
              <div><Label htmlFor="userspanel-suffix">Suffix</Label><Input value={form.suffix} onChange={field('suffix')} placeholder="Jr., Sr., III…" id="userspanel-suffix" /></div>
            </div>
            <div>
              <Label htmlFor="userspanel-designation">Designation</Label>
              <DesignationCombobox
                id="userspanel-designation"
                value={form.designation}
                onChange={(v) => { setForm((f) => ({ ...f, designation: v })); setPlantId(''); setPlantIds([]); }}
                placeholder="Select or type a designation…"
              />
            </div>
          </div>
          {form.designation && (
            <div className="space-y-2 pt-1 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Plant assignment {isOperator ? '(single plant)' : '(multi-plant)'}
              </p>
              {isOperator ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(plants ?? []).map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors',
                        plantId === p.id ? 'border-accent bg-accent/5' : 'hover:bg-muted/40',
                      )}
                    >
                      <input
                        type="radio"
                        name="create-plant"
                        value={p.id}
                        checked={plantId === p.id}
                        onChange={() => setPlantId(p.id)}
                        className="accent-accent"
                      />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                  {!(plants ?? []).length && <p className="text-xs text-muted-foreground">No plants available.</p>}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(plants ?? []).map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors',
                        plantIds.includes(p.id) ? 'border-accent bg-accent/5' : 'hover:bg-muted/40',
                      )}
                    >
                      <Checkbox
                        checked={plantIds.includes(p.id)}
                        onCheckedChange={() =>
                          setPlantIds((prev) =>
                            prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                          )
                        }
                      />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                  {!(plants ?? []).length && <p className="text-xs text-muted-foreground">No plants available.</p>}
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Created with <strong>Operator</strong> role, placed in the approval queue.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={busy}>{busy ? 'Creating…' : 'Create user'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { CreateUserDialog };
