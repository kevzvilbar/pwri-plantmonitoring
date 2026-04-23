"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export default function Onboarding() {
  const { user, profile, refreshProfile, loading } = useAuth();
  const router = useRouter();
  const navigate = (to: string) => router.push(to);
  const { data: plants } = usePlants();
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    username: '', first_name: '', middle_name: '', last_name: '', suffix: '',
    designation: '', designation_other: '', plant_assignments: [] as string[],
  });

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/auth');
    else if (profile?.profile_complete) router.replace('/');
  }, [loading, user, profile, router]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (!user) return null;
  if (profile?.profile_complete) return null;

  const togglePlant = (id: string) => {
    setForm((f) => ({
      ...f,
      plant_assignments: f.plant_assignments.includes(id)
        ? f.plant_assignments.filter((x) => x !== id)
        : [...f.plant_assignments, id],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.first_name || !form.last_name) { toast.error('Fill required fields'); return; }
    if (!form.designation) { toast.error('Select your role'); return; }
    if (form.designation === 'Other' && !form.designation_other.trim()) {
      toast.error('Please specify your role'); return;
    }
    if (!plants || plants.length === 0) {
      toast.error('No plants exist yet — ask your admin to create at least one plant first.');
      return;
    }
    if (form.plant_assignments.length === 0) { toast.error('Assign at least one plant'); return; }
    setBusy(true);
    const finalDesignation =
      form.designation === 'Other' ? form.designation_other.trim() : form.designation;
    const { designation_other, ...rest } = form;
    const { error } = await supabase.from('user_profiles').update({
      ...rest, designation: finalDesignation,
      profile_complete: true, status: 'Active',
    }).eq('id', user.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await refreshProfile();
    toast.success('Profile saved');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background p-4 flex justify-center">
      <form onSubmit={submit} className="w-full max-w-lg bg-card rounded-2xl shadow-card p-5 space-y-4 my-6">
        <div>
          <h1 className="text-xl font-semibold">Complete your profile</h1>
          <p className="text-sm text-muted-foreground">Required before accessing the app.</p>
        </div>

        <div>
          <Label className="mb-2 block">Plant Assignments *</Label>
          {plants && plants.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {plants.map((p) => (
                <label key={p.id} className="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-secondary"
                  data-testid={`label-plant-${p.id}`}>
                  <Checkbox checked={form.plant_assignments.includes(p.id)} onCheckedChange={() => togglePlant(p.id)} />
                  <span className="text-sm">{p.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No plants exist yet. An Admin must create at least one plant before
              you can complete onboarding.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Username *</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required data-testid="input-username" /></div>
          <div><Label>First Name *</Label><Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required data-testid="input-firstname" /></div>
          <div><Label>Last Name *</Label><Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required data-testid="input-lastname" /></div>
          <div><Label>Middle Name</Label><Input value={form.middle_name} onChange={(e) => setForm({ ...form, middle_name: e.target.value })} /></div>
          <div><Label>Suffix</Label><Input value={form.suffix} onChange={(e) => setForm({ ...form, suffix: e.target.value })} placeholder="Jr., Sr., III" /></div>

          <div className="col-span-2">
            <Label>Role / Position *</Label>
            <Select value={form.designation} onValueChange={(v) => setForm({ ...form, designation: v })}>
              <SelectTrigger data-testid="select-designation"><SelectValue placeholder="Select your role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Manager">Manager</SelectItem>
                <SelectItem value="Supervisor">Supervisor</SelectItem>
                <SelectItem value="Operator">Operator</SelectItem>
                <SelectItem value="Technician">Technician</SelectItem>
                <SelectItem value="Engineer">Engineer</SelectItem>
                <SelectItem value="Staff">Staff</SelectItem>
                <SelectItem value="Other">Other (Specify Below)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.designation === 'Other' && (
            <div className="col-span-2">
              <Label>Specify Role *</Label>
              <Input value={form.designation_other}
                onChange={(e) => setForm({ ...form, designation_other: e.target.value })}
                placeholder="e.g. Lab Analyst" data-testid="input-designation-other" />
            </div>
          )}
        </div>

        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save & continue'}</Button>
        <p className="text-xs text-muted-foreground text-center">Your role defaults to <strong>Operator</strong>. An Admin can change roles later.</p>
      </form>
    </div>
  );
}
