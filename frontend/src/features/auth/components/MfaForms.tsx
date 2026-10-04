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
}: {
  factorId: string;
  onVerified: () => void;
  submitLabel?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code)) return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      return setError(challenge.error.message);
    }
    const verify = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    setBusy(false);
    if (verify.error) {
      setCode('');
      return setError('That code was not accepted. Check your device clock and try again.');
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Drop abandoned, never-verified factors so a retry does not hit "friendly name exists".
      const existing = await supabase.auth.mfa.listFactors();
      for (const f of existing.data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
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
    return () => { cancelled = true; };
  }, []);

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
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
      <TotpChallengeForm factorId={factor.id} onVerified={onEnrolled} submitLabel="Confirm and enable" />
    </div>
  );
}
