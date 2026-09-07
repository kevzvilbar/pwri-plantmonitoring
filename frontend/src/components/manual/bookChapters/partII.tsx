import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partII : BookPart =   {
    part: 'Part II â€” Daily Operations',
    chapters: [
      {
        id: 'dashboard',
        number: 5,
        title: 'The Dashboard',
        dek: "A rolled-up view of one plant's health",
        body: (
          <>
            <Lead>
              The Dashboard is the landing page after sign-in â€” a rolled-up, at-a-glance view of one plant&rsquo;s
              production, quality, cost, and outstanding work, with quick links into whatever module actually
              needs attention. Three view modes â€” Inline, Sections, and Dialog â€” rearrange the same information
              differently; pick whichever is easiest to scan on your screen.
            </Lead>
            <P>
              KPI cards are grouped into four clusters â€” Overview, Quality, Production Cost, and Plant Health
              Trend â€” alongside a set of focused cards: a Non-Revenue Water gauge, a data-completeness radar
              (how many expected readings were actually logged), a cost sunburst, a PM due-soon card, a
              pending-review card for flagged readings, and a blending-volume card for plants using bypass
              wells. Selecting a metric that supports drill-down opens a trend chart plotting it over time, so
              you can confirm at a glance whether something is trending up, down, or flat.
            </P>
            <Note kind="tip">
              The Dashboard is read-only by design â€” it never lets you edit a reading directly. To fix a
              number you see here, go to the module that owns it, or use Data Corrections (Chapter 17) for a
              reading that&rsquo;s already been submitted.
            </Note>
          </>
        ),
      },
      {
        id: 'plants',
        number: 6,
        title: 'Plants Module',
        dek: 'Where the physical structure of your operation lives',
        body: (
          <>
            <Lead>
              Almost everything else in the app â€” Operations, RO Trains, Costs, Compliance â€” reads and writes
              against assets defined here, so getting this module right first makes everything downstream
              easier. The page opens on a grid of plant cards; selecting one opens a Plant Detail page with six
              tabs: Locators, Wells, Product, Trains, Power, and Configuration.
            </Lead>
            <H3>Locators and derived locators</H3>
            <P>
              A locator represents a raw-water intake meter. Most are physical meters an operator reads
              directly, but the system also supports{' '}
              <strong className="font-sans font-semibold not-italic">derived locators</strong> â€” a locator with
              no meter of its own, whose daily volume is calculated automatically as the mother meter&rsquo;s
              reading minus the sum of its sibling locators&rsquo; volumes. That&rsquo;s used when one bulk
              supply meter feeds several downstream points and only some of them have their own meters.
            </P>
            <H3>Wells, and marking one as blending</H3>
            <P>
              Wells carry their own water meter and, optionally, a dedicated electric meter. A well can be
              flagged as a{' '}
              <strong className="font-sans font-semibold not-italic">blending well</strong> â€” its output feeds
              the distribution line rather than being tracked as an independent production source â€” which
              routes it into the Blending tab in Operations and the Dashboard&rsquo;s blending-volume card.
              That toggle is Manager/Admin only, and turning it on asks you to confirm the well&rsquo;s current
              meter reading as the baseline.
            </P>
            <H3>Replacing a meter</H3>
            <P>
              Whenever a physical meter â€” locator or well â€” gets physically swapped, use{' '}
              <strong className="font-sans font-semibold not-italic">Replace meter</strong> rather than just
              editing the reading. It closes out the old meter&rsquo;s final reading and registers the new
              meter&rsquo;s brand, serial, and initial reading, which cleanly breaks the history at the swap
              point so the system doesn&rsquo;t compute a false usage spike between the old meter&rsquo;s last
              number and the new one&rsquo;s first. The same idea applies to a power meter&rsquo;s CT/multiplier
              on the Power tab â€” changing it is tracked with an effective date rather than silently misreading
              past data with the new ratio.
            </P>
          </>
        ),
      },
      {
        id: 'operations',
        number: 7,
        title: 'Wells & Locators â€” Daily Data Entry',
        dek: 'Five tabs, one save button per reading, and the guards behind every save',
        body: (
          <>
            <Lead>
              This is where field staff record daily readings â€” sidebar label &ldquo;Wells &amp; Locators,&rdquo;
              organized into five tabs (Locator, Well, Product, Blending, Power) matching the asset types set
              up in Plants. Every tab follows the same pattern: pick the plant, then each asset is its own card
              with its own field and its own Save button. You save each reading as you take it, not one giant
              form submitted all at once.
            </Lead>
            <WorkflowStrip
              steps={[
                { label: 'Choose plant', detail: 'Start in Wells & Locators and confirm the plant context before reading assets.' },
                { label: 'Save per asset', detail: 'Enter the cumulative meter value on its card, then save that reading immediately.' },
                { label: 'Review flags', detail: 'Pause on cooldowns, duplicate warnings, or pending-review badges before moving on.' },
              ]}
            />
            <ManualFigure
              title="Daily reading card"
              caption="The field workflow is intentionally one asset at a time: the current plant stays visible, each card owns its Save button, and unusual readings are surfaced instead of hidden."
            >
              <div className="min-w-[520px] rounded-lg border bg-background p-3 font-sans text-xs">
                <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
                  <div><div className="font-semibold text-foreground">Wells & Locators</div><div className="text-muted-foreground">Plant: North Injection Plant</div></div>
                  <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">Locator</span>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-3 flex items-center justify-between"><div><div className="font-medium text-foreground">Raw Water Inlet 01</div><div className="text-3xs text-muted-foreground">Last reading 12,480 mÂ³</div></div><span className="rounded-full bg-muted px-2 py-1 text-3xs text-muted-foreground">Ready to save</span></div>
                  <div className="flex items-center gap-2"><div className="flex-1 rounded-md border bg-muted/20 px-3 py-2 text-muted-foreground">12,520</div><button className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Save reading</button></div>
                </div>
              </div>
            </ManualFigure>
            <H3>The guards that run on every save</H3>
            <List
              items={[
                <><strong className="font-sans font-semibold not-italic">45-minute cooldown</strong> â€” the same person can&rsquo;t save a second reading for the same asset within 45 minutes of their last one; the Save button shows how many minutes remain.</>,
                <><strong className="font-sans font-semibold not-italic">Duplicate blocking</strong> â€” an identical reading already logged for that asset/time is rejected outright.</>,
                <><strong className="font-sans font-semibold not-italic">Mandatory Anomaly Remarks</strong> â€” whenever an entered reading deviates significantly from the moving baseline, a prominent amber/rose anomaly banner requires at least a 10-character operational explanation (e.g., pump serviced, peak demand, meter calibration) before the reading can be saved.</>,
                <><strong className="font-sans font-semibold not-italic">Backward-reading and spike detection</strong> â€” a cumulative reading lower than the last one, or an implied flow rate more than double the recent average, is still saved, but automatically tagged pending review for a supervisor rather than silently rejected.</>,
                <><strong className="font-sans font-semibold not-italic">Daily cap</strong> â€” wells stop accepting new readings after 3 in a single day.</>,
              ]}
            />
            <H3>Logging reading gaps and maintenance reasons</H3>
            <P>
              When an asset was offline, under maintenance, or has no reading for today, the system surfaces a prominent{' '}
              <strong className="font-sans font-semibold not-italic">&ldquo;Log gap reason&rdquo;</strong> badge directly
              in the asset&rsquo;s metadata strip across all tabs â€” Locators, Wells, Blending, and Product meters.
              These badges are never collapsed or hidden in menus: clicking the button prompts the operator for a reason
              (e.g., Planned maintenance, Sensor offline, Valve closed), which is recorded permanently in the gap ledger
              and displayed with a live status badge so supervisors and data analysts immediately understand missing telemetry.
            </P>
            <P>
              Two checkboxes bypass the false-positive side of those checks when an abnormal-looking reading is
              legitimate:{' '}
              <strong className="font-sans font-semibold not-italic">Meter replacement/Estimated</strong> for a
              newly installed meter or a deliberate estimate, and{' '}
              <strong className="font-sans font-semibold not-italic">Meter rollover</strong> for when the same
              physical meter has wrapped around its maximum digits â€” the system then computes the true
              wrap-around delta instead of clamping usage to zero.
            </P>
            <P>
              Wherever your browser has location permission enabled, saving a reading automatically geotags it
              with your GPS position and flags it if you&rsquo;re more than about 100 meters from where that
              asset is registered â€” a quiet cross-check that a reading was actually taken on-site.
            </P>
            <Note kind="warn">
              Found a mistake after the fact? Don&rsquo;t submit a second reading to &ldquo;correct&rdquo; it â€”
              that just creates a second data point. Wells and locators can be edited within the same session
              via &ldquo;Edit last reading&rdquo;; anything beyond that, or a reading someone else submitted,
              goes through Data Corrections (Chapter 17).
            </Note>
          </>
        ),
      },
      {
        id: 'ro-trains',
        number: 8,
        title: 'RO Trains & Pre-Treatment',
        dek: 'Performance logging, CIP cycles, chemical dosing, and inventory',
        body: (
          <>
            <Lead>
              The RO Trains module covers everything to do with Reverse Osmosis train performance: the daily
              pre-treatment/RO reading, backwash and CIP records, chemical dosing, and chemical stock, across
              four tabs â€” Overview, Pre-Treatment &amp; RO, CIP, and Chemical Dosing.
            </Lead>
            <ManualFigure
              title="Pre-Treatment & RO shift log"
              caption="Use the tab bar to move between Overview, Pre-Treatment & RO, CIP, and Chemical Dosing. Calculated deltas and quality percentages appear alongside the values they explain."
            >
              <div className="min-w-[520px] rounded-lg border bg-background p-3 font-sans text-xs">
                <div className="mb-3 flex gap-1 border-b pb-2"><span className="border-b-2 border-primary px-2 py-1 font-semibold text-primary">Pre-Treatment & RO</span><span className="px-2 py-1 text-muted-foreground">CIP</span><span className="px-2 py-1 text-muted-foreground">Chemical Dosing</span></div>
                <div className="grid grid-cols-3 gap-2"><div className="rounded-md border p-3"><div className="text-muted-foreground">Feed flow</div><div className="mt-1 text-lg font-semibold text-foreground">48.2 <span className="text-xs font-normal">mÂ³/h</span></div></div><div className="rounded-md border p-3"><div className="text-muted-foreground">Salt rejection</div><div className="mt-1 text-lg font-semibold text-primary">98.4%</div></div><div className="rounded-md border border-warn/40 bg-warn-soft p-3"><div className="text-muted-foreground">Î”P check</div><div className="mt-1 font-semibold text-foreground">Review</div></div></div>
              </div>
            </ManualFigure>
            <H3>The Pre-Treatment & RO reading</H3>
            <P>
              This is the primary shift log for train performance, organized into sections you fill in as
              relevant to your plant&rsquo;s SOP rather than every field every time: backwash activity (per
              train or per unit, with an auto-computed pressure differential); the high-pressure pump and
              cartridge filter; feed, permeate, and reject meters, with flowrates auto-computed from the meter
              delta; suction/feed/reject pressures with an automatic Î”P; and water quality â€” feed, permeate,
              and reject TDS and pH, with salt rejection and salt-passage percentages calculated for you, plus
              turbidity, temperature, and chlorine residual. A field showing a warning highlight (an
              out-of-range Î”P or a drifting permeate pH) isn&rsquo;t blocked from saving â€” it&rsquo;s a visual
              flag to double-check before you submit, and it typically also feeds a Compliance threshold
              (Chapter 21).
            </P>
            <H3>CIP and Chemical Dosing</H3>
            <P>
              The <strong className="font-sans font-semibold not-italic">CIP</strong> tab logs cleaning cycles â€”
              which chemicals were used (Caustic Soda, HCl, and SLS by default, plus any plant-specific
              chemicals), in what quantity, over what start/end window.{' '}
              <strong className="font-sans font-semibold not-italic">Chemical Dosing</strong> is a separate,
              day-to-day log for the chemicals actually added during water treatment â€” Chlorine, SMBS,
              Anti-scalant, Soda Ash by default â€” plus a free-chlorine residual test section where you can log
              several sampling points in one entry. Cost for both is estimated automatically from the current
              unit price (Chapter 13).
            </P>
            <H3>Chemical inventory</H3>
            <P>
              Current stock for each chemical is simply deliveries received minus quantity dosed, shown with a
              progress bar and a low-stock flag once it drops below a configured threshold. A Manager or Admin
              logs a delivery â€” plant, chemical, quantity, supplier, date â€” and the stock figure updates
              immediately.
            </P>
            <Note kind="tip">
              A regular Operator can edit an entry they personally recorded â€” reading, CIP, or dosing â€” for up
              to 8 hours after creation. After that window, or for someone else&rsquo;s entry, it goes through
              Data Corrections (Chapter 17); Manager and Data Analyst can always edit directly.
            </Note>
          </>
        ),
      },
      {
        id: 'topology',
        number: 9,
        title: 'Network Topology',
        dek: "A live diagram of how a plant's assets connect",
        body: (
          <>
            <Lead>
              Network Topology is a visual, drag-and-drop diagram showing how a plant&rsquo;s assets connect â€”
              locators feeding wells, wells feeding RO trains, trains feeding product meters, and so on. It is
              hidden for Operators.
            </Lead>
            <P>
              The diagram auto-populates from your real plant data and can be extended with manually placed
              custom nodes â€” tanks, valves, off-system points â€” for a fuller picture than the raw asset list
              alone. Manager and Admin can enter an edit mode, drag new nodes in from a palette with snap-to-grid
              alignment, rename them, and draw or remove connections representing a physical flow path; saving
              persists the layout for the next person who opens that plant&rsquo;s topology.
            </P>
          </>
        ),
      },
    ],
  };


