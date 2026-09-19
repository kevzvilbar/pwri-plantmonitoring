import React from 'react';
import { Trophy, Star, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { LampTone } from '@/components/ui/Lamp';

export type AppraisalTier = {
  id: string;
  tier: string;
  shortLabel: string;
  badge: string;
  dot: string;
  tone: LampTone;
  iconName: 'Trophy' | 'Star' | 'CheckCircle2' | 'AlertTriangle' | 'XCircle';
  minScore: number;
  description: string;
};

export const APPRAISAL_TIERS: AppraisalTier[] = [
  {
    id: 'exemplary',
    tier: 'Exemplary Oversight',
    shortLabel: 'Exemplary',
    badge: 'bg-accent-soft text-accent border-accent/40',
    dot: 'bg-accent',
    tone: 'good',
    iconName: 'Trophy',
    minScore: 90,
    description: 'Outstanding data completeness, pristine telemetry, and prompt approvals',
  },
  {
    id: 'active',
    tier: 'Active Oversight',
    shortLabel: 'Active',
    badge: 'bg-info-soft text-info border-info/40',
    dot: 'bg-info',
    tone: 'info',
    iconName: 'Star',
    minScore: 80,
    description: 'High data quality and regular review resolution',
  },
  {
    id: 'meets',
    tier: 'Meets Standards',
    shortLabel: 'Meets Standard',
    badge: 'bg-primary-soft text-primary border-primary/40',
    dot: 'bg-primary',
    tone: 'primary' as LampTone,
    iconName: 'CheckCircle2',
    minScore: 70,
    description: 'Satisfactory oversight with minor review delays',
  },
  {
    id: 'attention',
    tier: 'Attention Required',
    shortLabel: 'Attention',
    badge: 'bg-warn-soft text-warn border-warn/40',
    dot: 'bg-warn',
    tone: 'warn',
    iconName: 'AlertTriangle',
    minScore: 50,
    description: 'Backlog in correction approvals or lower reading completeness',
  },
  {
    id: 'critical',
    tier: 'Critical Oversight Gap',
    shortLabel: 'Critical Gap',
    badge: 'bg-destructive/15 text-destructive border-destructive/40',
    dot: 'bg-destructive',
    tone: 'danger',
    iconName: 'XCircle',
    minScore: 0,
    description: 'Unassigned manager or persistent unreviewed telemetry anomalies',
  },
];

export function getAppraisalTier(scorePct: number): AppraisalTier {
  for (const t of APPRAISAL_TIERS) {
    if (scorePct >= t.minScore) return t;
  }
  return APPRAISAL_TIERS[APPRAISAL_TIERS.length - 1];
}

export function renderAppraisalIcon(iconName: AppraisalTier['iconName'], className = 'h-3.5 w-3.5 shrink-0') {
  switch (iconName) {
    case 'Trophy':
      return <Trophy className={className} />;
    case 'Star':
      return <Star className={className} />;
    case 'CheckCircle2':
      return <CheckCircle2 className={className} />;
    case 'AlertTriangle':
      return <AlertTriangle className={className} />;
    case 'XCircle':
      return <XCircle className={className} />;
  }
}

