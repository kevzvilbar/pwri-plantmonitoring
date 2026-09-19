import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';

export function MeterGroupChips({
  label,
  groupName,
  members,
  allEntities,
  entityLabel,
  onMembersChange,
  onGroupNameChange,
  onDeleteGroup,
  canEdit,
}: {
  label: string;
  groupName: string;
  members: string[];
  allEntities: Array<{ id: string; name: string }>;
  entityLabel: string;
  onMembersChange: (ids: string[]) => void;
  onGroupNameChange: (name: string) => void;
  onDeleteGroup?: () => void;
  canEdit: boolean;
}) {
  const available = allEntities.filter(e => !members.includes(e.id));
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3 space-y-2.5 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        {canEdit ? (
          <Input
            value={groupName}
            onChange={e => onGroupNameChange(e.target.value)}
            placeholder="Group name (e.g. Main Pump House)"
            className="h-8 text-xs font-semibold max-w-sm"
          />
        ) : (
          <p className="text-xs font-bold text-foreground">{groupName || label}</p>
        )}
        {canEdit && onDeleteGroup && (
          <button
            type="button"
            onClick={onDeleteGroup}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            aria-label="Remove group"
            title="Delete group"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {members.map(id => {
          const e = allEntities.find(x => x.id === id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/40 font-medium transition-all shadow-2xs"
            >
              <span>{e?.name ?? id}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onMembersChange(members.filter(m => m !== id))}
                  className="h-3.5 w-3.5 rounded-full hover:bg-primary/20 flex items-center justify-center text-primary/70 hover:text-primary transition-colors -mr-1"
                  aria-label={`Remove ${e?.name}`}
                  title="Remove"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          );
        })}
        {canEdit && available.length > 0 && (
          <Select onValueChange={id => onMembersChange([...members, id])}>
            <SelectTrigger className="h-6 w-auto text-xs px-2.5 py-0 rounded-full border-dashed border-border/80 bg-muted/30 hover:bg-muted font-medium">
              <Plus className="h-3 w-3 mr-1 text-primary" />Add {entityLabel}
            </SelectTrigger>
            <SelectContent>
              {available.map(e => (
                <SelectItem key={e.id} value={e.id} className="text-xs">{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
