import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useDraft } from '@/hooks/useDraft';
import { DraftBanner } from '@/components/DraftBanner';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-picker';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { getCurrentPosition } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { ChevronDown, MapPin, Printer, AlertOctagon, ShieldAlert, AlertTriangle, CheckCircle2, Search, Download, Flame, PlusCircle, History as HistoryIcon } from 'lucide-react';
import { downloadCSV } from '@/lib/csv';
import { cn } from '@/lib/utils';

const REPORT_INITIAL = {
  plant_id: '',
  incident_type: '',
  severity: 'Medium' as 'Low' | 'Medium' | 'High' | 'Critical',
  what_description: '',
  where_location: '',
  gps_lat: null as number | null,
  gps_lng: null as number | null,
  when_datetime: '',
  witness: '',
  weather: 'Clear',
  temperature_c: '',
  immediate_action: '',
};

export { REPORT_INITIAL };

const TYPES = ['Equipment failure', 'Chemical spill', 'Power outage', 'Safety incident', 'Quality deviation', 'Other'];
const WEATHER = ['Clear', 'Partly cloudy', 'Cloudy', 'Rain', 'Heavy rain'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export function ReportForm({ initial }: { initial: typeof REPORT_INITIAL }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: plants } = usePlants();

  const { draft: v, setDraft: setV, hasDraft, clearDraft, discardDraft } = useDraft(
    `incident-report:${user?.id ?? 'anon'}`,
    initial,
  );

  const captureGPS = async () => {
    try {
      const pos = await getCurrentPosition();
      setV(s => ({ ...s, gps_lat: pos.coords.latitude, gps_lng: pos.coords.longitude }));
      toast.success('GPS coordinates captured');
    } catch { toast.error('Could not capture GPS'); }
  };

  const submit = async () => {
    if (!v.plant_id || !v.what_description) { toast.error('Plant and description required'); return; }
    const { error } = await supabase.from('incidents').insert({
      plant_id: v.plant_id,
      incident_type: v.incident_type || null,
      severity: v.severity,
      what_description: v.what_description,
      where_location: v.where_location || null,
      gps_lat: v.gps_lat,
      gps_lng: v.gps_lng,
      when_datetime: new Date(v.when_datetime).toISOString(),
      who_reporter: user?.id,
      witness: v.witness || null,
      weather: v.weather,
      temperature_c: v.temperature_c ? +v.temperature_c : null,
      immediate_action: v.immediate_action || null,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Incident logged successfully');
    clearDraft({ plant_id: v.plant_id });
    qc.invalidateQueries();
  };

  return (
    <Card className="p-4 space-y-4 rounded-xl print-page">
      {hasDraft && <DraftBanner onDiscard={discardDraft} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="incidents-plant" className="text-xs font-semibold">Plant Facility *</Label>
          <Select value={v.plant_id} onValueChange={(x) => setV({ ...v, plant_id: x })}>
            <SelectTrigger id="incidents-plant"><SelectValue placeholder="Select facility" /></SelectTrigger>
            <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="incidents-type" className="text-xs font-semibold">Incident Classification</Label>
          <Select value={v.incident_type} onValueChange={(x) => setV({ ...v, incident_type: x })}>
            <SelectTrigger id="incidents-type"><SelectValue placeholder="Classification" /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs font-semibold">Severity Rating</Label>
        <div className="grid grid-cols-4 gap-2 mt-1.5">
          {SEVERITIES.map(s => {
            const isSelected = v.severity === s;
            return (
              <Button
                key={s}
                size="sm"
                type="button"
                variant={isSelected ? 'default' : 'outline'}
                className={cn('font-bold text-xs', isSelected ? 'shadow-xs' : '')}
                onClick={() => setV({ ...v, severity: s })}
              >
                {s}
              </Button>
            );
          })}
        </div>
      </div>

      <section>
        <Label htmlFor="incidents-what" className="text-xs font-semibold">What Happened? (Detailed Description) *</Label>
        <Textarea
          value={v.what_description}
          onChange={e => setV({ ...v, what_description: e.target.value })}
          rows={3}
          placeholder="Describe the sequence of events, equipment affected, or safety deviation…"
          id="incidents-what"
          className="text-xs mt-1"
        />
      </section>

      <section>
        <Label htmlFor="incidents-where" className="text-xs font-semibold">Where (Specific Location / Area)</Label>
        <div className="flex gap-2 mt-1">
          <Input
            value={v.where_location}
            onChange={e => setV({ ...v, where_location: e.target.value })}
            placeholder="e.g. RO Train 2 HP Pump Skid"
            id="incidents-where"
            className="text-xs flex-1"
          />
          <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={captureGPS}>
            <MapPin className="h-3.5 w-3.5 mr-1 text-primary" />
            Capture GPS
          </Button>
        </div>
        {v.gps_lat && (
          <div className="text-2xs text-accent mt-1 font-mono">
            GPS: {v.gps_lat.toFixed(5)}, {v.gps_lng?.toFixed(5)}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="incidents-when" className="text-xs font-semibold">When Did It Occur?</Label>
          <DateTimePicker
            value={v.when_datetime}
            onChange={(val) => setV({ ...v, when_datetime: val })}
            placeholder="Select incident date & time..."
            size="sm"
            className="w-full font-mono-num"
            id="incidents-when"
          />
        </div>
        <div>
          <Label htmlFor="incidents-who" className="text-xs font-semibold">Witnesses / Personnel Present</Label>
          <Input
            placeholder="Personnel names or roles"
            value={v.witness}
            onChange={e => setV({ ...v, witness: e.target.value })}
            id="incidents-who"
            className="text-xs mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="incidents-weather" className="text-xs font-semibold">Weather Conditions</Label>
          <Select value={v.weather} onValueChange={(x) => setV({ ...v, weather: x })}>
            <SelectTrigger id="incidents-weather" className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{WEATHER.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="incidents-temp-c" className="text-xs font-semibold">Ambient Temp (°C)</Label>
          <Input
            type="number"
            step="any"
            placeholder="e.g. 32"
            value={v.temperature_c}
            onChange={e => setV({ ...v, temperature_c: e.target.value })}
            id="incidents-temp-c"
            className="text-xs mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="incidents-immediate-action-taken" className="text-xs font-semibold">Immediate Containment Action Taken</Label>
        <Textarea
          rows={2}
          value={v.immediate_action}
          onChange={e => setV({ ...v, immediate_action: e.target.value })}
          placeholder="Emergency shutdown, spill barrier deployed, bypass opened…"
          id="incidents-immediate-action-taken"
          className="text-xs mt-1"
        />
      </div>

      <div className="flex gap-2 no-print pt-1">
        <Button onClick={submit} className="flex-1 font-bold">
          Submit Incident Report
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="shrink-0">
          <Printer className="h-4 w-4 mr-1.5" />
          Print PDF
        </Button>
      </div>
    </Card>
  );
}
