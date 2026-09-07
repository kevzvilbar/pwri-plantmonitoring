import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partIII : BookPart =   {
    part: 'Part III â€” Maintenance & Response',
    chapters: [
      {
        id: 'pm-schedule',
        number: 10,
        title: 'PM Schedule',
        dek: 'Preventive maintenance: equipment, checklists, and due dates',
        body: (
          <>
            <Lead>
              PM Schedule manages preventive maintenance across three tabs: Calendar, Add Equipment, and
              Records.
            </Lead>
            <P>
              For a new plant â€” or to top up anything missing â€” a Manager or Admin can select{' '}
              <strong className="font-sans font-semibold not-italic">Generate Standard PMS Library</strong> on
              the Add Equipment tab for one-tap setup of the common categories most plants need: Genset, RO,
              Dosing Pump, Controllers, Cartridge Filter, Pumps &amp; Motors, and pH/NTU/Colorimeter. Anything
              that already exists for the plant is skipped automatically, so it&rsquo;s safe to run more than
              once.
            </P>
            <P>
              For anything the standard library doesn&rsquo;t cover, add custom equipment directly: a category,
              an equipment name, one or more frequencies (Daily, Weekly, Monthly, Quarterly, Yearly â€” one
              schedule is generated per frequency selected), a start date, and optional custom checklist steps
              (leave them blank to use the standard template for that category). When a scheduled task comes
              due, whoever completes it works through the checklist, adds notes, and marks it complete â€” the
              record moves into Records with a timestamp, and the schedule automatically rolls forward to its
              next due date based on the frequency.
            </P>
          </>
        ),
      },
      {
        id: 'incidents',
        number: 11,
        title: 'Incidents',
        dek: "The plant's incident reporting and resolution log",
        body: (
          <>
            <Lead>
              Incidents has three tabs â€” Open (unresolved, needing follow-up), Report (log a new one), and
              History (closed).
            </Lead>
            <P>
              Reporting captures a type (Equipment failure, Chemical spill, Power outage, Safety incident,
              Quality deviation, Other) and severity (Low through Critical), then what happened, where, when,
              and who witnessed it, plus optional weather/temperature and the immediate action taken at the
              time. The form autosaves a draft as you type, so a long report isn&rsquo;t lost if you have to
              step away mid-entry. Closing an incident â€” Manager/Admin, or Technician where enabled â€” requires
              root cause, corrective action, and preventive measures before it&rsquo;s allowed to move from
              Open to History, which keeps the History tab genuinely useful for spotting repeat failures at the
              same site rather than just a pile of closed tickets.
            </P>
          </>
        ),
      },
    ],
  };


