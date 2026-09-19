import React from 'react';
import { ReactNode } from 'react';
import { Crown, Briefcase, Cog, UserCircle, BarChart2 } from 'lucide-react';

export type ChatMsg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  sent_at: string;
  expires_at: string;
};

export type StaffMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  suffix: string | null;
  username: string | null;
  designation: string | null;
  plant_assignments: string[];
  status: string;
  updated_at: string;
  last_seen_at: string | null;
  immediate_head_id: string | null;
};

// Reading record (for KPI)
export type ReadingRecord = {
  plant_id: string;
  reading_datetime: string;
  recorded_by: string | null;
};

// Checklist execution (for KPI)
export type ChecklistExecution = {
  template_id: string;
  execution_date: string;
  completed: boolean;
};

// ---------------------------------------------------------------------------
// Minimal interface for the online-ids lookup — accepts both Set<string> and
// the { has } adapter returned by the usePresence hook.
export type OnlineIds = { has: (id: string) => boolean };

// Presence helpers
// ---------------------------------------------------------------------------

export type PresenceState = 'active' | 'idle' | 'away' | 'offline';

export function getPresence(lastSeenAt: string | null, accountStatus: string, isOnline = false): PresenceState {
  if (accountStatus === 'Suspended' || accountStatus === 'Pending') return 'offline';
  if (isOnline) return 'active';
  if (!lastSeenAt) return 'offline';
  const diffMin = (Date.now() - new Date(lastSeenAt).getTime()) / 60_000;
  if (diffMin < 15)  return 'active';
  if (diffMin < 60)  return 'idle';
  if (diffMin < 480) return 'away';
  return 'offline';
}

export const presenceConfig: Record<PresenceState, { label: string; dot: string; badge: string }> = {
  active:  { label: 'Active',  dot: 'bg-accent', badge: 'bg-accent-soft text-accent border-accent' },
  idle:    { label: 'Idle',    dot: 'bg-warn',   badge: 'bg-warn-soft text-warn border-warn' },
  away:    { label: 'Away',    dot: 'bg-kpi-solar',  badge: 'bg-kpi-solar/15 text-kpi-solar border-kpi-solar' },
  offline: { label: 'Offline', dot: 'bg-muted-foreground/40',    badge: 'bg-muted text-muted-foreground border-border' },
};

// ---------------------------------------------------------------------------
export const AVATAR_COLORS = [
  'bg-primary',
  'bg-accent',
  'bg-info',
  'bg-highlight',
  'bg-warn',
  'bg-kpi-ro',
  'bg-kpi-wells',
  'bg-kpi-power',
];

export const PLANT_COLUMN_ACCENTS = [
  { header: 'from-info to-info',      border: 'border-info',   bg: 'bg-info-soft',    text: 'text-info',    line: 'hsl(var(--org-line-1))' },
  { header: 'from-primary to-primary',    border: 'border-primary',  bg: 'bg-primary-soft',   text: 'text-primary',   line: 'hsl(var(--org-line-2))' },
  { header: 'from-highlight to-highlight',    border: 'border-highlight',  bg: 'bg-highlight-soft',   text: 'text-highlight',   line: 'hsl(var(--org-line-3))' },
  { header: 'from-info to-primary',     border: 'border-info',   bg: 'bg-info-soft',   text: 'text-info',    line: 'hsl(var(--org-line-4))' },
  { header: 'from-primary to-highlight',    border: 'border-primary',  bg: 'bg-primary-soft',  text: 'text-primary',   line: 'hsl(var(--org-line-5))' },
  { header: 'from-highlight to-info',     border: 'border-highlight',  bg: 'bg-highlight-soft',  text: 'text-highlight',   line: 'hsl(var(--org-line-6))' },
];

export const DEPTH_SHADES = [
  'bg-card',
  'bg-info-soft/80',
  'bg-info-soft/70',
  'bg-primary-soft/80',
  'bg-primary-soft/70',
  'bg-highlight-soft/80',
];

// Same 6-color set as PLANT_COLUMN_ACCENTS.line above — both read from the
// --org-line-* tokens instead of maintaining two independent hardcoded copies.
export const CONNECTOR_COLORS = [
  'hsl(var(--org-line-1))', 'hsl(var(--org-line-2))', 'hsl(var(--org-line-3))',
  'hsl(var(--org-line-4))', 'hsl(var(--org-line-5))', 'hsl(var(--org-line-6))',
];

export function hashId(id: string) {
  return id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

export function avatarColor(id: string)  { return AVATAR_COLORS[hashId(id) % AVATAR_COLORS.length]; }

export function initials(s: StaffMember) {
  const f = s.first_name?.[0] ?? '';
  const l = s.last_name?.[0] ?? '';
  return (f + l).toUpperCase() || (s.username?.[0] ?? '?').toUpperCase();
}

export function fullName(s: StaffMember) {
  return [s.first_name, s.middle_name ? s.middle_name[0] + '.' : null, s.last_name, s.suffix]
    .filter(Boolean).join(' ') || s.username || 'Unknown';
}

// ---------------------------------------------------------------------------
// Role hierarchy config
// ---------------------------------------------------------------------------

export const ROLE_HIERARCHY: { role: string; level: number; icon: ReactNode; color: string; bg: string }[] = [
  { role: 'Admin',         level: 0, icon: React.createElement(Crown, { className: "h-3 w-3" }),        color: 'text-danger',    bg: 'bg-danger-soft border-danger' },
  { role: 'Manager',       level: 1, icon: React.createElement(Briefcase, { className: "h-3 w-3" }),    color: 'text-info',     bg: 'bg-info-soft border-info' },
  { role: 'Data Analyst',  level: 2, icon: React.createElement(BarChart2, { className: "h-3 w-3" }),    color: 'text-kpi-ro',  bg: 'bg-kpi-ro/15 border-kpi-ro' },
  { role: 'Technician',    level: 3, icon: React.createElement(Cog, { className: "h-3 w-3" }),          color: 'text-primary',    bg: 'bg-primary-soft border-primary' },
  { role: 'Operator',      level: 4, icon: React.createElement(UserCircle, { className: "h-3 w-3" }),   color: 'text-muted-foreground',    bg: 'bg-muted border-border' },
];

export function getRoleConfig(role: string) {
  return ROLE_HIERARCHY.find((r) => r.role === role) ?? ROLE_HIERARCHY[4];
}

// ---------------------------------------------------------------------------
