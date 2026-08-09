import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { BOOK_PARTS, type BookChapter } from './bookChapters';
import { BookOpen, ChevronLeft, ChevronRight, Menu, Search, X } from 'lucide-react';

// Flat, numbered reading order — used for prev/next and the "Chapter N of
// TOTAL" indicator, independent of how chapters are grouped into Parts for
// the table of contents.
const ALL_CHAPTERS: BookChapter[] = BOOK_PARTS.flatMap((p) => p.chapters);
const TOTAL_CHAPTERS = ALL_CHAPTERS.length;

type BookReaderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialChapterId?: string;
};

export function BookReader({ open, onOpenChange, initialChapterId }: BookReaderProps) {
  const isMobile = useIsMobile();
  const [activeId, setActiveId] = useState(initialChapterId ?? ALL_CHAPTERS[0].id);
  const [query, setQuery] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // Re-sync to whichever chapter the launcher asked for each time the
  // reader is (re)opened, and always start scrolled to the top of it.
  useEffect(() => {
    if (open) {
      setActiveId(initialChapterId ?? ALL_CHAPTERS[0].id);
      setQuery('');
      setTocOpen(false);
    }
  }, [open, initialChapterId]);

  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeId]);

  const activeIndex = useMemo(() => ALL_CHAPTERS.findIndex((c) => c.id === activeId), [activeId]);
  const active = ALL_CHAPTERS[activeIndex] ?? ALL_CHAPTERS[0];
  const prev = activeIndex > 0 ? ALL_CHAPTERS[activeIndex - 1] : null;
  const next = activeIndex < TOTAL_CHAPTERS - 1 ? ALL_CHAPTERS[activeIndex + 1] : null;
  const activePart = BOOK_PARTS.find((p) => p.chapters.some((c) => c.id === active.id))?.part ?? '';

  const q = query.trim().toLowerCase();
  const filteredParts = q
    ? BOOK_PARTS.map((p) => ({
        ...p,
        chapters: p.chapters.filter(
          (c) => c.title.toLowerCase().includes(q) || c.dek.toLowerCase().includes(q),
        ),
      })).filter((p) => p.chapters.length > 0)
    : BOOK_PARTS;

  const goTo = (id: string) => {
    setActiveId(id);
    if (isMobile) setTocOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none w-screen h-[100dvh] inset-0 top-0 left-0 translate-x-0 translate-y-0 rounded-none border-0 p-0 gap-0 flex flex-col sm:rounded-none [&>button]:z-30"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">PWRI Plant Monitoring — Operations Manual</DialogTitle>

        {/* Header */}
        <div className="shrink-0 h-14 border-b flex items-center gap-3 px-4 sm:px-5 bg-background">
          <button
            className="md:hidden -ml-1 p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground"
            onClick={() => setTocOpen((v) => !v)}
            aria-label="Toggle chapter list"
          >
            {tocOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <BookOpen className="h-4 w-4 text-primary shrink-0 hidden sm:block" />
          <div className="min-w-0">
            <div className="font-sans text-sm font-semibold text-foreground truncate">
              PWRI Plant Monitoring — Operations Manual
            </div>
            <div className="font-sans text-2xs text-muted-foreground hidden sm:block">
              Chapter {active.number} of {TOTAL_CHAPTERS} · {activePart.replace(/^Part [IVX]+ — /, '')}
            </div>
          </div>
        </div>

        {/* Progress rule */}
        <div className="shrink-0 h-[2px] bg-muted/60">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((activeIndex + 1) / TOTAL_CHAPTERS) * 100}%` }}
          />
        </div>

        <div className="flex-1 min-h-0 flex relative">
          {/* Mobile scrim */}
          {tocOpen && (
            <div
              className="md:hidden fixed inset-0 top-[58px] bg-black/40 z-10"
              onClick={() => setTocOpen(false)}
            />
          )}

          {/* Table of contents */}
          <div
            className={cn(
              'w-72 shrink-0 border-r bg-background flex flex-col',
              'md:static md:translate-x-0',
              'fixed inset-y-[58px] left-0 z-20 transition-transform duration-200',
              tocOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            )}
          >
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chapters…"
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {filteredParts.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No chapters match &ldquo;{query}&rdquo;.</p>
              )}
              {filteredParts.map((p) => (
                <div key={p.part} className="space-y-0.5">
                  <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-1">
                    {p.part}
                  </div>
                  {p.chapters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => goTo(c.id)}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-md text-xs flex items-start gap-2 transition-colors',
                        c.id === active.id
                          ? 'bg-primary/10 text-foreground font-medium'
                          : 'text-foreground/80 hover:bg-muted/60',
                      )}
                    >
                      <span className={cn('font-sans tabular-nums shrink-0 w-4 text-right', c.id === active.id ? 'text-primary' : 'text-muted-foreground')}>
                        {c.number}
                      </span>
                      <span className="leading-snug">{c.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Reading pane */}
          <div ref={paneRef} className="flex-1 min-w-0 overflow-y-auto bg-background">
            <article className="mx-auto max-w-[68ch] px-6 sm:px-10 py-10 sm:py-16">
              <div className="font-sans text-2xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
                Chapter {active.number}
              </div>
              <h1 className="font-book-heading text-4xl sm:text-[2.75rem] font-semibold text-foreground leading-tight">
                {active.title}
              </h1>
              <p className="font-book-body italic text-muted-foreground text-base mt-3 mb-8">{active.dek}</p>
              <div className="h-px bg-border mb-8" />

              <div key={active.id}>{active.body}</div>

              <div className="mt-14 pt-6 border-t flex items-stretch justify-between gap-4">
                {prev ? (
                  <button
                    onClick={() => goTo(prev.id)}
                    className="flex-1 text-left group flex items-center gap-2 min-w-0"
                  >
                    <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0 group-hover:-translate-x-0.5 transition-transform" />
                    <span className="min-w-0">
                      <span className="block font-sans text-2xs text-muted-foreground">Previous</span>
                      <span className="block font-sans text-sm text-foreground truncate group-hover:underline">{prev.title}</span>
                    </span>
                  </button>
                ) : (
                  <span />
                )}
                {next ? (
                  <button
                    onClick={() => goTo(next.id)}
                    className="flex-1 text-right group flex items-center justify-end gap-2 min-w-0"
                  >
                    <span className="min-w-0">
                      <span className="block font-sans text-2xs text-muted-foreground">Next</span>
                      <span className="block font-sans text-sm text-foreground truncate group-hover:underline">{next.title}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </article>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
