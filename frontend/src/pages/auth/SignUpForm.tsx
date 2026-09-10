import { useState, useEffect } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DesignationCombobox,
  OPERATOR_DESIGNATION,
} from '@/components/DesignationCombobox';
import { StepIndicator } from './SignUpForm/StepIndicator';
import { SignUpNavigation } from './SignUpForm/SignUpNavigation';
import { DesignationStep } from './SignUpForm/DesignationStep';
import { OperatorCountStep } from './SignUpForm/OperatorCountStep';
import { OperatorEntriesView } from './SignUpForm/OperatorEntriesStep';
import { UserDetailsStep } from './SignUpForm/UserDetailsStep';
import { PlantAssignmentStep } from './SignUpForm/PlantAssignmentStep';
import { ConfirmationStep } from './SignUpForm/ConfirmationStep';
import {
  blankOperator, type OperatorEntry, type SignUpStep,
} from './SignUpForm/types';

const emailSchema = z.string().trim().email('Enter a valid email').max(255);
const passSchema  = z.string().min(8, 'Min 8 characters').max(72);
const userSchema  = z.string().trim().min(2, 'Min 2 characters').max(64)
  .regex(/^[a-z0-9_.-]+$/i, 'Username: letters, numbers, _ . - only');

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

  const setSingleField = (field: string, value: string) =>
    setSingle((s) => ({ ...s, [field]: value }));

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

        const { error: rpErr } = await (supabase.rpc as any)('complete_onboarding', {
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
            await createAccount(acctEmail, op, 'Operator', assignedPlants);
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

  const stepContent = () => {
    switch (step) {
      case 'designation':
        return (
          <DesignationStep
            email={email} password={password} confirmPassword={confirmPassword} designation={designation}
            showPassword={showPassword} showConfirmPassword={showConfirmPassword}
            onEmailChange={setEmail} onPasswordChange={setPassword}
            onConfirmPasswordChange={setConfirmPassword} onDesignationChange={setDesignation}
            onTogglePassword={() => setShowPassword(v => !v)}
            onToggleConfirmPassword={() => setShowConfirmPassword(v => !v)}
          />
        );
      case 'count':
        return <OperatorCountStep email={email} operatorCount={operatorCount} onCountChange={setOperatorCount} />;
      case 'entries':
        return (
          <OperatorEntriesView
            email={email} operatorCount={operatorCount}
            operators={operators} completedIndices={completedIndices}
            onOperatorChange={updateOp}
          />
        );
      case 'details':
        return <UserDetailsStep single={single} onFieldChange={setSingleField} />;
      case 'plants':
        return (
          <PlantAssignmentStep
            isOperator={isOperator} designation={designation} plants={plants}
            plantId={plantId} plantIds={plantIds}
            onPlantIdChange={setPlantId} onTogglePlantId={(id) => setPlantIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
          />
        );
      case 'confirm':
        return (
          <ConfirmationStep
            isOperator={isOperator} email={email} designation={designation}
            operatorCount={operatorCount} operators={operators}
            plantId={plantId} plantIds={plantIds}
            completedIndices={completedIndices} plants={plants}
            busy={busy} single={single}
            onSubmit={handleSubmit} onBack={goBack}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <StepIndicator steps={allSteps} currentStep={step} stepIndex={stepIdx} labels={stepLabel} />
      {stepContent()}
      {step !== 'confirm' && <SignUpNavigation step={step} onBack={goBack} onNext={goNext} />}
    </div>
  );
}
