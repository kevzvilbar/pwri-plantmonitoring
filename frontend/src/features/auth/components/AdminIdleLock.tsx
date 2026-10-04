import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { TotpChallengeForm } from './MfaForms';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Re-prompts for a TOTP code after `idleMs` without input, on the Admin page only.
 *
 * It deliberately does NOT sign out: this app queues readings offline, and a
 * forced sign-out would discard unsynced work. The content stays mounted (inert)
 * behind the lock, so drafts, tabs and the offline queue are untouched.
 * Admins without an enrolled factor (enforcement not yet on) are never locked.
 */
export function AdminIdleLock({ children, idleMs = 10 * 60_000 }: { children: ReactNode; idleMs?: number }) {
  const { isAdmin } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const lastActivity = useRef(Date.now());
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!cancelled) setFactorId(data?.totp?.[0]?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !factorId) return;
    const touch = () => { if (!locked) lastActivity.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= idleMs) setLocked(true);
    }, 15_000);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [isAdmin, factorId, idleMs, locked]);

  useEffect(() => { contentRef.current?.toggleAttribute('inert', locked); }, [locked]);

  return (
    <>
      <div ref={contentRef} aria-hidden={locked || undefined}>{children}</div>
      {locked && factorId && (
        <div role="dialog" aria-modal="true" aria-label="Admin session locked"
             className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur">
          <Card className="w-full max-w-sm space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5" aria-hidden />
              <h2 className="text-lg font-semibold">Admin session locked</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Locked after inactivity. Your unsaved work is still here. Enter your authenticator code to continue.
            </p>
            <TotpChallengeForm
              factorId={factorId}
              submitLabel="Unlock"
              onVerified={() => { lastActivity.current = Date.now(); setLocked(false); }}
            />
          </Card>
        </div>
      )}
    </>
  );
}
