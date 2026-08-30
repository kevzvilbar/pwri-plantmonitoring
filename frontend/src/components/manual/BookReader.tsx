import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { BOOK_PARTS, type BookChapter } from './bookChapters';
import { BookOpen, ChevronLeft, ChevronRight, Menu, Search, X, Printer, Bookmark, Copy, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// Flat, numbered reading order
const ALL_CHAPTERS: BookChapter[] = BOOK_PARTS.flatMap((p) => p.chapters);
const TOTAL_CHAPTERS = ALL_CHAPTERS.length;

// Mapping chapters to their respective in-app routes
const CHAPTER_ROUTE_MAP: Record<string, string> = {
  dashboard: '/',
  plants: '/plants',
  operations: '/operations',
  'ro-trains': '/ro-trains',
  topology: '/topology',
  'pm-schedule': '/maintenance',
  incidents: '/incidents',
  costs: '/costs',
  employees: '/employees',
  'smart-import': '/import',
  exports: '/exports',
  'data-analysis': '/data-analysis',
  'data-corrections': '/data-corrections',
  'manager-scorecard': '/manager-scorecard',
  'alerts-triage': '/alerts',
  compliance: '/compliance',
  'admin-console': '/admin',
  profile: '/profile',
};

type BookReaderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialChapterId?: string;
};

export function BookReader({ open, onOpenChange, initialChapterId }: BookReaderProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState(initialChapterId ?? ALL_CHAPTERS[0].id);
  const [query, setQuery] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('pwri_manual_bookmarks') || '[]');
    } catch {
      return [];
    }
  });

  const paneRef = useRef<HTMLDivElement>(null);

  // Re-sync to initial chapter on open
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
  const relatedRoute = CHAPTER_ROUTE_MAP[active.id];

  const isBookmarked = bookmarks.includes(active.id);

  const toggleBookmark = () => {
    const nextBookmarks = isBookmarked
      ? bookmarks.filter((id) => id !== active.id)
      : [...bookmarks, active.id];
    setBookmarks(nextBookmarks);
    try {
      localStorage.setItem('pwri_manual_bookmarks', JSON.stringify(nextBookmarks));
      toast.success(isBookmarked ? 'Bookmark removed' : 'Chapter bookmarked');
    } catch {
      // Ignore storage errors
    }
  };

  const copyChapterLink = () => {
    const url = `${window.location.origin}/employees?chapter=${active.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success('Chapter link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const q = query.trim().toLowerCase();
  const filteredParts = q
    ? BOOK_PARTS.map((p) => ({
        ...p,
        chapters: p.chapters.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            c.dek.toLowerCase().includes(q) ||
            c.number.toString() === q,
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

        {/* Header Toolbar */}
        <div className="shrink-0 h-14 border-b flex items-center justify-between gap-3 px-4 sm:px-5 bg-background select-none">
          <div className="flex items-center gap-3 min-w-0">
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

          {/* Quick Reader Actions */}
          <div className="flex items-center gap-1.5 pr-8 sm:pr-10">
            {relatedRoute && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate(relatedRoute);
                }}
                className="hidden sm:inline-flex items-center gap-1 text-2xs font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded-md transition-colors"
                title="Go to the page described in this chapter"
              >
                <span>Open module</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleBookmark}
              className={cn(
                'p-1.5 rounded-md transition-colors text-xs flex items-center gap-1 font-medium',
                isBookmarked
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              title={isBookmarked ? 'Remove bookmark' : 'Bookmark this chapter'}
            >
              <Bookmark className={cn('h-4 w-4', isBookmarked && 'fill-current')} />
              <span className="hidden sm:inline text-2xs">{isBookmarked ? 'Bookmarked' : 'Bookmark'}</span>
            </button>

            <button
              type="button"
              onClick={copyChapterLink}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Copy chapter link"
            >
              {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors hidden sm:block"
              title="Print chapter"
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Reading Progress Indicator */}
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

          {/* Table of contents sidebar */}
          <div
            className={cn(
              'w-72 shrink-0 border-r bg-background flex flex-col',
              'md:static md:translate-x-0',
              'fixed inset-y-[58px] left-0 z-20 transition-transform duration-200',
              tocOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            )}
          >
            <div className="p-3 border-b space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chapters or #"
                  className="pl-8 h-8 text-xs font-sans"
                />
              </div>

              {bookmarks.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                  <span className="text-3xs text-muted-foreground font-semibold uppercase">Saved:</span>
                  {bookmarks.map((bmId) => {
                    const c = ALL_CHAPTERS.find((ch) => ch.id === bmId);
                    if (!c) return null;
                    return (
                      <button
                        key={bmId}
                        onClick={() => goTo(bmId)}
                        className={cn(
                          'text-3xs px-1.5 py-0.5 rounded border transition-colors shrink-0 font-mono-num',
                          bmId === active.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted/40 text-foreground hover:bg-muted'
                        )}
                      >
                        Ch {c.number}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4 font-sans">
              {filteredParts.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No chapters match &ldquo;{query}&rdquo;.</p>
              )}
              {filteredParts.map((p) => (
                <div key={p.part} className="space-y-0.5">
                  <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-1">
                    {p.part}
                  </div>
                  {p.chapters.map((c) => {
                    const bm = bookmarks.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => goTo(c.id)}
                        className={cn(
                          'w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center justify-between gap-2 transition-colors',
                          c.id === active.id
                            ? 'bg-primary/10 text-foreground font-semibold'
                            : 'text-foreground/80 hover:bg-muted/60',
                        )}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <span className={cn('font-mono-num tabular-nums shrink-0 w-4 text-right', c.id === active.id ? 'text-primary' : 'text-muted-foreground')}>
                            {c.number}
                          </span>
                          <span className="leading-snug truncate">{c.title}</span>
                        </div>
                        {bm && <Bookmark className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Reading pane */}
          <div ref={paneRef} className="flex-1 min-w-0 overflow-y-auto bg-background">
            <article className="mx-auto max-w-[68ch] px-6 sm:px-10 py-10 sm:py-16">
              <div className="flex items-center justify-between gap-4 mb-3 font-sans">
                <div className="text-2xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                  Chapter {active.number}
                </div>
                {relatedRoute && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      navigate(relatedRoute);
                    }}
                    className="sm:hidden text-3xs font-semibold text-primary flex items-center gap-1 hover:underline"
                  >
                    <span>Open screen</span>
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>

              <h1 className="font-book-heading text-4xl sm:text-[2.75rem] font-semibold text-foreground leading-tight">
                {active.title}
              </h1>
              <p className="font-book-body italic text-muted-foreground text-base mt-3 mb-8">{active.dek}</p>
              <div className="h-px bg-border mb-8" />

              <div key={active.id}>{active.body}</div>

              {/* Prev / Next Footer */}
              <div className="mt-14 pt-6 border-t flex items-stretch justify-between gap-4 select-none">
                {prev ? (
                  <button
                    onClick={() => goTo(prev.id)}
                    className="flex-1 text-left group flex items-center gap-2 min-w-0"
                  >
                    <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0 group-hover:-translate-x-0.5 transition-transform" />
                    <span className="min-w-0">
                      <span className="block font-sans text-2xs text-muted-foreground font-semibold">Previous</span>
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
                      <span className="block font-sans text-2xs text-muted-foreground font-semibold">Next</span>
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
