import { useState } from 'react';
import { StatusDot } from './StatusDot';
import { RoleSelector } from './RoleSelector';
import {
  ROLE_PILL, primaryRole, displayName, userLabel, initials,
} from './constants';
import { type AppRole } from './constants';
import { type SharedTileProps } from './types';
import { DesignationCombobox, accessLevelFromRoles, OPERATOR_DESIGNATION } from '@/components/DesignationCombobox';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PlantAssignmentEditor } from '@/components/PlantAssignmentEditor';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import {
  ShieldCheck, KeyRound, Mail, Building2, MoreVertical, Zap,
} from 'lucide-react';

function UserTableRow({ s, userRoles, ...shared }: {
  s: any;
  userRoles: string[];
} & SharedTileProps) {
  const [roleOpen, setRoleOpen] = useState(false);

  const pRole       = primaryRole(userRoles);
  const avatarCls   = ROLE_PILL[pRole ?? 'Operator'];
  const assignments = (s.plant_assignments ?? []) as string[];
  const isOperator  = s.designation === OPERATOR_DESIGNATION;
  const awaiting    = s.confirmed === false || s.status === 'Pending';
  const name        = displayName(s);
  const label       = userLabel(s);
  const access      = accessLevelFromRoles(userRoles);

  return (
    <>
      <tr
        className={cn(
          'border-b border-border/50 transition-colors last:border-0',
          roleOpen ? 'bg-elevated/10' : 'hover:bg-muted/30',
        )}
        data-testid={`admin-user-row-${s.id}`}
      >
        <td className="py-2.5 pl-4 pr-2">
          <div className="flex items-center gap-2.5">
            <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-2xs font-semibold shrink-0', avatarCls)}>
              {initials(s.first_name, s.last_name, s.username)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium leading-tight truncate">{name}</span>
                {access.label === 'Elevated' && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-3xs font-semibold bg-elevated/15 text-elevated border border-elevated/40 shrink-0">
                    <Zap className="w-2.5 h-2.5" /> Elevated
                  </span>
                )}
              </div>
              <div className="text-2xs text-muted-foreground">@{s.username ?? '—'}</div>
            </div>
          </div>
        </td>

        <td className="py-2.5 px-2">
          <div className="flex flex-wrap gap-1">
            {assignments.slice(0, 2).map((id) => (
              <span key={id} className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs bg-muted text-muted-foreground border border-border/60">
                {shared.plantName(id)}
              </span>
            ))}
            {assignments.length > 2 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs bg-muted text-muted-foreground">
                +{assignments.length - 2}
              </span>
            )}
            {assignments.length === 0 && (
              <span className="text-2xs text-muted-foreground italic">None</span>
            )}
          </div>
        </td>

        <td className="py-2.5 px-2">
          <div className="flex flex-wrap gap-1">
            {userRoles.map((r) => (
              <span
                key={r}
                className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium border', ROLE_PILL[r as AppRole] ?? 'bg-muted text-muted-foreground border-border/60')}
              >
                {r}
              </span>
            ))}
            {userRoles.length === 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium border bg-muted text-muted-foreground border-border/60">No role</span>
            )}
          </div>
        </td>

        <td className="py-2.5 px-2">
          <StatusDot status={s.status} />
        </td>

        <td className="py-2.5 pr-4 pl-2 text-right">
          <div className="inline-flex items-center gap-1">
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

            <button
              className={cn(
                'h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center rounded-md border transition-colors shrink-0',
                roleOpen
                  ? 'bg-elevated/15 border-elevated text-elevated'
                  : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              title="Change role"
              aria-label="Change role"
              onClick={() => setRoleOpen((v) => !v)}
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
        </td>
      </tr>

      {roleOpen && (
        <tr className="border-b border-elevated/40 bg-elevated/10">
          <td colSpan={5} className="px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-2xs font-semibold text-elevated flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Change role
              </span>
              <RoleSelector userId={s.id} currentRoles={userRoles} onChanged={shared.invalidate} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export { UserTableRow };
