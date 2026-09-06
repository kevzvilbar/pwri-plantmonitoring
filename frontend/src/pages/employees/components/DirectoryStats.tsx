import { Users, CheckCircle2, Building2 } from 'lucide-react';
import { getRoleConfig } from '../types';
import { cn } from '@/lib/utils';

import React from 'react';
import { StaffMember } from '../types';

const ROLES = ['Admin', 'Manager', 'Technician', 'Operator'] as const;

function DirectoryStats({ staff, roles, plants }: { staff: StaffMember[]; roles: any[]; plants: any[] }) {
  const activeCount = staff.filter((s) => s.status === 'Active').length;
  const roleCounts = ROLES.map((role) => ({
    role,
    count: (roles as any[]).filter((r) => r.role === role).length,
  }));
  const coveredPlantIds = new Set(staff.flatMap((s) => s.plant_assignments ?? []));
  const plantsCount = plants.filter((p) => coveredPlantIds.has(p.id)).length;
  const statItems = [
    { label: 'Total Staff', value: staff.length, icon: <Users className="h-4 w-4" />, color: 'text-info' },
    { label: 'Active', value: activeCount, icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-accent' },
    { label: 'Plants Covered', value: plantsCount, icon: <Building2 className="h-4 w-4" />, color: 'text-kpi-ro' },
  ];
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        {statItems.map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-muted/40 border border-border/40 rounded-lg py-2 px-2 text-center gap-0.5 shadow-2xs">
            <span className={s.color}>{s.icon}</span>
            <span className="text-lg font-bold font-mono-num leading-tight text-foreground">{s.value}</span>
            <span className="text-2xs text-muted-foreground font-medium">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {roleCounts.map(({ role, count }) => {
          const rc = getRoleConfig(role);
          return (
            <div key={role} className="flex items-center justify-between bg-muted/30 border border-border/40 rounded-lg px-2.5 py-1.5">
              <div className={cn('flex items-center gap-1.5 text-xs font-medium', rc.color)}>
                {rc.icon}
                <span className="text-foreground">{role}</span>
              </div>
              <span className="text-xs font-bold font-mono-num px-1.5 py-0.5 rounded bg-background border border-border/50 text-foreground">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export { DirectoryStats };
