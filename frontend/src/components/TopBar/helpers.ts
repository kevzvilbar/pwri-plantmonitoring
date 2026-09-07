import { ShieldAlert, AlertTriangle, Activity, FlaskConical, Waves, Zap, Droplet, Wrench } from 'lucide-react';
import { ROTrainIcon, RawWaterIcon, ChemicalsIcon } from '@/components/icons/water-icons';
import { SevTier } from './types';

export { ROTrainIcon, RawWaterIcon, ChemicalsIcon };

export const sevTier = (severity: string): SevTier => {
  switch (severity) {
    case 'Critical':
    case 'High':
    case 'critical':
      return 'critical';
    case 'Medium':
    case 'warning':
      return 'warning';
    case 'Low':
    case 'info':
    default:
      return 'info';
  }
};

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
