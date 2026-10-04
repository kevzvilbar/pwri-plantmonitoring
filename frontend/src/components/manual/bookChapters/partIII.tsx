import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partIII : BookPart =   {
    part: 'Part III: Maintenance & Response',
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
              For a new plant, or to top up anything missing, a Manager or Admin can select{' '}
              <strong className="font-sans font-semibold not-italic">Generate Standard PMS Library</strong> on
              the Add Equipment tab for one-tap setup of the common categories most plants need: Genset, RO,
              Dosing Pump, Controllers, Cartridge Filter, Pumps &amp; Motors, and pH/NTU/Colorimeter. Anything
              that already exists for the plant is skipped automatically, so it&rsquo;s safe to run more than
              once.
            </P>
            <Ref
              cols={['Frequency', 'Typical Tasks', 'Target Equipment']}
              rows={[
                ['Daily', 'Visual leak inspection, suction/discharge gauge verification', 'Booster pumps, chemical dosing skids, RO feed pumps'],
                ['Weekly', 'Cartridge filter ΔP check, chemical strainer cleanout, battery test', 'Prefiltration, chemical tanks, emergency standby genset'],
                ['Monthly', 'Bearing vibration analysis, motor terminal tightening, oil top-up', 'High-pressure pumps, blowers, raw water intake pumps'],
                ['Quarterly', 'Dosing pump diaphragm replacement, sensor calibration (pH/NTU)', 'Water quality analyzers, dosing metering heads'],
                ['Yearly', 'Comprehensive electrical thermography, pressure vessel hydrotest', 'Main switchgear, RO membrane pressure vessels'],
              ]}
            />
            <WorkflowStrip
              steps={[
                { label: 'Review Due Tasks', detail: 'Inspect Calendar tab or Dashboard PM Due Soon card for pending tasks.' },
                { label: 'Execute Checklist', detail: 'Perform physical inspection, tick items, and attach parts/fluid notes.' },
                { label: 'Digital Sign-Off', detail: 'Mark complete; system logs your user signature and advances schedule.' },
              ]}
            />
            <Note kind="tip">
              If an inspection reveals damaged components requiring shutdown or major replacement, do not merely record it in PM notes, log an official ticket in the Incidents module (Chapter 11) to trigger corrective tracking.
            </Note>
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
              Incidents provides a structured, auditable tracking system across three tabs: Open (active unresolved issues), Report (log a new occurrence), and History (verified closed records).
            </Lead>
            <Ref
              cols={['Severity', 'Definition & Impact', 'Response SLA & Notification']}
              rows={[
                ['Critical', 'Total plant shutdown, raw water contamination, major chemical spill, injury', 'Immediate response (< 15 mins), mandatory supervisor & DPO alert'],
                ['High', 'Single RO train offline, critical dosing pump failure, major piping leak', 'Response within 1 hour, target resolution within 8 hours'],
                ['Medium', 'Elevated membrane ΔP, non-critical sensor failure, minor valve seepage', 'Response within 4 hours, resolved within current shift'],
                ['Low', 'Minor cosmetic issue, panel indicator lamp out, non-urgent maintenance', 'Resolved during routine scheduled maintenance'],
              ]}
            />
            <WorkflowStrip
              steps={[
                { label: 'Report Incident', detail: 'Capture type, severity, location, witnesses, and immediate action (drafts autosaved).' },
                { label: 'Investigate & RCA', detail: 'Technician/Manager identifies physical root cause and corrective repairs.' },
                { label: 'Preventive Closure', detail: 'Document systemic preventive measures before closing ticket to History.' },
              ]}
            />
            <P>
              Closing an incident (Manager/Admin, or Technician where enabled) strictly requires documentation of Root Cause, Corrective Action, and Preventive Measures before moving from Open to History. This ensures the historical log serves as a reliable engineering knowledge base rather than an uncurated ticket archive.
            </P>
          </>
        ),
      },
    ],
  };


