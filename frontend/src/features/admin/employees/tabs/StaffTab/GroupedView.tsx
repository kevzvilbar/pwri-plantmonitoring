import { Crown, BarChart2, UserCircle } from 'lucide-react';
import { StaffMember } from '../../types';
import { StaffCard } from './StaffCard';

function GroupedView({ leadershipGroup, analystGroup, operatorGroup, roles, plants, activeOperator, user, onlineIds, onChat, onDetail }: {
  leadershipGroup: StaffMember[]; analystGroup: StaffMember[]; operatorGroup: StaffMember[]; roles: any[]; plants: any[]; activeOperator: StaffMember | null | undefined; user: StaffMember | null | undefined; onlineIds: any; onChat: (m: StaffMember) => void; onDetail: (m: StaffMember) => void;
}) {
  return (
    <div className="space-y-4">
      {leadershipGroup.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Crown className="h-4 w-4 text-danger" />
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Leadership & Administration ({leadershipGroup.length})
            </h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {leadershipGroup.map((s) => (
              <StaffCard
                key={s.id}
                member={s}
                roles={roles}
                plants={plants}
                isSelf={s.id === (activeOperator?.id ?? user?.id)}
                onlineIds={onlineIds}
                onChat={() => onChat(s)}
                onDetail={() => onDetail(s)}
              />
            ))}
          </div>
        </div>
      )}

      {analystGroup.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <BarChart2 className="h-4 w-4 text-kpi-ro" />
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Data & Compliance Analytics ({analystGroup.length})
            </h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {analystGroup.map((s) => (
              <StaffCard
                key={s.id}
                member={s}
                roles={roles}
                plants={plants}
                isSelf={s.id === (activeOperator?.id ?? user?.id)}
                onlineIds={onlineIds}
                onChat={() => onChat(s)}
                onDetail={() => onDetail(s)}
              />
            ))}
          </div>
        </div>
      )}

      {operatorGroup.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <UserCircle className="h-4 w-4 text-primary" />
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Plant Operations & Field Technical Team ({operatorGroup.length})
            </h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {operatorGroup.map((s) => (
              <StaffCard
                key={s.id}
                member={s}
                roles={roles}
                plants={plants}
                isSelf={s.id === (activeOperator?.id ?? user?.id)}
                onlineIds={onlineIds}
                onChat={() => onChat(s)}
                onDetail={() => onDetail(s)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { GroupedView };
