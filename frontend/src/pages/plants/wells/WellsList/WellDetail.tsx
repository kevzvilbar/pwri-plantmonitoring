import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChevronLeft, MapPin, Gauge, Zap, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fmtNum } from '@/lib/calculations';
import { MeterDetailButton } from '../../charts/EntityHistoryChart';
import { EntityHistoryChart } from '../../charts/EntityHistoryChart';
import { ReplaceMeterDialog } from '../../locators/LocatorDialogs';
import { EditElectricMeterDialog, EditHydraulicDialog } from '../WellDialogs';
import { useAuth } from '@/hooks/useAuth';

export function WellDetail({ wellId, onBack }: { wellId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [editHydraulicOpen, setEditHydraulicOpen] = useState(false);
  const [editElectricOpen, setEditElectricOpen] = useState(false);

  const { data: well } = useQuery({
    queryKey: ['well', wellId],
    queryFn: async () => (await supabase.from('wells').select('*').eq('id', wellId).single()).data,
  });
  const { data: pms } = useQuery({
    queryKey: ['well-pms', wellId],
    queryFn: async () => (await supabase.from('well_pms_records').select('*').eq('well_id', wellId).order('date_gathered', { ascending: false })).data ?? [],
  });
  const { data: latestReplacement } = useQuery({
    queryKey: ['well-latest-replacement', wellId],
    queryFn: async () => {
      const { data } = await supabase.from('well_meter_replacements')
        .select('*, replacer:user_profiles!well_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('well_id', wellId).order('replacement_date', { ascending: false }).limit(1);
      return (data?.[0] ?? null) as any;
    },
  });
  const { data: rawReadings = [] } = useQuery<any[]>({
    queryKey: ['well-raw-readings', wellId],
    queryFn: async () => {
      const { data } = await supabase
        .from('well_readings')
        .select('id, reading_datetime, current_reading, previous_reading, power_meter_reading, tds_ppm, pressure_psi')
        .eq('well_id', wellId)
        .order('reading_datetime', { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });
  const { data: isBlendingWell } = useQuery<boolean>({
    queryKey: ['well-is-blending', wellId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blending_wells')
        .select('well_id')
        .eq('well_id', wellId)
        .limit(1);
      if (error) return false;
      return (data ?? []).length > 0;
    },
  });

  if (!well) return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  const latest = pms?.[0];
  const replacerName = latestReplacement?.replacer
    ? [latestReplacement.replacer.first_name, latestReplacement.replacer.last_name].filter(Boolean).join(' ') : null;
  const hasCoords = (well as any).gps_lat != null && (well as any).gps_lng != null;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${(well as any).gps_lat},${(well as any).gps_lng}` : null;

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" /> Back to Wells
      </button>

      {/* Hero */}
      <Card className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-base">{well.name}</h3>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {well.diameter && <span>{well.diameter}</span>}
              {(well as any).drilling_depth_m && <span>{(well as any).drilling_depth_m} m depth</span>}
            </div>
            {hasCoords && (
              <a href={mapsUrl!} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                <MapPin className="h-3 w-3" />
                {(+(well as any).gps_lat).toFixed(5)}, {(+(well as any).gps_lng).toFixed(5)}
              </a>
            )}
          </div>
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${
            well.status === 'Active' ? 'text-accent bg-accent-soft border-accent'
            : 'text-muted-foreground bg-muted border-border'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${well.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground'}`} />
            {well.status ?? 'Active'}
          </span>
        </div>
      </Card>

      {/* Water Meter */}
      <MeterDetailButton label="Water Meter" icon={<Gauge className="h-4 w-4 text-info" />}
        fields={[
          { label: 'Brand', value: well.meter_brand },
          { label: 'Size', value: well.meter_size ? `${well.meter_size} in` : null },
          { label: 'Serial No.', value: well.meter_serial },
          { label: 'Installed', value: well.meter_installed_date },
          { label: 'Last Replaced By', value: replacerName },
          { label: 'Replacement Date', value: latestReplacement?.replacement_date },
        ]}>
        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setReplaceOpen(true)}>
          Replace Meter
        </Button>
      </MeterDetailButton>

      {/* Electric Meter */}
      {well.has_power_meter && (
        <MeterDetailButton label="Electric Meter" icon={<Zap className="h-4 w-4 text-warn" />}
          fields={[
            { label: 'Brand', value: (well as any).electric_meter_brand },
            { label: 'Size', value: (well as any).electric_meter_size },
            { label: 'Serial No.', value: (well as any).electric_meter_serial },
            { label: 'Installed', value: (well as any).electric_meter_installed_date },
          ]}>
          {isManager && (
            <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setEditElectricOpen(true)}>
              Edit Electric Meter
            </Button>
          )}
        </MeterDetailButton>
      )}

      {/* Historical Consumption Chart */}
      <Card className="p-3">
        <EntityHistoryChart entityId={wellId} entityType="well" entityName={well.name} isBlendingWell={!!isBlendingWell} />
      </Card>

      {/* Hydraulic data */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-info" /> Hydraulic Data
          </span>
          {isManager && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditHydraulicOpen(true)}>
              Edit
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {([
            ['Drilling depth', `${(latest as any)?.drilling_depth_m ?? well.drilling_depth_m ?? '—'} m`],
            ['SWL', `${latest?.static_water_level_m ?? '—'} m`],
            ['PWL', `${latest?.pumping_water_level_m ?? '—'} m`],
            ['Pump setting', latest?.pump_setting ?? '—'],
            ['Motor HP', latest?.motor_hp ?? '—'],
            ['TDS (PMS)', `${latest?.tds_ppm ?? '—'} ppm`],
            ['TDS (daily)', `${(rawReadings as any[]).find((r: any) => r.tds_ppm != null)?.tds_ppm ?? '—'} ppm`],
            ['Pressure', `${(rawReadings as any[]).find((r: any) => r.pressure_psi != null)?.pressure_psi ?? '—'} psi`],
            ['Turbidity', `${latest?.turbidity_ntu ?? '—'} NTU`],
          ] as [string, string | number | null | undefined][]).map(([k, val]) => (
            <div key={k}>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground">{k}</div>
              <div className="font-mono-num font-medium">{val ?? '—'}</div>
            </div>
          ))}
          {latest?.date_gathered && (
            <div className="col-span-2 text-2xs text-muted-foreground pt-1">Last gathered: {latest.date_gathered}</div>
          )}
        </div>
        {pms && pms.length > 1 && (
          <details className="mt-3">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              History ({pms.length} records)
            </summary>
            <div className="mt-2 space-y-0 text-xs max-h-48 overflow-y-auto">
              {(pms as any[]).map((p: any) => (
                <div key={p.id} className="border-t py-1.5 grid grid-cols-3 gap-x-2">
                  <span className="font-medium col-span-3">{p.date_gathered}</span>
                  <span className="text-muted-foreground">D: {p.drilling_depth_m ?? '—'}m</span>
                  <span className="text-muted-foreground">SWL: {p.static_water_level_m ?? '—'}m</span>
                  <span className="text-muted-foreground">PWL: {p.pumping_water_level_m ?? '—'}m</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Recent raw readings table */}
      {rawReadings.length > 0 && (
        <Card className="p-3" data-testid="well-raw-readings-card">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" /> Recent Readings
            {well.has_power_meter && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-2xs uppercase tracking-wide text-warn bg-warn-soft px-1.5 py-0.5 rounded">
                <Zap className="h-2.5 w-2.5" /> kWh tracked
              </span>
            )}
          </h4>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead className="text-2xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left px-1 py-1 font-medium">Date</th>
                  <th className="text-right px-1 py-1 font-medium">Water m³</th>
                  <th className="text-right px-1 py-1 font-medium">Δ</th>
                  {well.has_power_meter && <th className="text-right px-1 py-1 font-medium">kWh</th>}
                  <th className="text-right px-1 py-1 font-medium">TDS (ppm)</th>
                  <th className="text-right px-1 py-1 font-medium">Pressure (psi)</th>
                </tr>
              </thead>
              <tbody>
                {rawReadings.map((r: any) => {
                  const delta = r.previous_reading != null && r.current_reading != null
                    ? +r.current_reading - +r.previous_reading : null;
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-1 py-1 text-muted-foreground whitespace-nowrap">
                        {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-1 py-1 text-right font-mono-num">{r.current_reading != null ? fmtNum(+r.current_reading, 2) : '—'}</td>
                      <td className="px-1 py-1 text-right font-mono-num text-muted-foreground">{delta != null ? fmtNum(delta, 2) : '—'}</td>
                      {well.has_power_meter && (
                        <td className="px-1 py-1 text-right font-mono-num text-warn">
                          {r.power_meter_reading != null ? fmtNum(+r.power_meter_reading, 2) : '—'}
                        </td>
                      )}
                      <td className="px-1 py-1 text-right font-mono-num">{r.tds_ppm != null ? fmtNum(+r.tds_ppm, 2) : '—'}</td>
                      <td className="px-1 py-1 text-right font-mono-num">{r.pressure_psi != null ? fmtNum(+r.pressure_psi, 2) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {replaceOpen && (
        <ReplaceMeterDialog kind="well" assetId={wellId} plantId={well.plant_id} oldSerial={well.meter_serial}
          onClose={() => {
            setReplaceOpen(false);
            qc.invalidateQueries({ queryKey: ['well', wellId] });
            qc.invalidateQueries({ queryKey: ['well-latest-replacement', wellId] });
          }}
        />
      )}
      {editHydraulicOpen && (
        <EditHydraulicDialog well={well} latest={latest} onClose={() => {
          setEditHydraulicOpen(false);
          qc.invalidateQueries({ queryKey: ['well-pms', wellId] });
          qc.invalidateQueries({ queryKey: ['well', wellId] });
        }} />
      )}
      {editElectricOpen && (
        <EditElectricMeterDialog well={well} onClose={() => {
          setEditElectricOpen(false);
          qc.invalidateQueries({ queryKey: ['well', wellId] });
          qc.invalidateQueries({ queryKey: ['wells', well.plant_id] });
        }} />
      )}
    </div>
  );
}
