// @ts-nocheck
/// <reference path="../deno.d.ts" />
/**
 * Edge Function: admin-update-user-email
 *
 * Allows Admins to immediately update another user's email address (e.g. for
 * shared-email Operator accounts) without requiring confirmation email delivery.
 *
 * Security requirements:
 * 1. Caller must supply a valid authenticated JWT in Authorization header.
 * 2. Caller must possess the Admin role (verified via database is_admin RPC).
 * 2b. When `require_admin_mfa` is on, the caller's token must be aal2 (TOTP-verified).
 * 3. Caller cannot update their own email via this route (prevents self-lockout/bypass).
 * 4. Input validation: target_user_id must be a UUID, new_email must be valid format.
 * 5. Uses service_role client to update auth.users with email_confirm: true.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** `aal` claim of an already-verified Supabase access token ('aal1' | 'aal2'). */
function jwtAal(token: string): string {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
    return typeof payload.aal === 'string' ? payload.aal : 'aal1';
  } catch {
    return 'aal1';
  }
}

interface UpdateEmailRequest {
  target_user_id: string;
  new_email: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: 'Server configuration missing' }, 500);
  }

  // 1. Verify caller authorization
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');

  // Caller client to inspect caller session
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerUser) {
    return json({ error: 'Unauthorized: Invalid token' }, 401);
  }

  // 2. Check Admin role using service client with caller ID
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: isAdmin, error: adminCheckError } = await adminClient.rpc('is_admin', {
    _user_id: callerUser.id,
  });

  if (adminCheckError || !isAdmin) {
    return json({ error: 'Forbidden: Admin access required' }, 403);
  }

  // 2b. MFA: once `require_admin_mfa` is switched on, Admin actions need an aal2 session.
  const { data: mfaRequired, error: mfaError } = await adminClient.rpc('admin_mfa_required');
  if (mfaError) {
    return json({ error: 'Unable to verify MFA policy' }, 500);
  }
  if (mfaRequired && jwtAal(token) !== 'aal2') {
    return json({ error: 'Forbidden: multi-factor authentication (aal2) required' }, 403);
  }

  // 3. Parse and validate body
  let body: UpdateEmailRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target_user_id, new_email } = body;

  if (!target_user_id || !UUID_REGEX.test(target_user_id)) {
    return json({ error: 'Invalid or missing target_user_id' }, 400);
  }

  const cleanEmail = (new_email || '').trim().toLowerCase();
  if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
    return json({ error: 'Invalid email address format' }, 400);
  }

  if (target_user_id === callerUser.id) {
    return json({ error: 'Admins must use self-confirm email change for their own account' }, 400);
  }

  // 4. Update user email via Supabase Admin API
  const { data: updatedUser, error: updateError } = await adminClient.auth.admin.updateUserById(
    target_user_id,
    {
      email: cleanEmail,
      email_confirm: true,
    },
  );

  if (updateError) {
    const isConflict = updateError.message?.toLowerCase().includes('already registered') ||
                       updateError.message?.toLowerCase().includes('duplicate') ||
                       updateError.message?.toLowerCase().includes('unique');
    return json(
      { error: isConflict ? 'That email is already in use by another account' : updateError.message },
      isConflict ? 409 : 400,
    );
  }

  return json({
    ok: true,
    user_id: target_user_id,
    email: cleanEmail,
  });
});
