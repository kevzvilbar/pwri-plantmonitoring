import React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Droplet, RefreshCw, HelpCircle, PanelRightOpen, PanelRightClose, Plug, Unplug, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TopologyHeaderProps {
  activePlant: { name: string } | undefined;
  plants: { id: string; name: string }[];
  effectivePlantId: string | null;
  setActivePlantId: (id: string) => void;
  showHelp: boolean;
  setShowHelp: (v: boolean) => void;
  refetch: () => void;
  setPanelOpen: (v: boolean) => void;
  panelOpen: boolean;
  canEdit: boolean;
  saving: boolean;
  handleSave: () => void;
  setEditMode: (m: 'connect' | 'disconnect' | null) => void;
  setPendingFrom: (p: { id: string; type: import('../shared').NodeType } | null) => void;
  editMode: 'connect' | 'disconnect' | null;
  pendingFrom: { id: string; type: import('../shared').NodeType } | null;
  waterNodesCount: number;
  powerNodesCount: number;
  activeLinksCount: number;
  isMobile: ReturnType<typeof useIsMobile>;
}

export function TopologyHeader({
  activePlant, plants, effectivePlantId, setActivePlantId, showHelp, setShowHelp,
  refetch, setPanelOpen, panelOpen, canEdit, saving, handleSave, setEditMode,
  setPendingFrom, editMode, pendingFrom, waterNodesCount, powerNodesCount,
  activeLinksCount, isMobile,
}: TopologyHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-4 px-5 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="shrink-0 space-y-0.5">
            <h1 className="text-base font-bold tracking-tight text-foreground leading-tight">Network Topology</h1>
            <p className="text-2xs text-muted-foreground hidden xl:block">
              P&amp;ID process flow &amp; power distribution
            </p>
          </div>

          <div className="h-5 w-px bg-border/80 hidden sm:block shrink-0" />

          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border shrink-0 flex-nowrap overflow-x-auto">
            {plants.map((p) => {
              const isActive = effectivePlantId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { setActivePlantId(p.id); setPendingFrom(null); setEditMode(null); }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden lg:flex items-center gap-2 text-2xs font-mono text-muted-foreground">
            <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
              <Droplet className="h-3 w-3 text-primary" />
              <span>{waterNodesCount} Nodes</span>
            </span>
            <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
              <Plug className="h-3 w-3 text-muted-foreground" />
              <span>{powerNodesCount} Feeds</span>
            </span>
            <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
              <span>{activeLinksCount} Links</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 border-l border-border pl-2">
            <button
              onClick={() => setShowHelp(!showHelp)}
              aria-label={showHelp ? 'Hide help' : 'Show help'}
              className={`p-1.5 rounded-md border transition-colors ${
                showHelp
                  ? 'border-primary/50 bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}
              title="Help & Keybindings"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPanelOpen(!panelOpen)}
              className={`p-1.5 rounded-md border transition-colors ${
                panelOpen
                  ? 'border-primary/50 bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}
              title="Toggle node panel"
              aria-label="Toggle node panel"
            >
              {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {showHelp && (
        <div className="px-5 py-2.5 bg-primary/5 border-b border-primary/20 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 shrink-0">
          <span>
            <strong className="text-primary">Water flow:</strong>{' '}
            Well → Raw Meter → Pre-treatment → Feed Meter → RO Train → Permeate / Reject → Bulk Meter → Locator
          </span>
          <span>
            <strong className="text-primary">Power:</strong>{' '}
            Solar Array → Solar Meter · Grid Utility → Grid Meter → Wells / RO Trains
          </span>
          <span>
            <strong className="text-primary">Inspect:</strong>{' '}
            Click any node to open full specifications, stream analysis, and operational deep-links.
          </span>
          <span>
            <strong className="text-primary">Edit:</strong>{' '}
            Use Connect/Disconnect below, click two compatible nodes, then Save.
          </span>
          <span>
            <strong className="text-primary">Navigate:</strong>{' '}
            {isMobile
              ? 'Drag / scroll to pan · Use floating +/− to zoom · Tap any node to inspect'
              : 'Scroll to pan (H+V) · Alt+drag / middle-click · Ctrl+scroll to zoom · Click node to inspect'}
          </span>
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-muted/20 shrink-0 flex-wrap">
          <span className="text-2xs font-mono tracking-widest text-muted-foreground uppercase mr-1">Edit Links:</span>
          <button
            onClick={() => { setEditMode(editMode === 'connect' ? null : 'connect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-all ${
              editMode === 'connect'
                ? 'bg-accent-soft border-accent text-accent shadow-2xs'
                : 'border-border text-muted-foreground hover:border-accent/60 hover:text-accent/90'
            }`}
          >
            <Plug className="h-3.5 w-3.5" />
            {editMode === 'connect' ? (pendingFrom ? 'Pick 2nd node…' : 'Pick node…') : 'Connect'}
          </button>
          <button
            onClick={() => { setEditMode(editMode === 'disconnect' ? null : 'disconnect'); setPendingFrom(null); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition-all ${
              editMode === 'disconnect'
                ? 'bg-danger-soft border-danger text-danger shadow-2xs'
                : 'border-border text-muted-foreground hover:border-danger/60 hover:text-danger/90'
            }`}
          >
            <Unplug className="h-3.5 w-3.5" />
            {editMode === 'disconnect' ? (pendingFrom ? 'Pick 2nd node…' : 'Pick node…') : 'Disconnect'}
          </button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={saving}
            className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/5 hover:border-primary ml-auto"
          >
            {saving
              ? <RefreshCw className="h-3 w-3 animate-spin mr-1" />
              : <Save className="h-3 w-3 mr-1" />}
            Save Topology
          </Button>
        </div>
      )}
    </>
  );
}
