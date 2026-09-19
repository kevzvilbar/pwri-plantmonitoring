import { useMemo } from 'react';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { CorrectionRequestDialog, type CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { fmtNum } from '@/lib/calculations';
import { History, Pencil, X, Lock, SquarePen } from 'lucide-react';

interface ActionButtonsProps {
  lastToday: any;
  editingId: string | null;
  canSelfEdit: boolean;
  canRequest: boolean;
  isManagerOrAdmin: boolean;
  isLocked: boolean;
  correctionTarget: any | null;
  setCorrectionTarget: (target: any | null) => void;
  handleCorrectionRequest: () => void;
  setEditingId: (id: string | null) => void;
  setReading: (value: string) => void;
  setShowHistory: (show: boolean) => void;
  onSaved: () => void;
}

export function ActionButtons({
  lastToday, editingId, canSelfEdit, canRequest, isManagerOrAdmin, isLocked,
  correctionTarget, setCorrectionTarget, handleCorrectionRequest,
  setEditingId, setReading, setShowHistory, onSaved,
}: ActionButtonsProps) {
  const actions = useMemo(() => [
    lastToday && !editingId && canSelfEdit && {
      icon: Pencil,
      title: `Edit last reading (${fmtNum(lastToday.current_reading)})`,
      onClick: () => { setEditingId(lastToday.id); setReading(String(lastToday.current_reading)); },
    },
    editingId && {
      icon: X,
      title: 'Cancel edit',
      variant: 'danger' as const,
      onClick: () => { setEditingId(null); setReading(''); },
    },
    isManagerOrAdmin && {
      icon: History,
      title: 'View reading history',
      onClick: () => setShowHistory(true),
    },
    isLocked && lastToday && !editingId && {
      icon: Lock,
      label: 'Locked',
      title: 'Reading approved by supervisor — locked from editing',
      variant: 'danger' as const,
      disabled: true,
      onClick: () => {},
    },
    lastToday && !editingId && canRequest && {
      icon: SquarePen,
      label: 'Fix',
      title: 'Entry is older than 2 hours — submit a correction request for supervisor review',
      variant: 'warn' as const,
      onClick: handleCorrectionRequest,
    },
  ].filter(Boolean), [lastToday, editingId, canSelfEdit, canRequest, isManagerOrAdmin, isLocked, handleCorrectionRequest, setEditingId, setReading, setShowHistory]);

  return (
    <>
      <ControlCluster actions={actions as any[]} />
      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget as CorrectionTarget}
          onClose={() => setCorrectionTarget(null)}
          onSubmitted={() => { setCorrectionTarget(null); onSaved(); }}
        />
      )}
    </>
  );
}
