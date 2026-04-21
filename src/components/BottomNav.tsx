import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Activity, Wrench, DollarSign, Menu,
  Building2, Cog, FlaskConical, Filter, AlertTriangle, Users, Receipt, Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';

const operationsRoutes = [
  { to: '/plants', label: 'Plants', icon: Building2 },
  { to: '/operations', label: 'Wells & Locators', icon: Activity },
  { to: '/ro-trains', label: 'RO Trains', icon: Cog },
  { to: '/pretreatment', label: 'Pre-Treatment', icon: Filter },
  { to: '/chemicals', label: 'Chemicals', icon: FlaskConical },
];
const maintRoutes = [
  { to: '/maintenance', label: 'PM Schedule', icon: Wrench },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
];
const financeRoutes = [
  { to: '/costs', label: 'Costs & Tariffs', icon: DollarSign },
  { to: '/costs?tab=prices', label: 'Chemical Prices', icon: Receipt },
];
const adminRoutes = [
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/exports', label: 'Data Exports', icon: Download },
];

const operationsPaths = ['/plants', '/operations', '/ro-trains', '/pretreatment', '/chemicals'];
const maintPaths = ['/maintenance', '/incidents'];
const financePaths = ['/costs'];

export function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [openSheet, setOpenSheet] = useState<null | 'ops' | 'maint' | 'fin'>(null);

  const isActive = (paths: string[]) => paths.some((p) => pathname.startsWith(p));

  const groupBtn = (
    key: 'ops' | 'maint' | 'fin',
    label: string,
    Icon: any,
    paths: string[],
  ) => (
    <button
      onClick={() => setOpenSheet(key)}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] font-medium transition-colors',
        isActive(paths) ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="leading-none">{label}</span>
    </button>
  );

  const sheetItems = openSheet === 'ops' ? operationsRoutes
    : openSheet === 'maint' ? maintRoutes
    : openSheet === 'fin' ? financeRoutes
    : [...adminRoutes];
  const sheetTitle = openSheet === 'ops' ? 'Operations'
    : openSheet === 'maint' ? 'Maintenance'
    : openSheet === 'fin' ? 'Finance' : '';

  return (
    <>
      <nav className="md:hidden sticky bottom-0 z-40 bg-card border-t shadow-[0_-2px_8px_-2px_hsl(210_30%_12%/0.06)]">
        <div className="grid grid-cols-5 max-w-3xl mx-auto">
          <NavLink
            to="/"
            end
            className={({ isActive }) => cn(
              'flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutDashboard className="h-[18px] w-[18px]" />
            <span className="leading-none">Home</span>
          </NavLink>
          {groupBtn('ops', 'Operations', Activity, operationsPaths)}
          {groupBtn('maint', 'Maintenance', Wrench, maintPaths)}
          {groupBtn('fin', 'Finance', DollarSign, financePaths)}
          <Sheet>
            <SheetTrigger asChild>
              <button className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] font-medium text-muted-foreground hover:text-foreground">
                <Menu className="h-[18px] w-[18px]" />
                <span className="leading-none">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader><SheetTitle>Admin</SheetTitle></SheetHeader>
              <div className="mt-4 flex flex-col gap-1">
                {adminRoutes.map((r) => (
                  <NavLink
                    key={r.to}
                    to={r.to}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                      isActive ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-muted',
                    )}
                  >
                    <r.icon className="h-4 w-4" />
                    {r.label}
                  </NavLink>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

      <Sheet open={openSheet !== null && openSheet !== 'admin' as any} onOpenChange={(o) => !o && setOpenSheet(null)}>
        <SheetContent side="bottom" className="rounded-t-xl">
          <SheetHeader><SheetTitle>{sheetTitle}</SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-1 gap-1">
            {sheetItems.map((r: any) => {
              const target = r.to.split('?')[0];
              const active = pathname.startsWith(target);
              return (
                <button
                  key={r.to}
                  onClick={() => { navigate(r.to); setOpenSheet(null); }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-md text-sm text-left transition-colors',
                    active ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-muted',
                  )}
                >
                  <r.icon className="h-4 w-4" />
                  {r.label}
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
