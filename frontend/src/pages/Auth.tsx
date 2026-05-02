import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Droplets, ChevronLeft, ChevronRight, Users, User } from 'lucide-react';
import {
  DesignationCombobox,
  OPERATOR_DESIGNATION,
} from '@/components/DesignationCombobox';

// ─── Validators ───────────────────────────────────────────────────────────────
const emailSchema = z.string().trim().email('Enter a valid email').max(255);
const passSchema  = z.string().min(8, 'Min 8 characters').max(72);
const userSchema  = z.string().trim().min(2, 'Min 2 characters').max(64)
  .regex(/^[a-z0-9_.-]+$/i, 'Username: letters, numbers, _ . - only');

// ─── Types ────────────────────────────────────────────────────────────────────
interface OperatorEntry {
  username: string; first_name: string; last_name: string; middle_name: string; suffix: string;
}
const blankOperator = (): OperatorEntry => ({
  username: '', first_name: '', last_name: '', middle_name: '', suffix: '',
});
type SignUpStep = 'designation' | 'count' | 'entries' | 'details' | 'plants' | 'confirm';

// ─── Audit helpers ────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL ?? '';

function getDeviceId(): string {
  const key = 'pwri-device-id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
async function logLoginAttempt(p: {
  emailAttempted: string; username?: string; success: boolean;
  userId?: string | null; plantId?: string | null; errorReason?: string | null;
}) {
  try {
    await supabase.from('login_attempts' as any).insert({
      email: p.emailAttempted, user_id: p.userId ?? null,
      username: p.username ?? null, plant_id: p.plantId ?? null,
      success: p.success, error_reason: p.errorReason ?? null,
      device_id: getDeviceId(), user_agent: navigator.userAgent.slice(0, 500),
    } as any);
  } catch (e) { console.warn('[Auth] login attempt audit failed:', e); }
}
async function logSignUpAudit(p: {
  email: string; designation: string; operatorCount: number; plantIds: string[];
}) {
  try {
    await supabase.from('signup_audit' as any).insert({
      email: p.email, designation: p.designation,
      operator_count: p.operatorCount, plant_ids: p.plantIds,
      device_id: getDeviceId(), user_agent: navigator.userAgent.slice(0, 500),
    } as any);
  } catch (e) { console.warn('[Auth] sign-up audit failed:', e); }
}

// ─── Sign-In ──────────────────────────────────────────────────────────────────
function SignInForm() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pickList, setPickList] = useState<{ id: string; username: string; first_name: string | null; last_name: string | null }[]>([]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const ve = emailSchema.safeParse(email);
    const vp = passSchema.safeParse(password);
    if (!ve.success || !vp.success) {
      const msg = ve.error?.issues[0]?.message ?? vp.error?.issues[0]?.message ?? 'Invalid input';
      toast.error(msg);
      void logLoginAttempt({ emailAttempted: email.trim(), success: false, errorReason: `validation: ${msg}` });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      void logLoginAttempt({ emailAttempted: email.trim(), success: false, errorReason: error.message });
      return;
    }
    void logLoginAttempt({ emailAttempted: email.trim(), success: true, userId: data.user?.id ?? null });
    const { data: profile } = await supabase
      .from('user_profiles').select('id, username, first_name, last_name, designation')
      .eq('id', data.user!.id).maybeSingle();
    if (profile?.designation === OPERATOR_DESIGNATION) {
      setPickList([{ id: profile.id, username: profile.username ?? data.user!.id, first_name: profile.first_name, last_name: profile.last_name }]);
      return;
    }
    navigate('/');
  };

  if (pickList.length > 0) {
    return (
      <div className="space-y-3">
        <div className="text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="font-medium text-sm">Choose your username</p>
          <p className="text-xs text-muted-foreground">Select the profile you're signing in as</p>
        </div>
        <div className="space-y-1.5">
          {pickList.map((u) => (
            <button key={u.id} onClick={() => {
              toast.success(`Welcome, ${u.first_name ?? u.username}!`);
              void logLoginAttempt({ emailAttempted: email.trim(), success: true, username: u.username });
              navigate('/');
            }} className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/60 transition-colors text-left">
              <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-semibold text-xs shrink-0">
                {((u.first_name?.[0] ?? '') + (u.last_name?.[0] ?? '')).toUpperCase() || '?'}
              </div>
              <div>
                <div className="text-sm font-medium">{u.first_name} {u.last_name}</div>
                <div className="text-xs text-muted-foreground">@{u.username}</div>
              </div>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setPickList([])}>
          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSignIn} className="space-y-3">
      <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}

// ─── Sign-Up (multi-step) ─────────────────────────────────────────────────────
function SignUpForm() {
  const { data: plants } = usePlants();
  const [step, setStep] = useState<SignUpStep>('designation');
  const [busy, setBusy] = useState(false);
  // Credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [designation, setDesignation] = useState('');
  // Operator branch
  const [operatorCount, setOperatorCount] = useState(1);
  const [operators, setOperators] = useState<OperatorEntry[]>([blankOperator()]);
  const [plantId, setPlantId] = useState('');
  // Non-operator branch
  const [single, setSingle] = useState({ username: '', first_name: '', last_name: '', middle_name: '', suffix: '' });
  const [plantIds, setPlantIds] = useState<string[]>([]);

  const isOperator = designation === OPERATOR_DESIGNATION;
  const allSteps: SignUpStep[] = isOperator
    ? ['designation', 'count', 'entries', 'plants', 'confirm']
    : ['designation', 'details', 'plants', 'confirm'];
  const stepIdx = allSteps.indexOf(step);
  const stepLabel: Record<SignUpStep, string> = {
    designation: 'Designation', count: '# Operators', entries: 'Operator Details',
    details: 'User Details', plants: 'Plant Assignment', confirm: 'Confirm',
  };

  const updateOp = (i: number, k: keyof OperatorEntry, v: string) =>
    setOperators((p) => p.map((o, idx) => idx === i ? { ...o, [k]: v } : o));

  const goNext = () => {
    if (step === 'designation') {
      if (!designation) { toast.error('Select a designation'); return; }
      const ve = emailSchema.safeParse(email); if (!ve.success) { toast.error(ve.error.issues[0].message); return; }
      const vp = passSchema.safeParse(password); if (!vp.success) { toast.error(vp.error.issues[0].message); return; }
      setStep(isOperator ? 'count' : 'details'); return;
    }
    if (step === 'count') {
      if (operatorCount < 1) { toast.error('At least 1 operator required'); return; }
      setOperators(Array.from({ length: operatorCount }, (_, i) => operators[i] ?? blankOperator()));
      setStep('entries'); return;
    }
    if (step === 'entries') {
      for (let i = 0; i < operatorCount; i++) {
        const o = operators[i];
        const vu = userSchema.safeParse(o.username);
        if (!vu.success) { toast.error(`Op ${i + 1} username: ${vu.error.issues[0].message}`); return; }
        if (!o.first_name || !o.last_name) { toast.error(`Op ${i + 1}: first and last name required`); return; }
      }
      const unames = operators.slice(0, operatorCount).map((o) => o.username.toLowerCase());
      if (new Set(unames).size !== unames.length) { toast.error('Each operator must have a unique username'); return; }
      setStep('plants'); return;
    }
    if (step === 'details') {
      const vu = userSchema.safeParse(single.username);
      if (!vu.success) { toast.error(vu.error.issues[0].message); return; }
      if (!single.first_name || !single.last_name) { toast.error('First and last name required'); return; }
      setStep('plants'); return;
    }
    if (step === 'plants') {
      if (isOperator && !plantId) { toast.error('Select a plant'); return; }
      if (!isOperator && plantIds.length === 0) { toast.error('Assign at least one plant'); return; }
      setStep('confirm'); return;
    }
  };

  const goBack = () => {
    const prev: Record<SignUpStep, SignUpStep> = {
      count: 'designation', entries: 'count', details: 'designation',
      plants: isOperator ? 'entries' : 'details', confirm: 'plants',
      designation: 'designation',
    };
    setStep(prev[step]);
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd.session?.access_token;
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

      if (isOperator) {
        for (let i = 0; i < operatorCount; i++) {
          const op = operators[i];
          const res = await fetch(`${API_BASE}/admin/users/create`, {
            method: 'POST', headers,
            body: JSON.stringify({
              email: i === 0 ? email : email.replace('@', `+op${i}@`),
              password, username: op.username, first_name: op.first_name, last_name: op.last_name,
              middle_name: op.middle_name || null, suffix: op.suffix || null,
              designation: OPERATOR_DESIGNATION, plant_assignments: [plantId], shared_email: email,
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({ detail: res.statusText }));
            toast.error(`Op ${i + 1}: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}`);
            setBusy(false); return;
          }
        }
        void logSignUpAudit({ email, designation, operatorCount, plantIds: [plantId] });
        toast.success(`${operatorCount} operator account${operatorCount > 1 ? 's' : ''} created — pending approval.`);
      } else {
        const res = await fetch(`${API_BASE}/admin/users/create`, {
          method: 'POST', headers,
          body: JSON.stringify({
            email, password, username: single.username, first_name: single.first_name,
            last_name: single.last_name, middle_name: single.middle_name || null,
            suffix: single.suffix || null, designation, plant_assignments: plantIds,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: res.statusText }));
          toast.error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail));
          setBusy(false); return;
        }
        void logSignUpAudit({ email, designation, operatorCount: 1, plantIds });
        toast.success('Account created — pending admin approval.');
      }
      setBusy(false);
      setStep('designation'); setEmail(''); setPassword(''); setDesignation('');
      setOperatorCount(1); setOperators([blankOperator()]); setPlantId('');
      setSingle({ username: '', first_name: '', last_name: '', middle_name: '', suffix: '' });
      setPlantIds([]);
    } catch (err: any) {
      toast.error(err?.message ?? 'Unexpected error.');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 flex-wrap">
        {allSteps.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              s === step ? 'bg-accent text-accent-foreground'
              : i < stepIdx ? 'bg-muted text-muted-foreground line-through'
              : 'text-muted-foreground'
            }`}>{stepLabel[s]}</span>
            {i < allSteps.length - 1 && <span className="text-muted-foreground text-[10px]">›</span>}
          </span>
        ))}
      </div>

      {/* Step: Designation */}
      {step === 'designation' && (
        <div className="space-y-3">
          <div><Label>Email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" /></div>
          <div><Label>Password *</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" minLength={8} /></div>
          <div>
            <Label>Designation *</Label>
            <DesignationCombobox value={designation} onChange={setDesignation} placeholder="Select designation…" data-testid="signup-designation" />
          </div>
          {designation && (
            <div className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
              isOperator ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'
            }`}>
              {isOperator ? <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <User className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              {isOperator
                ? "Operator accounts share one email. You'll enter each operator's username individually. Only one plant is allowed."
                : 'This designation uses a unique email and can be assigned to multiple plants.'}
            </div>
          )}
        </div>
      )}

      {/* Step: Count (Operator) */}
      {step === 'count' && (
        <div className="space-y-3">
          <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            All operators share email <strong>{email}</strong> and pick their username at sign-in.
          </div>
          <div>
            <Label>How many Operators will use this email? *</Label>
            <Input type="number" min={1} max={20} value={operatorCount}
              onChange={(e) => setOperatorCount(Math.max(1, Math.min(20, +e.target.value)))} />
            <p className="text-[11px] text-muted-foreground mt-1">Maximum 20 per shared email</p>
          </div>
        </div>
      )}

      {/* Step: Operator entries */}
      {step === 'entries' && (
        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {Array.from({ length: operatorCount }, (_, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Operator {i + 1}</span>
                <Badge variant="outline" className="text-[10px]">Shared: {email}</Badge>
              </div>
              <div><Label className="text-xs">Username *</Label>
                <Input value={operators[i]?.username ?? ''} onChange={(e) => updateOp(i, 'username', e.target.value)} placeholder="e.g. jdelacruz" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">First name *</Label><Input value={operators[i]?.first_name ?? ''} onChange={(e) => updateOp(i, 'first_name', e.target.value)} /></div>
                <div><Label className="text-xs">Last name *</Label><Input value={operators[i]?.last_name ?? ''} onChange={(e) => updateOp(i, 'last_name', e.target.value)} /></div>
                <div><Label className="text-xs">Middle name</Label><Input value={operators[i]?.middle_name ?? ''} onChange={(e) => updateOp(i, 'middle_name', e.target.value)} /></div>
                <div><Label className="text-xs">Suffix</Label><Input value={operators[i]?.suffix ?? ''} onChange={(e) => updateOp(i, 'suffix', e.target.value)} placeholder="Jr., Sr.…" /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Step: Non-operator single details */}
      {step === 'details' && (
        <div className="space-y-2">
          <div><Label>Username *</Label><Input value={single.username} onChange={(e) => setSingle((s) => ({ ...s, username: e.target.value }))} placeholder="e.g. jdelacruz" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>First name *</Label><Input value={single.first_name} onChange={(e) => setSingle((s) => ({ ...s, first_name: e.target.value }))} /></div>
            <div><Label>Last name *</Label><Input value={single.last_name} onChange={(e) => setSingle((s) => ({ ...s, last_name: e.target.value }))} /></div>
            <div><Label>Middle name</Label><Input value={single.middle_name} onChange={(e) => setSingle((s) => ({ ...s, middle_name: e.target.value }))} /></div>
            <div><Label>Suffix</Label><Input value={single.suffix} onChange={(e) => setSingle((s) => ({ ...s, suffix: e.target.value }))} placeholder="Jr., Sr.…" /></div>
          </div>
        </div>
      )}

      {/* Step: Plants */}
      {step === 'plants' && (
        <div className="space-y-2">
          {isOperator ? (
            <>
              <p className="text-xs text-muted-foreground">Operators are limited to a <strong>single plant</strong>.</p>
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {(plants ?? []).map((p) => (
                  <label key={p.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${plantId === p.id ? 'border-accent bg-accent/5' : 'hover:bg-muted/60'}`}>
                    <input type="radio" name="op-plant" value={p.id} checked={plantId === p.id} onChange={() => setPlantId(p.id)} className="accent-accent" />
                    <div><div className="text-sm font-medium">{p.name}</div>{p.address && <div className="text-[11px] text-muted-foreground">{p.address}</div>}</div>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground"><strong>{designation}</strong> can be assigned to multiple plants.</p>
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {(plants ?? []).map((p) => (
                  <label key={p.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${plantIds.includes(p.id) ? 'border-accent bg-accent/5' : 'hover:bg-muted/60'}`}>
                    <Checkbox checked={plantIds.includes(p.id)} onCheckedChange={() => setPlantIds((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])} />
                    <div><div className="text-sm font-medium">{p.name}</div>{p.address && <div className="text-[11px] text-muted-foreground">{p.address}</div>}</div>
                  </label>
                ))}
              </div>
            </>
          )}
          {!(plants ?? []).length && <p className="text-xs text-muted-foreground text-center py-4">No plants available — an Admin will assign plants after approval.</p>}
        </div>
      )}

      {/* Step: Confirm */}
      {step === 'confirm' && (
        <div className="space-y-3">
          <div className="rounded-lg border divide-y text-sm">
            <div className="p-3 flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{email}</span></div>
            <div className="p-3 flex justify-between"><span className="text-muted-foreground">Designation</span><Badge variant="outline">{designation}</Badge></div>
            {isOperator ? (
              <>
                <div className="p-3 flex justify-between"><span className="text-muted-foreground">Operators</span><span className="font-medium">{operatorCount}</span></div>
                <div className="p-3"><span className="text-muted-foreground text-xs">Usernames</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {operators.slice(0, operatorCount).map((o, i) => (
                      <Badge key={i} variant="secondary" className="text-[11px]">@{o.username} — {o.first_name} {o.last_name}</Badge>
                    ))}
                  </div>
                </div>
                <div className="p-3 flex justify-between"><span className="text-muted-foreground">Plant</span><span className="font-medium">{(plants ?? []).find((p) => p.id === plantId)?.name ?? plantId}</span></div>
              </>
            ) : (
              <>
                <div className="p-3 flex justify-between"><span className="text-muted-foreground">Username</span><span className="font-medium">@{single.username}</span></div>
                <div className="p-3 flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{single.first_name} {single.last_name}</span></div>
                <div className="p-3"><span className="text-muted-foreground text-xs">Plants</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {plantIds.map((id) => <Badge key={id} variant="secondary" className="text-[11px]">{(plants ?? []).find((p) => p.id === id)?.name ?? id}</Badge>)}
                  </div>
                </div>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Account{isOperator && operatorCount > 1 ? 's' : ''} will be placed in the approval queue until an Admin activates {isOperator && operatorCount > 1 ? 'them' : 'it'}.
          </p>
          <Button onClick={handleSubmit} disabled={busy} className="w-full">
            {busy ? 'Creating…' : `Create ${isOperator && operatorCount > 1 ? `${operatorCount} accounts` : 'account'}`}
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={goBack}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
        </div>
      )}

      {/* Navigation (all steps except confirm) */}
      {step !== 'confirm' && (
        <div className="flex gap-2">
          {step !== 'designation' && (
            <Button variant="outline" onClick={goBack} className="flex-1">
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          <Button onClick={goNext} className="flex-1">
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Auth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (user)    return <Navigate to="/" replace />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-stat p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-accent shadow-elev mb-3">
            <Droplets className="h-7 w-7 text-accent-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-topbar-foreground tracking-tight">PWRI Monitoring</h1>
          <p className="text-sm text-topbar-muted">Multi-plant water operations</p>
        </div>
        <div className="bg-card rounded-2xl shadow-modal p-5">
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full mb-4">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin"><SignInForm /></TabsContent>
            <TabsContent value="signup"><SignUpForm /></TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
