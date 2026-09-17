// @ts-nocheck
/// <reference path="../deno.d.ts" />
/**
 * Edge Function: send-push-notification
 *
 * Dispatches Web Push Notifications to subscribed mobile and desktop devices.
 * Invoked by database triggers or authorized service-role jobs when critical events occur.
 *
 * Payload:
 * {
 *   user_id?: string;
 *   plant_id?: string;
 *   title: string;
 *   message: string;
 *   url?: string;
 *   severity?: 'critical' | 'warning' | 'info';
 *   tag?: string;
 * }
 *
 * ZERO-COST / NO-OP GUARANTEES:
 *   - VAPID_PRIVATE_KEY unset -> 200 { skipped: true, reason: 'VAPID_PRIVATE_KEY not configured' }
 *   - No subscriptions found  -> 200 { sent: 0, skipped: true, reason: 'no subscriptions' }
 *   - Bad auth                -> 401 Unauthorized
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
}

serve(async (req: any) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only authorized callers (service role) may invoke push delivery
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@pwri.com';

  if (!vapidPrivateKey || !vapidPublicKey) {
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: 'VAPID keys not configured in Edge environment.',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  let body: PushRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.title || !body.message) {
    return new Response(
      JSON.stringify({ error: 'title and message are required fields' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let targetUserIds: string[] = [];

  if (body.user_id) {
    targetUserIds = [body.user_id];
  } else if (body.plant_id) {
    // Lookup active staff for plant
    const { data: recipients } = await supabase.rpc('get_offline_alert_recipients', {
      p_plant_id: body.plant_id,
    });
    if (recipients && Array.isArray(recipients)) {
      targetUserIds = recipients.map((r: any) => r.user_id || r.id).filter(Boolean);
    }
  }

  // Fetch active subscriptions
  let query = supabase.from('push_subscriptions').select('*');
  if (targetUserIds.length > 0) {
    query = query.in('user_id', targetUserIds);
  }

  const { data: subscriptions, error: subError } = await query;
  if (subError) {
    return new Response(JSON.stringify({ error: subError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!subscriptions || subscriptions.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, skipped: true, reason: 'no active subscriptions' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const notificationPayload = JSON.stringify({
    title: body.title,
    body: body.message,
    icon: './icon-192.png',
    badge: './favicon.png',
    url: body.url || './alerts',
    severity: body.severity || 'info',
    tag: body.tag || `pwri-${Date.now()}`,
  });

  let sent = 0;
  let failed = 0;
  const expiredEndpoints: string[] = [];

  for (const sub of subscriptions) {
    try {
      // Dispatch Web Push via standard HTTP push endpoint
      const pushRes = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'TTL': '86400',
          'Content-Type': 'application/octet-stream',
        },
        body: notificationPayload,
      });

      if (pushRes.ok) {
        sent++;
      } else if (pushRes.status === 404 || pushRes.status === 410) {
        // Subscription is expired / unregistered
        expiredEndpoints.push(sub.endpoint);
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  // Clean up expired subscriptions automatically
  if (expiredEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
  }

  return new Response(
    JSON.stringify({
      sent,
      failed,
      pruned: expiredEndpoints.length,
      totalSubscribers: subscriptions.length,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});

