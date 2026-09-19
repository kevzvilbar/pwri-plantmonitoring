import { useMemo } from 'react';
import { X, User, ShieldCheck, Building2, MapPin, Clock, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { InfoRow } from './InfoRow';
import { StaffMember, getRoleConfig, avatarColor, initials, fullName, getPresence, presenceConfig, OnlineIds } from '../../types';
import { cn } from '@/lib/utils';

function DetailDrawer({ member, roles, plants, allStaff, onChat, onClose, isSelf, isAdmin, onlineIds }: {
  member: StaffMember; roles: any[]; plants: any[]; allStaff: StaffMember[];
  onChat: () => void; onClose: () => void; isSelf: boolean; isAdmin: boolean; onlineIds: OnlineIds;
}) {
  const presence = getPresence(member.last_seen_at, member.status, onlineIds.has(member.id));
  const pc = presenceConfig[presence];
  const memberRoles = roles.filter((r) => r.user_id === member.id).map((r) => r.role);
  const memberPlants = plants.filter((p) => member.plant_assignments?.includes(p.id)).map((p) => p.name);
  const head = allStaff.find((s) => s.id === member.immediate_head_id);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div
        className={cn(
          'fixed top-0 bottom-0 z-50 bg-background border-l shadow-2xl flex flex-col',
          'right-0 left-0 sm:left-auto sm:w-80',
        )}
      >
        <div className={cn('h-1.5 w-full', avatarColor(member.id))} />
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">Employee Details</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center pt-6 pb-4 px-4 text-center">
            <div className={cn('h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold text-white mb-3', avatarColor(member.id))}>
              {initials(member)}
            </div>
            <div className="font-semibold text-base">{fullName(member)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">@{member.username ?? '—'}</div>
            <div className={cn('flex items-center gap-1.5 mt-2 text-xs px-2.5 py-1 rounded-full border font-medium', pc.badge)}>
              <span className={cn('h-2 w-2 rounded-full', pc.dot)} />
              {pc.label}
            </div>
          </div>

          <div className="px-4 space-y-3 pb-6">
            <InfoRow icon={<User className="h-3.5 w-3.5" />}       label="Designation"    value={member.designation ?? '—'} />
            <InfoRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Role(s)"        value={memberRoles.join(', ') || '—'} />
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />}  label="Plants"         value={memberPlants.join(', ') || '—'} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />}     label="Reports to"     value={head ? fullName(head) : '—'} />
            <InfoRow icon={<Clock className="h-3.5 w-3.5" />}      label="Account status" value={member.status} />
          </div>
        </div>

        <div className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-2">
          {!isSelf && (
            <Button className="flex-1 gap-1.5" size="sm" onClick={() => { onChat(); onClose(); }}>
              <MessageSquare className="h-3.5 w-3.5" /> Chat
            </Button>
          )}
          {isAdmin && (
            <DeleteEntityMenu
              kind="user" id={member.id} label={fullName(member)}
              canSoftDelete={member.status === 'Active'} canHardDelete
              invalidateKeys={[['staff'], ['all-roles']]} compact
            />
          )}
        </div>
      </div>
    </>
  );
}

export { DetailDrawer };
