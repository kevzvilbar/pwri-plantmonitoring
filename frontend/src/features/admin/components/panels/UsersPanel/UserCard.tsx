import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { PlantAssignmentEditor } from '@/components/PlantAssignmentEditor';
import { RoleSelector } from './RoleSelector';
import { StatusDot } from './StatusDot';
import {
  Search, UserPlus, Zap, Building2, MoreVertical,
  ShieldCheck, KeyRound, Mail, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmailChangeDialog, EmailChangeTarget } from '@/components/EmailChangeDialog';
import {
  DesignationCombobox, accessLevelFromRoles, OPERATOR_DESIGNATION,
} from '@/components/DesignationCombobox';
import { toast } from '@/components/ui/sonner';
import {
  ALL_ROLES, type AppRole, ROLE_AVATAR, ROLE_PILL,
  primaryRole, displayName, userLabel, initials,
} from './constants';
import { friendlyError } from '@/lib/supabaseErrors';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';

import { type SharedTileProps } from './types';

function UserCard({ s, userRoles, ...shared }: {
  s: any;
  userRoles: string[];
} & SharedTileProps) {
  const [expanded, setExpanded] = useState(false);

  const pRole        = primaryRole(userRoles);
  const avatarCls    = ROLE_AVATAR[pRole ?? 'Operator'];
  const assignments  = (s.plant_assignments ?? []) as string[];
  const isOperator   = s.designation === OPERATOR_DESIGNATION;
  const awaiting     = s.confirmed === false || s.status === 'Pending';
  const access       = accessLevelFromRoles(userRoles);
  const name         = displayName(s);
  const label        = userLabel(s);
  const visiblePlants = assignments.slice(0, 3);
  const overflowCount = assignments.length - 3;

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl border bg-card text-card-foreground transition-all duration-150',
        expanded ? 'shadow-md border-elevated/50 ring-1 ring-elevated/20' : 'hover:shadow-sm hover:border-border',
      )}
      data-testid={`admin-user-card-${s.id}`}
    >
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start gap-2.5">
          <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0', avatarCls)}>
            {initials(s.first_name, s.last_name, s.username)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium leading-tight truncate max-w-[110px]">{name}</span>
              {access.label === 'Elevated' && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-2xs font-semibold bg-elevated/15 text-elevated shrink-0 border border-elevated/40">
                  <Zap className="w-2.5 h-2.5" /> Elevated
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">@{s.username ?? '—'}</div>
          </div>
          <StatusDot status={s.status} />
        </div>

        {assignments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visiblePlants.map((id) => (
              <span key={id} className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs bg-muted text-muted-foreground border border-border/60">
                {shared.plantName(id)}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs bg-muted text-muted-foreground">
                +{overflowCount}
              </span>
            )}
          </div>
        )}

        {userRoles.length === 0 && (
          <Badge variant="secondary" className="text-3xs w-fit">No role</Badge>
        )}
      </div>

      <div className="border-t mt-auto">
        <div className="px-3 pt-2 pb-1.5 flex items-center justify-between gap-2 min-w-0">
          <span className="text-2xs text-muted-foreground truncate min-w-0" title={s.designation ?? ''}>
            {s.designation || <span className="italic opacity-40">No designation</span>}
          </span>
          {awaiting && (
            <Button
              size="sm"
              className="h-6 px-2 text-2xs shrink-0"
              onClick={() => shared.approveUser(s.id, label)}
              data-testid={`approve-user-${s.id}`}
            >
              Approve
            </Button>
          )}
        </div>

        <div className="px-3 pb-3 flex items-center justify-end gap-1.5">
          <button
            className={cn(
              'h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center rounded-md border transition-colors shrink-0',
              expanded
                ? 'bg-elevated/15 border-elevated text-elevated'
                : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            title="Change role"
            aria-label="Change role"
            onClick={() => setExpanded((v) => !v)}
          >
            <ShieldCheck className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
          </button>

          <button
            className="h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-warn-soft hover:border-warn/90 hover:text-warn/90 transition-colors shrink-0"
            title="Change password"
            aria-label="Change password"
            onClick={() => shared.onChangePassword(s.id, label)}
          >
            <KeyRound className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
          </button>

          <button
            className="h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-info-soft hover:border-info/90 hover:text-info/90 transition-colors shrink-0"
            title="Change email"
            aria-label="Change email"
            onClick={() => shared.onChangeEmail({
              mode: 'admin-instant',
              userId: s.id,
              currentEmail: s.email ?? '',
              displayName: label,
            })}
          >
            <Mail className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
          </button>

          <PlantAssignmentEditor
            userId={s.id}
            userLabel={label}
            currentPlantIds={assignments}
            singlePlantOnly={isOperator}
            invalidateKeys={[['admin-users'], ['staff']]}
            trigger={
              <button
                className="h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                title="Edit plants"
                aria-label="Edit plants"
              >
                <Building2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
              </button>
            }
          />

          <DeleteEntityMenu
            kind="user" id={s.id} label={label}
            canSoftDelete={s.status === 'Active'} canHardDelete
            invalidateKeys={[['admin-users'], ['admin-user-roles'], ['staff'], ['all-roles']]}
            compact
            trigger={
              <button
                className="h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                title="More options"
                aria-label="More options"
              >
                <MoreVertical className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
              </button>
            }
          />
        </div>

        {expanded && (
          <div className="border-t border-elevated/40 bg-elevated/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs font-semibold text-elevated flex items-center gap-1 shrink-0">
                <ShieldCheck className="w-3 h-3" /> Role
              </span>
              <RoleSelector userId={s.id} currentRoles={userRoles} onChanged={shared.invalidate} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { UserCard };
