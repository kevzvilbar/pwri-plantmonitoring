import { useState, useEffect } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { ChevronLeft, ChevronRight, Users, User, Eye, EyeOff } from 'lucide-react';
import {
  DesignationCombobox,
  OPERATOR_DESIGNATION,
} from '@/components/DesignationCombobox';

const emailSchema = z.string().trim().email('Enter a valid email').max(255);
const passSchema  = z.string().min(8, 'Min 8 characters').max(72);
const userSchema  = z.string().trim().min(2, 'Min 2 characters').max(64)
  .regex(/^[a-z0-9_.-]+$/i, 'Username: letters, numbers, _ . - only');

export interface OperatorEntry {
  username: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  suffix: string;
}

export const blankOperator = (): OperatorEntry => ({
  username: '', first_name: '', last_name: '', middle_name: '', suffix: '',
});

export type SignUpStep = 'designation' | 'count' | 'entries' | 'details' | 'plants' | 'confirm';

async function logSignUpAudit(p: {
  email: string;
  designation: string;
  operatorCount: number;
  plantIds: string[];
}) {
  try {
    await supabase.from('signup_audit' as any).insert({
      email: p.email,
      designation: p.designation,
      operator_count: p.operatorCount,
      plant_ids: p.plantIds,
      device_id: (() => {
        const key = 'pwri-device-id';
        let id = localStorage.getItem(key);
        if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
        return id;
      })(),
      user_agent: navigator.userAgent.slice(0, 500),
    } as any);
  } catch (e) { console.warn('[Auth] sign-up audit failed:', e); }
}

export function SignUpForm({
  onSuccess,
}: {
  onSuccess?: (email: string, count: number) => void;
}) {
  const [plants, setPlants] = useState<{ id: string; name: string; address?: string }[]>([]);
  useEffect(() => {
    supabase
      .from('plants' as any)
      .select('id, name, address')
      .order('name')
      .then(({ data }) => { if (data) setPlants(data as any[]); });
  }, []);
  const [step, setStep] = useState<SignUpStep>('designation');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [designation, setDesignation] = useState('');
  const [operatorCount, setOperatorCount] = useState(1);
  const [operators, setOperators] = useState<OperatorEntry[]>([blankOperator()]);
  const [plantId, setPlantId] = useState('');
  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set());
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
      if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }
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
      if (plants.length > 0 && isOperator && !plantId) { toast.error('Select a plant'); return; }
      if (plants.length > 0 && !isOperator && plantIds.length === 0) { toast.error('Assign at least one plant'); return; }
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
      const assignedPlants = isOperator ? [plantId] : plantIds;

      const createAccount = async (
        acctEmail: string,
        op: { username: string; first_name: string; last_name: string; middle_name: string; suffix: string },
        acctDesignation: string,
        plants: string[],
      ) => {
        const { data: upData, error: upErr } = await supabase.auth.signUp({ email: acctEmail, password });
        if (upErr) throw new Error(upErr.message);

        if (!upData.session) {
          const { error: inErr } = await supabase.auth.signInWithPassword({ email: acctEmail, password });
          if (inErr) throw new Error(inErr.message);
        }

        const { error: rpErr } = await supabase.rpc('complete_onboarding', {
          _username: op.username,
          _first_name: op.first_name,
          _middle_name: op.middle_name || null,
          _last_name: op.last_name,
          _suffix: op.suffix || null,
          _designation: acctDesignation || null,
          _plant_assignments: plants,
        });
        if (rpErr) throw new Error(rpErr.message);

        await supabase.auth.signOut();
      };

      if (isOperator) {
        const newlyCreated = new Set(completedIndices);
        for (let i = 0; i < operatorCount; i++) {
          if (newlyCreated.has(i)) continue;
          const op = operators[i];
          if (!op.username || !op.first_name || !op.last_name) {
            toast.error(`Operator ${i + 1}: fill all required fields.`);
            setBusy(false); return;
          }
          const acctEmail = i === 0 ? email : email.replace('@', `+op${i}@`);
          try {
            await createAccount(acctEmail, op, OPERATOR_DESIGNATION, assignedPlants);
            newlyCreated.add(i);
            setCompletedIndices(new Set(newlyCreated));
          } catch (err: any) {
            setBusy(false);
            const succeededCount = newlyCreated.size;
            toast.error(
              `${succeededCount} of ${operatorCount} accounts created. Operator ${i + 1} (@${op.username}) failed: ${friendlyError(err)}. You can adjust details and retry remaining accounts.`,
              { duration: 8000 }
            );
            return;
          }
        }
        void logSignUpAudit({ email, designation, operatorCount, plantIds: assignedPlants });
        toast.success(`${operatorCount} operator account${operatorCount > 1 ? 's' : ''} created — pending approval.`);
      } else {
        await createAccount(email, single, designation, assignedPlants);
        void logSignUpAudit({ email, designation, operatorCount: 1, plantIds: assignedPlants });
        toast.success('Account created — pending admin approval.');
      }

      setBusy(false);
      const registeredEmail = email;
      const count = isOperator ? operatorCount : 1;
      setStep('designation'); setEmail(''); setPassword(''); setConfirmPassword(''); setDesignation('');
      setOperatorCount(1); setOperators([blankOperator()]); setPlantId('');
      setSingle({ username: '', first_name: '', last_name: '', middle_name: '', suffix: '' });
      setPlantIds([]);
      setCompletedIndices(new Set());
      onSuccess?.(registeredEmail, count);
    } catch (err) {
      toast.error(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 flex-wrap">
        {allSteps.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              s === step ? 'bg-accent text-accent-foreground'
              : i < stepIdx ? 'bg-muted text-muted-foreground line-through'
              : 'text-muted-foreground'
            }`}>{stepLabel[s]}</span>
            {i < allSteps.length - 1 && <span className="text-muted-foreground text-2xs">›</span>}
          </span>
        ))}
      </div>

      {step === 'designation' && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="signup-email">Email *</Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <Label htmlFor="signup-password">Password *</Label>
            <div className="relative">
              <Input
                id="signup-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                minLength={8}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded p-0.5"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="signup-confirm-password">Confirm password *</Label>
            <div className="relative">
              <Input
                id="signup-confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                minLength={8}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded p-0.5"
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="signup-designation">Designation *</Label>
            <DesignationCombobox id="signup-designation" value={designation} onChange={setDesignation} placeholder="Select designation…" data-testid="signup-designation" />
          </div>
          {designation && (
            <div className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
              isOperator ? 'bg-warn-soft border border-warn text-warn' : 'bg-info-soft border border-info text-info'
            }`}>
              {isOperator ? <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <User className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              {isOperator
                ? "Operator accounts share one email inbox. Each operator receives an individual login address routed to this email. Only one plant is allowed."
                : 'This designation uses a unique email and can be assigned to multiple plants.'}
            </div>
          )}
        </div>
      )}

      {step === 'count' && (
        <div className="space-y-3">
          <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground leading-relaxed">
            All operators receive password reset links and notifications at <strong>{email}</strong>.
            Each operator will have their own distinct login address and username.
          </div>
          <div>
            <Label htmlFor="operator-count">How many Operators will use this email? *</Label>
            <Input id="operator-count" type="number" min={1} max={20} value={operatorCount}
              onChange={(e) => setOperatorCount(Math.max(1, Math.min(20, +e.target.value)))} />
            <p className="text-xs text-muted-foreground mt-1">Maximum 20 per shared email</p>
          </div>
        </div>
      )}

      {step === 'entries' && (
        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          <div className="rounded-lg bg-info-soft border border-info/30 p-2.5 text-xs text-info flex items-start gap-2">
            <Users className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="leading-relaxed">
              <strong>Individual Login Addresses:</strong> Operator 1 signs in using <code>{email}</code>. Additional operators use plus-aliased addresses (e.g. <code>{email.replace('@', '+op1@')}</code>) so each operator can independently reset passwords, with all notifications arriving in the shared inbox.
            </div>
          </div>

          {Array.from({ length: operatorCount }, (_, i) => {
            const acctEmail = i === 0 ? email : email.replace('@', `+op${i}@`);
            const isCompleted = completedIndices.has(i);
            return (
              <div key={i} className={`border rounded-lg p-3 space-y-2 transition-all ${isCompleted ? 'bg-muted/40 border-success/40' : ''}`}>
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Operator {i + 1}</span>
                    {isCompleted && <Badge className="bg-success text-success-foreground text-2xs py-0">✓ Account Created</Badge>}
                  </div>
                  <Badge variant="outline" className="text-2xs font-mono">
                    Login: {acctEmail} {i === 0 ? '(Primary)' : `(Alias → ${email})`}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs" htmlFor={`op-${i}-username`}>Username *</Label>
                  <Input
                    id={`op-${i}-username`}
                    autoComplete="username"
                    disabled={isCompleted}
                    value={operators[i]?.username ?? ''}
                    onChange={(e) => updateOp(i, 'username', e.target.value)}
                    placeholder="e.g. jdelacruz"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs" htmlFor={`op-${i}-first`}>First name *</Label>
                    <Input
                      id={`op-${i}-first`}
                      autoComplete="given-name"
                      disabled={isCompleted}
                      value={operators[i]?.first_name ?? ''}
                      onChange={(e) => updateOp(i, 'first_name', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor={`op-${i}-last`}>Last name *</Label>
                    <Input
                      id={`op-${i}-last`}
                      autoComplete="family-name"
                      disabled={isCompleted}
                      value={operators[i]?.last_name ?? ''}
                      onChange={(e) => updateOp(i, 'last_name', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor={`op-${i}-middle`}>Middle name</Label>
                    <Input
                      id={`op-${i}-middle`}
                      autoComplete="additional-name"
                      disabled={isCompleted}
                      value={operators[i]?.middle_name ?? ''}
                      onChange={(e) => updateOp(i, 'middle_name', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor={`op-${i}-suffix`}>Suffix</Label>
                    <Input
                      id={`op-${i}-suffix`}
                      autoComplete="honorific-suffix"
                      disabled={isCompleted}
                      value={operators[i]?.suffix ?? ''}
                      onChange={(e) => updateOp(i, 'suffix', e.target.value)}
                      placeholder="Jr., Sr.…"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {step === 'details' && (
        <div className="space-y-2">
          <div><Label htmlFor="single-username">Username *</Label><Input id="single-username" autoComplete="username" value={single.username} onChange={(e) => setSingle((s) => ({ ...s, username: e.target.value }))} placeholder="e.g. jdelacruz" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="single-first">First name *</Label><Input id="single-first" autoComplete="given-name" value={single.first_name} onChange={(e) => setSingle((s) => ({ ...s, first_name: e.target.value }))} /></div>
            <div><Label htmlFor="single-last">Last name *</Label><Input id="single-last" autoComplete="family-name" value={single.last_name} onChange={(e) => setSingle((s) => ({ ...s, last_name: e.target.value }))} /></div>
            <div><Label htmlFor="single-middle">Middle name</Label><Input id="single-middle" autoComplete="additional-name" value={single.middle_name} onChange={(e) => setSingle((s) => ({ ...s, middle_name: e.target.value }))} /></div>
            <div><Label htmlFor="single-suffix">Suffix</Label><Input id="single-suffix" autoComplete="honorific-suffix" value={single.suffix} onChange={(e) => setSingle((s) => ({ ...s, suffix: e.target.value }))} placeholder="Jr., Sr.…" /></div>
          </div>
        </div>
      )}

      {step === 'plants' && (
        <div className="space-y-2">
          {isOperator ? (
            <>
              <p className="text-xs text-muted-foreground">Operators are limited to a <strong>single plant</strong>.</p>
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {(plants ?? []).map((p) => (
                  <label key={p.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${plantId === p.id ? 'border-accent bg-accent/5' : 'hover:bg-muted/60'}`}>
                    <input type="radio" name="op-plant" value={p.id} checked={plantId === p.id} onChange={() => setPlantId(p.id)} className="accent-accent" />
                    <div><div className="text-sm font-medium">{p.name}</div>{p.address && <div className="text-xs text-muted-foreground">{p.address}</div>}</div>
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
                    <div><div className="text-sm font-medium">{p.name}</div>{p.address && <div className="text-xs text-muted-foreground">{p.address}</div>}</div>
                  </label>
                ))}
              </div>
            </>
          )}
          {!(plants ?? []).length && <p className="text-xs text-muted-foreground text-center py-4">No plants available — an Admin will assign plants after approval.</p>}
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-3">
          <div className="rounded-lg border divide-y text-sm">
            <div className="p-3 flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{email}</span></div>
            <div className="p-3 flex justify-between"><span className="text-muted-foreground">Designation</span><Badge variant="outline">{designation}</Badge></div>
            {isOperator ? (
              <>
                <div className="p-3 flex justify-between"><span className="text-muted-foreground">Operators</span><span className="font-medium">{operatorCount}</span></div>
                <div className="p-3">
                  <span className="text-muted-foreground text-xs font-medium">Operator Accounts &amp; Login Addresses</span>
                  <div className="mt-1 space-y-1.5">
                    {operators.slice(0, operatorCount).map((o, i) => {
                      const acctEmail = i === 0 ? email : email.replace('@', `+op${i}@`);
                      const isCompleted = completedIndices.has(i);
                      return (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/40 border">
                          <div>
                            <span className="font-semibold text-foreground">@{o.username}</span>
                            <span className="text-muted-foreground ml-1.5">— {o.first_name} {o.last_name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
                            <span>{acctEmail}</span>
                            {isCompleted && <Badge className="bg-success text-success-foreground text-2xs py-0 px-1">Created</Badge>}
                          </div>
                        </div>
                      );
                    })}
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
                    {plantIds.map((id) => <Badge key={id} variant="secondary" className="text-xs">{(plants ?? []).find((p) => p.id === id)?.name ?? id}</Badge>)}
                  </div>
                </div>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Account{isOperator && operatorCount > 1 ? 's' : ''} will be placed in the approval queue until an Admin activates {isOperator && operatorCount > 1 ? 'them' : 'it'}.
          </p>
          <Button onClick={handleSubmit} disabled={busy} className="w-full">
            {busy
              ? 'Creating…'
              : isOperator && completedIndices.size > 0
              ? `Retry remaining ${operatorCount - completedIndices.size} account${operatorCount - completedIndices.size > 1 ? 's' : ''}`
              : `Create ${isOperator && operatorCount > 1 ? `${operatorCount} accounts` : 'account'}`}
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={goBack}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
        </div>
      )}

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
