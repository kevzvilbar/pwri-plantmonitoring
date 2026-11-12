import React from 'react';
import { Trophy, Star, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import {
  type AppraisalTier,
  APPRAISAL_TIERS,
  getAppraisalTier,
} from '@/lib/appraisalTiers';

export type { AppraisalTier };
export { APPRAISAL_TIERS, getAppraisalTier };

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

