// Split out of Dashboard.tsx (was 2,204 lines) as part of a file-size
// cleanup pass. This module pushes the dashboard's live alerts into the
// TopBar notification bell (NRW breach, feed alerts, RO train gaps, low
// chemical inventory, RO meter spikes, pretreatment issues, pump
// electrical issues) and computes the RO-meter/pretreatment/pump alert
// lists themselves.
//
// Moved verbatim from Dashboard.tsx — no logic changes.
import { useMemo, useEffect } from 'react';
import { fmtNum, ALERTS } from '@/lib/calculations';
import {
  evaluateROMeterSpike, evaluatePhaseImbalance, evaluatePhaseLoss, dpPsi, type ROMeterKind,
} from '@/lib/roReadingGuards';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import type { PlantAlert, PlantAlertSeverity } from '@/store/appStore';

export function useDashboardAlerts(p: Record<string, any>) {
  const {
    selectedPlantId, addAlerts, removeAlerts, plants, plantIds,
    latestRO, roAvgFlowByTrain, recentPretreatment, latestPumpReadings,
    powerAvgByPlant, prevPowerRowByPlant, todayPower, powerIsStale,
    nrw, nrwBreached, feedAlerts, trainGaps, chemInv, consumption, _qualityTrainMeta2,
  } = p;
  // ── Push all live alerts into the TopBar notification bell ─────────────────
  // Converts trainGap / RO quality / low-stock / feed alerts into PlantAlert
  // objects and upserts them into the global Zustand store.  TopBar reads the
  // store and shows each alert in the bell dropdown with the plant name
  // prefixed — visible to multi-plant users so they know which site fired.
  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p: any) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  // ── RO meter (feed/permeate/reject) spike detection ─────────────────────────
  // latestRO holds every reading in the past 24h (not deduped to one-per-train
  // like latestPerTrain below), so each train's rows can be sorted
  // chronologically and each one compared to its own immediately-prior
  // reading — same "vs last time" shape as PretreatmentAndROLog.tsx's
  // permHighWarn, just applied to rows already sitting in the DB (including
  // ones written before this guard existed, or written via CSV import which
  // has no client-side guard at all).
  // Ported to flow-rate comparison 2026-08-07 — see roReadingGuards.ts header
  // for why comparing raw deltas directly (even "vs. the immediately-prior
  // reading", which this used to do) breaks whenever the elapsed time
  // between two readings differs, e.g. a normal reading after a skipped
  // check-in interval. Rows are still walked chronologically per train, but
  // each one is now compared to its own rolling 10-day average flow rate
  // (roAvgFlowByTrain, computed above) with elapsed hours factored in, not
  // to the single immediately-prior reading.
  const roMeterSpikes = useMemo(() => {
    const byTrain = new Map<string, any[]>();
    (latestRO ?? []).forEach((r: any) => {
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
          // Dashboard's alert bell mirrors the same 'critical' bar
          // PretreatmentAndROLog.tsx auto-quarantines on — the broader
          // ±50% 'needs_remark' band doesn't need a bell alert here, since
          // any row that reached that tier at save time already required
          // (and got) an operator remark before it could be saved at all.
          if (result.tier === 'critical') spikes.push({ row: sorted[i], kind, result });
        });
      }
    });
    return spikes;
  }, [latestRO, roAvgFlowByTrain]);

  // ── Pre-treatment: latest reading per train + booster amperage vs prior ────
  const pretreatmentAlerts = useMemo(() => {
    type PretreatAlert = {
      trainId: string; plantId: string; severity: PlantAlertSeverity;
      title: string; description: string; idSuffix: string;
    };
    const out: PretreatAlert[] = [];
    const byTrain = new Map<string, any[]>();
    (recentPretreatment ?? []).forEach((r: any) => {
      const key = String(r.train_id ?? 'unknown');
      if (!byTrain.has(key)) byTrain.set(key, []);
      byTrain.get(key)!.push(r); // already DESC-ordered by the query
    });
    byTrain.forEach((rows, trainId) => {
      const latest = rows[0];
      const prior = rows[1];
      const meta = _qualityTrainMeta2.get(trainId);
      const plantId = latest.plant_id ?? meta?.plant_id ?? '';
      const trainLabel = meta?.train_name ?? (meta?.train_number != null ? `Train ${meta.train_number}` : 'Train');

      // AFM/MMF differential pressure
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

      // Filter housing differential pressure
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

      // Booster pump amperage — spike vs. this same unit's prior reading
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
  }, [recentPretreatment, _qualityTrainMeta2]);

  // ── Pump readings: phase imbalance / phase loss ──────────────────────────────
  const pumpElectricalAlerts = useMemo(() => {
    type PumpAlert = {
      trainId: string; plantId: string; severity: PlantAlertSeverity;
      title: string; description: string; idSuffix: string;
    };
    const out: PumpAlert[] = [];
    (latestPumpReadings ?? []).forEach((r: any) => {
      const meta = _qualityTrainMeta2.get(r.train_id);
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
  }, [latestPumpReadings, _qualityTrainMeta2]);

  useEffect(() => {
    const storeAlerts: PlantAlert[] = [];
    // Deep-links straight to the flagged train's entry form — see the
    // ?plant=&train= handling added to ROTrains/index.tsx (tab) and
    // PretreatmentAndROLog.tsx (plant/train pre-select).
    const roLink = (pid?: string | null, trainId?: string | null) =>
      `/ro-trains?tab=pretreat-ro${pid ? `&plant=${pid}` : ''}${trainId ? `&train=${trainId}` : ''}`;

    // Train gap warnings — plant_id comes from TrainGap directly
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

    // NRW threshold alert — fired when today's NRW exceeds the 10% limit
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
      // NRW is back within range — clear any previous NRW alert automatically
      removeAlerts(['nrw-threshold']);
    }

    // RO quality threshold alerts — latestRO returns ALL readings in the past
    // 24 h (ordered DESC), so we must first collapse to ONE row per train_id
    // (the most-recent reading) before generating alerts. Without this step
    // every historical reading for a train would produce its own duplicate alert.
    const latestPerTrain = new Map<string, any>();
    (latestRO ?? []).forEach((r: any) => {
      const key = String(r.train_id ?? r.train_number ?? 'unknown');
      if (!latestPerTrain.has(key)) latestPerTrain.set(key, r); // first = most recent (query ordered DESC)
    });

    // DP: critical if > 40 psi, warning if 35–40 psi (approaching limit)
    // TDS: critical if >= 600 ppm, warning if 500–599 ppm
    // Recovery: warning if < 70%
    latestPerTrain.forEach((r: any) => {
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

    // Low chemical stock
    (chemInv ?? []).forEach((c: any) => {
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

    // Backend feed alerts (downtime / blending / recovery)
    // Uses the stable id set on each alert above (real blending_events row
    // id / plant+day key) rather than array position — position shifts
    // between refetches (ties on date have no defined order, and rows age
    // in/out of the 30-day window), which used to make a dismissed or
    // snoozed card come back as if it were new. Falls back to the old
    // index-based scheme only as a defensive no-op for any alert shape that
    // somehow skips the id above.
    feedAlerts.forEach((a: any, i: number) => {
      storeAlerts.push({
        id:          a.id ?? `feed-${a.kind ?? 'alert'}-${i}-${a.title}`,
        severity:    a.severity === 'high' ? 'critical' : a.severity === 'medium' ? 'warning' : 'info',
        title:       a.title ?? 'Alert',
        description: a.detail ?? '',
        source:      a.kind === 'downtime' ? 'Downtime' : a.kind === 'blending' ? 'Blending' : 'Recovery',
        plantId:     a.plant_id ?? selectedPlantId ?? '',
        timestamp:   a.date ? new Date(a.date).getTime() : Date.now(),
        // Backend feed doesn't expose a train_id, so this is page-level only.
        linkPath:    a.kind === 'blending' ? '/operations?tab=blending' : roLink(a.plant_id ?? selectedPlantId),
      });
    });

    // Pre-treatment: AFM/MMF + filter housing DP, booster pump amperage spikes
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

    // Booster/HPP pump electrical — phase imbalance / possible phase loss
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

    // Power consumption — spike vs. this plant's own 14-day rolling average
    // RATE (kWh/hr), not the raw daily total. Deliberately relative (see
    // ALERTS.power_spike_multiplier comment) — no absolute kWh ceiling is
    // used since plant sizes vary widely.
    // Skipped when todayPowerRaw fell back to a stale/prior-day reading
    // (powerIsStale) — that's not actually today's consumption, so comparing
    // it to the rolling average would mislabel old data as "today's spike".
    (powerIsStale ? [] : (todayPower ?? [])).forEach((r: any) => {
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

    // RO train meter (feed/permeate/reject) spikes — e.g. a mis-keyed
    // cumulative meter reading producing a delta orders of magnitude above
    // the train's normal flow. Root-cause example this catches: permeate
    // meter jumping from ~660,977 to 2,153,677 in one entry (a 1,493,203 m3
    // delta / 409,096.71 m3/h implied flow rate) with nothing elsewhere in
    // the app rejecting or flagging it.
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

    // Deduplicate storeAlerts by ID — keep last write (most severe value wins
    // if the same key was pushed more than once by different code paths).
    if (storeAlerts.length > 0) {
      const dedupedMap = new Map<string, PlantAlert>();
      storeAlerts.forEach((a) => dedupedMap.set(a.id, a));
      addAlerts(Array.from(dedupedMap.values()));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainGaps, latestRO, chemInv, feedAlerts, selectedPlantId, nrw, nrwBreached,
      pretreatmentAlerts, pumpElectricalAlerts, roMeterSpikes, todayPower, powerIsStale, powerAvgByPlant, plantNameById]);

  return { plantNameById, roMeterSpikes, pretreatmentAlerts, pumpElectricalAlerts };
}
