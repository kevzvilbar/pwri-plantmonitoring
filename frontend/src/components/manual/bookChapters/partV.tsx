import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partV : BookPart =   {
    part: 'Part V â€” Team',
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
              Info.
            </Lead>
            <P>
              The <strong className="font-sans font-semibold not-italic">Staff</strong> tab lists every team
              member as a searchable, plant-filterable tile; selecting one opens a profile drawer and a
              direct-message window. Those messages are deliberately{' '}
              <strong className="font-sans font-semibold not-italic">ephemeral</strong> â€” auto-deleted after
              roughly 8 hours â€” a quick coordination channel for shift handovers, not a permanent record;
              anything worth keeping belongs in the module it actually concerns (Incidents, a Data Corrections
              note, and so on). The{' '}
              <strong className="font-sans font-semibold not-italic">KPI</strong> tab is a heatmap-style
              scorecard summarizing reading timeliness and completeness per employee over a selected period â€”
              green for everything logged, down through red for nothing â€” so a supervisor can spot who might
              need support at a glance. The{' '}
              <strong className="font-sans font-semibold not-italic">Info</strong> tab carries this reader, plus
              a reporting-tree org chart built from each person&rsquo;s immediate supervisor assignment.
            </P>
          </>
        ),
      },
    ],
  };


