import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, Activity, Cog, FlaskConical, Wrench, AlertTriangle, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/plants', label: 'Plants', icon: Building2 },
  { to: '/operations', label: 'Ops', icon: Activity },
  { to: '/ro-trains', label: 'RO', icon: Cog },
  { to: '/chemicals', label: 'Chem', icon: FlaskConical },
  { to: '/maintenance', label: 'PMS', icon: Wrench },
  { to: '/incidents', label: 'Issues', icon: AlertTriangle },
  { to: '/employees', label: 'Staff', icon: Users },
];

export function BottomNav() {
  return (
    <nav className="sticky bottom-0 z-40 bg-card border-t shadow-[0_-2px_8px_-2px_hsl(210_30%_12%/0.06)]">
      <div className="grid grid-cols-8 max-w-3xl mx-auto">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="leading-none">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
