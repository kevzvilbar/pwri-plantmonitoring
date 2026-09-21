/**
 * "My correction requests": P5-6 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * An operator can ask a supervisor to fix a reading (the "Fix" button on an
 * entry older than two hours). Until now the only trace was a notification,
 * and Data Corrections, where the requests are reviewed, is closed to
 * Operators. This is the operator's side of that loop: what I asked for, what
 * happened, and why.
 *
 * Pure and React-free on purpose, like shared/plantVisibility.ts. The fetching
 * lives in data/queries/myCorrections.ts, the screen in
 * features/readings/pages/MyCorrectionsPage.tsx.
 */
import { fmtNum, tableLabel, type SourceTable } from '@/features/readings/dataCorrections/types';

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'unknown';

/** The columns this screen reads from `correction_requests`. */
export interface CorrectionRequestRow {
  id: string;
  source_table: string;
  source_id: string;
  plant_id: string;
  original_value: number;
  proposed_value: number;
  reason: string;
  note: string | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

/** Everything looked up around the rows. Any part may be empty (a lookup can
 *  fail, or RLS can hide a name) and the screen must still work. */
export interface RequestContext {
  /** Keyed by `refKey(source_table, source_id)`: the reading a request is about. */
  readings: Readonly<Record<string, { entityId: string | null; readingAt: string | null }>>;
  /** Keyed by `refKey(source_table, entityId)`: the well / locator / meter / train name. */
  entityNames: Readonly<Record<string, string>>;
  plantNames: Readonly<Record<string, string>>;
  userNames: Readonly<Record<string, string>>;
}

export const EMPTY_CONTEXT: RequestContext = { readings: {}, entityNames: {}, plantNames: {}, userNames: {} };

export interface MyCorrectionRequest {
  id: string;
  status: RequestStatus;
  /** What the database holds, for anything unrecognised. */
  rawStatus: string;
  /** e.g. "Well 3", or "Well reading" when the well cannot be looked up. */
  title: string;
  /** e.g. "Well · North Plant". */
  subtitle: string;
  readingAt: string | null;
  originalValue: number;
  proposedValue: number;
  reason: string;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
}

/** How many of a user's requests the screen loads, newest first. */
export const MY_CORRECTIONS_LIMIT = 100;

export const refKey = (table: string, id: string): string => `${table}:${id}`;

const KNOWN: readonly RequestStatus[] = ['pending', 'approved', 'rejected', 'withdrawn'];

/** The database constrains `status` to four values, but a screen must not
 *  break, or mislabel a request, if that list ever grows. */
export function normalizeStatus(raw: string | null | undefined): RequestStatus {
  const s = (raw ?? '').trim().toLowerCase();
  return (KNOWN as readonly string[]).includes(s) ? (s as RequestStatus) : 'unknown';
}

export interface StatusMeta {
  label: string;
  /** A StatusPill tone. */
  tone: 'warn' | 'good' | 'danger' | 'muted';
  hint: string;
}

// The hints say only what is certain from the request row. Whether a rejected
// request leaves the reading flagged is decided in the review screen, not here.
export function statusMeta(status: RequestStatus): StatusMeta {
  switch (status) {
    case 'pending':
      return { label: 'Pending', tone: 'warn', hint: 'Waiting for a supervisor to review it.' };
    case 'approved':
      return { label: 'Approved', tone: 'good', hint: 'A supervisor approved this correction.' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger', hint: 'A supervisor did not approve this correction.' };
    case 'withdrawn':
      return { label: 'Withdrawn', tone: 'muted', hint: 'This request was withdrawn.' };
    default:
      return { label: 'Unknown', tone: 'muted', hint: 'The status of this request is not recognised.' };
  }
}

export const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type StatusCounts = Record<StatusFilter | 'withdrawn' | 'unknown', number>;

export function countByStatus(requests: readonly Pick<MyCorrectionRequest, 'status'>[]): StatusCounts {
  const counts: StatusCounts = { all: requests.length, pending: 0, approved: 0, rejected: 0, withdrawn: 0, unknown: 0 };
  for (const r of requests) counts[r.status] += 1;
  return counts;
}

export function filterByStatus<T extends Pick<MyCorrectionRequest, 'status'>>(
  requests: readonly T[],
  filter: StatusFilter,
): T[] {
  return filter === 'all' ? [...requests] : requests.filter((r) => r.status === filter);
}

export interface ChangeSummary {
  from: string;
  to: string;
  /** Signed, e.g. "+9.00" or "-9.00". */
  delta: string;
  direction: 'up' | 'down' | 'same';
}

export function describeChange(original: number, proposed: number): ChangeSummary {
  const diff = proposed - original;
  // Guard against float noise turning 0.1 + 0.2 - 0.3 into "+0.00".
  const rounded = Math.round(diff * 100) / 100;
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'same';
  const sign = direction === 'up' ? '+' : direction === 'down' ? '-' : '';
  return {
    from: fmtNum(original),
    to: fmtNum(proposed),
    delta: `${sign}${fmtNum(Math.abs(rounded))}`,
    direction,
  };
}

const knownLabel = (table: string): string | undefined => tableLabel[table as SourceTable];

/** One database row plus whatever could be looked up around it. */
export function buildMyRequest(row: CorrectionRequestRow, ctx: RequestContext = EMPTY_CONTEXT): MyCorrectionRequest {
  const reading = ctx.readings[refKey(row.source_table, row.source_id)];
  const entityName = reading?.entityId ? ctx.entityNames[refKey(row.source_table, reading.entityId)] : undefined;
  const plantName = ctx.plantNames[row.plant_id];
  const known = knownLabel(row.source_table);
  const kind = known ?? 'Reading';

  return {
    id: row.id,
    status: normalizeStatus(row.status),
    rawStatus: row.status,
    // "Well reading", but never "Reading reading" for a table this screen does not know.
    title: entityName ?? (known ? `${known} reading` : 'Reading'),
    subtitle: plantName ? `${kind} · ${plantName}` : kind,
    readingAt: reading?.readingAt ?? null,
    originalValue: Number(row.original_value),
    proposedValue: Number(row.proposed_value),
    reason: row.reason,
    note: row.note?.trim() ? row.note.trim() : null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by ? ctx.userNames[row.resolved_by] ?? null : null,
    resolutionNote: row.resolution_note?.trim() ? row.resolution_note.trim() : null,
  };
}
