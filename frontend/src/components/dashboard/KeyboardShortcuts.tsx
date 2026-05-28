import { useState, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Shortcut {
  keys: string[];
  action: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  {
    keys: ['?'],
    action: 'Toggle Help',
    description: 'Show this keyboard shortcuts guide',
  },
  {
    keys: ['Ctrl', '/'],
    action: 'Focus Search',
    description: 'Jump to plant filter or search',
  },
  {
    keys: ['Ctrl', 'Shift', 'D'],
    action: 'Toggle Data Summary',
    description: 'Open the data summary pivot table modal',
  },
  {
    keys: ['R'],
    action: 'Refresh Dashboard',
    description: 'Manually trigger data refresh',
  },
  {
    keys: ['S'],
    action: 'Toggle Settings',
    description: 'Open dashboard customization settings',
  },
  {
    keys: ['1'],
    action: 'Inline View',
    description: 'Switch to inline chart view mode',
  },
  {
    keys: ['2'],
    action: 'Sections View',
    description: 'Switch to collapsible sections view mode',
  },
  {
    keys: ['3'],
    action: 'Dialog View',
    description: 'Switch to dialog/popup view mode',
  },
];

/**
 * Displays keyboard shortcuts in a modal dialog.
 * Keyboard shortcuts help users discover and use keyboard navigation.
 */
export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  // Listen for '?' key to open shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !open) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts (press ?)"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogDescription>
              Press <kbd className="px-1.5 py-0.5 bg-muted text-xs rounded font-mono">?</kbd>{' '}
              anytime to show this guide
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Dashboard Navigation */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Dashboard</h3>
              <div className="grid gap-2">
                {SHORTCUTS.filter((s) => ['Refresh Dashboard', 'Toggle Settings', 'Toggle Data Summary'].includes(s.action)).map((shortcut) => (
                  <ShortcutRow key={shortcut.action} shortcut={shortcut} />
                ))}
              </div>
            </div>

            {/* View Modes */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">View Modes</h3>
              <div className="grid gap-2">
                {SHORTCUTS.filter((s) =>
                  ['Inline View', 'Sections View', 'Dialog View'].includes(s.action),
                ).map((shortcut) => (
                  <ShortcutRow key={shortcut.action} shortcut={shortcut} />
                ))}
              </div>
            </div>

            {/* General */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">General</h3>
              <div className="grid gap-2">
                {SHORTCUTS.filter((s) =>
                  ['Toggle Help', 'Focus Search'].includes(s.action),
                ).map((shortcut) => (
                  <ShortcutRow key={shortcut.action} shortcut={shortcut} />
                ))}
              </div>
            </div>

            {/* Tip */}
            <Card className="p-3 bg-muted/30 border-muted/50">
              <p className="text-xs text-muted-foreground">
                💡 <strong>Tip:</strong> Keyboard shortcuts work throughout the dashboard and
                most pages. Try them to discover faster workflows!
              </p>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Single shortcut row in the keyboard shortcuts dialog.
 */
function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <div className="flex-1">
        <p className="font-medium text-foreground">{shortcut.action}</p>
        <p className="text-muted-foreground">{shortcut.description}</p>
      </div>
      <div className="flex gap-1 shrink-0">
        {shortcut.keys.map((key) => (
          <kbd
            key={key}
            className="px-2 py-1 bg-muted border border-muted-foreground/20 rounded text-[10px] font-mono font-semibold text-foreground/80"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

/**
 * Hook to register keyboard shortcuts on the dashboard.
 * Call this in Dashboard component's useEffect to enable shortcuts.
 */
export function useDashboardKeyboardShortcuts(handlers: {
  onRefresh?: () => void;
  onToggleSettings?: () => void;
  onToggleSummary?: () => void;
  onInlineView?: () => void;
  onSectionsView?: () => void;
  onDialogView?: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // R = refresh
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        handlers.onRefresh?.();
      }

      // S = settings
      if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        handlers.onToggleSettings?.();
      }

      // Ctrl+Shift+D = data summary
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        handlers.onToggleSummary?.();
      }

      // 1, 2, 3 = view modes
      if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        handlers.onInlineView?.();
      }
      if (e.key === '2' && !e.ctrlKey && !e.metaKey) {
        handlers.onSectionsView?.();
      }
      if (e.key === '3' && !e.ctrlKey && !e.metaKey) {
        handlers.onDialogView?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
