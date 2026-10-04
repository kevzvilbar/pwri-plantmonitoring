import { describe, expect, it } from 'vitest';
import type { StaffMember } from '../../types';
import { selectKpiOperators, type RoleRow } from './selectKpiOperators';

const UMAPAD = 'plant-umapad';
const OTHER = 'plant-other';

function person(id: string, over: Partial<StaffMember> = {}): StaffMember {
  return {
    id, first_name: id, last_name: 'X', middle_name: null, suffix: null, username: id,
    designation: 'Operator', plant_assignments: [UMAPAD], status: 'Active',
    updated_at: '', last_seen_at: null, immediate_head_id: null, email: null,
    confirmed: true, profile_complete: true, created_at: '', ...over,
  } as StaffMember;
}

const operatorViewer = { roles: ['Operator'], plantIds: [UMAPAD] };
const managerViewer = { roles: ['Manager'], plantIds: [] as string[] };
const ids = (list: StaffMember[]) => list.map((s) => s.id).sort();

describe('selectKpiOperators', () => {
  it('Operator viewer sees same-plant operators even when only their own role is visible (the reported bug)', () => {
    const staff = [person('sanito'), person('james'), person('chiervin'), person('glenn'), person('reynan')];
    const rolesVisible: RoleRow[] = [{ user_id: 'sanito', role: 'Operator' }]; // RLS hid the rest
    expect(ids(selectKpiOperators(staff, rolesVisible, operatorViewer)))
      .toEqual(['chiervin', 'glenn', 'james', 'reynan', 'sanito']);
  });

  it('uses roles directly once the server returns colleague roles', () => {
    const staff = [person('a'), person('b')];
    const roles: RoleRow[] = [{ user_id: 'a', role: 'Operator' }, { user_id: 'b', role: 'Operator' }];
    expect(ids(selectKpiOperators(staff, roles, operatorViewer))).toEqual(['a', 'b']);
  });

  it('does NOT list everyone: Managers, Technicians, Supervisors and blank designations stay out', () => {
    const staff = [
      person('op'),
      person('mgr', { designation: 'Manager' }),
      person('admin', { designation: 'Admin' }),
      person('tech', { designation: 'Technician' }),
      person('maint', { designation: 'Maintenance' }),
      person('sup', { designation: 'Plant Supervisor' }),
      person('blank', { designation: null }),
    ];
    expect(ids(selectKpiOperators(staff, [], operatorViewer))).toEqual(['op']);
  });

  it('a known role wins over the free-text designation', () => {
    const staff = [
      person('promoted', { designation: 'Operator' }),
      person('mislabelled', { designation: 'Manager' }),
    ];
    const roles: RoleRow[] = [
      { user_id: 'promoted', role: 'Manager' },
      { user_id: 'mislabelled', role: 'Operator' },
    ];
    expect(ids(selectKpiOperators(staff, roles, operatorViewer))).toEqual(['mislabelled']);
  });

  it('excludes inactive people', () => {
    const staff = [person('on'), person('pending', { status: 'Pending' }), person('off', { status: 'Inactive' })];
    expect(ids(selectKpiOperators(staff, [], operatorViewer))).toEqual(['on']);
  });

  it('Operator viewer does not see operators from other plants', () => {
    const staff = [person('mine'), person('theirs', { plant_assignments: [OTHER] }),
                   person('both', { plant_assignments: [OTHER, UMAPAD] })];
    expect(ids(selectKpiOperators(staff, [], operatorViewer))).toEqual(['both', 'mine']);
  });

  it('Manager (and Admin / Data Analyst) viewers see operators of every plant', () => {
    const staff = [person('mine'), person('theirs', { plant_assignments: [OTHER] })];
    for (const role of ['Manager', 'Admin', 'Data Analyst']) {
      expect(ids(selectKpiOperators(staff, [], { roles: [role], plantIds: [] }))).toEqual(['mine', 'theirs']);
    }
    expect(ids(selectKpiOperators(staff, [], managerViewer))).toHaveLength(2);
  });

  it('a viewer with no plants (profile still loading) sees nobody rather than everybody', () => {
    expect(selectKpiOperators([person('a')], [], { roles: ['Operator'], plantIds: [] })).toEqual([]);
  });

  it('handles multiple role rows per person', () => {
    const staff = [person('dual')];
    const roles: RoleRow[] = [{ user_id: 'dual', role: 'Technician' }, { user_id: 'dual', role: 'Operator' }];
    expect(ids(selectKpiOperators(staff, roles, operatorViewer))).toEqual(['dual']);
  });
});
