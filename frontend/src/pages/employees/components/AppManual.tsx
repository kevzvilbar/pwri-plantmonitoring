import { useState } from 'react';
import { BookOpen, CheckCircle2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

import React from 'react';
import { BookReader } from '@/components/manual/BookReader';
import { BOOK_PARTS } from '@/components/manual/bookChapters';

const ALL_MANUAL_CHAPTERS = BOOK_PARTS.flatMap((p) => p.chapters);

function AppManual() {
  const [bookOpen, setBookOpen] = useState(false);
  const [initialChapterId, setInitialChapterId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');

  const openAt = (chapterId?: string) => {
    setInitialChapterId(chapterId);
    setBookOpen(true);
  };

  const q = query.trim().toLowerCase();
  const suggestions = q
    ? ALL_MANUAL_CHAPTERS.filter(
        (c) => c.title.toLowerCase().includes(q) || c.dek.toLowerCase().includes(q),
      ).slice(0, 6)
    : [];

  return (
    <div className="rounded-lg border overflow-hidden bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="shrink-0 w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center">
          <BookOpen className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-book-heading text-2xl font-semibold text-foreground leading-tight">
            Operations Manual
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {ALL_MANUAL_CHAPTERS.length} chapters, from your first sign-in to running the Admin Console —
            open it as a book, or search for a topic below.
          </p>
        </div>
        <button
          onClick={() => openAt(undefined)}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <BookOpen className="h-3.5 w-3.5" /> Open Manual
        </button>
      </div>

      <div className="border-t bg-muted/20 px-5 py-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-foreground">Shift handover quick start</div>
            <div className="text-2xs text-muted-foreground">A practical path for the next reading round.</div>
          </div>
          <button onClick={() => openAt('operations')} className="shrink-0 text-2xs font-medium text-primary hover:underline">Open daily entry</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['Confirm context', 'Check the plant and asset tab before entering a value.', 'dashboard'],
            ['Log the shift', 'Save Wells & Locators, then complete RO and dosing records.', 'operations'],
            ['Close the loop', 'Review flags and send corrections through the review workflow.', 'data-corrections'],
          ].map(([label, detail, chapter]) => (
            <button key={label} onClick={() => openAt(chapter)} className="flex items-start gap-2 rounded-md border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span><span className="block text-xs font-medium text-foreground">{label}</span><span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground">{detail}</span></span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 sm:px-6 pb-5 sm:pb-6">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a topic — e.g. “compliance thresholds” or “delete a user”…"
            className="pl-8 h-9 text-xs bg-background"
          />
        </div>
        {suggestions.length > 0 && (
          <div className="mt-2 border rounded-md overflow-hidden bg-background">
            {suggestions.map((c) => (
              <button
                key={c.id}
                onClick={() => openAt(c.id)}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted/50 transition-colors border-b last:border-b-0"
              >
                <span className="font-sans tabular-nums text-muted-foreground w-4 text-right shrink-0">{c.number}</span>
                <span className="text-foreground font-medium">{c.title}</span>
                <span className="text-muted-foreground truncate">— {c.dek}</span>
              </button>
            ))}
          </div>
        )}
        {q && suggestions.length === 0 && (
          <p className="text-2xs text-muted-foreground mt-2 px-1">No chapters match &ldquo;{query}&rdquo;.</p>
        )}
      </div>

      <BookReader open={bookOpen} onOpenChange={setBookOpen} initialChapterId={initialChapterId} />
    </div>
  );
}



export { AppManual };
