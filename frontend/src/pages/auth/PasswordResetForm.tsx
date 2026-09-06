import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { ChevronLeft, KeyRound, MailCheck, Eye, EyeOff } from 'lucide-react';

const emailSchema = z.string().trim().email('Enter a valid email').max(255);
const passSchema  = z.string().min(8, 'Min 8 characters').max(72);

type ForgotStep = 'email' | 'code' | 'newpass';

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const LENGTH = 8;
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(LENGTH, ' ').split('').slice(0, LENGTH);

  const commit = (idx: number, char: string) => {
    const next = [...digits];
    next[idx] = char || ' ';
    onChange(next.join('').trimEnd());
    if (char && idx < LENGTH - 1) boxRefs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[idx].trim()) { commit(idx, ''); }
      else if (idx > 0) { boxRefs.current[idx - 1]?.focus(); commit(idx - 1, ''); }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      boxRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < LENGTH - 1) {
      boxRefs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    onChange(pasted);
    boxRefs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  };

  return (
    <div role="group" aria-label="8-digit verification code" className="flex gap-2 justify-center my-1">
      {Array.from({ length: LENGTH }).map((_, idx) => (
        <input
          key={idx}
          ref={(el) => { boxRefs.current[idx] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete={idx === 0 ? 'one-time-code' : undefined}
          aria-label={`Digit ${idx + 1} of ${LENGTH}`}
          value={digits[idx].trim()}
          onChange={(e) => commit(idx, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={[
            'w-11 h-13 text-center text-xl font-mono font-bold rounded-lg border-2 bg-background',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent',
            'transition-all caret-transparent',
            digits[idx].trim() ? 'border-accent/60' : 'border-border',
          ].join(' ')}
          style={{ height: '3.25rem' }}
        />
      ))}
    </div>
  );
}

export function SetNewPasswordForm({
  onSubmit,
  busy,
  submitLabel = 'Update password',
}: {
  onSubmit: (password: string) => Promise<void>;
  busy: boolean;
  submitLabel?: string;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const vp = passSchema.safeParse(password);
    if (!vp.success) { toast.error(vp.error.issues[0].message); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    await onSubmit(password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="set-new-password">New password</Label>
        <div className="relative">
          <Input
            id="set-new-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            autoComplete="new-password"
            autoFocus
            required
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
        <Label htmlFor="set-confirm-password">Confirm new password</Label>
        <div className="relative">
          <Input
            id="set-confirm-password"
            type={showConfirm ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat new password"
            autoComplete="new-password"
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded p-0.5"
            aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
          >
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Updating…' : submitLabel}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [step, setStep]       = useState<ForgotStep>('email');
  const [email, setEmail]     = useState('');
  const [code, setCode]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const handleSendCode = async (isResend = false) => {
    const ve = emailSchema.safeParse(email);
    if (!ve.success) { toast.error(ve.error.issues[0].message); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    setCooldown(60);
    if (isResend) toast.success('New code sent — check your email.');
    setStep('code');
  };

  const handleVerifyCode = async () => {
    if (code.replace(/\s/g, '').length < 8) { toast.error('Enter the full 8-digit code'); return; }
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'recovery',
    });
    setBusy(false);
    if (error) { toast.error('Invalid or expired code — try again'); return; }
    setStep('newpass');
  };

  const handleUpdatePassword = async (newPassword: string) => {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Password updated! Please sign in.');
    await supabase.auth.signOut();
    onBack();
  };

  const steps: ForgotStep[] = ['email', 'code', 'newpass'];
  const stepIdx = steps.indexOf(step);

  const StepDots = () => (
    <div className="flex justify-center gap-1.5 mb-3">
      {steps.map((s, i) => (
        <span key={s} className={[
          'h-1.5 rounded-full transition-all duration-300',
          i === stepIdx ? 'w-5 bg-accent' : i < stepIdx ? 'w-1.5 bg-accent/40' : 'w-1.5 bg-border',
        ].join(' ')} />
      ))}
    </div>
  );

  if (step === 'email') return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-muted mx-auto mb-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="font-semibold text-sm">Forgot your password?</p>
        <p className="text-xs text-muted-foreground mt-0.5">We'll send an 8-digit code to your email.</p>
      </div>
      <StepDots />
      <div>
        <Label htmlFor="forgot-email">Email address</Label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          onKeyDown={(e) => e.key === 'Enter' && handleSendCode(false)}
          autoFocus
        />
      </div>
      <Button onClick={() => handleSendCode(false)} disabled={busy} className="w-full">
        {busy ? 'Sending…' : 'Send code'}
      </Button>
      <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back to sign in
      </Button>
    </div>
  );

  if (step === 'code') return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-accent/10 mx-auto mb-2">
          <MailCheck className="h-5 w-5 text-accent" />
        </div>
        <p className="font-semibold text-sm">Enter the code</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          An 8-digit code was sent to <strong>{email}</strong>
        </p>
      </div>
      <StepDots />
      <OtpInput value={code} onChange={setCode} />
      <Button
        onClick={handleVerifyCode}
        disabled={busy || code.replace(/\s/g, '').length < 8}
        className="w-full"
      >
        {busy ? 'Verifying…' : 'Verify code'}
      </Button>
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
        <button type="button" onClick={() => setStep('email')} className="hover:text-foreground underline underline-offset-2">
          Change email
        </button>
        <button
          type="button"
          onClick={() => handleSendCode(true)}
          disabled={busy || cooldown > 0}
          className="hover:text-foreground underline underline-offset-2 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
        >
          {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
        </button>
      </div>
      <p className="text-2xs text-muted-foreground text-center pt-2 leading-normal">
        Didn't receive an 8-digit code? If your email contains a direct reset link instead, click it directly in your inbox to reset your password.
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-accent/10 mx-auto mb-2">
          <KeyRound className="h-5 w-5 text-accent" />
        </div>
        <p className="font-semibold text-sm">Set a new password</p>
        <p className="text-xs text-muted-foreground mt-0.5">Choose a strong password for your account.</p>
      </div>
      <StepDots />
      <SetNewPasswordForm onSubmit={handleUpdatePassword} busy={busy} submitLabel="Update password" />
    </div>
  );
}

export function ResetPasswordForm() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleUpdate = async (newPassword: string) => {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Password updated! Please sign in with your new password.');
    await supabase.auth.signOut();
    navigate('/auth', { replace: true });
  };

  return (
    <div className="space-y-3">
      <div className="text-center mb-1">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-accent/10 mx-auto mb-2">
          <KeyRound className="h-5 w-5 text-accent" />
        </div>
        <p className="font-semibold text-sm">Set a new password</p>
        <p className="text-xs text-muted-foreground mt-0.5">Choose a strong password for your account.</p>
      </div>
      <SetNewPasswordForm onSubmit={handleUpdate} busy={busy} submitLabel="Set new password" />
    </div>
  );
}
