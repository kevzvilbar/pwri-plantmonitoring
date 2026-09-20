import type { PlantAlert } from '@/store/alertStore';

/** P3-3: "Acknowledged by X · 14:02" / "Resolved by X · 14:02". Names resolve
 *  via the map (user id → display name); unknown ids fall back to a short id.
 *  Returns null for active alerts (no line rendered). Snoozed alerts keep no
 *  actor, so they render no line either — the snooze copy lives in the menu. */
export function alertStatusLine(
  alert: PlantAlert,
  nameById: Map<string, string> | Record<string, string>,
): string | null {
  const nameOf = (id?: string) => {
    if (!id) return 'Unknown';
    const name = nameById instanceof Map ? nameById.get(id) : nameById[id];
    return name ?? `${id.slice(0, 8)}…`;
  };
  const fmtTime = (ts?: number) => {
    if (ts == null) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };
  if (alert.resolvedAt != null) {
    return `Resolved by ${nameOf(alert.resolvedBy)} · ${fmtTime(alert.resolvedAt)}`;
  }
  if (alert.acknowledgedAt != null) {
    return `Acknowledged by ${nameOf(alert.acknowledgedBy)} · ${fmtTime(alert.acknowledgedAt)}`;
  }
  return null;
}
