export interface Notification {
  id: string;
  title: string;
  message: string | null;
  link_path: string | null;
  read: boolean;
  severity: string;
  created_at: string;
}

export const EMPTY_NOTIFICATIONS: Notification[] = [];
export const EMPTY_PLANTS: Array<{ id: string; name: string }> = [];

export const sevTier = (severity: string) => {
  switch (severity) {
    case 'Critical':
    case 'High':
    case 'critical':
      return 'critical';
    case 'Medium':
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
};

import { ShieldAlert, AlertTriangle, Activity } from 'lucide-react';
import { ROTrainIcon, RawWaterIcon } from '@/components/icons/water-icons';
import { FlaskConical, Waves, Zap, Droplet, Wrench } from 'lucide-react';

export const getAlertIcon = (alert: { title: string; source?: string; severity: string }) => {
  const t = (alert.title || '').toLowerCase();
  const s = (alert.source || '').toLowerCase();

  if (t.includes('water loss') || t.includes('nrw') || s.includes('nrw')) return RawWaterIcon;
  if (t.includes('ph') || t.includes('chemical') || t.includes('conduct') || t.includes('tds')) return FlaskConical;
  if (t.includes('recovery') || t.includes('ro') || t.includes('train') || s.includes('ro')) return ROTrainIcon;
  if (t.includes('blending') || t.includes('bypass') || s.includes('blending')) return Waves;
  if (t.includes('power') || t.includes('kwh') || t.includes('voltage') || t.includes('grid') || s.includes('power')) return Zap;
  if (t.includes('well') || s.includes('well')) return Droplet;
  if (t.includes('maintenance') || t.includes('pms') || s.includes('maintenance')) return Wrench;

  const tier = sevTier(alert.severity);
  if (tier === 'critical') return ShieldAlert;
  if (tier === 'warning') return AlertTriangle;
  return Activity;
};
