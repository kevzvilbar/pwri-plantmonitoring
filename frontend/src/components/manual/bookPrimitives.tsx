import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared typography for the full-screen Manual book reader (BookReader.tsx).
 * Every chapter in bookChapters.tsx is written using only these primitives,
 * so the reading style — serif family, measure, line-height, drop cap — is
 * controlled from one place instead of being repeated 23 times.
 */

// Opening paragraph of a chapter — gets the drop cap, book-style.
export function Lead({ children }: { children: ReactNode }) {
  return (
    <p
      className={cn(
        'font-book-body text-[17px] sm:text-[18px] leading-[1.85] text-foreground/90 mb-5',
        'first-letter:font-book-heading first-letter:text-[3.4rem] first-letter:font-semibold',
        'first-letter:leading-[0.72] first-letter:float-left first-letter:mr-2.5 first-letter:mt-1',
        'first-letter:text-primary',
      )}
    >
      {children}
    </p>
  );
}

// Regular body paragraph.
export function P({ children }: { children: ReactNode }) {
  return <p className="font-book-body text-[17px] sm:text-[18px] leading-[1.85] text-foreground/90 mb-5">{children}</p>;
}

// In-chapter subheading (a "section" within a chapter, like 6.2 in the source manual).
export function H3({ children }: { children: ReactNode }) {
  return <h3 className="font-book-heading text-xl sm:text-2xl font-semibold text-foreground mt-9 mb-3">{children}</h3>;
}

// A tight run of book-style prose list items (not app-UI bullets).
export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="font-book-body text-[17px] sm:text-[18px] leading-[1.75] text-foreground/90 list-disc pl-5 space-y-1.5 mb-5 marker:text-primary/60">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

// A small reference table (role tiers, thresholds, tab lists) — kept in the
// app's UI sans-serif rather than the reading serif, the way a real book
// sets its data tables in a different face than the body copy.
export function Ref({ rows, cols }: { rows: ReactNode[][]; cols: string[] }) {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border font-sans text-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-muted/50">
            {cols.map((c, i) => (
              <th key={i} className="text-left font-semibold text-foreground px-3 py-2 border-b">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 1 ? 'bg-muted/20' : undefined}>
              {row.map((cell, j) => (
                <td key={j} className="align-top px-3 py-2 border-b last:border-b-0 text-foreground/85">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Marginal callout — a "tip" or a "caution," set like a printed manual's
// sidebar note rather than blended into the reading paragraph.
export function Note({ children, kind = 'tip' }: { children: ReactNode; kind?: 'tip' | 'warn' }) {
  return (
    <div
      className={cn(
        'not-prose font-sans text-[13.5px] leading-relaxed rounded-md border-l-[3px] pl-4 pr-4 py-3 my-6',
        kind === 'tip' ? 'border-primary/50 bg-primary/5 text-foreground/80' : 'border-warn/60 bg-warn-soft text-foreground/80',
      )}
    >
      {children}
    </div>
  );
}

// A theme-aware, app-style figure used in place of brittle external screenshots.
// It documents the real controls without requiring a static image asset.
export function ManualFigure({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <figure className="not-prose my-8 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/35 px-3 py-2 font-sans">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full bg-primary/70" aria-hidden="true" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">App walkthrough</span>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">PWRI Plant Monitoring</span>
      </div>
      <div className="overflow-x-auto p-3 sm:p-4">{children}</div>
      <figcaption className="border-t px-3 py-3 font-sans text-xs leading-relaxed text-muted-foreground sm:px-4">
        <span className="font-semibold text-foreground">{title}.</span> {caption}
      </figcaption>
    </figure>
  );
}

export function WorkflowStrip({ steps }: { steps: { label: string; detail: string }[] }) {
  return (
    <div className="not-prose my-6 grid gap-2 font-sans sm:grid-cols-3">
      {steps.map((step, index) => (
        <div key={step.label} className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{index + 1}</span>
            <span className="text-xs font-semibold text-foreground">{step.label}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
        </div>
      ))}
    </div>
  );
}
