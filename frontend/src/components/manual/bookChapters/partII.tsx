import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
import { FlaskConical, Droplets } from 'lucide-react';
export const partII : BookPart =   {
    part: 'Part II: Daily Operations',
    chapters: [
      {
        id: 'dashboard',
        number: 5,
        title: 'The Dashboard',
        dek: "A rolled-up view of one plant's health",
        body: (
          <>
            <Lead>
              The Dashboard is the landing page after sign-in, a rolled-up, at-a-glance view of one plant&rsquo;s
              production, quality, cost, and outstanding work, with quick links into whatever module actually
              needs attention. Three view modes, Inline, Sections, and Dialog, rearrange the same information
              differently; pick whichever is easiest to scan on your screen.
            </Lead>
            <P>
              KPI cards are grouped into four clusters, Overview, Quality, Production Cost, and Plant Health
              Trend, alongside a set of focused cards: a Non-Revenue Water gauge, a data-completeness radar
              (how many expected readings were actually logged), a cost sunburst, a PM due-soon card, a
              pending-review card for flagged readings, and a blending-volume card for plants using bypass
              wells. Selecting a metric that supports drill-down opens a trend chart plotting it over time, so
              you can confirm at a glance whether something is trending up, down, or flat.
            </P>
            <Note kind="tip">
              The Dashboard is read-only by design, it never lets you edit a reading directly. To fix a
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
              Almost everything else in the app, Operations, RO Trains, Costs, Compliance, reads and writes
              against assets defined here, so getting this module right first makes everything downstream
              easier. The page opens on a grid of plant cards; selecting one opens a Plant Detail page with six
              tabs: Locators, Wells, Product, Trains, Power, and Configuration.
            </Lead>
            <H3>Locators and derived locators</H3>
            <P>
              A locator represents a raw-water intake meter. Most are physical meters an operator reads
              directly, but the system also supports{' '}
              <strong className="font-sans font-semibold not-italic">derived locators</strong>, a locator with
              no meter of its own, whose daily volume is calculated automatically as the mother meter&rsquo;s
              reading minus the sum of its sibling locators&rsquo; volumes. That&rsquo;s used when one bulk
              supply meter feeds several downstream points and only some of them have their own meters.
            </P>
            <H3>Wells, and marking one as blending</H3>
            <P>
              Wells carry their own water meter and, optionally, a dedicated electric meter. A well can be
              flagged as a{' '}
              <strong className="font-sans font-semibold not-italic">blending well</strong>, its output feeds
              the distribution line rather than being tracked as an independent production source, which
              routes it into the Blending tab in Operations and the Dashboard&rsquo;s blending-volume card.
              That toggle is Manager/Admin only, and turning it on asks you to confirm the well&rsquo;s current
              meter reading as the baseline.
            </P>
            <H3>The Configuration tab: meter instrumentation</H3>
            <P>
              The Configuration tab is where you tell the system which meters <em>actually exist</em> and how
              each train&rsquo;s readings are taken, Operations, RO Trains, Costs, and the NRW math all
              read their expectations from here. It&rsquo;s an accordion of independently collapsible sections
, RO Trains, Product Meters, Wells, Locators, Power, Component Types, and Chemicals, 
              each with a badge counting how many meters are switched on. A Manager or Admin makes changes
              here; everyone else sees the current truth.
            </P>
            <P>
              The RO Trains section opens with the three flow-meter tiles on one row, Feed, Permeate,
              and Reject. Toggling a meter off isn&rsquo;t losing data, it&rsquo;s choosing derived math: with
              the feed meter off and the other two on, feed volume is computed as{' '}
              <span className="font-mono text-[0.85em]">permeate + reject</span>; with the reject meter off,
              it&rsquo;s <span className="font-mono text-[0.85em]">feed &minus; permeate</span>. Each
              tile&rsquo;s subtitle states exactly which equation is in effect, so you never have to guess.
              Below the tiles sits the per-train meter instrumentation list, every train gets a
              three-way control: <strong className="font-sans font-semibold not-italic">Turbine (Common)</strong>{' '}
              (operator-entered flows),{' '}
              <strong className="font-sans font-semibold not-italic">All Electromagnetic (EMF)</strong> (an electromagnetic
              flow meter on every stream), or{' '}
              <strong className="font-sans font-semibold not-italic">Mixed</strong> (Electromagnetic (EMF) on selected streams
              only, picking it reveals per-stream toggles). The{' '}
              <strong className="font-sans font-semibold not-italic">Set all to</strong> control in the
              header applies one choice to every train as a single confirmed batch. On desktop the train
              list sits two-up with each control stretched across its row, a seven-train plant reads
              at a glance instead of scrolling, and the rows stack one-per-train on phones.
            </P>
            <ManualFigure
              title="Plant Configuration: RO Trains section"
              caption="The three flow-meter tiles share one row, and the per-train instrumentation list sits two-up on desktop with each Turbine (Common) / All Electromagnetic (EMF) / Mixed control stretched across its row. Set all to (header, right) batch-applies one mode to every train; here the feed meter is off, so feed volume is derived as permeate + reject."
            >
              <div className="min-w-[560px] rounded-lg border bg-background p-3 font-sans text-xs">
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">Feed meter</div><div className="text-3xs leading-snug text-muted-foreground">Off: computed as permeate + reject</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-primary/50 bg-primary-soft/30 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">Permeate meter</div><div className="text-3xs leading-snug text-muted-foreground">Filtered / product-side output</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-border bg-muted/20 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">Reject meter</div><div className="text-3xs leading-snug text-muted-foreground">Brine / concentrate output</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-foreground/70" aria-hidden="true" />
                  </div>
                </div>
                <div className="rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                    <span className="font-medium uppercase tracking-wide text-muted-foreground">Per-train meter instrumentation &middot; 7 trains</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Set all to</span>
                      <span className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
                        <span className="rounded-md px-2 py-1 text-muted-foreground">Turbine (Common)</span>
                        <span className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground shadow-sm">All Electromagnetic (EMF)</span>
                        <span className="rounded-md px-2 py-1 text-muted-foreground">Mixed</span>
                      </span>
                    </span>
                  </div>
                  <div className="grid grid-cols-2">
                    {[
                      { t: 'RO1', m: 'all' as const },
                      { t: 'RO2', m: 'mixed' as const },
                      { t: 'RO3', m: 'all' as const },
                      { t: 'RO4', m: 'manual' as const },
                    ].map((row, i) => (
                      <div key={row.t} className={'flex items-center gap-2 border-b border-border px-3 py-2.5' + (i % 2 === 0 ? ' border-r' : '')}>
                        <span className="w-9 shrink-0 font-medium text-foreground">{row.t}</span>
                        <span className="flex flex-1 gap-0.5 rounded-lg bg-muted p-0.5">
                          {(['manual', 'all', 'mixed'] as const).map(opt => (
                            <span
                              key={opt}
                              className={'flex-1 rounded-md px-2 py-1 text-center ' + (row.m === opt ? 'bg-primary font-medium text-primary-foreground shadow-sm' : 'text-muted-foreground')}
                            >
                              {opt === 'all' ? 'All Electromagnetic (EMF)' : opt === 'manual' ? 'Turbine (Common)' : 'Mixed'}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                    <div className="hidden border-b border-border sm:block" aria-hidden="true" />
                  </div>
                </div>
                <div className="mt-2 text-3xs text-muted-foreground">RO2 is set to Mixed, in the live app its row expands with per-stream toggles (Feed / Permeate / Reject) choosing which streams carry Electromagnetic (EMF) meters. Trains RO5&ndash;RO7 continue below; on phones everything stacks one row per train.</div>
              </div>
            </ManualFigure>
            <P>
              The same one-row treatment continues through the other asset sections. Per-train utility
              meters are separate toggles, does each train have its own kWh meter, its own water
              meter, and enabling per-train electricity raises shared power meter groups (several
              trains splitting one physical meter). Wells always have their own water meter; their section
              only asks how <em>electricity</em> is metered, as three tiles on one row, shared,
              dedicated per well, or none. Locators likewise always log a water meter; their section asks
              how <em>bulk</em> metering works, dedicated bulk meter, a shared bulk meter group
              (several locators splitting one mother meter, with the member list managed right below), or
              no bulk meter at all.
            </P>
            <ManualFigure
              title="Wells and Locators meter sections"
              caption="Both asset sections present their full choice set on one row. Wells ask how electricity is metered (shared, dedicated per well, or none); locators ask how bulk metering works. A purple-highlighted tile marks the active shared bulk meter group option."
            >
              <div className="min-w-[560px] rounded-lg border bg-background p-3 font-sans text-xs">
                <div className="mb-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Wells: electricity metering</div>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">Shared electric meter</div><div className="text-3xs leading-snug text-muted-foreground">Multiple wells / colboxes share one kWh meter</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">Dedicated meter (per well)</div><div className="text-3xs leading-snug text-muted-foreground">Some wells have their own kWh meter</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-primary/50 bg-primary-soft/30 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">No electricity metering</div><div className="text-3xs leading-snug text-muted-foreground">Some wells have no kWh meter at all</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  </div>
                </div>
                <div className="mb-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Locators: bulk / product metering</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">Dedicated bulk meter</div><div className="text-3xs leading-snug text-muted-foreground">Some locators have their own bulk meter</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-purple-400/60 bg-purple-500/10 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">Shared bulk meter group</div><div className="text-3xs leading-snug text-muted-foreground">Multiple locators share one bulk meter</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-purple-500" aria-hidden="true" />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 p-2.5">
                    <div className="min-w-0"><div className="font-semibold text-foreground">No bulk meter (some locators)</div><div className="text-3xs leading-snug text-muted-foreground">Certain locators only track water meter</div></div>
                    <span className="h-4 w-7 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                  </div>
                </div>
              </div>
            </ManualFigure>
            <Note kind="tip">
              These switches are expectations, not observations, they change what Operations asks
              for and what the system derives, and per-train instrumentation saves the moment you tap a
              mode (hence its &ldquo;Saves instantly&rdquo; badge). Historical readings are never rewritten
              by a later change: turning a meter off today doesn&rsquo;t recompute yesterday.
            </Note>
            <H3>Replacing a meter</H3>
            <P>
              Whenever a physical meter, locator or well, gets physically swapped, use{' '}
              <strong className="font-sans font-semibold not-italic">Replace meter</strong> rather than just
              editing the reading. It closes out the old meter&rsquo;s final reading and registers the new
              meter&rsquo;s brand, serial, and initial reading, which cleanly breaks the history at the swap
              point so the system doesn&rsquo;t compute a false usage spike between the old meter&rsquo;s last
              number and the new one&rsquo;s first. The same idea applies to a power meter&rsquo;s CT/multiplier
              on the Power tab, changing it is tracked with an effective date rather than silently misreading
              past data with the new ratio.
            </P>
          </>
        ),
      },
      {
        id: 'operations',
        number: 7,
        title: 'Wells & Locators, Daily Data Entry',
        dek: 'Five tabs, one save button per reading, and the guards behind every save',
        body: (
          <>
            <Lead>
              This is where field staff record daily readings, sidebar label &ldquo;Wells &amp; Locators,&rdquo;
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
                <><strong className="font-sans font-semibold not-italic">45-minute cooldown</strong>, the same person can&rsquo;t save a second reading for the same asset within 45 minutes of their last one; the Save button shows how many minutes remain.</>,
                <><strong className="font-sans font-semibold not-italic">Duplicate blocking</strong>, an identical reading already logged for that asset/time is rejected outright.</>,
                <><strong className="font-sans font-semibold not-italic">Mandatory Anomaly Remarks</strong>, whenever an entered reading deviates significantly from the moving baseline, a prominent amber/rose anomaly banner requires at least a 10-character operational explanation (e.g., pump serviced, peak demand, meter calibration) before the reading can be saved.</>,
                <><strong className="font-sans font-semibold not-italic">Backward-reading and spike detection</strong>, a cumulative reading lower than the last one, or an implied flow rate more than double the recent average, is still saved, but automatically tagged pending review for a supervisor rather than silently rejected.</>,
                <><strong className="font-sans font-semibold not-italic">Daily cap</strong>, wells stop accepting new readings after 3 in a single day.</>,
              ]}
            />
            <H3>Logging reading gaps and maintenance reasons</H3>
            <P>
              When an asset was offline, under maintenance, or has no reading for today, the system surfaces a prominent{' '}
              <strong className="font-sans font-semibold not-italic">&ldquo;Log gap reason&rdquo;</strong> badge directly
              in the asset&rsquo;s metadata strip across all tabs, Locators, Wells, Blending, and Product meters.
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
              physical meter has wrapped around its maximum digits, the system then computes the true
              wrap-around delta instead of clamping usage to zero.
            </P>
            <P>
              Wherever your browser has location permission enabled, saving a reading automatically geotags it
              with your GPS position and flags it if you&rsquo;re more than about 100 meters from where that
              asset is registered, a quiet cross-check that a reading was actually taken on-site.
            </P>
            <Note kind="warn">
              Found a mistake after the fact? Don&rsquo;t submit a second reading to &ldquo;correct&rdquo; it,
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
              four tabs, Overview, Pre-Treatment &amp; RO, CIP, and Chemical Dosing.
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
              delta; suction/feed/reject pressures with an automatic Î”P; and water quality, feed, permeate,
              and reject TDS and pH, with salt rejection and salt-passage percentages calculated for you, plus
              turbidity, temperature, and chlorine residual. A field showing a warning highlight (an
              out-of-range Î”P or a drifting permeate pH) isn&rsquo;t blocked from saving, it&rsquo;s a visual
              flag to double-check before you submit, and it typically also feeds a Compliance threshold
              (Chapter 21).
            </P>
            <H3>CIP and Chemical Dosing</H3>
            <P>
              The <strong className="font-sans font-semibold not-italic">CIP</strong> tab logs cleaning cycles,
              which chemicals were used (Caustic Soda, HCl, and SLS by default, plus any plant-specific
              chemicals), in what quantity, over what start/end window.{' '}
              <strong className="font-sans font-semibold not-italic">Chemical Dosing</strong> is a separate,
              day-to-day log for the chemicals actually added during water treatment, Chlorine, SMBS,
              Anti-scalant, Soda Ash by default, plus a free-chlorine residual test section where you can log
              several sampling points in one entry. Cost for both is estimated automatically from the current
              unit price (Chapter 13).
            </P>
            <P>
              The dosing form itself is built for speed at the end of a shift. Each chemical is an
              icon-coded card, a flask for each dosed chemical, droplets for the water-quality
              header, with its own quantity input and unit; a card lights up in its accent color the
              moment it has a value. Only the chemicals your plant actually doses appear (the set is
              controlled per plant in Configuration, Chapter 6), a sidebar keeps running totals, 
              mass dosed, liquid volume, estimated cost, and the free-chlorine residual test
              expands into one row per sampling point: name the point, enter the ppm, and the average
              is stored with the entry. Bulk-logged a paper sheet instead? The import dialog accepts a
              CSV of dosing rows.
            </P>
            <ManualFigure
              title="Chemical Dosing: daily log"
              caption="Icon-coded chemical cards light up as quantities are entered; the sidebar totals mass, volume, and estimated cost live. Below the cards, the free-chlorine residual test expands to one row per sampling point, and the average residual is saved with the entry."
            >
              <div className="min-w-[560px] rounded-lg border bg-background p-3 font-sans text-xs">
                <div className="grid grid-cols-[1fr_170px] gap-3">
                  <div>
                    <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
                      <Droplets className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      <span className="font-medium text-foreground">North Injection Plant</span>
                      <span className="ml-auto text-muted-foreground">2026-09-13 14:00</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { n: 'Chlorine', u: 'kg', a: 'teal', v: '12.5' },
                        { n: 'SMBS', u: 'kg', a: 'amber', v: '6.0' },
                        { n: 'Anti-scalant', u: 'L', a: 'olive', v: '8.0' },
                        { n: 'Soda Ash', u: 'kg', a: 'default', v: '' },
                      ].map(c => (
                        <div key={c.n} className={'rounded-lg border-2 p-2 ' + (c.v ? (c.a === 'teal' ? 'border-primary bg-primary-soft/40' : 'border-warn bg-warn-soft/40') : 'border-border bg-muted/10')}>
                          <div className="mb-1 flex items-center gap-1.5">
                            <FlaskConical className={'h-3.5 w-3.5 ' + (c.v ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                            <span className="font-semibold text-foreground">{c.n}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1">
                            <span className={c.v ? 'text-foreground' : 'text-muted-foreground/50'}>{c.v || 'Inputs'}</span>
                            <span className="text-muted-foreground">{c.u}</span>
                          </div>
                          <div className={'mt-1.5 h-0.5 rounded-full ' + (c.v ? 'bg-primary/60' : 'bg-muted')}>
                            <div className={'h-full rounded-full ' + (c.v ? 'w-1/2 bg-primary' : 'w-0')} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 rounded-md border border-border p-2">
                      <div className="mb-1.5 font-semibold text-foreground">Free chlorine residual, 3 sampling points</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1"><span className="text-muted-foreground">After cartridge filter</span><span className="font-medium text-foreground">0.42 ppm</span></div>
                        <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1"><span className="text-muted-foreground">Product tank</span><span className="font-medium text-foreground">0.38 ppm</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-md border border-border bg-muted/20 p-2.5">
                      <div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Today&rsquo;s totals</div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Mass dosed</span><span className="font-medium text-foreground">18.5 kg</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Liquid volume</span><span className="font-medium text-foreground">8.0 L</span></div>
                    </div>
                    <div className="rounded-md border-2 border-primary/50 bg-primary-soft/30 p-2.5">
                      <div className="text-muted-foreground">Estimated cost</div>
                      <div className="text-base font-semibold text-primary">&#8369;1,240.50</div>
                      <div className="text-3xs text-muted-foreground">from current unit prices</div>
                    </div>
                  </div>
                </div>
              </div>
            </ManualFigure>
            <H3>Chemical inventory</H3>
            <P>
              Current stock for each chemical is simply deliveries received minus quantity dosed, shown with a
              progress bar and a low-stock flag once it drops below a configured threshold. A Manager or Admin
              logs a delivery, plant, chemical, quantity, supplier, date, and the stock figure updates
              immediately.
            </P>
            <Note kind="tip">
              A regular Operator can edit an entry they personally recorded, reading, CIP, or dosing, for up
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
              Network Topology is a visual, drag-and-drop diagram showing how a plant&rsquo;s assets connect,
              locators feeding wells, wells feeding RO trains, trains feeding product meters, and so on. It is
              hidden for Operators.
            </Lead>
            <P>
              The diagram auto-populates from your real plant data and can be extended with manually placed
              custom nodes, tanks, valves, off-system points, for a fuller picture than the raw asset list
              alone. Manager and Admin can enter an edit mode, drag new nodes in from a palette with snap-to-grid
              alignment, rename them, and draw or remove connections representing a physical flow path; saving
              persists the layout for the next person who opens that plant&rsquo;s topology.
            </P>
          </>
        ),
      },
    ],
  };


