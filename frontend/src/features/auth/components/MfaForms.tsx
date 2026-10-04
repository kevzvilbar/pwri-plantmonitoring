import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CODE_RE = /^\d{6}$/;

/** Challenge + verify a TOTP code for an already-enrolled factor. Yields an aal2 session. */
export function TotpChallengeForm({
  factorId,
  onVerified,
  submitLabel = 'Verify',
  onFactorNotFound,
}: {
  factorId: string;
  onVerified: () => void;
  submitLabel?: string;
  onFactorNotFound?: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code)) return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    setError(null);

    // Use atomic challengeAndVerify to create challenge and verify the factor in one step
    const verify = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);

    if (verify.error) {
      setCode('');
      const msg = verify.error.message || '';
      if (msg.toLowerCase().includes('factor not found') && onFactorNotFound) {
        setError('This enrollment factor has expired. Please scan the newly generated QR code.');
        onFactorNotFound();
        return;
      }
      return setError(msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('incorrect')
        ? 'That code was not accepted. Check your device clock and try again.'
        : msg || 'Verification failed. Please try again.');
    }

    onVerified();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        aria-label="6-digit authentication code"
        autoFocus
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Verifying…' : submitLabel}</Button>
    </form>
  );
}

/** Enroll a new TOTP factor: shows the QR code, then verifies the first code. */
export function TotpEnrollForm({ onEnrolled }: { onEnrolled: () => void }) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      setFactor(null);

      try {
        // Drop abandoned, never-verified factors so a retry does not hit conflicts
        const existing = await supabase.auth.mfa.listFactors();
        for (const f of existing.data?.all ?? []) {
          if (f.factor_type === 'totp' && f.status === 'unverified') {
            await supabase.auth.mfa.unenroll({ factorId: f.id });
          }
        }
      } catch (err) {
        console.warn('[MFA] Clean unverified factors warning:', err);
      }

      if (cancelled) return;

      const res = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `PWRI Admin ${new Date().toISOString().slice(0, 10)}`,
      });

      if (cancelled) return;
      if (res.error || !res.data) {
        return setError(res.error?.message ?? 'Could not start MFA enrollment.');
      }
      setFactor({ id: res.data.id, qr: res.data.totp.qr_code, secret: res.data.totp.secret });
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="w-full" onClick={() => setAttempt((a) => a + 1)}>
          Generate fresh QR code
        </Button>
      </div>
    );
  }

  if (!factor) return <p className="text-sm text-muted-foreground">Preparing enrollment…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator,
        1Password, Authy), then enter the 6-digit code it shows.
      </p>
      <img src={factor.qr} alt="TOTP enrollment QR code" className="mx-auto h-44 w-44 rounded bg-white p-2" />
      <p className="break-all text-center font-mono text-xs text-muted-foreground">
        Can’t scan? Enter this key manually: {factor.secret}
      </p>
      <TotpChallengeForm
        factorId={factor.id}
        onVerified={onEnrolled}
        submitLabel="Confirm and enable"
        onFactorNotFound={() => setAttempt((a) => a + 1)}
      />
    </div>
  );
}
