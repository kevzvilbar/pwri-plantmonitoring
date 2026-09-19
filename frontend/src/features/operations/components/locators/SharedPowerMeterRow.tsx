import React, { useState, useEffect, useRef } from 'react';
import { useDraft } from '@/hooks/useDraft';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { Zap, CalendarClock, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fmtNum } from '@/lib/calculations';

export function SharedPowerMeterRow({
  groupName, primaryWellId, plantId, previousPower, userId, onSaved,
}: {
  groupName: string;
  primaryWellId: string;
  plantId: string;
  previousPower: number | null;
  userId: string | undefined;
  onSaved: () => void;
}) {
  const [reading, setReading] = useState('');
  // Draft recovery — restores the power meter value if the operator navigates away accidentally
  const { draft: draftReading, setDraft: setDraftReading, clearDraft: clearDraftReading } =
    useDraft(`shared-power-${primaryWellId}`, { value: '' });
  // Restore draft on mount if input is empty
  useEffect(() => { if (!reading && draftReading.value) setReading(draftReading.value); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!reading) { toast.error(`${groupName}: enter a power meter reading`); return; }
    setSaving(true);
    const val = +reading;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    // Check if primary well already has a reading today — update it if so
    const { data: todayRecs, error: checkErr } = await supabase
      .from('well_readings')
      .select('id')
      .eq('well_id', primaryWellId)
      .gte('reading_datetime', startOfDay.toISOString())
      .order('reading_datetime', { ascending: false })
      .limit(1);
    // Was: error discarded — same duplicate-row risk as elsewhere this
    // session: a failed check fell through to the INSERT branch below even
    // when today's well reading already existed, creating a second row.
    if (checkErr) {
      setSaving(false);
      toast.error("Couldn't verify today's existing reading — retry before saving.");
      return;
    }

    if (todayRecs?.length) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val })
        .eq('id', (todayRecs[0] as any).id);
      setSaving(false);
      if (error) { toast.error(friendlyError(error)); return; }
    } else {
      // No water reading yet for today — insert a standalone power record
      const { error } = await supabase.from('well_readings').insert({
        well_id: primaryWellId,
        plant_id: plantId,
        current_reading: previousPower ?? 0,
        power_meter_reading: val,
        recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSaving(false);
      if (error) { toast.error(friendlyError(error)); return; }
    }

    toast.success(`${groupName}: power meter saved`);
    setReading(''); clearDraftReading();
    onSaved();
  };

  return (
    /* ── Shared meter group header — owns the kWh input ── */
    <div className="border-b border-warn/40 bg-warn-soft/60">
      {/* Title bar */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-warn-soft shrink-0">
          <Zap className="h-3.5 w-3.5 text-warn" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground tracking-tight truncate">{groupName}</span>
          <span className="text-3xs font-bold uppercase tracking-widest bg-warn/20 text-warn px-1.5 py-0.5 rounded-full shrink-0">
            Shared Meter
          </span>
        </div>
        {/* Date picker */}
        <label className="shrink-0 cursor-pointer relative">
          <span
            className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted border border-border/70 rounded-md px-3.5 py-1.5 font-mono-num whitespace-nowrap hover:bg-muted/80 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-focus-visible:outline-offset-2"
            onClick={(e) => {
              e.preventDefault();
              const el = dtInputRef.current;
              if (!el) return;
              if (typeof el.showPicker === 'function') {
                try { el.showPicker(); } catch { el.focus(); }
              } else {
                el.focus();
              }
            }}
          >
            {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
            <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
          </span>
          <Input ref={dtInputRef} type="datetime-local" value={customDt}
            onChange={e => setCustomDt(e.target.value)}
            className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none"
            title="Reading date & time" />
        </label>
      </div>

      {/* kWh input */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
          prev: <span className="font-mono-num font-medium text-foreground/80">{previousPower == null ? '—' : fmtNum(previousPower)}</span>
        </span>
        <div className="relative flex-1">
          <Zap className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-kpi-meter pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={reading}
            onChange={e => { setReading(e.target.value); setDraftReading({ value: e.target.value }); }} placeholder="Shared power kWh"
            className="h-10 pl-8 w-full border-kpi-meter/30 focus-visible:ring-kpi-meter/40 bg-kpi-meter/5 placeholder:text-muted-foreground/50"
            data-testid={`shared-power-input-${primaryWellId}`} />
        </div>
        <Button onClick={save} disabled={saving || !reading}
          className="h-10 px-4 text-sm shrink-0 bg-kpi-meter hover:bg-kpi-meter/90 active:bg-kpi-meter/80 text-white shadow-sm border-0">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </div>
  );
}
