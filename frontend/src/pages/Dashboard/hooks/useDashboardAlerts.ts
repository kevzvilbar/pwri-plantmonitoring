import { useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { fmtNum, ALERTS } from '@/lib/calculations';
import {
  evaluateROMeterSpike, evaluatePhaseImbalance, evaluatePhaseLoss, dpPsi, type ROMeterKind,
} from '@/lib/roReadingGuards';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import type { PlantAlert, PlantAlertSeverity } from '@/store/alertStore';
import { useReadingGaps, type ReadingGap, gapDescription } from '@/hooks/useReadingGaps';
import { useTrainHourlyGaps, type TrainHourlyGap } from '@/hooks/useTrainHourlyGaps';
import { useTrainAutoOffline, type TrainGap } from '@/hooks/useTrainAutoOffline';

export interface DashboardAlertsParams {
  selectedPlantId: string | null;
  addAlerts: (alerts: PlantAlert[]) => void;
  removeAlerts: (ids: string[]) => void;
  plants: { id: string; name?: string | null; code?: string | null }[] | undefined;
  plantIds: string[];
  latestRO: unknown[] | undefined;
  roAvgFlowByTrain: Map<string, Record<ROMeterKind, number | null>>;
  recentPretreatment: unknown[] | undefined;
  latestPumpReadings: unknown[] | undefined;
  powerAvgByPlant: Map<string, number>;
  prevPowerRowByPlant: Map<string, { reading_datetime: string }>;
  todayPower: unknown[];
  powerIsStale: boolean;
  nrw: number | null;
  nrwBreached: boolean;
  qualityTrainMeta2: Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>;
  // Optional overrides for testing or backward compatibility
  feedAlerts?: any[];
  trainGaps?: TrainGap[];
  wellGaps?: ReadingGap[];
  locatorGaps?: ReadingGap[];
  trainHourlyGaps?: TrainHourlyGap[];
  chemInv?: unknown[];
}

export function useDashboardAlerts({
  selectedPlantId,
  addAlerts,
  removeAlerts,
  plants,
  plantIds,
  latestRO,
  roAvgFlowByTrain,
  recentPretreatment,
  latestPumpReadings,
  powerAvgByPlant,
  prevPowerRowByPlant,
  todayPower,
  powerIsStale,
  nrw,
  nrwBreached,
  qualityTrainMeta2,
  feedAlerts: propFeedAlerts,
  trainGaps: propTrainGaps,
  wellGaps: propWellGaps,
  locatorGaps: propLocatorGaps,
  trainHourlyGaps: propTrainHourlyGaps,
  chemInv: propChemInv,
}: DashboardAlertsParams) {
  // Alert data hooks
  const internalTrainGaps = useTrainAutoOffline(plantIds);
  const { wellGaps: internalWellGaps, locatorGaps: internalLocatorGaps } = useReadingGaps(plantIds);
  const internalTrainHourlyGaps = useTrainHourlyGaps(plantIds);

  const trainGaps = propTrainGaps ?? internalTrainGaps;
  const wellGaps = propWellGaps ?? internalWellGaps;
  const locatorGaps = propLocatorGaps ?? internalLocatorGaps;
  const trainHourlyGaps = propTrainHourlyGaps ?? internalTrainHourlyGaps;

  const { data: internalChemInv } = useQuery({
    queryKey: ['dash-chem', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('chemical_inventory').select('*').in('plant_id', plantIds)).data ?? []
      : [],
    enabled: plantIds.length > 0 && !propChemInv,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
  const chemInv = propChemInv ?? internalChemInv;

  const { data: internalFeed } = useQuery<{ count: number; alerts: any[] }>({
    queryKey: ['alerts-feed', selectedPlantId],
    queryFn: async () => {
      const days = 30;
      const since = format(subDays(new Date(), Math.max(1, days)), 'yyyy-MM-dd');
      const alerts: any[] = [];

      let qDt = supabase.from('downtime_events' as any)
        .select('id, plant_id, subsystem, duration_hrs, event_date')
        .gte('event_date', since);
      if (selectedPlantId) qDt = qDt.eq('plant_id', selectedPlantId);
      const { data: dtRows, error: dtErr } = await qDt;
      if (dtErr) throw dtErr;
      const eventsByDay = new Map<string, any[]>();
      (dtRows ?? []).forEach((d: any) => {
        const day = String(d.event_date ?? '').slice(0, 10);
        if (!eventsByDay.has(day)) eventsByDay.set(day, []);
        eventsByDay.get(day)!.push(d);
      });
      eventsByDay.forEach((evs, day) => {
        const total = evs.reduce((s, e) => s + (Number(e.duration_hrs) || 0), 0);
        const longOnes = evs.filter((e) => (Number(e.duration_hrs) || 0) >= 12);
        if (longOnes.length) {
          alerts.push({
            id: `downtime-${longOnes[0].plant_id}-${day}`,
            kind: 'downtime', severity: 'high', date: day, plant_id: longOnes[0].plant_id,
            title: `Prolonged shutdown · ${longOnes[0].subsystem}`,
            detail: `${longOnes[0].duration_hrs}h`, count: longOnes.length,
          });
        } else if (evs.length >= 3 && total >= 6) {
          alerts.push({
            id: `downtime-${evs[0].plant_id}-${day}`,
            kind: 'downtime', severity: 'medium', date: day, plant_id: evs[0].plant_id,
            title: `Abnormal downtime · ${evs.length} events / ${total.toFixed(1)}h`,
            detail: 'Multiple short shutdowns.', count: evs.length,
          });
        }
      });

      const sinceBlending = format(subDays(new Date(), 2), 'yyyy-MM-dd');
      let qBe = supabase.from('blending_events')
        .select('id, plant_id, well_name, volume_m3, event_date')
        .gte('event_date', sinceBlending).order('event_date', { ascending: false }).limit(50);
      if (selectedPlantId) qBe = qBe.eq('plant_id', selectedPlantId);
      const { data: beRows, error: beErr } = await qBe;
      if (beErr) throw beErr;
      (beRows ?? []).forEach((d) => {
        alerts.push({
          id: `blending-${d.id}`,
          kind: 'blending', severity: 'info',
          date: String(d.event_date ?? '').slice(0, 10), plant_id: d.plant_id,
          title: `Blending · ${d.well_name}`,
          detail: `Injected ${d.volume_m3} m³ into product water.`,
        });
      });

      let qSnap = supabase.from('compliance_snapshots' as any)
        .select('plant_id, evaluated_at, violations')
        .order('evaluated_at', { ascending: false }).limit(20);
      if (selectedPlantId) qSnap = qSnap.eq('plant_id', selectedPlantId);
      const { data: snapRows, error: snapErr } = await qSnap;
      if (snapErr) throw snapErr;
      const seen = new Set<string>();
      (snapRows ?? []).forEach((s: any) => {
        const pid = s.plant_id ?? '';
        if (seen.has(pid)) return;
        seen.add(pid);
        for (const v of s.violations ?? []) {
          if (v.code === 'recovery_pct_under') {
            alerts.push({
              id: `recovery-${pid}`,
              kind: 'recovery', severity: v.severity ?? 'medium',
              date: String(s.evaluated_at ?? '').slice(0, 10), plant_id: pid,
              title: 'Recovery below threshold',
              detail: `Recovery ${v.value}% vs. min ${v.threshold}%`,
            });
            break;
          }
        }
      });

      const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
      alerts.sort((a, b) => {
        const r = (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9);
        if (r !== 0) return r;
        return Number(String(b.date ?? '').replace(/-/g, '') || 0) - Number(String(a.date ?? '').replace(/-/g, '') || 0);
      });
      const capped = alerts.slice(0, 80);
      return { count: capped.length, alerts: capped };
    },
    enabled: !propFeedAlerts,
    retry: false,
    staleTime: 3 * 60_000,
    refetchInterval: 3 * 60_000,
  });
  const feedAlerts = propFeedAlerts ?? internalFeed?.alerts ?? [];

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  const roMeterSpikes = useMemo(() => {
    const byTrain = new Map<string, any[]>();
    ((latestRO as any[]) ?? []).forEach((r) => {
      const key = String(r.train_id ?? 'unknown');
      if (!byTrain.has(key)) byTrain.set(key, []);
      byTrain.get(key)!.push(r);
    });
    const spikes: { row: any; kind: ROMeterKind; result: ReturnType<typeof evaluateROMeterSpike> }[] = [];
    byTrain.forEach((rows, trainId) => {
      const sorted = [...rows].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const avgRates = roAvgFlowByTrain.get(trainId);
      for (let i = 1; i < sorted.length; i++) {
        const hoursElapsed =
          (new Date(sorted[i].reading_datetime).getTime() - new Date(sorted[i - 1].reading_datetime).getTime()) / 3_600_000;
        (['feed', 'permeate', 'reject'] as ROMeterKind[]).forEach((kind) => {
          const col = `${kind}_meter_delta`;
          const result = evaluateROMeterSpike(kind, sorted[i][col], hoursElapsed, avgRates?.[kind] ?? null);
          if (result.tier === 'critical') spikes.push({ row: sorted[i], kind, result });
        });
      }
    });
    return spikes;
  }, [latestRO, roAvgFlowByTrain]);

  const pretreatmentAlerts = useMemo(() => {
    type PretreatAlert = {
      trainId: string; plantId: string; severity: PlantAlertSeverity;
      title: string; description: string; idSuffix: string;
    };
    const out: PretreatAlert[] = [];
    const byTrain = new Map<string, any[]>();
    ((recentPretreatment as any[]) ?? []).forEach((r) => {
      const key = String(r.train_id ?? 'unknown');
      if (!byTrain.has(key)) byTrain.set(key, []);
      byTrain.get(key)!.push(r);
    });
    byTrain.forEach((rows, trainId) => {
      const latest = rows[0];
      const prior = rows[1];
      const meta = qualityTrainMeta2.get(trainId);
      const plantId = latest.plant_id ?? meta?.plant_id ?? '';
      const trainLabel = meta?.train_name ?? (meta?.train_number != null ? `Train ${meta.train_number}` : 'Train');

      (latest.afm_units ?? []).forEach((u: any) => {
        const dp = u.dp_psi ?? dpPsi(u.in_psi, u.out_psi);
        if (dp != null && dp >= ALERTS.pretreatment_afm_dp_max) {
          out.push({
            trainId, plantId, severity: 'warning',
            idSuffix: `afm-dp-${trainId}-${u.unit}`,
            title: `AFM ${u.unit} DP high: ${dp} psi`,
            description: `${trainLabel} — AFM/MMF unit ${u.unit} differential pressure at ${dp} psi (limit: ${ALERTS.pretreatment_afm_dp_max} psi) — backwash likely needed`,
          });
        }
      });

      (latest.filter_housings ?? []).forEach((h: any) => {
        const dp = dpPsi(h.in_psi, h.out_psi);
        if (dp != null && dp >= ALERTS.pretreatment_filter_housing_dp_max) {
          out.push({
            trainId, plantId, severity: 'warning',
            idSuffix: `housing-dp-${trainId}-${h.unit}`,
            title: `Filter Housing ${h.unit} DP high: ${dp} psi`,
            description: `${trainLabel} — filter housing ${h.unit} differential pressure at ${dp} psi (limit: ${ALERTS.pretreatment_filter_housing_dp_max} psi) — cartridge/bag replacement likely needed`,
          });
        }
      });

      if (prior) {
        const priorByUnit = new Map<number, any>();
        (prior.booster_pumps ?? []).forEach((p: any) => { if (p.unit != null) priorByUnit.set(+p.unit, p); });
        (latest.booster_pumps ?? []).forEach((p: any) => {
          const amp = p.amperage != null ? +p.amperage : null;
          const prevAmp = priorByUnit.get(+p.unit)?.amperage ?? null;
          if (
            amp != null && prevAmp != null && prevAmp > 1 &&
            amp > prevAmp * ALERTS.pretreatment_pump_amp_spike_multiplier
          ) {
            out.push({
              trainId, plantId, severity: 'warning',
              idSuffix: `booster-amp-${trainId}-${p.unit}`,
              title: `Booster Pump ${p.unit} amperage spike: ${amp}A`,
              description: `${trainLabel} — booster pump ${p.unit} reading ${amp}A vs. ${prevAmp}A last reading — check for mis-key or pump fault`,
            });
          }
        });
      }
    });
    return out;
  }, [recentPretreatment, qualityTrainMeta2]);

  const pumpElectricalAlerts = useMemo(() => {
    type PumpAlert = {
      trainId: string; plantId: string; severity: PlantAlertSeverity;
      title: string; description: string; idSuffix: string;
    };
    const out: PumpAlert[] = [];
    ((latestPumpReadings as any[]) ?? []).forEach((r) => {
      const meta = qualityTrainMeta2.get(r.train_id);
      const plantId = r.plant_id ?? meta?.plant_id ?? '';
      const trainLabel = meta?.train_name ?? (meta?.train_number != null ? `Train ${meta.train_number}` : 'Train');
      const pumpLabel = `${r.pump_type === 'Booster' ? 'Booster' : 'HPP'} Pump ${r.pump_number}`;

      const loss = evaluatePhaseLoss(r.l1_amp, r.l2_amp, r.l3_amp);
      if (loss) {
        out.push({
          trainId: r.train_id, plantId, severity: 'critical',
          idSuffix: `pump-phase-loss-${r.id}`,
          title: `${pumpLabel}: possible phase loss`,
          description: `${trainLabel} — one or more phases reading near 0A while others are running (L1 ${r.l1_amp ?? '—'}A / L2 ${r.l2_amp ?? '—'}A / L3 ${r.l3_amp ?? '—'}A)`,
        });
      } else {
        const imbalance = evaluatePhaseImbalance(r.l1_amp, r.l2_amp, r.l3_amp);
        if (imbalance.tier !== 'ok' && imbalance.pct != null) {
          out.push({
            trainId: r.train_id, plantId,
            severity: imbalance.tier === 'critical' ? 'critical' : 'warning',
            idSuffix: `pump-imbalance-${r.id}`,
            title: `${pumpLabel} current imbalance: ${imbalance.pct.toFixed(0)}%`,
            description: `${trainLabel} — phase current imbalance ${imbalance.pct.toFixed(0)}% (L1 ${r.l1_amp ?? '—'}A / L2 ${r.l2_amp ?? '—'}A / L3 ${r.l3_amp ?? '—'}A) — check motor windings/connections`,
          });
        }
      }
    });
    return out;
  }, [latestPumpReadings, qualityTrainMeta2]);

  useEffect(() => {
    const storeAlerts: PlantAlert[] = [];
    const roLink = (pid?: string | null, trainId?: string | null) =>
      `/ro-trains?tab=pretreat-ro${pid ? `&plant=${pid}` : ''}${trainId ? `&train=${trainId}` : ''}`;

    trainGaps.forEach((g) => {
      storeAlerts.push({
        id:          `train-gap-${g.train_id}`,
        severity:    'warning',
        title:       `Train ${g.train_number} — no reading`,
        description: `No reading in ${g.hours_gap.toFixed(1)}h — auto-flagged Offline`,
        source:      'RO Trains',
        plantId:     g.plant_id,
        timestamp:   Date.now(),
        linkPath:    roLink(g.plant_id, g.train_id),
      });
    });

    trainHourlyGaps.forEach((g) => {
      const tab = g.source_table === 'ro_train_readings' ? 'ro' : 'pretreat';
      storeAlerts.push({
        id:          `train-hourly-gap-${g.train_id}-${g.source_table}-${g.gap.gapStartAt}`,
        severity:    'warning',
        title:       `Train ${g.train_number} — ${g.gap.missedHours} hr${g.gap.missedHours === 1 ? '' : 's'} missing`,
        description: `${tab === 'ro' ? 'RO Train' : 'Pre-Treatment'} reading not logged from ${format(new Date(g.gap.gapStartAt), 'HH:mm')} to ${format(new Date(new Date(g.gap.gapEndAt).getTime() - 1), 'HH:mm')} — log why`,
        source:      'RO Trains',
        plantId:     g.plant_id,
        timestamp:   Date.now(),
        linkPath:    `/ro-trains?tab=overview&plant=${g.plant_id}&train=${g.train_id}&log=1&logTab=${tab}&highlight=${encodeURIComponent(`gap:${g.gap.gapStartAt}`)}`,
      });
    });

    wellGaps.forEach((g) => {
      storeAlerts.push({
        id:          `well-gap-${g.entity_id}`,
        severity:    g.hours_gap >= 96 ? 'critical' : 'warning',
        title:       `${g.entity_name} — no reading`,
        description: gapDescription(g),
        source:      'Wells',
        plantId:     g.plant_id,
        timestamp:   Date.now(),
        linkPath:    `/operations?tab=well&highlight=${g.entity_id}`,
      });
    });

    locatorGaps.forEach((g) => {
      storeAlerts.push({
        id:          `locator-gap-${g.entity_id}`,
        severity:    g.hours_gap >= 96 ? 'critical' : 'warning',
        title:       `${g.entity_name} — no reading`,
        description: gapDescription(g),
        source:      'Locators',
        plantId:     g.plant_id,
        timestamp:   Date.now(),
        linkPath:    `/operations?tab=locator&highlight=${g.entity_id}`,
      });
    });

    if (nrwBreached && nrw != null) {
      storeAlerts.push({
        id:          'nrw-threshold',
        severity:    'critical',
        title:       `NRW Water Loss: ${nrw}%`,
        description: `Non-revenue water is above the 10% threshold — inspect for leaks or meter inaccuracies.`,
        source:      'NRW',
        plantId:     selectedPlantId ?? '',
        timestamp:   Date.now(),
      });
    } else {
      removeAlerts(['nrw-threshold']);
    }

    const latestPerTrain = new Map<string, any>();
    ((latestRO as any[]) ?? []).forEach((r) => {
      const key = String(r.train_id ?? r.train_number ?? 'unknown');
      if (!latestPerTrain.has(key)) latestPerTrain.set(key, r);
    });

    latestPerTrain.forEach((r) => {
      const pid        = r.plant_id ?? selectedPlantId ?? '';
      const trainLabel = r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : 'Train');
      const link        = roLink(pid, r.train_id);
      const dp = r.dp_psi ?? 0;
      if (dp > 40) {
        storeAlerts.push({
          id:          `dp-${r.train_id}-${r.train_number}`,
          severity:    'critical',
          title:       `DP alert: ${dp} psi`,
          description: `${trainLabel} — differential pressure above 40 psi (current: ${dp} psi)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
          linkPath:    link,
        });
      } else if (dp >= 35) {
        storeAlerts.push({
          id:          `dp-warn-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `DP approaching limit: ${dp} psi`,
          description: `${trainLabel} — differential pressure at ${dp} psi (limit: 40 psi)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
          linkPath:    link,
        });
      }
      const tds = r.permeate_tds ?? 0;
      if (tds >= 600) {
        storeAlerts.push({
          id:          `tds-${r.train_id}-${r.train_number}`,
          severity:    'critical',
          title:       `TDS alert: ${tds} ppm`,
          description: `${trainLabel} — permeate TDS exceeded 600 ppm`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
          linkPath:    link,
        });
      } else if (tds >= 500) {
        storeAlerts.push({
          id:          `tds-warn-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `TDS approaching limit: ${tds} ppm`,
          description: `${trainLabel} — permeate TDS at ${tds} ppm (limit: 600 ppm)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
          linkPath:    link,
        });
      }
      if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) {
        storeAlerts.push({
          id:          `ph-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `pH out of range: ${r.permeate_ph}`,
          description: `${trainLabel} — pH outside 6.5–8.5 safe range`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
          linkPath:    link,
        });
      }
      if (r.recovery_pct != null && r.recovery_pct < 70) {
        storeAlerts.push({
          id:          `recovery-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `Low recovery: ${r.recovery_pct.toFixed(1)}%`,
          description: `${trainLabel} — recovery rate below 70% (current: ${r.recovery_pct.toFixed(1)}%)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
          linkPath:    link,
        });
      }
    });

    ((chemInv as any[]) ?? []).forEach((c) => {
      if ((c.current_stock ?? 0) < (c.low_stock_threshold ?? 0)) {
        storeAlerts.push({
          id:          `stock-${c.id}`,
          severity:    'warning',
          title:       `Low stock: ${c.chemical_name}`,
          description: `Current: ${c.current_stock} ${c.unit ?? ''} — below threshold ${c.low_stock_threshold}`,
          source:      'Chemical Inventory',
          plantId:     c.plant_id ?? selectedPlantId ?? '',
          timestamp:   Date.now(),
          linkPath:    '/chemicals',
        });
      }
    });

    feedAlerts.forEach((a: any, i: number) => {
      storeAlerts.push({
        id:          a.id ?? `feed-${a.kind ?? 'alert'}-${i}-${a.title}`,
        severity:    a.severity === 'high' ? 'critical' : a.severity === 'medium' ? 'warning' : 'info',
        title:       a.title ?? 'Alert',
        description: a.detail ?? '',
        source:      a.kind === 'downtime' ? 'Downtime' : a.kind === 'blending' ? 'Blending' : 'Recovery',
        plantId:     a.plant_id ?? selectedPlantId ?? '',
        timestamp:   a.date ? new Date(a.date).getTime() : Date.now(),
        linkPath:    a.kind === 'blending' ? '/operations?tab=blending' : roLink(a.plant_id ?? selectedPlantId),
      });
    });

    pretreatmentAlerts.forEach((a) => {
      storeAlerts.push({
        id:          a.idSuffix,
        severity:    a.severity,
        title:       a.title,
        description: a.description,
        source:      'Pre-Treatment',
        plantId:     a.plantId || selectedPlantId || '',
        timestamp:   Date.now(),
        linkPath:    roLink(a.plantId, a.trainId),
      });
    });

    pumpElectricalAlerts.forEach((a) => {
      storeAlerts.push({
        id:          a.idSuffix,
        severity:    a.severity,
        title:       a.title,
        description: a.description,
        source:      'Booster Pumps',
        plantId:     a.plantId || selectedPlantId || '',
        timestamp:   Date.now(),
        linkPath:    roLink(a.plantId, a.trainId),
      });
    });

    (powerIsStale ? [] : ((todayPower as any[]) ?? [])).forEach((r) => {
      const pid = r.plant_id ?? selectedPlantId ?? '';
      const todayKwh = Number(r.daily_consumption_kwh);
      const avgRate = powerAvgByPlant.get(pid) ?? null;
      const prevRow = prevPowerRowByPlant.get(pid);
      const hoursElapsed = prevRow && r.reading_datetime
        ? (new Date(r.reading_datetime).getTime() - new Date(prevRow.reading_datetime).getTime()) / 3_600_000
        : null;
      const rate = computeRate(Number.isFinite(todayKwh) ? todayKwh : null, hoursElapsed);
      const result = classifyDeviation(rate, avgRate, ALERTS.power_spike_multiplier);
      if (result.tier === 'critical') {
        storeAlerts.push({
          id:          `power-spike-${pid}-${r.reading_datetime}`,
          severity:    'warning',
          title:       `Power spike: ${fmtNum(todayKwh, 0)} kWh`,
          description: `${plantNameById.get(pid) ?? 'Plant'} — consumption rate ${result.rate!.toFixed(1)} kWh/hr is ${result.deviationPct}% above the 14-day average (${result.avgRate!.toFixed(1)} kWh/hr)`,
          source:      'Power',
          plantId:     pid,
          timestamp:   Date.now(),
          linkPath:    '/operations?tab=power',
        });
      }
    });

    roMeterSpikes.forEach(({ row, kind, result }) => {
      const pid = row.plant_id ?? selectedPlantId ?? '';
      const trainLabel = row.train_name ?? (row.train_number != null ? `Train ${row.train_number}` : 'Train');
      storeAlerts.push({
        id:          `ro-meter-spike-${kind}-${row.id ?? row.train_id}-${row.reading_datetime}`,
        severity:    'critical',
        title:       `${result.label} meter reading error`,
        description: `${trainLabel} — ${result.detail}`,
        source:      'RO Trains',
        plantId:     pid,
        timestamp:   Date.now(),
        linkPath:    roLink(pid, row.train_id),
      });
    });

    if (storeAlerts.length > 0) {
      const dedupedMap = new Map<string, PlantAlert>();
      storeAlerts.forEach((a) => dedupedMap.set(a.id, a));
      addAlerts(Array.from(dedupedMap.values()));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainGaps, wellGaps, locatorGaps, trainHourlyGaps, latestRO, chemInv, feedAlerts, selectedPlantId, nrw, nrwBreached,
      pretreatmentAlerts, pumpElectricalAlerts, roMeterSpikes, todayPower, powerIsStale, powerAvgByPlant, plantNameById]);

  return { plantNameById, roMeterSpikes, pretreatmentAlerts, pumpElectricalAlerts };
}

