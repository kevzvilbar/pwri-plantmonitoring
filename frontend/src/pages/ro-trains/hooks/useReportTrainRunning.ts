import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';

export type UptimeReportCategory = 'operator_failed_to_encode' | 'system_error' | 'other';

/**
 * "Report Running — failed to encode" exemption workflow.
 *
 * Files a retroactive attestation that the train was actually running during
 * a gap the auto-offline flagger mis-read (operator forgot to encode, or the
 * terminal/app was down), then:
 *   1. deletes the open bogus auto-flag row(s) from train_status_log,
 *   2. flips the train back to Running,
 *   3. logs a Running row in train_status_log so the transition is auditable.
 *
 * The report row itself (covered_from → covered_until) is what stops the
 * flagger from re-writing the flag on the next 5-minute poll: see the
 * exemption check in useTrainAutoOffline.ts. Gaps filed AFTER covered_until
 * are flagged normally — an attestation is not a standing exemption.
 */
export function useReportTrainRunning() {
  const qc = useQueryClient();

  const reportRunning = async (opts: {
    trainId: string;
    plantId: string;
    /** Last production reading before the gap (the gap's start). */
    coveredFrom: string;
    /** Server-authoritative end of the attested window (defaults to now). */
    coveredUntil?: string;
    category: UptimeReportCategory;
    detail?: string;
  }) => {
    const coveredUntil = opts.coveredUntil ?? new Date().toISOString();

    const { error: reportErr } = await supabase.from('ro_train_uptime_reports' as any).insert({
      train_id: opts.trainId,
      plant_id: opts.plantId,
      covered_from: opts.coveredFrom,
      covered_until: coveredUntil,
      reason_category: opts.category,
      reason_detail: opts.detail || null,
    });
    if (reportErr) throw new Error(friendlyError(reportErr));

    // Remove the open bogus auto-flag(s). Only rows whose Offline flag was
    // auto-written and never closed (a later row would have closed it) —
    // closed history stays untouched.
    const { data: openFlags, error: fetchErr } = await supabase
      .from('train_status_log' as any)
      .select('id')
      .eq('train_id', opts.trainId)
      .eq('status', 'Offline')
      .like('reason', 'Auto-flagged%')
      .gte('confirmed_at', opts.coveredFrom)
      .order('confirmed_at', { ascending: false });
    if (fetchErr) throw new Error(friendlyError(fetchErr));

    if (openFlags?.length) {
      const { error: delErr } = await supabase
        .from('train_status_log' as any)
        .delete()
        .in('id', openFlags.map((f: any) => f.id));
      if (delErr) throw new Error(friendlyError(delErr));
    }

    // Flip the train back to Running (idempotent — guard on current status so
    // a manual Offline/Maintenance set after the flag isn't steamrolled).
    const { data: cur, error: curErr } = await supabase
      .from('ro_trains' as any)
      .select('status')
      .eq('id', opts.trainId)
      .maybeSingle();
    if (curErr) throw new Error(friendlyError(curErr));
    if ((cur as any)?.status === 'Offline') {
      const { error: updErr } = await supabase
        .from('ro_trains' as any)
        .update({ status: 'Running' })
        .eq('id', opts.trainId);
      if (updErr) throw new Error(friendlyError(updErr));
      await supabase.from('train_status_log' as any).insert({
        train_id: opts.trainId,
        plant_id: opts.plantId,
        status: 'Running',
        reason: `Uptime reported: ${opts.category}${opts.detail ? ` — ${opts.detail}` : ''}`,
        confirmed_at: coveredUntil,
      });
    }

    qc.invalidateQueries({ queryKey: ['trains'] });
    qc.invalidateQueries({ queryKey: ['ro-trains'] });
    qc.invalidateQueries({ queryKey: ['train-status-log'] });
    qc.invalidateQueries({ queryKey: ['train-latest-status-log'] });
    qc.invalidateQueries({ queryKey: ['train-hourly-gaps'] });
    qc.invalidateQueries({ queryKey: ['train-gaps'] });
  };

  return { reportRunning };
}
