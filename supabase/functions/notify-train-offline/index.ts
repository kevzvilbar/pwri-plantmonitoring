/**
 * Edge Function: notify-train-offline
 *
 * Email alert when a train is marked Offline. Invoked by the
 * trg_train_status_log_notify_offline trigger (migration
 * 20260916000004_train_offline_email_notify.sql) via pg_net on every
 * train_status_log INSERT with status='Offline' — i.e. once per genuine
 * transition, because the consolidated writer + the duplicate-timestamp
 * trigger guarantee one INSERT per episode. No dedupe table needed.
 *
 * Recipients: Active Manager/Analyst/Admin profiles assigned to the train's
 * plant, resolved by get_offline_alert_recipients() (emails from auth.users).
 *
 * Delivery: Resend (https://resend.com) free tier via plain fetch — no SDK.
 *
 * ZERO-COST / NO-OP GUARANTEES (see migration header):
 *   - RESEND_API_KEY unset  → 200 { skipped: true } — nothing sends.
 *   - No recipients         → 200 with sent: 0 — nothing sends.
 *   - Bad/missing auth      → 401 — the function is not an open relay.
 * The DB trigger treats any failure as a warning, never blocking the
 * status-log write.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotifyRequest {
  row_id: string;
  train_id: string;
  plant_id: string;
  reason: string | null;
  confirmed_at: string;
  confirmed_by: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only the database (holding the service role key) may call this.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    // Not configured yet — the whole notification pipeline is a safe no-op.
    return new Response(JSON.stringify({ skipped: true, reason: 'RESEND_API_KEY not configured' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const fromEmail = Deno.env.get('NOTIFY_FROM_EMAIL') ?? 'PWRI Monitoring <onboarding@resend.dev>';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: NotifyRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!body?.train_id || !body?.plant_id) {
    return new Response(JSON.stringify({ error: 'train_id and plant_id are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Train + plant context for the message.
  const { data: train } = await supabase
    .from('ro_trains')
    .select('train_number, name')
    .eq('id', body.train_id)
    .maybeSingle();
  const { data: plant } = await supabase
    .from('plants')
    .select('name')
    .eq('id', body.plant_id)
    .maybeSingle();

  const trainLabel = train
    ? `Train ${train.train_number}${train.name ? ` — ${train.name}` : ''}`
    : 'a train';
  const plantName = plant?.name ?? 'your plant';
  const wentOfflineAt = body.confirmed_at
    ? new Date(body.confirmed_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'just now';

  // Recipients — Active Manager/Analyst/Admin profiles on the train's plant.
  const { data: recipients, error: recipientsError } = await supabase
    .rpc('get_offline_alert_recipients', { p_plant_id: body.plant_id });
  if (recipientsError) {
    return new Response(JSON.stringify({ error: `Recipient lookup failed: ${recipientsError.message}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const to = (recipients ?? [])
    .map((r: any) => r.email as string)
    .filter((e: string) => !!e);
  if (!to.length) {
    return new Response(JSON.stringify({ sent: 0, failed: 0, skipped: true, reason: 'no recipients' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const subject = `RO ${trainLabel} marked Offline — ${plantName}`;
  const html =
    `<p><strong>${trainLabel}</strong> at <strong>${plantName}</strong> was marked <strong>Offline</strong>.</p>` +
    `<p>Went offline at: <strong>${wentOfflineAt}</strong><br>` +
    `Reason: ${body.reason ? body.reason : '<em>not given</em>'}</p>` +
    `<p>If the train is actually running, confirm it back online in the Operator Log ` +
    `(RO Trains → Operator Log) so downtime stays accurate.</p>` +
    `<p style="color:#888;font-size:12px">Automated alert from PWRI Plant Monitoring. ` +
    `You receive this because you are a Manager/Admin assigned to ${plantName}.</p>`;

  // One email per recipient (no address sharing between managers).
  let sent = 0;
  let failed = 0;
  const failures: string[] = [];
  await Promise.allSettled(
    to.map(async (email: string) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject,
          html,
        }),
      });
      if (res.ok) {
        sent += 1;
      } else {
        failed += 1;
        failures.push(`${email}: ${res.status}`);
      }
    }),
  );

  return new Response(JSON.stringify({ sent, failed, failures }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

