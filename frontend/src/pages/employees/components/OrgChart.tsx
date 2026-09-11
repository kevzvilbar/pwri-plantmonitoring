import { ROLE_HIERARCHY } from '../types';
import { Building2 } from 'lucide-react';

import React, { Fragment, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StaffMember, getRoleConfig, avatarColor, initials, fullName, CONNECTOR_COLORS, DEPTH_SHADES, PLANT_COLUMN_ACCENTS } from '../types';

function OrgNodeFixed({ member, allStaff, roles, depth = 0, accentLine }: {
  member: StaffMember; allStaff: StaffMember[]; roles: any[];
  depth?: number; accentLine?: string;
}) {
  const getRoleRank = (userId: string) => {
    const r = (roles as any[]).find((x) => x.user_id === userId)?.role;
    const idx = ROLE_HIERARCHY.findIndex((rh) => rh.role === r);
    return idx >= 0 ? idx : 99;
  };

  const rawChildren = allStaff.filter((s) => s.immediate_head_id === member.id);
  const children = [...rawChildren].sort((a, b) => {
    const diff = getRoleRank(a.id) - getRoleRank(b.id);
    if (diff !== 0) return diff;
    return fullName(a).localeCompare(fullName(b));
  });

  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? '—';
  const hasChildren = children.length > 0;
  const depthShade = DEPTH_SHADES[Math.min(depth, DEPTH_SHADES.length - 1)];
  const lineColor = accentLine ?? CONNECTOR_COLORS[Math.min(depth, CONNECTOR_COLORS.length - 1)];
  const childLineColor = CONNECTOR_COLORS[Math.min(depth + 1, CONNECTOR_COLORS.length - 1)];
  const rc = getRoleConfig(memberRole);

  const hasDesignation =
    member.designation &&
    member.designation.trim().length > 0 &&
    member.designation.trim().toLowerCase() !== memberRole.toLowerCase();

  return (
    <div className="flex flex-col">
      {/* Elbow connector at depth > 0 */}
      {depth > 0 && (
        <div className="flex items-center -my-0.5" style={{ paddingLeft: (depth - 1) * 14 + 10 }}>
          <div className="flex items-center shrink-0" style={{ width: 14 }}>
            <div style={{ width: 2, height: 10, background: lineColor, opacity: 0.5 }} />
            <div style={{ width: 8, height: 2, background: lineColor, opacity: 0.5 }} />
          </div>
        </div>
      )}

      <div
        style={{ marginLeft: depth * 14 }}
        className={cn(
          'flex items-center gap-2 p-2 rounded-xl border transition-all duration-150 relative bg-card/85 border-border/60 hover:border-border shadow-2xs my-0.5',
          depthShade,
        )}
      >
        {depth > 0 && (
          <div
            className="absolute top-1.5 bottom-1.5 w-0.5 rounded-full"
            style={{ background: lineColor, opacity: 0.5, left: -6 }}
          />
        )}

        {/* Avatar */}
        <div className={cn('h-7 w-7 rounded-full flex items-center justify-center text-3xs font-bold text-white shrink-0 shadow-2xs', avatarColor(member.id))}>
          {initials(member)}
        </div>

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold leading-tight text-foreground truncate">{fullName(member)}</div>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            <span
              className={cn('inline-flex items-center gap-1 text-3xs font-medium px-1.5 py-0.5 rounded-md border shrink-0', rc.bg, rc.color)}
            >
              {rc.icon}
              <span>{memberRole}</span>
            </span>
            {hasDesignation && (
              <span className="text-3xs text-muted-foreground/80 truncate" title={member.designation!}>
                {member.designation}
              </span>
            )}
          </div>
        </div>

        {hasChildren && (
          <span
            className="text-3xs font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{ color: lineColor, background: `${lineColor}20` }}
            title={`${children.length} direct report(s)`}
          >
            {children.length}
          </span>
        )}
      </div>

      {/* Always-expanded children with vertical trunk line */}
      {hasChildren && (
        <div className="flex">
          <div style={{ width: depth * 14 + 10, flexShrink: 0, paddingLeft: depth * 14 }}>
            <div style={{ width: 2, height: '100%', background: childLineColor, opacity: 0.3, marginLeft: 10 }} />
          </div>
          <div className="flex-1 min-w-0">
            {children.map((child) => (
              <OrgNodeFixed
                key={child.id} member={child} allStaff={allStaff} roles={roles}
                depth={depth + 1} accentLine={childLineColor}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hierarchy Legend
// ---------------------------------------------------------------------------

export function HierarchyLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {ROLE_HIERARCHY.map((r, i) => (
        <div key={r.role} className="flex items-center gap-1">
          <span className={cn('inline-flex items-center gap-1 text-3xs font-semibold px-2 py-0.5 rounded-full border shadow-2xs', r.bg, r.color)}>
            {r.icon} <span>{r.role}</span>
          </span>
          {i < ROLE_HIERARCHY.length - 1 && (
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Org Chart — fixed, always visible, always expanded
// ---------------------------------------------------------------------------

function OrgChart({ staff, roles, plants, hideLegend = false }: {
  staff: StaffMember[]; roles: any[]; plants: any[]; hideLegend?: boolean;
}) {
  const getRoleRank = (userId: string) => {
    const r = (roles as any[]).find((x) => x.user_id === userId)?.role;
    const idx = ROLE_HIERARCHY.findIndex((rh) => rh.role === r);
    return idx >= 0 ? idx : 99;
  };

  const plantsWithStaff = plants.filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));

  if (plantsWithStaff.length === 0) {
    const staffIds = new Set(staff.map((s) => s.id));
    const rawRoots = staff.filter((s) => !s.immediate_head_id || !staffIds.has(s.immediate_head_id));
    const roots = [...rawRoots].sort((a, b) => {
      const diff = getRoleRank(a.id) - getRoleRank(b.id);
      if (diff !== 0) return diff;
      return fullName(a).localeCompare(fullName(b));
    });

    return (
      <div className="space-y-1">
        {roots.map((r) => <OrgNodeFixed key={r.id} member={r} allStaff={staff} roles={roles} depth={0} />)}
      </div>
    );
  }

  return (
    <div>
      {!hideLegend && (
        <>
          <HierarchyLegend className="mb-3 p-2 rounded-xl bg-muted/40 border border-border/50" />

          {/* Summary strip */}
          <div className="flex items-center gap-2 mb-3.5 flex-wrap">
            {plantsWithStaff.map((plant, idx) => {
              const accent = PLANT_COLUMN_ACCENTS[idx % PLANT_COLUMN_ACCENTS.length];
              const count = staff.filter((s) => s.plant_assignments?.includes(plant.id)).length;
              return (
                <div key={plant.id}
                  className={cn('flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-1 rounded-full border shadow-2xs', accent.bg, accent.border, accent.text)}
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: accent.line }} />
                  {plant.name}
                  <span className="opacity-50 mx-0.5">·</span>
                  <span className="font-bold">{count} staff</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Plant columns — always expanded */}
      <div className={cn(
        'grid gap-3.5',
        plantsWithStaff.length === 1 && 'grid-cols-1',
        plantsWithStaff.length === 2 && 'grid-cols-1 sm:grid-cols-2',
        plantsWithStaff.length === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        plantsWithStaff.length >= 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      )}>
        {plantsWithStaff.map((plant, idx) => {
          const accent = PLANT_COLUMN_ACCENTS[idx % PLANT_COLUMN_ACCENTS.length];
          const plantStaff = staff.filter((s) => s.plant_assignments?.includes(plant.id));
          const plantStaffIds = new Set(plantStaff.map((s) => s.id));
          const rawRoots = plantStaff.filter(
            (s) => !s.immediate_head_id || !plantStaffIds.has(s.immediate_head_id)
          );
          const roots = [...rawRoots].sort((a, b) => {
            const diff = getRoleRank(a.id) - getRoleRank(b.id);
            if (diff !== 0) return diff;
            return fullName(a).localeCompare(fullName(b));
          });

          return (
            <div key={plant.id} className={cn('rounded-xl border overflow-hidden flex flex-col shadow-xs', accent.border)}>
              {/* Column header */}
              <div className={cn('px-3.5 py-2.5 bg-gradient-to-r text-white flex items-center justify-between shadow-2xs', accent.header)}>
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-3.5 w-3.5 shrink-0 opacity-90" />
                  <span className="text-xs font-bold uppercase tracking-wide truncate">{plant.name}</span>
                </div>
                <span className="text-2xs font-bold bg-white/20 px-2 py-0.5 rounded-full shrink-0">
                  {plantStaff.length}
                </span>
              </div>

              {/* Tree nodes — fully expanded */}
              <div
                className={cn('flex-1 p-2.5 space-y-1 overflow-y-auto overscroll-contain scrollbar-thin', accent.bg)}
                style={{ maxHeight: 480 }}
              >
                {roots.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No hierarchy configured.</p>
                ) : (
                  roots.map((r) => (
                    <OrgNodeFixed
                      key={r.id} member={r} allStaff={plantStaff} roles={roles}
                      depth={0} accentLine={accent.line}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export { OrgChart, HierarchyLegend };
