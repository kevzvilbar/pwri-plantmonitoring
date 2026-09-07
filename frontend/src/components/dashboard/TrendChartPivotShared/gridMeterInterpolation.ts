export function interpolateMissingGridMeterReadings<T extends { plant_id?: string | null; reading_datetime: string; grid_meter_readings?: Record<string, number> | null; meter_reading_kwh?: number | null; is_estimated?: boolean | null }>(
  sortedAscReadings: T[],
): T[] {
  if (!sortedAscReadings || sortedAscReadings.length === 0) return sortedAscReadings;
  if (!sortedAscReadings.some(r => r.is_estimated)) return sortedAscReadings;

  const byPlant = new Map<string, { row: T; index: number }[]>();
  sortedAscReadings.forEach((r, index) => {
    const pid = r.plant_id ?? '__';
    if (!byPlant.has(pid)) byPlant.set(pid, []);
    byPlant.get(pid)!.push({ row: r, index });
  });

  const result = [...sortedAscReadings];

  for (const plantEntries of byPlant.values()) {
    const meterIndices = new Set<number>();
    for (const { row } of plantEntries) {
      if (row.grid_meter_readings) {
        for (const k of Object.keys(row.grid_meter_readings)) {
          const mi = parseInt(k, 10);
          if (Number.isFinite(mi)) meterIndices.add(mi);
        }
      }
      if (row.meter_reading_kwh != null) meterIndices.add(0);
    }

    for (let i = 0; i < plantEntries.length; i++) {
      const { row: r, index: globalIdx } = plantEntries[i];
      if (!r.is_estimated) continue;

      const rowTime = new Date(r.reading_datetime).getTime();
      if (isNaN(rowTime)) continue;

      let gmrCopy: Record<string, number> | null = r.grid_meter_readings ? { ...r.grid_meter_readings } : null;

      if (r.meter_reading_kwh != null && Number.isFinite(+r.meter_reading_kwh)) {
        if (!gmrCopy) gmrCopy = {};
        if (gmrCopy['0'] == null) gmrCopy['0'] = Number(r.meter_reading_kwh);
      }

      for (const mi of meterIndices) {
        const direct = gmrCopy?.[String(mi)] ?? (mi === 0 ? r.meter_reading_kwh : null);
        if (direct != null && Number.isFinite(+direct)) {
          if (mi === 0 && gmrCopy && gmrCopy['0'] == null) gmrCopy['0'] = Number(direct);
          continue;
        }

        let earlierVal: number | null = null;
        let earlierTime: number | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const prevR = plantEntries[j].row;
          const v = prevR.grid_meter_readings?.[String(mi)] ?? (mi === 0 ? prevR.meter_reading_kwh : null);
          if (v != null && Number.isFinite(+v)) {
            earlierVal = Number(v);
            earlierTime = new Date(prevR.reading_datetime).getTime();
            break;
          }
        }

        let laterVal: number | null = null;
        let laterTime: number | null = null;
        for (let j = i + 1; j < plantEntries.length; j++) {
          const nextR = plantEntries[j].row;
          const v = nextR.grid_meter_readings?.[String(mi)] ?? (mi === 0 ? nextR.meter_reading_kwh : null);
          if (v != null && Number.isFinite(+v)) {
            laterVal = Number(v);
            laterTime = new Date(nextR.reading_datetime).getTime();
            break;
          }
        }

        if (
          earlierVal != null &&
          laterVal != null &&
          earlierTime != null &&
          laterTime != null &&
          laterTime > earlierTime
        ) {
          const fraction = (rowTime - earlierTime) / (laterTime - earlierTime);
          const estVal = Math.round((earlierVal + (laterVal - earlierVal) * fraction) * 10) / 10;
          if (!gmrCopy) gmrCopy = {};
          gmrCopy[String(mi)] = estVal;
        }
      }

      if (gmrCopy) {
        result[globalIdx] = {
          ...r,
          grid_meter_readings: gmrCopy,
          meter_reading_kwh: r.meter_reading_kwh ?? gmrCopy['0'] ?? null,
        };
      }
    }
  }

  return result;
}
