import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppLoading } from '@/components/AppLoading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { resolveMfaGate, type MfaGateState } from '../lib/mfaGate';
import { TotpChallengeForm, TotpEnrollForm } from './MfaForms';

const SKIP_KEY = 'pwri-admin-mfa-skipped';
const readSkip = () => {
  try {
    return sessionStorage.getItem(SKIP_KEY) === '1' || localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
};
const writeSkip = () => {
  try {
    sessionStorage.setItem(SKIP_KEY, '1');
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    /* private mode */
  }
};

/**
 * Wraps the protected app. Non-admins pass straight through. Admins must hold an
 * aal2 (TOTP-verified) session. The database enforces this independently once
 * `security_settings.require_admin_mfa` is on (see migration 20261004000003); this
 * gate is the UX that gets them there.
 */
export function AdminMfaGate({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <Gate>{children}</Gate> : <>{children}</>;
}

function Gate({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const [state, setState] = useState<MfaGateState | 'loading'>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [{ data: aal }, { data: required, error: requiredError }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.rpc('admin_mfa_required'),
    ]);
    const next = resolveMfaGate({
      currentLevel: aal?.currentLevel,
      nextLevel: aal?.nextLevel,
      required: requiredError ? true : required === true, // fail closed if the policy lookup fails
      skipped: readSkip(),
    });
    if (next === 'challenge') {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      setFactorId(factors?.totp?.[0]?.id ?? null);
    }
    setState(next);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (state === 'loading') return <AppLoading className="min-h-screen text-muted-foreground" />;
  if (state === 'allow') return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-semibold">
            {state === 'challenge' ? 'Two-step verification' : 'Set up two-step verification'}
          </h1>
        </div>

        {state === 'challenge' && factorId && (
          <>
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code from your authenticator app to continue.
            </p>
            <TotpChallengeForm factorId={factorId} onVerified={refresh} />
          </>
        )}
        {state === 'challenge' && !factorId && (
          <p role="alert" className="text-sm text-destructive">Could not load your authenticator. Sign out and try again.</p>
        )}

        {(state === 'enroll' || state === 'enroll-optional') && (
          <>
            <p className="text-sm text-muted-foreground">
              Administrator accounts can delete data and manage users, so they require a second factor.
            </p>
            <TotpEnrollForm onEnrolled={refresh} />
            {state === 'enroll-optional' && (
              <Button variant="ghost" className="w-full" onClick={() => { writeSkip(); void refresh(); }}>
                Skip for now
              </Button>
            )}
          </>
        )}

        <Button variant="outline" className="w-full" onClick={() => void signOut()}>Sign out</Button>
      </Card>
    </div>
  );
}
