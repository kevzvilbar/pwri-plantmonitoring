import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, PanelRightClose, Plus, Trash2, Pencil, CheckCircle2, XCircle } from 'lucide-react';
import { NodeType, CustomColumn, BASE_COL_SLOTS, TopoNode, TopologyState, NODE_LABELS, COLORS, withAlpha, Zone } from './shared';

// ─── Side Panel ─────────────────────────────────────────────────────────────────

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  topoState: TopologyState | null;
  customNodes: TopoNode[];
  customColumns: CustomColumn[];
  plantId: string;
  canEdit: boolean;
  onAddNode: (type: 'bulk' | 'locator' | 'customNode', name: string, colId?: string) => void;
  onDeleteCustomNode: (id: string) => void;
  onRenameCustomNode: (id: string, name: string) => void;
  onAddColumn: (label: string, insertAfter: string) => void;
  onDeleteColumn: (id: string) => void;
}

export function SidePanel({
  open, onClose, topoState, customNodes, customColumns, canEdit,
  onAddNode, onDeleteCustomNode, onRenameCustomNode, onAddColumn, onDeleteColumn,
}: SidePanelProps) {
  const [addType, setAddType] = useState<'bulk' | 'locator' | string>('bulk');
  const [addName, setAddName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newColName, setNewColName] = useState('');
  const [insertAfter, setInsertAfter] = useState<string>('feedMeter');
  const [activeTab, setActiveTab] = useState<'row' | 'column'>('row');

  const counts: Partial<Record<NodeType, number>> = {};
  (topoState?.nodes ?? []).forEach((n) => {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
  });

  function handleAdd() {
    if (!addName.trim()) return;
    const isCustomCol = addType !== 'bulk' && addType !== 'locator';
    if (isCustomCol) {
      onAddNode('customNode', addName.trim(), addType);
    } else {
      onAddNode(addType as 'bulk' | 'locator', addName.trim());
    }
    setAddName('');
  }

  function handleAddColumn() {
    if (!newColName.trim()) return;
    onAddColumn(newColName.trim(), insertAfter);
    setNewColName('');
    setActiveTab('row');
  }

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 z-30 flex flex-col bg-card border-l border-border shadow-2xl transition-all duration-300 ease-in-out overflow-hidden ${
        open ? 'w-full sm:w-72 opacity-100' : 'w-0 opacity-0 pointer-events-none'
      }`}
      style={{ minWidth: open ? undefined : 0 }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 shrink-0">
        <div>
          <p className="text-3xs font-mono tracking-widest text-muted-foreground uppercase">Topology</p>
          <h2 className="text-sm font-bold text-foreground">Node Panel</h2>
        </div>
        <button onClick={onClose} aria-label="Close node panel" className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Inventory */}
      <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
        <p className="text-3xs font-mono tracking-widest text-muted-foreground uppercase mb-2">Node Inventory</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.entries(counts) as [NodeType, number][]).map(([type, count]) => (
            <div
              key={type}
              className="flex items-center justify-between rounded-md px-2 py-1 text-2xs font-mono"
              style={{ background: COLORS[type].bg, border: `1px solid ${withAlpha(COLORS[type].border, 0.125)}` }}
            >
              <span style={{ color: COLORS[type].text }} className="truncate">{NODE_LABELS[type]}</span>
              <span
                className="ml-1 rounded-full px-1.5 py-0.5 text-3xs font-bold"
                style={{ background: COLORS[type].accent, color: '#fff' }}
              >
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Add Column / Add Row */}
      {canEdit && (
        <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">

          {/* Tabs */}
          <div className="flex gap-0.5 mb-3 bg-muted rounded-md p-0.5">
            {(['row', 'column'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1 rounded text-2xs font-semibold transition-all ${
                  activeTab === tab
                    ? 'bg-card shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'row' ? '＋ Add Row' : '＋ Add Column'}
              </button>
            ))}
          </div>

          {activeTab === 'column' ? (
            /* ── Add Column ── */
            <div>
              <p className="text-3xs font-mono tracking-widest text-muted-foreground uppercase mb-2">Insert After</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {BASE_COL_SLOTS.map((slot) => (
                  <button
                    key={slot.key}
                    onClick={() => setInsertAfter(slot.key)}
                    className={`px-2 py-0.5 rounded text-2xs font-semibold border transition-all ${
                      insertAfter === slot.key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {slot.label.replace(' / REJECT', '')}
                  </button>
                ))}
              </div>
              <p className="text-3xs font-mono tracking-widest text-muted-foreground uppercase mb-2">Column Name</p>
              <div className="flex gap-1.5">
                <input
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
                  placeholder="e.g. Storage Tank"
                  className="h-7 text-xs flex-1 rounded-md border border-input bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" onClick={handleAddColumn} className="h-7 px-2" disabled={!newColName.trim()} aria-label="Add column">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {customColumns.length > 0 && (
                <div className="mt-3 flex flex-col gap-1">
                  <p className="text-3xs font-mono tracking-widest text-muted-foreground uppercase mb-1">Your Columns</p>
                  {customColumns.map((col) => {
                    const after = BASE_COL_SLOTS.find((s) => s.key === col.insertAfter);
                    return (
                      <div key={col.id} className="flex items-center gap-1.5 rounded px-2 py-1.5 bg-muted/50 border border-border">
                        <div className="flex-1 min-w-0">
                          <div className="text-2xs font-semibold text-foreground truncate">{col.label}</div>
                          <div className="text-3xs text-muted-foreground">after {after?.label ?? col.insertAfter}</div>
                        </div>
                        <button
                          onClick={() => onDeleteColumn(col.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          title="Delete column and its nodes"
                          aria-label="Delete column and its nodes"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Add Row ── */
            <div>
              <p className="text-3xs font-mono tracking-widest text-muted-foreground uppercase mb-2">Column</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {(['bulk', 'locator'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAddType(t)}
                    className={`px-2 py-0.5 rounded text-2xs font-semibold border transition-all ${
                      addType === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {t === 'bulk' ? 'Bulk Meter' : 'Locator'}
                  </button>
                ))}
                {customColumns.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => setAddType(col.id)}
                    className={`px-2 py-0.5 rounded text-2xs font-semibold border transition-all ${
                      addType === col.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {col.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder={
                    addType === 'bulk' ? 'e.g. Bulk Meter 3'
                    : addType === 'locator' ? 'e.g. Zone A'
                    : 'e.g. Tank 1'
                  }
                  className="h-7 text-xs"
                />
                <Button size="sm" onClick={handleAdd} className="h-7 px-2" disabled={!addName.trim()} aria-label="Add item">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Custom nodes list */}
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        {customNodes.length > 0 && (
          <>
            <p className="text-3xs font-mono tracking-widest text-muted-foreground uppercase mb-2">
              Custom Nodes ({customNodes.length})
            </p>
            <div className="flex flex-col gap-1.5">
              {customNodes.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 border"
                  style={{ background: COLORS[n.type].bg, borderColor: `${COLORS[n.type].border}40` }}
                >
                  {editId === n.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { onRenameCustomNode(n.id, editName); setEditId(null); }
                          if (e.key === 'Escape') setEditId(null);
                        }}
                        className="h-5 text-2xs flex-1 p-1"
                        autoFocus
                      />
                      <button onClick={() => { onRenameCustomNode(n.id, editName); setEditId(null); }} aria-label="Save name" className="text-accent hover:text-accent/90">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setEditId(null)} aria-label="Cancel rename" className="text-muted-foreground hover:text-foreground">
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className="text-3xs font-mono rounded px-1"
                        style={{ background: COLORS[n.type].accent, color: '#fff' }}
                      >
                        {NODE_LABELS[n.type]}
                      </span>
                      <span className="flex-1 text-2xs font-medium truncate" style={{ color: COLORS[n.type].text }}>
                        {n.label}
                      </span>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => { setEditId(n.id); setEditName(n.label); }}
                            aria-label="Rename node"
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => onDeleteCustomNode(n.id)}
                            aria-label="Delete node"
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {customNodes.length === 0 && canEdit && (
          <p className="text-2xs text-muted-foreground text-center pt-4">
            Use "Add Box" above to create custom bulk meter or locator nodes.
          </p>
        )}
      </div>
    </div>
  );
}

