export type MfaGateState =
  | 'allow'            // aal2 reached, or MFA not applicable
  | 'challenge'        // TOTP factor enrolled, session still aal1: ask for a code
  | 'enroll'           // no factor and the server requires MFA: must enroll
  | 'enroll-optional'; // no factor, server not enforcing yet: offer enrollment, allow skipping

export interface MfaGateInput {
  /** From supabase.auth.mfa.getAuthenticatorAssuranceLevel() */
  currentLevel: 'aal1' | 'aal2' | null | undefined;
  nextLevel: 'aal1' | 'aal2' | null | undefined;
  /** public.admin_mfa_required(). Callers pass `true` when the lookup fails (fail closed). */
  required: boolean;
  /** Admin chose "Skip for now" this browser session (only honoured while not required). */
  skipped: boolean;
}

export function resolveMfaGate({ currentLevel, nextLevel, required, skipped }: MfaGateInput): MfaGateState {
  if (currentLevel === 'aal2') return 'allow';
  if (nextLevel === 'aal2') return 'challenge'; // a verified factor exists
  if (required) return 'enroll';
  return skipped ? 'allow' : 'enroll-optional';
}
