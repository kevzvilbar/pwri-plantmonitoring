import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Gauge, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FlaggedRow, fmtNum, fmtDt, pickDisplayRole } from '../types';
import { guessMeterMax, supersedeOtherCorrectionRequests } from '../api';
import { DeltaBadge } from './DeltaBadge';

export function MarkRolloverModal({
  row, onClose, onDone,
}: { row: FlaggedRow; onClose: () => void; onDone: () => void }) {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const [maxVal, setMaxVal] = useState(String(guessMeterMax(row.previous_reading)));
  const [maxTouched, setMaxTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Wells can carry a configured wrap point (wells.meter_rollover_max, see
  // 20260806143000_wells_meter_rollover_max_config.sql) — prefer it over the
  // guessed digit-count heuristic once it loads. Locators and product
  // meters have no equivalent config column yet, so they keep using the
  // guess. maxTouched guards against clobbering a value the admin already
  // started typing before this resolves.
  const { data: configuredMax } = useQuery({
    queryKey: ['well-rollover-max', row.entity_id],
    queryFn: async () => {
      if (!row.entity_id) return null;
      const { data } = await supabase
        .from('wells')
        .select('meter_rollover_max')
        .eq('id', row.entity_id)
        .maybeSingle();
      return data?.meter_rollover_max ?? null;
    },
    enabled: row.source_table === 'well_readings' && !!row.entity_id,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (configuredMax != null && !maxTouched) setMaxVal(String(configuredMax));
  }, [configuredMax, maxTouched]);

  const parsedMax = Number(maxVal);
  const validMax = maxVal !== '' && !isNaN(parsedMax) && parsedMax > 0
    && (row.previous_reading == null || parsedMax >= row.previous_reading);

  // Same formula as calc.dailyVolume (frontend) and the DB's rollover-aware
  // daily_volume expression: (max - previous) + current, floored at zero.
  const computedVolume = validMax
    ? Math.max(0, Math.round((parsedMax - (row.previous_reading ?? 0)) + row.current_reading))
    : null;

  const handleSave = async () => {
    if (!validMax) {
      toast.error(row.previous_reading != null
        ? `Enter a wrap point ≥ the previous reading (${fmtNum(row.previous_reading)})`
        : 'Enter a valid wrap point');
      return;
    }
    setBusy(true);
    try {
      // locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres
      // recomputes it from is_meter_rollover/meter_rollover_max automatically
      // and must never appear in this UPDATE. well_readings and
      // product_meter_readings store it as a plain column that needs setting
      // directly.
      if (row.source_table === 'locator_readings') {
        const { error } = await supabase
          .from('locator_readings')
          .update({
            is_meter_rollover: true,
            meter_rollover_max: parsedMax,
            norm_status: 'normal',
          })
          .eq('id', row.id);
        if (error) throw error;
      } else if (row.source_table === 'well_readings') {
        const { error } = await supabase
          .from('well_readings')
          .update({
            is_meter_rollover: true,
            meter_rollover_max: parsedMax,
            norm_status: 'normal',
            daily_volume: computedVolume,
          })
          .eq('id', row.id);
        if (error) throw error;
      } else if (row.source_table === 'product_meter_readings') {
        const { error } = await supabase
          .from('product_meter_readings')
          .update({
            is_meter_rollover: true,
            meter_rollover_max: parsedMax,
            norm_status: 'normal',
            daily_volume: computedVolume,
          })
          .eq('id', row.id);
        if (error) throw error;
      }

      const { error: normError } = await supabase
        .from('reading_normalizations')
        .insert({
          source_table: row.source_table,
          source_id: row.id,
          action: 'normalize',
          original_value: row.current_reading,
          adjusted_value: computedVolume,
          note: `Marked as meter rollover (wrap point ${fmtNum(parsedMax)}) from Pending Review — true delta ${fmtNum(computedVolume)} m³`,
          performed_by: user?.id ?? null,
          performed_role: actorRole,
        });
      if (normError) throw normError;

      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        'Superseded — reading marked as meter rollover directly from Pending Review',
      );
      toast.success(`${row.entity_name}: marked as rollover · +${fmtNum(computedVolume)} m³`);
      onDone();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => { if (!o && !busy) onClose(); }}
      title={(
        <span className="flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-primary shrink-0" />
          Mark as meter rollover — {row.entity_name}
        </span>
      )}
      description={(
        <>
          {row.plant_name} · {fmtDt(row.reading_datetime)}
          <br />
          Previous: <span className="font-mono">{fmtNum(row.previous_reading)}</span>
          {' → '}Current: <span className="font-mono">{fmtNum(row.current_reading)}</span>
        </>
      )}
      className="max-w-sm"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !validMax}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Confirm rollover
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 pb-4">
        <p className="text-xs text-muted-foreground">
          Only confirm this if the meter's register actually wrapped around —
          the current reading should look like an early value for this meter
          (small, near its usual minimum), not a plausible mid-range value
          with a digit dropped or transposed.
        </p>

        <div className="space-y-1">
          <label htmlFor="datacorrections-wrap-point" className="text-xs font-medium">Meter wrap point (register max)</label>
          <Input
            id="datacorrections-wrap-point"
            type="number"
            value={maxVal}
            onChange={e => { setMaxVal(e.target.value); setMaxTouched(true); }}
            className="font-mono h-9 text-sm"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-2xs text-muted-foreground">Presets:</span>
            {[
              { label: '99,999.99', val: 99999.99 },
              { label: '999,999.99', val: 999999.99 },
              { label: '9,999,999.99', val: 9999999.99 },
              { label: '99,999', val: 99999 },
              { label: '999,999', val: 999999 },
              { label: '9,999,999', val: 9999999 },
            ].map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setMaxVal(String(p.val)); setMaxTouched(true); }}
                className={cn(
                  'text-2xs font-mono px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-accent/20 transition-colors',
                  Number(maxVal) === p.val && 'bg-primary/20 border-primary text-primary font-semibold'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {configuredMax != null && !maxTouched
              ? "From this well's configured wrap point (Edit Well) — overtype if it's wrong."
              : "Guessed from the previous reading's digit count — overtype with the physical meter's actual register size if you know it."}
          </p>
          {validMax && (
            <p className="text-xs text-muted-foreground">
              True delta if confirmed: <DeltaBadge vol={computedVolume} />
            </p>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  );
}