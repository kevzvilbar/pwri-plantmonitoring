import { useState, useEffect } from 'react';
import { Droplet, FlaskConical, Zap, ShieldCheck, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DashboardSection {
  id: string;
  label: string;
  shortLabel: string;
  icon: typeof Droplet;
  accent: string;
}

export const DASHBOARD_SECTIONS: DashboardSection[] = [
  { id: 'overview-cluster', label: 'Overview', shortLabel: 'Overview', icon: Droplet, accent: 'text-primary' },
  { id: 'quality-cluster', label: 'Quality', shortLabel: 'Quality', icon: FlaskConical, accent: 'text-accent' },
  { id: 'cost-cluster', label: 'Production Cost', shortLabel: 'Cost', icon: Zap, accent: 'text-chart-6' },
  { id: 'audits-cluster', label: 'Audits & Analytics', shortLabel: 'Audits', icon: ShieldCheck, accent: 'text-highlight' },
  { id: 'health-cluster', label: 'Health & Coverage', shortLabel: 'Health', icon: Activity, accent: 'text-info' },
];

export function DashboardSectionNav() {
  const [activeSection, setActiveSection] = useState<string>('overview-cluster');

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = DASHBOARD_SECTIONS.map((sec) => ({
        id: sec.id,
        el: document.getElementById(sec.id),
      })).filter((s) => s.el !== null);

      const scrollPosition = window.scrollY + 180;

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const item = sectionElements[i];
        if (item.el && item.el.offsetTop <= scrollPosition) {
          setActiveSection(item.id);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const headerOffset = 110;
    const elementPosition = el.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
    setActiveSection(id);
  };

  return (
    <div className="sticky top-14 z-20 -mx-1 px-1 py-1.5 bg-background/80 backdrop-blur-md border-y border-border/40 transition-all">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth">
        {DASHBOARD_SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => scrollToSection(sec.id)}
              className={cn(
                'flex items-center gap-1.5 h-7.5 px-3 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer select-none',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary-foreground' : sec.accent)} />
              <span className="hidden sm:inline">{sec.label}</span>
              <span className="sm:hidden">{sec.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

