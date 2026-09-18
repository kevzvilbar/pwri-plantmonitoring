// @ts-nocheck
/// <reference path="../deno.d.ts" />
/**
 * Edge Function: send-push-notification
 *
 * Delivers a real Web Push notification to every subscribed device of the
 * targeted users, encrypting the payload per RFC 8291 and authenticating with
 * VAPID per RFC 8292 (see ../_shared/webpush.ts for the crypto and for why the
 * previous plaintext-POST implementation never delivered anything).
 *
 * Invoked by database triggers (pg_net) or authorized service-role jobs.
 *
 * Payload:
 * {
 *   user_id?: string;          // exactly one recipient
 *   plant_id?: string;         // every Active Manager/Analyst/Admin on the plant
 *   title: string;
 *   message: string;
 *   url?: string;
 *   severity?: 'critical' | 'warning' | 'info';
 *   tag?: string;              // also used as the RFC 8030 collapse Topic
 *   ttl_seconds?: number;
 * }
 *
 * TARGETING IS FAIL-CLOSED. Exactly one of user_id / plant_id is required. An
 * earlier revision skipped the filter when neither resolved, which silently
 * turned "nobody specified" into "every subscriber on every plant" — an alert
 * leak across plants. Ambiguous input now gets a 400 instead.
 *
 * ZERO-COST / NO-OP GUARANTEES:
 *   - VAPID keys unset   -> 200 { skipped: true, reason: 'VAPID keys not configured...' }
 *   - No subscriptions   -> 200 { sent: 0, skipped: true, reason: 'no subscriptions' }
 *   - No recipients      -> 200 { sent: 0, skipped: true, reason: 'no recipients' }
 *   - Bad auth           -> 401 Unauthorized
 *   - Missing target     -> 400 (never a broadcast)
 *
 * CONFIG (see DEPLOYMENT.md):
 *   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
 * Generate a pair with: node scripts/generate-vapid-keys.mjs
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendWebPush,
  type PushSubscriptionRecord,
  type VapidKeys,
} from "../_shared/webpush.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushRequest {
  user_id?: string;
  plant_id?: string;
  title: string;
  message: string;
  url?: string;
  severity?: 'critical' | 'warning' | 'info';
  tag?: string;
  ttl_seconds?: number;
}

/** Critical alerts should wake a lockscreen; informational ones must not. */
const URGENCY_BY_SEVERITY = {
  critical: 'high',
  warning: 'normal',
  info: 'low',
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only authorized callers (service role) may invoke push delivery
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const vapid: VapidKeys = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@pwri.com',
  };

  // Without a real keypair nothing can be signed, so stay a no-op rather than
  // burning a request per subscriber on guaranteed 401s from the push service.
  if (!vapid.publicKey || !vapid.privateKey) {
    return json({
      skipped: true,
      reason: 'VAPID keys not configured in Edge environment.',
    });
  }

  let body: PushRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body?.title || !body?.message) {
    return json({ error: 'title and message are required fields' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Resolve the audience (fail closed) ───────────────────────────────────
  let targetUserIds: string[] = [];

  if (body.user_id) {
    targetUserIds = [body.user_id];
  } else if (body.plant_id) {
    // NOTE: the email path's get_offline_alert_recipients() returns (email,
    // display_name) with no user id, so it cannot be reused here.
    const { data: recipients, error: recipientError } = await supabase.rpc(
      'get_push_alert_recipient_ids',
      { p_plant_id: body.plant_id },
    );
    if (recipientError) {
      return json({ error: `Recipient lookup failed: ${recipientError.message}` }, 500);
    }
    targetUserIds = (recipients ?? [])
      .map((r: { user_id?: string }) => r.user_id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  } else {
    // Never fall through to an unfiltered query — that is a broadcast.
    return json({ error: 'user_id or plant_id is required' }, 400);
  }

  targetUserIds = [...new Set(targetUserIds)];
  if (targetUserIds.length === 0) {
    return json({ sent: 0, failed: 0, skipped: true, reason: 'no recipients' });
  }

  // ─ Fan out ───────────────────────────────────────────────────────────────
  const { data: subscriptions, error: subError } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', targetUserIds);

  if (subError) {
    return json({ error: subError.message }, 500);
  }
  if (!subscriptions || subscriptions.length === 0) {
    return json({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: 'no active subscriptions',
      recipients: targetUserIds.length,
    });
  }

  const severity = body.severity ?? 'info';
  const tag = body.tag || `pwri-${severity}-${Date.now()}`;
  const payload = JSON.stringify({
    title: body.title,
    body: body.message,
    icon: './icon-192.png',
    badge: './favicon.png',
    url: body.url || './alerts',
    severity,
    tag,
  });

  const results = await Promise.all(
    subscriptions.map((sub: PushSubscriptionRecord) =>
      sendWebPush(sub, payload, vapid, {
        urgency: URGENCY_BY_SEVERITY[severity],
        topic: tag,
        ttlSeconds: body.ttl_seconds,
      }),
    ),
  );

  const sent = results.filter((r) => r.ok).length;
  const failures = results.filter((r) => !r.ok);
  const expiredEndpoints = failures.filter((r) => r.expired).map((r) => r.endpoint);

  // Drop subscriptions the push service has retired (RFC 8030 §8), so the table
  // does not accumulate dead endpoints that waste a request on every alert.
  if (expiredEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
  }

  return json({
    sent,
    failed: failures.length,
    pruned: expiredEndpoints.length,
    totalSubscribers: subscriptions.length,
    recipients: targetUserIds.length,
    // Operator-facing diagnosis: without this, a systematic failure (e.g. a
    // VAPID key mismatch at the push service) is invisible behind "failed: 3".
    diagnostics: failures.slice(0, 5).map((r) => ({
      status: r.status,
      error: r.error,
      endpointHost: (() => {
        try {
          return new URL(r.endpoint).host;
        } catch {
          return 'malformed-endpoint';
        }
      })(),
    })),
  });
});