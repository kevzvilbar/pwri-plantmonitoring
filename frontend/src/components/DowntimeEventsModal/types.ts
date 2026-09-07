export type DowntimeEvent = {
  id?: string;
  event_date: string;
  subsystem: string;
  duration_hrs: number;
  cause?: string;
  raw_text?: string;
  plant_id?: string;
  plant_name?: string;
  source_type?: 'granular_event' | 'daily_summary';
  created_at?: string;
};

export type DowntimeResponse = {
  count: number;
  total_duration_hrs: number;
  by_subsystem: { subsystem: string; hours: number }[];
  events: DowntimeEvent[];
};

export const SUBSYSTEM_OPTIONS = [
  { value: 'RO Trains', label: 'RO Trains / Desalination' },
  { value: 'Well Pumps', label: 'Deep Wells / Submersible Pumps' },
  { value: 'Pretreatment', label: 'Pre-treatment / Media & Cartridge Filters' },
  { value: 'Power & Grid', label: 'Power Grid / Solar / Generator Outage' },
  { value: 'Meters & Distribution', label: 'Meters / Transmission & Distribution' },
  { value: 'CIP & Maintenance', label: 'CIP Cleaning & Scheduled Servicing' },
  { value: 'General Plant', label: 'General / Plant-wide Disruption' },
] as const;

export function rollup(events: DowntimeEvent[]): { subsystem: string; hours: number }[] {
  const bySub = new Map<string, number>();
  for (const e of events) {
    const key = e.subsystem || 'General';
    bySub.set(key, (bySub.get(key) ?? 0) + (e.duration_hrs || 0));
  }
  return [...bySub.entries()]
    .map(([subsystem, hours]) => ({ subsystem, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}
