export interface AuditEntry {
  id: string;
  kind: 'user' | 'plant';
  entity_id: string;
  entity_label: string | null;
  action: 'soft' | 'hard';
  actor_user_id: string | null;
  actor_label: string | null;
  reason: string | null;
  dependencies: Record<string, unknown> | null;
  created_at: string;
}

export interface LoginAttempt {
  id: string;
  email: string;
  user_id: string | null;
  username: string | null;
  plant_id: string | null;
  success: boolean;
  error_reason: string | null;
  device_id: string | null;
  user_agent: string | null;
  attempted_at: string;
}

export interface LoginStats {
  total: number;
  successes: number;
  failures: number;
  rate: number;
  flaggedCount: number;
}

export type AuditLogResult = {
  entries: AuditEntry[];
};
