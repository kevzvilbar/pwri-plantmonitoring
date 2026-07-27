// src/hooks/useEmailChange.ts
// ─────────────────────────────────────────────────────────────────────────────
// Encapsulates the two email-change flows:
//
//  A) OPERATOR / ADMIN-FORCED (instant, no confirmation)
//     Calls the `admin-update-user-email` Edge Function via service_role.
//     Available only to Admins. The target user is immediately updated —
//     no email is sent. Use for shared-email Operator accounts.
//
//  B) NON-OPERATOR SELF-CHANGE (confirmation required)
//     Calls supabase.auth.updateUser({ email }). Supabase sends a confirmation
//     link to the NEW email. The change only takes effect after the user
//     clicks that link. This is the standard, secure flow for individual emails.
//
// Usage:
//   const { changeEmail, loading, error } = useEmailChange();
//
//   // Admin changes an Operator's email immediately:
//   await changeEmail({ mode: 'admin-instant', targetUserId: '...', newEmail: '...' });
//
//   // User changes their own non-operator email (triggers confirmation):
//   await changeEmail({ mode: 'self-confirm', newEmail: '...' });
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminInstantParams = {
  mode: 'admin-instant';
  /** The user whose email is being changed (must not be the caller). */
  targetUserId: string;
  newEmail: string;
};

type SelfConfirmParams = {
  mode: 'self-confirm';
  newEmail: string;
};

export type EmailChangeParams = AdminInstantParams | SelfConfirmParams;

export type EmailChangeResult =
  | { ok: true; confirmedImmediately: boolean }
  | { ok: false; message: string };

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useEmailChange() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeEmail = async (params: EmailChangeParams): Promise<EmailChangeResult> => {
    setLoading(true);
    setError(null);

    try {
      // ── A) Admin instant (Edge Function) ────────────────────────────────
      if (params.mode === 'admin-instant') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          const msg = 'You must be signed in to perform this action.';
          setError(msg);
          return { ok: false, message: msg };
        }

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user-email`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Pass the caller's JWT so the Edge Function can verify Admin role
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              target_user_id: params.targetUserId,
              new_email: params.newEmail.trim().toLowerCase(),
            }),
          },
        );

        const json = await res.json();

        if (!res.ok) {
          const msg = json.error ?? 'Failed to update email.';
          setError(msg);
          return { ok: false, message: msg };
        }

        toast.success('Email updated immediately — no confirmation required.');
        return { ok: true, confirmedImmediately: true };
      }

      // ── B) Self-change with confirmation ────────────────────────────────
      if (params.mode === 'self-confirm') {
        const { error: updateErr } = await supabase.auth.updateUser({
          email: params.newEmail.trim().toLowerCase(),
        });

        if (updateErr) {
          const msg = updateErr.message.toLowerCase().includes('already registered')
            ? 'That email is already in use by another account.'
            : updateErr.message;
          setError(msg);
          return { ok: false, message: msg };
        }

        toast.success(
          'Confirmation email sent! Click the link in your new inbox to complete the change.',
          { duration: 6000 },
        );
        return { ok: true, confirmedImmediately: false };
      }

      // Exhaustive — TypeScript will catch missing branches
      const _: never = params;
      return { ok: false, message: 'Unknown mode' };

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error.';
      setError(msg);
      return { ok: false, message: msg };
    } finally {
      setLoading(false);
    }
  };

  return { changeEmail, loading, error };
}
