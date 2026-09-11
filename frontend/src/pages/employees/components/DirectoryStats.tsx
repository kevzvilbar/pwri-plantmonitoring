import React from 'react';
import { Users, CheckCircle2, Building2 } from 'lucide-react';
import { StaffMember, getRoleConfig } from '../types';
import { cn } from '@/lib/utils';

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
    { label: 'Total Staff', value: staff.length, icon: <Users className="h-3.5 w-3.5" />, color: 'text-info', bg: 'bg-info/10 border-info/20' },
    { label: 'Active Nominal', value: activeCount, icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-accent', bg: 'bg-accent/10 border-accent/20' },
    { label: 'Plants Covered', value: plantsCount, icon: <Building2 className="h-3.5 w-3.5" />, color: 'text-kpi-ro', bg: 'bg-kpi-ro/10 border-kpi-ro/20' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center">
      {/* 3 Summary KPIs */}
      <div className="grid grid-cols-3 gap-2 lg:col-span-5">
        {statItems.map((s) => (
          <div key={s.label} className="flex items-center gap-2 bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1.5 shadow-2xs">
            <span className={cn('p-1.5 rounded-md border shrink-0', s.color, s.bg)}>{s.icon}</span>
            <div className="min-w-0">
              <div className="text-base sm:text-lg font-bold font-mono tabular-nums leading-none text-foreground">{s.value}</div>
              <div className="text-3xs text-muted-foreground font-medium uppercase tracking-wider truncate mt-0.5">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Hairline divider on lg screens */}
      <div className="hidden lg:flex justify-center items-center lg:col-span-1 h-full">
        <div className="h-8 w-px bg-border/60" />
      </div>

      {/* 4 Role Distribution counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:col-span-6">
        {roleCounts.map(({ role, count }) => {
          const rc = getRoleConfig(role);
          return (
            <div key={role} className="flex items-center justify-between bg-muted/30 border border-border/50 rounded-lg px-2.5 py-1.5 shadow-2xs">
              <div className={cn('flex items-center gap-1.5 text-xs font-semibold', rc.color)}>
                {rc.icon}
                <span className="text-foreground">{role}</span>
              </div>
              <span className="text-xs font-bold font-mono tabular-nums px-1.5 py-0.5 rounded bg-background border border-border/60 text-foreground">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { DirectoryStats };
