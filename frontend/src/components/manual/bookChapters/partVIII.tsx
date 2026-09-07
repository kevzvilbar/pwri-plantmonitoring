import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';

export const partVIII: BookPart = {
  part: 'Part VIII — Reference',
  chapters: [
    {
      id: 'troubleshooting',
      number: 23,
      title: 'Troubleshooting & FAQ',
      dek: 'Common problems, and the honest answer to a few recurring questions',
      body: (
        <>
          <Lead>
            A handful of situations account for most support questions — most of them are covered in detail
            in their own chapter, but here they are gathered in one place.
          </Lead>
          <Ref
            cols={['Symptom', 'Cause', 'Fix']}
            rows={[
              ['"Incorrect email or password"', 'Wrong credentials, or the wrong plus-addressed email for a multi-operator batch.', 'Confirm the exact email used at account creation; reset the password if truly forgotten.'],
              ['Stuck on "awaiting Admin approval"', 'No Admin has approved the account yet.', 'Select Refresh status periodically, or ask an Admin to check Admin Console → Users.'],
              ['"cooldown — next reading available in ..."', 'You already saved a reading for this asset within the last 45 minutes.', 'Wait it out, or have a different authorized person take it if genuinely urgent.'],
              ['A reading is greyed out / flagged', 'Auto-tagged as a backward reading or a spike.', 'No action needed — a Manager/Data Analyst reviews it in Data Corrections.'],
              ["I can't edit a reading I entered", "It's outside your edit window, or belongs to someone else.", 'Submit a correction request instead (Chapter 17).'],
              ['CSV import fails immediately', "Column headers don't match the expected template.", 'Re-download the current template and match headers exactly.'],
              ["An import created records I didn't want", 'A malformed CSV, or the wrong target plant.', "Ask an Admin to run Bad Import Cleanup in the Admin Console."],
            ]}
          />
          <H3>Frequently asked questions</H3>
          <P>
            <strong className="font-sans font-semibold not-italic">Can I use the app offline?</strong> No — it&rsquo;s
            a connected web app; you need network access to sign in and save data. If connectivity at your
            site is unreliable, plan to record readings on paper as a backup and enter them once you&rsquo;re
            back online.
          </P>
          <P>
            <strong className="font-sans font-semibold not-italic">Why can&rsquo;t I see Compliance, Costs,
            or the Admin Console?</strong> These are hidden for the Operator role by design (Chapter 4). If
            your job genuinely needs visibility into them, that&rsquo;s a conversation with an Admin about a
            Technician-or-higher role, not a bug to report.
          </P>
          <P>
            <strong className="font-sans font-semibold not-italic">I found a data error from months ago —
            what do I do?</strong> Don&rsquo;t try to fix it with a new reading. Use Data Corrections
            (Chapter 17) — a correction request if you can&rsquo;t edit it directly, or the regression/raw-edit
            tool in Data Analysis &amp; Review (Chapter 16) if you have Data Analyst/Admin access — so the
            change is reviewed and captured in the audit trail.
          </P>
        </>
      ),
    },
    {
      id: 'glossary',
      number: 24,
      title: 'Glossary & Quick Reference',
      dek: 'Terms used throughout this manual',
      body: (
        <>
          <Lead>
            A short reference for terms used throughout this manual, gathered in one place for whenever a
            chapter uses a word you haven&rsquo;t seen defined yet.
          </Lead>
          <Ref
            cols={['Term', 'Meaning']}
            rows={[
              ['Locator', 'A raw-water intake meter/point feeding the plant.'],
              ['Derived locator', "A locator with no physical meter; its volume is computed as mother meter reading minus sibling locators."],
              ['Well', 'A production/injection well with its own water meter and, optionally, a dedicated electric meter.'],
              ['Blending well', 'A well flagged as feeding blended distribution rather than tracked as an independent source.'],
              ['RO Train', 'A Reverse Osmosis processing line within a plant.'],
              ['CIP', 'Clean-In-Place — a chemical cleaning cycle run on an RO train.'],
              ['NRW', 'Non-Revenue Water — water produced but not accounted for as delivered/billed output.'],
              ['ΔP', 'Differential pressure — the pressure drop across a filter, membrane, or element; a rising ΔP often signals fouling.'],
              ['Recovery %', 'The percentage of feed water converted to permeate (product) water in an RO process.'],
              ['Salt rejection %', "The percentage of dissolved salts an RO membrane removes from the feed stream."],
              ['Designation', "A user's descriptive job title — distinct from their system role."],
              ['Role', 'The access-control level assigned to a user: Operator, Technician, Manager, Data Analyst, or Admin.'],
              ['Soft delete', 'Deactivating a record without erasing it — reversible.'],
              ['Hard delete', 'Permanently erasing a record — blocked while dependent records exist.'],
              ['Force delete', 'A hard delete with an explicit override that cascades through dependent records — irreversible.'],
            ]}
          />
        </>
      ),
    },
  ],
};
