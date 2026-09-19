import { MapPin, Gauge, Droplet, Zap, Settings2 } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';

type PlantTab = 'locators' | 'wells' | 'product' | 'trains' | 'power' | 'configuration';

const TABS: { id: PlantTab; label: string; short: string; icon: React.ReactNode }[] = [
  { id: 'locators', label: 'Locators', short: 'LOC', icon: <MapPin className="h-3.5 w-3.5" /> },
  { id: 'wells', label: 'Wells', short: 'WELL', icon: <Droplet className="h-3.5 w-3.5" /> },
  { id: 'product', label: 'Product', short: 'PROD', icon: <Gauge className="h-3.5 w-3.5" /> },
  { id: 'trains', label: 'RO Trains', short: 'RO', icon: <ROTrainIcon className="h-3.5 w-3.5" /> },
  { id: 'power', label: 'Power & Energy', short: 'PWR', icon: <Zap className="h-3.5 w-3.5" /> },
  { id: 'configuration', label: 'Configuration', short: 'CONFIG', icon: <Settings2 className="h-3.5 w-3.5" /> },
];

export function PlantDetailTabs({ tab, onTabChange }: { tab: PlantTab; onTabChange: (t: PlantTab) => void }) {
  return (
    <div className="flex gap-1 p-1 bg-muted/60 border border-border/60 rounded-xl w-full overflow-x-auto shadow-sm">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTabChange(t.id)}
          className={[
            'flex-1 py-2 px-2 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-nowrap min-w-max sm:min-w-0',
            tab === t.id
              ? 'bg-card text-primary shadow-sm border border-border/80'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
          ].join(' ')}
        >
          {t.icon}
          <span className="hidden sm:inline">{t.label}</span>
          <span className="sm:hidden">{t.short}</span>
        </button>
      ))}
    </div>
  );
}
