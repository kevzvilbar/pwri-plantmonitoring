import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { UserCard } from './UserCard';
import { UserTableRow } from './UserTableRow';
import { CARD_ROLES, TABLE_ROLES, OPERATORS_PER_PAGE, ROLE_PLURAL, type AppRole } from './constants';
import { type SharedTileProps } from './types';

function CardRoleSection({
  role, users, rolesOf, ...shared
}: {
  role: AppRole | 'No role';
  users: any[];
  rolesOf: (uid: string) => string[];
} & SharedTileProps) {
  const label = role === 'No role' ? 'No role' : ROLE_PLURAL[role as AppRole];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-2xs px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">{users.length}</span>
        <div className="flex-1 h-px bg-border/60" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {users.map((s) => (
          <UserCard key={s.id} s={s} userRoles={rolesOf(s.id)} {...shared} />
        ))}
      </div>
    </div>
  );
}

function TableRoleSection({
  role, users, rolesOf, ...shared
}: {
  role: AppRole | 'No role';
  users: any[];
  rolesOf: (uid: string) => string[];
} & SharedTileProps) {
  const [page, setPage] = useState(0);
  const label      = role === 'No role' ? 'No role' : ROLE_PLURAL[role as AppRole];
  const totalPages = Math.ceil(users.length / OPERATORS_PER_PAGE);
  const pageUsers  = users.slice(page * OPERATORS_PER_PAGE, (page + 1) * OPERATORS_PER_PAGE);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-2xs px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">{users.length}</span>
        <div className="flex-1 h-px bg-border/60" />
      </div>

      <div className="rounded-xl border border-border/60 overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground py-2 pl-4 pr-2">User</th>
              <th className="text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground py-2 px-2">Plant</th>
              <th className="text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground py-2 px-2 hidden sm:table-cell">Designation</th>
              <th className="text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground py-2 px-2">Status</th>
              <th className="text-right text-2xs font-medium uppercase tracking-wider text-muted-foreground py-2 pl-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageUsers.map((s) => (
              <UserTableRow key={s.id} s={s} userRoles={rolesOf(s.id)} {...shared} />
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/20">
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages} · {users.length} users
            </span>
            <div className="flex items-center gap-1">
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { CardRoleSection, TableRoleSection };
