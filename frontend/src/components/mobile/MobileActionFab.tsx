import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Droplet, 
  AlertTriangle, 
  Wrench, 
  Sparkles, 
  Layers, 
  X 
} from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useCan } from '@/hooks/usePermission';

interface QuickActionItem {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  route: string;
  colorClass: string;
  iconBgClass: string;
  module: 'operations' | 'incidents' | 'pm_schedule' | 'ro_trains';
}

const QUICK_ACTIONS: QuickActionItem[] = [
  {
    id: 'reading',
    title: 'Log Daily Reading',
    description: 'Fast entry for RO trains, locators, and wells',
    icon: Droplet,
    route: '/operations?action=log',
    colorClass: 'text-primary',
    iconBgClass: 'bg-primary/10 border-primary/20',
    module: 'operations',
  },
  {
    id: 'ro-round',
    title: 'RO Train Round',
    description: 'Conduct full train inspection & stage check',
    icon: Layers,
    route: '/ro-trains?action=round',
    colorClass: 'text-indigo-600 dark:text-indigo-400',
    iconBgClass: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800',
    module: 'ro_trains',
  },
  {
    id: 'incident',
    title: 'Report Incident',
    description: 'Log breakdown, leak, or safety event with photo',
    icon: AlertTriangle,
    route: '/incidents?action=new',
    colorClass: 'text-amber-600 dark:text-amber-400',
    iconBgClass: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
    module: 'incidents',
  },
  {
    id: 'maintenance',
    title: 'Preventive Maintenance',
    description: 'Record filter swap, grease, or pump check',
    icon: Wrench,
    route: '/maintenance?action=log',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    iconBgClass: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
    module: 'pm_schedule',
  },
];

interface MobileActionFabProps {
  className?: string;
}

export function MobileActionFab({ className }: MobileActionFabProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const can = useCan();

  const handleSelect = (route: string) => {
    setOpen(false);
    navigate(route);
  };

  const availableActions = QUICK_ACTIONS.filter((act) => can(act.module, 'edit') || can(act.module, 'view'));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick Actions Menu"
        aria-expanded={open}
        className={cn(
          'relative -top-3 flex flex-col items-center justify-center group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          className
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center h-13 w-13 rounded-full',
            'bg-gradient-to-tr from-primary to-primary-hover text-primary-foreground',
            'shadow-[0_8px_16px_-4px_hsl(var(--primary)/0.45)] border-2 border-background',
            'transition-all duration-200 ease-spring-out active:scale-95 group-hover:scale-105'
          )}
        >
          <Plus className={cn('h-6 w-6 transition-transform duration-200', open ? 'rotate-45' : '')} strokeWidth={2.5} />
        </span>
        <span className="text-2xs font-semibold mt-0.5 text-foreground">Log</span>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="px-4 pb-8 max-w-lg mx-auto rounded-t-3xl border-t shadow-2xl">
          <DrawerHeader className="text-left px-2 pt-3 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <DrawerTitle className="text-lg font-bold tracking-tight">Quick Action</DrawerTitle>
                <DrawerDescription className="text-xs text-muted-foreground mt-0.5">
                  Select an action to launch field logging mode
                </DrawerDescription>
              </div>
              <DrawerClose asChild>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-muted focus:outline-none"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="grid grid-cols-1 gap-2.5 mt-2">
            {availableActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleSelect(action.route)}
                  className="flex items-center gap-3.5 p-3 rounded-2xl border border-border/70 bg-card hover:bg-accent/40 active:scale-[0.98] transition-all text-left shadow-xs group"
                >
                  <div
                    className={cn(
                      'flex items-center justify-center h-12 w-12 rounded-xl border shrink-0 transition-transform group-hover:scale-105',
                      action.iconBgClass
                    )}
                  >
                    <Icon className={cn('h-6 w-6', action.colorClass)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground tracking-tight">{action.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{action.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

