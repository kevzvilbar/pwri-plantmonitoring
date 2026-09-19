import { StaffMember, getPresence, presenceConfig, getRoleConfig, avatarColor, initials, fullName, OnlineIds } from '../../types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MessageSquare } from 'lucide-react';

function TableView({ staff, plants, roles, activeOperator, user, onlineIds, getMemberRole, onChat, onDetail }: {
  staff: StaffMember[]; plants: any[]; roles: any[]; activeOperator: StaffMember | null | undefined; user: StaffMember | null | undefined; onlineIds: OnlineIds; getMemberRole: (m: StaffMember) => string; onChat: (m: StaffMember) => void; onDetail: (m: StaffMember) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="border-b border-border/70 bg-muted/40 text-3xs uppercase tracking-wider text-muted-foreground font-bold">
            <th className="py-2.5 px-3">Employee</th>
            <th className="py-2.5 px-3">Role</th>
            <th className="py-2.5 px-3">Assigned Plants</th>
            <th className="py-2.5 px-3">Presence</th>
            <th className="py-2.5 px-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {staff.map((s) => {
            const presence = getPresence(s.last_seen_at, s.status, onlineIds.has(s.id));
            const pc = presenceConfig[presence];
            const memberRole = getMemberRole(s);
            const rc = getRoleConfig(memberRole);
            const isSelf = s.id === (activeOperator?.id ?? user?.id);
            const assignedPlantNames = (s.plant_assignments ?? [])
              .map((pid) => plants.find((p) => p.id === pid)?.name)
              .filter(Boolean);

            return (
              <tr
                key={s.id}
                onClick={() => onDetail(s)}
                className="hover:bg-muted/30 transition-colors cursor-pointer"
              >
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2.5">
                    <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center text-2xs font-bold text-white shrink-0', avatarColor(s.id))}>
                      {initials(s)}
                    </div>
                    <div>
                      <div className="font-bold text-foreground flex items-center gap-1.5">
                        <span>{fullName(s)}</span>
                        {isSelf && (
                          <span className="text-2xs font-semibold px-1 rounded bg-primary-soft text-primary">you</span>
                        )}
                      </div>
                      {s.username && (
                        <div className="text-3xs text-muted-foreground font-mono">@{s.username}</div>
                      )}
                    </div>
                  </div>
                </td>

                <td className="py-2 px-3">
                  <span className={cn('inline-flex items-center gap-1 text-3xs font-semibold px-2 py-0.5 rounded-md border', rc.bg, rc.color)}>
                    {rc.icon}
                    <span>{memberRole}</span>
                  </span>
                </td>

                <td className="py-2 px-3">
                  {assignedPlantNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {assignedPlantNames.map((name, i) => (
                        <span key={i} className="text-3xs px-1.5 py-0.2 rounded bg-muted font-medium text-foreground border border-border/60">
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-3xs text-muted-foreground/50 italic">All plants / Float</span>
                  )}
                </td>

                <td className="py-2 px-3">
                  <span className={cn('inline-flex items-center gap-1 text-3xs px-2 py-0.5 rounded-full border font-semibold', pc.badge)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', pc.dot)} />
                    {pc.label}
                  </span>
                </td>

                <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-1">
                    {!isSelf && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary-soft"
                        onClick={() => onChat(s)}
                        title="Direct Message"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-3xs font-medium rounded-lg"
                      onClick={() => onDetail(s)}
                    >
                      Profile
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { TableView };
