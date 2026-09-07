export interface Notification {
  id: string;
  title: string;
  message: string | null;
  link_path: string | null;
  read: boolean;
  severity: string;
  created_at: string;
}

export type SevTier = 'critical' | 'warning' | 'info';

export const EMPTY_NOTIFICATIONS: Notification[] = [];
export const EMPTY_PLANTS: Array<{ id: string; name: string }> = [];
