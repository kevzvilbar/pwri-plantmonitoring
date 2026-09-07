export type Kind = 'user' | 'plant';

export const KIND_COPY: Record<Kind, { label: string; softName: string; softVerb: string }> = {
  user: { label: 'user', softName: 'Suspended', softVerb: 'Suspend' },
  plant: { label: 'plant', softName: 'Inactive', softVerb: 'Deactivate' },
};

export interface Dependency {
  table?: string;
  column?: string;
  count: number;
}

export interface DependencySnapshot {
  blocking: boolean;
  total_references: number;
  references: Dependency[];
  role_rows?: number;
  assigned_plants?: string[];
  assigned_users?: number;
}

export interface DeleteMenuProps {
  kind: Kind;
  id: string;
  label: string;
  canSoftDelete: boolean;
  canHardDelete: boolean;
  invalidateKeys: string[][];
  onDeleted?: () => void;
  compact?: boolean;
  trigger?: React.ReactNode;
}
