import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Upload, FileSpreadsheet, X } from 'lucide-react';

interface DropZoneProps {
  onFile: (f: File) => void;
  file: File | null;
  onClear: () => void;
  id?: string;
}

export function DropZone({ onFile, file, onClear, id }: DropZoneProps) {
  const ref = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      className={cn(
        'relative rounded-lg border-2 border-dashed transition-colors cursor-pointer',
        file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30',
      )}
      onClick={() => !file && ref.current?.click()}
    >
      <input
        ref={ref}
        id={id}
        type="file"
        accept=".csv,.txt"
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      {file ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onClear(); }}
            className="rounded p-1 hover:bg-muted transition-colors"
            aria-label="Remove file"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-7 text-center">
          <Upload className="h-5 w-5 text-muted-foreground/50" />
          <div>
            <p className="text-sm text-muted-foreground">
              Drop a <span className="font-semibold text-foreground">.csv</span> or{' '}
              <span className="font-semibold text-foreground">.txt</span> file here
            </p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">or click to browse from device</p>
          </div>
        </div>
      )}
    </div>
  );
}
