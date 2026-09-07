import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, MapPin, MessageSquare } from 'lucide-react';
import { StaffMember, getRoleConfig, avatarColor, initials, fullName, getPresence, presenceConfig, OnlineIds } from '../types';
import { cn } from '@/lib/utils';

function StaffCard({ member, roles, plants, isSelf, onlineIds, onChat, onDetail }: {
  member: StaffMember; roles: any[]; plants: any[]; isSelf: boolean; onlineIds: OnlineIds; onChat: () => void; onDetail: () => void;
}) {
  const presence = getPresence(member.last_seen_at, member.status, onlineIds.has(member.id));
  const pc = presenceConfig[presence];
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? 'Operator';
  const rc = getRoleConfig(memberRole);

  const assignedPlantNames = (member.plant_assignments ?? [])
    .map((pid) => plants.find((p) => p.id === pid)?.name)
    .filter(Boolean);

  return (
    <div
      className="bg-card hover:bg-card/90 rounded-xl border border-border/70 p-3.5 flex flex-col justify-between gap-3 shadow-2xs hover:shadow-md hover:border-primary/50 transition-all cursor-pointer group"
      onClick={onDetail}
    >
      {/* Top row: Avatar + Identity + Presence pill */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Avatar with live presence ring */}
          <div className="relative shrink-0">
            <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-xs', avatarColor(member.id))}>
              {initials(member)}
            </div>
            <span className={cn('absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-card', pc.dot)} />
          </div>

          {/* Name & Role */}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-sm leading-snug truncate flex items-center gap-1.5">
              <span className="truncate">{fullName(member)}</span>
              {isSelf && (
                <span className="text-2xs font-semibold px-1 rounded bg-primary-soft text-primary">you</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded-md border', rc.bg, rc.color)}>
                {rc.icon}
                <span>{memberRole}</span>
              </span>
              {member.username && (
                <span className="text-2xs text-muted-foreground truncate font-mono">@{member.username}</span>
              )}
            </div>
          </div>
        </div>

        {/* Presence Badge */}
        <span className={cn('text-2xs px-2 py-0.5 rounded-full border font-semibold shrink-0', pc.badge)}>
          {pc.label}
        </span>
      </div>

      {/* Plant Assignment & Action row */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-xs">
        {/* Plant chips */}
        <div className="flex items-center gap-1.5 overflow-hidden">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
          {assignedPlantNames.length > 0 ? (
            <span className="text-xs text-muted-foreground truncate font-medium">
              {assignedPlantNames.slice(0, 2).join(', ')}
              {assignedPlantNames.length > 2 && ` +${assignedPlantNames.length - 2}`}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/60 italic">All plants / Float</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isSelf && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary-soft"
              onClick={onChat}
              title="Send direct message"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-2xs gap-0.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted font-medium"
            onClick={onDetail}
            title="View employee profile"
          >
            <span>Profile</span>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export { StaffCard };
