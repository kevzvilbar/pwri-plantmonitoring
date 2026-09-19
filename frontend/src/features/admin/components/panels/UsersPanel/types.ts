import type { EmailChangeTarget } from '@/components/EmailChangeDialog';

export interface SharedTileProps {
  plantName: (id: string) => string;
  existingDesignations: string[];
  updateDesignation: (uid: string, designation: string) => Promise<void>;
  approveUser: (uid: string, label: string) => Promise<void>;
  invalidate: () => void;
  onChangePassword: (userId: string, userName: string) => void;
  onChangeEmail: (target: EmailChangeTarget) => void;
}
