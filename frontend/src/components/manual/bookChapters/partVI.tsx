import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partVI : BookPart =   {
    part: 'Part VI â€” Data & Analysis',
    chapters: [
      {
        id: 'smart-import',
        number: 14,
        title: 'Smart Import',
        dek: 'Bulk-loading historical or backfill data from a spreadsheet',
        body: (
          <>
            <Lead>
              Manager, Data Analyst, and Admin only. Smart Import is a general-purpose bulk-loader, grouped by
              category â€” Operations (locator, well, product readings), RO Trains (TDS, water quality, pump, AFM
              readings), Chemical (dosing, deliveries), Power, and Finance.
            </Lead>
            <P>
              The pattern is the same for every data type: pick the import type and the target plant, download
              the built-in template for the exact expected column layout, then drop in your CSV or plain-text
              file. A parsed preview lets you check the data before committing anything, and an optional{' '}
              <strong className="font-sans font-semibold not-italic">skip invalid rows</strong> setting means a
              handful of bad rows don&rsquo;t block the whole file â€” a progress log then shows exactly what was
              processed and what wasn&rsquo;t.
            </P>
            <Note kind="warn">
              A CSV aimed at the wrong plant, or one that&rsquo;s badly malformed, can create records you didn&rsquo;t
              want. An Admin can bulk-remove them afterward using Bad Import Cleanup in the Admin Console
              (Chapter 20) rather than hunting down each bad record by hand.
            </Note>
          </>
        ),
      },
      {
        id: 'exports',
        number: 15,
        title: 'Data Exports',
        dek: 'Pulling data out for reporting, analysis, or regulators',
        body: (
          <>
            <Lead>
              Manager, Data Analyst, and Admin only. Tables are grouped by category â€” Operations, RO Trains,
              Chemical, Power, Maintenance, Incidents, Finance, and more â€” each exportable individually or as
              part of a full export.
            </Lead>
            <P>
              Set a plant filter and a date range (quick presets, or a custom range), then export whichever
              table you need under its category card, and a filtered download begins immediately. When you need
              everything rather than one table at a time â€”{' '}
              <strong className="font-sans font-semibold not-italic">Export All</strong> pulls every table for
              the current scope in a single action, which is the fastest route to a full backup or a complete
              handover package.
            </P>
          </>
        ),
      },
      {
        id: 'data-analysis',
        number: 16,
        title: 'Data Analysis & Review',
        dek: 'The one place raw history can be statistically checked and corrected',
        body: (
          <>
            <Lead>
              Every other page in the app is intentionally read-only with respect to historical values. Data
              Analysis & Review is the exception â€” visible to Manager, Data Analyst, and Admin, though Manager
              access is view-only; only Data Analyst and Admin can actually run the tool and edit values.
            </Lead>
            <P>
              The core tool runs an{' '}
              <strong className="font-sans font-semibold not-italic">OLS regression</strong> against a chosen
              column â€” daily volume, a meter reading, permeate TDS, recovery percentage, and similar fields
              across well, locator, product-meter, RO-train, and power readings â€” flags statistical outliers by
              Z-score, and proposes a corrected value for each. Nothing is changed automatically: you review
              each proposed correction and choose{' '}
              <strong className="font-sans font-semibold not-italic">Apply</strong> or leave it, and can{' '}
              <strong className="font-sans font-semibold not-italic">Retract</strong> a correction you&rsquo;ve
              already applied. A raw-data table alongside it lets you edit any of the latest 200 rows by hand
              instead, when that&rsquo;s the more direct fix â€” either way, every edit is written to the audit
              trail. Two sub-tabs round the page out: Edit Audit (every manual edit made here) and Flagged
              Readings (what&rsquo;s currently marked abnormal for the selected table) â€” a narrower,
              table-specific slice of what Data Corrections shows across every table at once.
            </P>
          </>
        ),
      },
      {
        id: 'data-corrections',
        number: 17,
        title: 'Data Corrections',
        dek: 'The central review workflow for anything the system flags',
        body: (
          <>
            <Lead>
              Manager, Data Analyst, and Admin only, across four tabs: Pending, Inbox, History, and Operators.
              This is where every backward reading, spike, and manually-requested correction across the whole
              app ends up for review.
            </Lead>
            <H3>Pending</H3>
            <P>
              Lists readings the system auto-tagged pending review, plus correction requests submitted by field
              staff, with a count badge showing how many are waiting. Expanding a row shows the previous and
              current reading, the computed volume, and who recorded it; from there a reviewer can{' '}
              <strong className="font-sans font-semibold not-italic">Approve</strong> it as-is,{' '}
              <strong className="font-sans font-semibold not-italic">Edit value</strong> to type the corrected
              figure, or <strong className="font-sans font-semibold not-italic">Reject</strong> it as invalid â€”
              with bulk actions for handling several readings that share the same disposition at once. Approving
              a reading <strong className="font-sans font-semibold not-italic">locks</strong> it against further
              edits; an Unlock control reopens it if needed later.
            </P>
            <H3>Requesting a correction</H3>
            <P>
              When a reading is outside your own edit window (same session for Wells/Locators, 8 hours for RO
              Trains logs â€” Chapter 8) or was recorded by someone else, the right move is a{' '}
              <strong className="font-sans font-semibold not-italic">correction request</strong>, not a direct
              edit: propose the correct value, pick the closest reason (meter misread, data-entry typo, wrong
              anchor reading, meter replaced, duplicate submission, wrong asset, or other), and add a short
              description. It lands in Pending for a reviewer, and you&rsquo;re notified of the outcome either
              way.
            </P>
            <H3>Inbox, History, and Operators</H3>
            <P>
              <strong className="font-sans font-semibold not-italic">Inbox</strong> is a separate safety net â€”
              readings technically marked &ldquo;normal&rdquo; that still compute to a negative daily volume,
              something worth a second look even though nothing auto-flagged it.{' '}
              <strong className="font-sans font-semibold not-italic">History</strong> is the full audit trail of
              every correction action taken anywhere in the system, and{' '}
              <strong className="font-sans font-semibold not-italic">Operators</strong> rolls up accuracy
              statistics per person â€” how often their readings get flagged â€” a useful lens for coaching, not
              just correction.
            </P>
          </>
        ),
      },
      {
        id: 'manager-scorecard',
        number: 18,
        title: 'Manager Scorecard',
        dek: "A per-plant rollup of data quality, for the people overseeing it",
        body: (
          <>
            <Lead>
              Visible to Manager, Data Analyst, and Admin. Manager Scorecard rolls up data-quality
              oversight per plant over a selectable time window â€” completeness, unexplained gaps, and open
              exceptions â€” so a manager doesn&rsquo;t have to reconcile several other pages by hand just to know
              whether a plant&rsquo;s data is actually being kept up.
            </Lead>
            <P>
              The scorecard aggregates compliance across three dimensions: reading frequency (whether expected daily
              entries were submitted on time), coverage of gap logs (confirming that every missing entry has an
              explicit logged maintenance or outage reason), and pending correction resolution. It offers area
              managers immediate visibility into operational compliance trends without requiring manual log audits.
            </P>
          </>
        ),
      },
    ],
  };


