import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partV : BookPart =   {
    part: 'Part V: Team',
    chapters: [
      {
        id: 'employees',
        number: 13,
        title: 'Employees',
        dek: 'Staff directory, KPI scoring, and the org chart',
        body: (
          <>
            <Lead>
              Employees is visible to every role, including Operators, and covers three tabs: Staff, KPI, and
              Org chart.
            </Lead>
            <P>
              The <strong className="font-sans font-semibold not-italic">Staff</strong> tab lists every team
              member as a searchable, plant-filterable tile; selecting one opens a profile drawer and a
              direct-message window. Those messages are deliberately{' '}
              <strong className="font-sans font-semibold not-italic">ephemeral</strong>, auto-deleted after
              roughly 8 hours, a quick coordination channel for shift handovers, not a permanent record;
              anything worth keeping belongs in the module it actually concerns (Incidents, a Data Corrections
              note, and so on). The{' '}
              <strong className="font-sans font-semibold not-italic">KPI</strong> tab is a heatmap-style
              scorecard summarizing reading timeliness and completeness per employee over a selected period,
              green for everything logged, down through red for nothing, so a supervisor can spot who might
              need support at a glance. The <strong className="font-sans font-semibold not-italic">Org chart</strong> tab shows the reporting tree, built from each person&rsquo;s immediate supervisor assignment.
            </P>
            <WorkflowStrip
              steps={[
                { label: 'Roster & Staff View', detail: 'Filter team by plant, inspect assigned roles, and access ephemeral shift messaging.' },
                { label: 'Duty & KPI Tracking', detail: 'Inspect logging timeliness, on-time submissions, and completeness percentages.' },
                { label: 'Role & Deposition', detail: 'Admin manages assignments and applies DPA 2012 pseudonymization upon employee departure.' },
              ]}
            />
            <H3>Shift Duty &amp; KPI Completeness Scoring</H3>
            <P>
              The KPI scorecard measures field operational discipline by tracking two vital metrics for each shift worker:
            </P>
            <Ref
              cols={['KPI Metric', 'Calculation Method', 'Target Standard']}
              rows={[
                ['Logging Completeness', '(Submitted Meter Readings ÷ Scheduled Required Readings) × 100%', '≥ 98.0% across all assigned plant meters'],
                ['Timeliness Score', 'Readings submitted within ± 30 mins of scheduled shift handover window', '≥ 95.0% on-time submission rate'],
                ['Data Accuracy Rate', '100% - (Approved Error Corrections ÷ Total Logged Readings × 100%)', '≥ 99.5% accuracy (minimal dial typo requests)'],
              ]}
            />
            <H3>Staff Departure &amp; Privacy Pseudonymization</H3>
            <P>
              When an employee separates from the organization, an Administrator navigates to their profile and selects{' '}
              <strong className="font-sans font-semibold not-italic">Anonymize User</strong>. This permanently removes email addresses, full names, phone numbers, and notification credentials in accordance with the Philippine Data Privacy Act of 2012 (RA 10173), while preserving immutable internal user ID references so that historical water quality readings and regulatory audit trails remain fully valid.
            </P>
          </>
        ),
      },
    ],
  };


