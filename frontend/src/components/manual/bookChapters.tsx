import type { ReactNode } from 'react';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from './bookPrimitives';

export type BookChapter = {
  id: string;
  number: number;
  title: string;
  dek: string;
  body: ReactNode;
};

export type BookPart = {
  part: string;
  chapters: BookChapter[];
};

export const BOOK_PARTS: BookPart[] = [
  {
    part: 'Part I — Orientation',
    chapters: [
      {
        id: 'introduction',
        number: 1,
        title: 'Introduction',
        dek: 'What this manual covers, and what the system does',
        body: (
          <>
            <Lead>
              PWRI Plant Monitoring is the web application your team uses to run day-to-day operations,
              compliance tracking, maintenance, and reporting across every water treatment and injection
              plant in the operation. This manual walks through it module by module, in the same order the
              modules appear in the sidebar, so you can either read it start to finish or jump straight to
              the chapter that matches whatever you&rsquo;re trying to do.
            </Lead>
            <P>
              A single installation manages any number of plants, each with its own wells, locators (raw-water
              intake points), RO trains, power meters, product meters, and chemical inventories. Day to day,
              that means: field staff capturing meter readings and water-quality samples; RO trains logging
              pre-treatment, backwash, and CIP activity; compliance scores calculated automatically against
              configurable thresholds; preventive maintenance scheduled and checked off; incidents reported
              and closed out; costs tracked against electric bills and chemical prices; a staff directory and
              KPI scorecard; and, for the people who need it, bulk CSV import/export and a full administration
              console for approving users and managing plants.
            </P>
            <H3>How to read a chapter</H3>
            <P>
              Every chapter opens with what the module is for and who uses it, then walks through the actual
              mechanics — the tabs you&rsquo;ll see, the fields on each form, and the rules the system enforces
              automatically (cooldowns, duplicate protection, spike detection, and so on). Where it matters,
              a chapter also says plainly who can do what — a field Operator sees a very different app than a
              Manager or an Admin, and that&rsquo;s by design, not a bug.
            </P>
            <Note kind="tip">
              Screens may look slightly different from what&rsquo;s described here if your Admin has customized
              plant names, chemical lists, or thresholds. Field labels and menu paths are otherwise accurate to
              the current build of the app.
            </Note>
          </>
        ),
      },
      {
        id: 'getting-started',
        number: 2,
        title: 'Getting Started',
        dek: 'Accounts, approval, signing in, and shift handovers',
        body: (
          <>
            <Lead>
              There is no app store install — open the app&rsquo;s URL in any browser and you land on a single
              Sign in / Sign up screen. Before creating an account, it helps to know which of two account
              types you need, because the sign-up form itself branches based on your choice.
            </Lead>
            <Ref
              cols={['Account type', "Who it's for", 'Key difference']}
              rows={[
                [
                  'Operator',
                  'Field/shift staff logging readings on a shared plant device or their own phone.',
                  'All Operators at one plant can share a single email — each person just picks their own username at sign-in. Limited to exactly one plant.',
                ],
                [
                  'Non-operator',
                  'Office, management, or technical staff — Admin, Manager, Supervisor, Maintenance, Quality Assurance, Data Analyst.',
                  'Requires its own unique email address. Can be assigned to multiple plants.',
                ],
              ]}
            />
            <P>
              Signing up walks you through a short wizard: email, password, and a designation (your job
              title — Operator switches the whole wizard into shared-email mode); how many operators will
              share this device, if applicable; each person&rsquo;s username and name; which plant(s) you belong
              to; and a final review step. Every new account — however it was created — starts in{' '}
              <strong className="font-sans font-semibold not-italic">Pending</strong> status. Trying to sign in
              before an Admin approves you lands you on an &ldquo;awaiting approval&rdquo; screen with a{' '}
              <strong className="font-sans font-semibold not-italic">Refresh status</strong> button that drops
              you straight into the app the moment you&rsquo;re approved — no need to sign out and back in.
            </P>
            <H3>Signing in, and the operator picker</H3>
            <P>
              Enter your email and password as usual. If more than one Operator is active at your assigned
              plant, a &ldquo;Who is signing in?&rdquo; screen appears listing every Operator there — tap your
              name, and everything you do for the rest of the session is attributed to you specifically, even
              though the device itself is shared. Forgot your password? Use{' '}
              <strong className="font-sans font-semibold not-italic">Forgot password?</strong> on the sign-in
              tab; an 8-digit code is emailed to you, and you set a new password from there.
            </P>
            <Note kind="tip">
              On a shared plant tablet, get in the habit of using{' '}
              <strong className="font-sans font-semibold not-italic">Switch operator</strong> (in the account
              menu) at the start of every shift, rather than staying logged in as whoever used the device
              last — it&rsquo;s the difference between readings being attributed correctly and not.
            </Note>
          </>
        ),
      },
      {
        id: 'navigating',
        number: 3,
        title: 'Navigating the App',
        dek: 'The sidebar, the top bar, and how the layout adapts',
        body: (
          <>
            <Lead>
              On desktop and tablet, a left sidebar handles navigation and a top bar carries context; on a
              phone, the sidebar becomes a bottom navigation bar with a &ldquo;More&rdquo; sheet for anything
              that doesn&rsquo;t fit in the main row. In every layout, items are organized into named
              groups — Overview, Operations, Maintenance, Finance, Team, Data, Analysis, Admin — and which
              groups you actually see depends entirely on your role.
            </Lead>
            <P>
              The top bar is constant across every page. A{' '}
              <strong className="font-sans font-semibold not-italic">plant selector</strong> controls which
              plant&rsquo;s data the current page shows — Operators are locked to their one assigned plant,
              everyone else can switch freely. A{' '}
              <strong className="font-sans font-semibold not-italic">notification bell</strong> surfaces active
              alarms and system logs with anti-fatigue rate-limited ringing on new critical events, quick snooze (1h / 24h),
              and one-click dismissal. It also links directly to the dedicated{' '}
              <strong className="font-sans font-semibold not-italic">Alert &amp; Notification Center</strong> (Chapter 19)
              for fleet-wide triage. Rounding it out: a real-time sync status indicator, theme palette selector,
              and your account menu (Profile, Switch operator, Sign out).
            </P>
            <Note kind="tip">
              Chapter 4 covers exactly who can see what, module by module — but as a shortcut while reading the
              rest of this manual: Operators see the fewest pages, Technician-tier roles see the same pages as
              a Manager but with edit actions blocked inside them, and Manager/Data Analyst/Admin see
              everything, with the Admin Console itself further split three ways.
            </Note>
          </>
        ),
      },
      {
        id: 'roles',
        number: 4,
        title: 'Roles & Permissions',
        dek: 'Who can see what, and why designation is not the same thing as role',
        body: (
          <>
            <Lead>
              Every account is assigned one or more roles, and roles are what actually control access — not
              designation, which is just your descriptive job title (&ldquo;Maintenance Technician,&rdquo;
              say). An Admin sets your real role when approving your account, separately from whatever
              designation you picked at sign-up.
            </Lead>
            <Ref
              cols={['Role', 'Typical user', 'Access level']}
              rows={[
                ['Operator', 'Field operator, shared shift terminal', 'Narrowest access — Dashboard, Plants, Operations, RO Trains, Maintenance, Incidents, Employees, Profile only.'],
                ['Technician', 'Maintenance / QA staff', 'Same page-level navigation as Manager/Admin, but Manager-and-above actions inside a page — deletions, budget, admin tools — stay blocked.'],
                ['Manager', 'Plant / area manager', 'Full operational visibility plus Exports, Data Analysis (view-only), Data Corrections, Budget, and a limited Admin Console (Plants + Audit only).'],
                ['Data Analyst', 'Data quality / analytics staff', 'Everything a Manager can see for data purposes, plus full edit access in Data Analysis & Data Corrections. Redirected to Data Corrections instead of the Admin Console.'],
                ['Admin', 'System administrator', 'Full access to every module, including the complete Admin Console — user approval, role assignment, plant lifecycle, migrations, and audit log.'],
              ]}
            />
            <P>
              A user can hold more than one role at once — the system always grants the most generous
              applicable permission, so someone with both Technician and Manager, for instance, simply gets
              Manager-level access. An Admin can also go further and build named{' '}
              <strong className="font-sans font-semibold not-italic">custom roles</strong> on top of a system
              role, from the Roles tab in the Admin Console (Chapter 20) — useful for a title like &ldquo;Senior
              Technician&rdquo; that should carry one or two extra permissions without being a full Manager.
            </P>
            <Note kind="tip">
              Chapter 22&rsquo;s reference section has the complete module-by-module permissions matrix if you
              need the precise answer for a specific page rather than the general pattern above.
            </Note>
          </>
        ),
      },
    ],
  },
  {
    part: 'Part II — Daily Operations',
    chapters: [
      {
        id: 'dashboard',
        number: 5,
        title: 'The Dashboard',
        dek: "A rolled-up view of one plant's health",
        body: (
          <>
            <Lead>
              The Dashboard is the landing page after sign-in — a rolled-up, at-a-glance view of one plant&rsquo;s
              production, quality, cost, and outstanding work, with quick links into whatever module actually
              needs attention. Three view modes — Inline, Sections, and Dialog — rearrange the same information
              differently; pick whichever is easiest to scan on your screen.
            </Lead>
            <P>
              KPI cards are grouped into four clusters — Overview, Quality, Production Cost, and Plant Health
              Trend — alongside a set of focused cards: a Non-Revenue Water gauge, a data-completeness radar
              (how many expected readings were actually logged), a cost sunburst, a PM due-soon card, a
              pending-review card for flagged readings, and a blending-volume card for plants using bypass
              wells. Selecting a metric that supports drill-down opens a trend chart plotting it over time, so
              you can confirm at a glance whether something is trending up, down, or flat.
            </P>
            <Note kind="tip">
              The Dashboard is read-only by design — it never lets you edit a reading directly. To fix a
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
              Almost everything else in the app — Operations, RO Trains, Costs, Compliance — reads and writes
              against assets defined here, so getting this module right first makes everything downstream
              easier. The page opens on a grid of plant cards; selecting one opens a Plant Detail page with six
              tabs: Locators, Wells, Product, Trains, Power, and Configuration.
            </Lead>
            <H3>Locators and derived locators</H3>
            <P>
              A locator represents a raw-water intake meter. Most are physical meters an operator reads
              directly, but the system also supports{' '}
              <strong className="font-sans font-semibold not-italic">derived locators</strong> — a locator with
              no meter of its own, whose daily volume is calculated automatically as the mother meter&rsquo;s
              reading minus the sum of its sibling locators&rsquo; volumes. That&rsquo;s used when one bulk
              supply meter feeds several downstream points and only some of them have their own meters.
            </P>
            <H3>Wells, and marking one as blending</H3>
            <P>
              Wells carry their own water meter and, optionally, a dedicated electric meter. A well can be
              flagged as a{' '}
              <strong className="font-sans font-semibold not-italic">blending well</strong> — its output feeds
              the distribution line rather than being tracked as an independent production source — which
              routes it into the Blending tab in Operations and the Dashboard&rsquo;s blending-volume card.
              That toggle is Manager/Admin only, and turning it on asks you to confirm the well&rsquo;s current
              meter reading as the baseline.
            </P>
            <H3>Replacing a meter</H3>
            <P>
              Whenever a physical meter — locator or well — gets physically swapped, use{' '}
              <strong className="font-sans font-semibold not-italic">Replace meter</strong> rather than just
              editing the reading. It closes out the old meter&rsquo;s final reading and registers the new
              meter&rsquo;s brand, serial, and initial reading, which cleanly breaks the history at the swap
              point so the system doesn&rsquo;t compute a false usage spike between the old meter&rsquo;s last
              number and the new one&rsquo;s first. The same idea applies to a power meter&rsquo;s CT/multiplier
              on the Power tab — changing it is tracked with an effective date rather than silently misreading
              past data with the new ratio.
            </P>
          </>
        ),
      },
      {
        id: 'operations',
        number: 7,
        title: 'Wells & Locators — Daily Data Entry',
        dek: 'Five tabs, one save button per reading, and the guards behind every save',
        body: (
          <>
            <Lead>
              This is where field staff record daily readings — sidebar label &ldquo;Wells &amp; Locators,&rdquo;
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
                  <div className="mb-3 flex items-center justify-between"><div><div className="font-medium text-foreground">Raw Water Inlet 01</div><div className="text-3xs text-muted-foreground">Last reading 12,480 m³</div></div><span className="rounded-full bg-muted px-2 py-1 text-3xs text-muted-foreground">Ready to save</span></div>
                  <div className="flex items-center gap-2"><div className="flex-1 rounded-md border bg-muted/20 px-3 py-2 text-muted-foreground">12,520</div><button className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Save reading</button></div>
                </div>
              </div>
            </ManualFigure>
            <H3>The guards that run on every save</H3>
            <List
              items={[
                <><strong className="font-sans font-semibold not-italic">45-minute cooldown</strong> — the same person can&rsquo;t save a second reading for the same asset within 45 minutes of their last one; the Save button shows how many minutes remain.</>,
                <><strong className="font-sans font-semibold not-italic">Duplicate blocking</strong> — an identical reading already logged for that asset/time is rejected outright.</>,
                <><strong className="font-sans font-semibold not-italic">Mandatory Anomaly Remarks</strong> — whenever an entered reading deviates significantly from the moving baseline, a prominent amber/rose anomaly banner requires at least a 10-character operational explanation (e.g., pump serviced, peak demand, meter calibration) before the reading can be saved.</>,
                <><strong className="font-sans font-semibold not-italic">Backward-reading and spike detection</strong> — a cumulative reading lower than the last one, or an implied flow rate more than double the recent average, is still saved, but automatically tagged pending review for a supervisor rather than silently rejected.</>,
                <><strong className="font-sans font-semibold not-italic">Daily cap</strong> — wells stop accepting new readings after 3 in a single day.</>,
              ]}
            />
            <H3>Logging reading gaps and maintenance reasons</H3>
            <P>
              When an asset was offline, under maintenance, or has no reading for today, the system surfaces a prominent{' '}
              <strong className="font-sans font-semibold not-italic">&ldquo;Log gap reason&rdquo;</strong> badge directly
              in the asset&rsquo;s metadata strip across all tabs — Locators, Wells, Blending, and Product meters.
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
              physical meter has wrapped around its maximum digits — the system then computes the true
              wrap-around delta instead of clamping usage to zero.
            </P>
            <P>
              Wherever your browser has location permission enabled, saving a reading automatically geotags it
              with your GPS position and flags it if you&rsquo;re more than about 100 meters from where that
              asset is registered — a quiet cross-check that a reading was actually taken on-site.
            </P>
            <Note kind="warn">
              Found a mistake after the fact? Don&rsquo;t submit a second reading to &ldquo;correct&rdquo; it —
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
              four tabs — Overview, Pre-Treatment &amp; RO, CIP, and Chemical Dosing.
            </Lead>
            <ManualFigure
              title="Pre-Treatment & RO shift log"
              caption="Use the tab bar to move between Overview, Pre-Treatment & RO, CIP, and Chemical Dosing. Calculated deltas and quality percentages appear alongside the values they explain."
            >
              <div className="min-w-[520px] rounded-lg border bg-background p-3 font-sans text-xs">
                <div className="mb-3 flex gap-1 border-b pb-2"><span className="border-b-2 border-primary px-2 py-1 font-semibold text-primary">Pre-Treatment & RO</span><span className="px-2 py-1 text-muted-foreground">CIP</span><span className="px-2 py-1 text-muted-foreground">Chemical Dosing</span></div>
                <div className="grid grid-cols-3 gap-2"><div className="rounded-md border p-3"><div className="text-muted-foreground">Feed flow</div><div className="mt-1 text-lg font-semibold text-foreground">48.2 <span className="text-xs font-normal">m³/h</span></div></div><div className="rounded-md border p-3"><div className="text-muted-foreground">Salt rejection</div><div className="mt-1 text-lg font-semibold text-primary">98.4%</div></div><div className="rounded-md border border-warn/40 bg-warn-soft p-3"><div className="text-muted-foreground">ΔP check</div><div className="mt-1 font-semibold text-foreground">Review</div></div></div>
              </div>
            </ManualFigure>
            <H3>The Pre-Treatment & RO reading</H3>
            <P>
              This is the primary shift log for train performance, organized into sections you fill in as
              relevant to your plant&rsquo;s SOP rather than every field every time: backwash activity (per
              train or per unit, with an auto-computed pressure differential); the high-pressure pump and
              cartridge filter; feed, permeate, and reject meters, with flowrates auto-computed from the meter
              delta; suction/feed/reject pressures with an automatic ΔP; and water quality — feed, permeate,
              and reject TDS and pH, with salt rejection and salt-passage percentages calculated for you, plus
              turbidity, temperature, and chlorine residual. A field showing a warning highlight (an
              out-of-range ΔP or a drifting permeate pH) isn&rsquo;t blocked from saving — it&rsquo;s a visual
              flag to double-check before you submit, and it typically also feeds a Compliance threshold
              (Chapter 21).
            </P>
            <H3>CIP and Chemical Dosing</H3>
            <P>
              The <strong className="font-sans font-semibold not-italic">CIP</strong> tab logs cleaning cycles —
              which chemicals were used (Caustic Soda, HCl, and SLS by default, plus any plant-specific
              chemicals), in what quantity, over what start/end window.{' '}
              <strong className="font-sans font-semibold not-italic">Chemical Dosing</strong> is a separate,
              day-to-day log for the chemicals actually added during water treatment — Chlorine, SMBS,
              Anti-scalant, Soda Ash by default — plus a free-chlorine residual test section where you can log
              several sampling points in one entry. Cost for both is estimated automatically from the current
              unit price (Chapter 13).
            </P>
            <H3>Chemical inventory</H3>
            <P>
              Current stock for each chemical is simply deliveries received minus quantity dosed, shown with a
              progress bar and a low-stock flag once it drops below a configured threshold. A Manager or Admin
              logs a delivery — plant, chemical, quantity, supplier, date — and the stock figure updates
              immediately.
            </P>
            <Note kind="tip">
              A regular Operator can edit an entry they personally recorded — reading, CIP, or dosing — for up
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
              Network Topology is a visual, drag-and-drop diagram showing how a plant&rsquo;s assets connect —
              locators feeding wells, wells feeding RO trains, trains feeding product meters, and so on. It is
              hidden for Operators.
            </Lead>
            <P>
              The diagram auto-populates from your real plant data and can be extended with manually placed
              custom nodes — tanks, valves, off-system points — for a fuller picture than the raw asset list
              alone. Manager and Admin can enter an edit mode, drag new nodes in from a palette with snap-to-grid
              alignment, rename them, and draw or remove connections representing a physical flow path; saving
              persists the layout for the next person who opens that plant&rsquo;s topology.
            </P>
          </>
        ),
      },
    ],
  },
  {
    part: 'Part III — Maintenance & Response',
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
              For a new plant — or to top up anything missing — a Manager or Admin can select{' '}
              <strong className="font-sans font-semibold not-italic">Generate Standard PMS Library</strong> on
              the Add Equipment tab for one-tap setup of the common categories most plants need: Genset, RO,
              Dosing Pump, Controllers, Cartridge Filter, Pumps &amp; Motors, and pH/NTU/Colorimeter. Anything
              that already exists for the plant is skipped automatically, so it&rsquo;s safe to run more than
              once.
            </P>
            <P>
              For anything the standard library doesn&rsquo;t cover, add custom equipment directly: a category,
              an equipment name, one or more frequencies (Daily, Weekly, Monthly, Quarterly, Yearly — one
              schedule is generated per frequency selected), a start date, and optional custom checklist steps
              (leave them blank to use the standard template for that category). When a scheduled task comes
              due, whoever completes it works through the checklist, adds notes, and marks it complete — the
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
              Incidents has three tabs — Open (unresolved, needing follow-up), Report (log a new one), and
              History (closed).
            </Lead>
            <P>
              Reporting captures a type (Equipment failure, Chemical spill, Power outage, Safety incident,
              Quality deviation, Other) and severity (Low through Critical), then what happened, where, when,
              and who witnessed it, plus optional weather/temperature and the immediate action taken at the
              time. The form autosaves a draft as you type, so a long report isn&rsquo;t lost if you have to
              step away mid-entry. Closing an incident — Manager/Admin, or Technician where enabled — requires
              root cause, corrective action, and preventive measures before it&rsquo;s allowed to move from
              Open to History, which keeps the History tab genuinely useful for spotting repeat failures at the
              same site rather than just a pile of closed tickets.
            </P>
          </>
        ),
      },
    ],
  },
  {
    part: 'Part IV — Finance',
    chapters: [
      {
        id: 'costs',
        number: 12,
        title: 'Costs & Tariffs',
        dek: 'Everything that feeds a cost-per-unit picture of the operation',
        body: (
          <>
            <Lead>
              Hidden for Operators. Up to six tabs depending on role — Rollup, Power, Compare, Prices, Filters,
              and, Manager/Admin only, Budget.
            </Lead>
            <Ref
              cols={['Tab', 'Purpose']}
              rows={[
                ['Rollup', 'Combined production-cost breakdown — chemicals, power, other inputs — for a plant and period.'],
                ['Power', 'Electric bill entry and history, reconciled against logged power readings.'],
                ['Compare', 'Side-by-side cost/production comparison across plants.'],
                ['Prices', "Unit price list for chemicals — feeds the dosing cost estimates in RO Trains."],
                ['Filters', 'Cost tracking for filter media (cartridge filters, AFM, etc.).'],
                ['Budget', 'Budget vs. actual by month, Manager/Admin only.'],
              ]}
            />
            <P>
              Logging a monthly electric bill on the Power tab takes previous and current meter readings — total
              kWh is calculated automatically — plus generation, distribution, and other charges. Chemical and
              filter prices on the Prices/Filters tabs carry an{' '}
              <strong className="font-sans font-semibold not-italic">effective date</strong> rather than simply
              overwriting the old figure, so a cost calculation for a past period keeps using whatever price
              actually applied at the time, even after today&rsquo;s price changes.
            </P>
          </>
        ),
      },
    ],
  },
  {
    part: 'Part V — Team',
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
              <strong className="font-sans font-semibold not-italic">ephemeral</strong> — auto-deleted after
              roughly 8 hours — a quick coordination channel for shift handovers, not a permanent record;
              anything worth keeping belongs in the module it actually concerns (Incidents, a Data Corrections
              note, and so on). The{' '}
              <strong className="font-sans font-semibold not-italic">KPI</strong> tab is a heatmap-style
              scorecard summarizing reading timeliness and completeness per employee over a selected period —
              green for everything logged, down through red for nothing — so a supervisor can spot who might
              need support at a glance. The{' '}
              <strong className="font-sans font-semibold not-italic">Info</strong> tab carries this reader, plus
              a reporting-tree org chart built from each person&rsquo;s immediate supervisor assignment.
            </P>
          </>
        ),
      },
    ],
  },
  {
    part: 'Part VI — Data & Analysis',
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
              category — Operations (locator, well, product readings), RO Trains (TDS, water quality, pump, AFM
              readings), Chemical (dosing, deliveries), Power, and Finance.
            </Lead>
            <P>
              The pattern is the same for every data type: pick the import type and the target plant, download
              the built-in template for the exact expected column layout, then drop in your CSV or plain-text
              file. A parsed preview lets you check the data before committing anything, and an optional{' '}
              <strong className="font-sans font-semibold not-italic">skip invalid rows</strong> setting means a
              handful of bad rows don&rsquo;t block the whole file — a progress log then shows exactly what was
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
              Manager, Data Analyst, and Admin only. Tables are grouped by category — Operations, RO Trains,
              Chemical, Power, Maintenance, Incidents, Finance, and more — each exportable individually or as
              part of a full export.
            </Lead>
            <P>
              Set a plant filter and a date range (quick presets, or a custom range), then export whichever
              table you need under its category card, and a filtered download begins immediately. When you need
              everything rather than one table at a time —{' '}
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
              Analysis & Review is the exception — visible to Manager, Data Analyst, and Admin, though Manager
              access is view-only; only Data Analyst and Admin can actually run the tool and edit values.
            </Lead>
            <P>
              The core tool runs an{' '}
              <strong className="font-sans font-semibold not-italic">OLS regression</strong> against a chosen
              column — daily volume, a meter reading, permeate TDS, recovery percentage, and similar fields
              across well, locator, product-meter, RO-train, and power readings — flags statistical outliers by
              Z-score, and proposes a corrected value for each. Nothing is changed automatically: you review
              each proposed correction and choose{' '}
              <strong className="font-sans font-semibold not-italic">Apply</strong> or leave it, and can{' '}
              <strong className="font-sans font-semibold not-italic">Retract</strong> a correction you&rsquo;ve
              already applied. A raw-data table alongside it lets you edit any of the latest 200 rows by hand
              instead, when that&rsquo;s the more direct fix — either way, every edit is written to the audit
              trail. Two sub-tabs round the page out: Edit Audit (every manual edit made here) and Flagged
              Readings (what&rsquo;s currently marked abnormal for the selected table) — a narrower,
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
              figure, or <strong className="font-sans font-semibold not-italic">Reject</strong> it as invalid —
              with bulk actions for handling several readings that share the same disposition at once. Approving
              a reading <strong className="font-sans font-semibold not-italic">locks</strong> it against further
              edits; an Unlock control reopens it if needed later.
            </P>
            <H3>Requesting a correction</H3>
            <P>
              When a reading is outside your own edit window (same session for Wells/Locators, 8 hours for RO
              Trains logs — Chapter 8) or was recorded by someone else, the right move is a{' '}
              <strong className="font-sans font-semibold not-italic">correction request</strong>, not a direct
              edit: propose the correct value, pick the closest reason (meter misread, data-entry typo, wrong
              anchor reading, meter replaced, duplicate submission, wrong asset, or other), and add a short
              description. It lands in Pending for a reviewer, and you&rsquo;re notified of the outcome either
              way.
            </P>
            <H3>Inbox, History, and Operators</H3>
            <P>
              <strong className="font-sans font-semibold not-italic">Inbox</strong> is a separate safety net —
              readings technically marked &ldquo;normal&rdquo; that still compute to a negative daily volume,
              something worth a second look even though nothing auto-flagged it.{' '}
              <strong className="font-sans font-semibold not-italic">History</strong> is the full audit trail of
              every correction action taken anywhere in the system, and{' '}
              <strong className="font-sans font-semibold not-italic">Operators</strong> rolls up accuracy
              statistics per person — how often their readings get flagged — a useful lens for coaching, not
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
              oversight per plant over a selectable time window — completeness, unexplained gaps, and open
              exceptions — so a manager doesn&rsquo;t have to reconcile several other pages by hand just to know
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
  },
  {
    part: 'Part VII — Oversight & Alarms',
    chapters: [
      {
        id: 'alerts-triage',
        number: 19,
        title: 'Alert & Notification Center',
        dek: 'Fleet-wide alarm triage, telemetry anomaly surveillance, and event audit',
        body: (
          <>
            <Lead>
              Reachable from the top bar notification bell or directly at <code className="font-sans text-sm font-semibold not-italic">/alerts</code>.
              The Alert &amp; Notification Center is the central triage console for live plant alarms, sensor threshold breaches,
              and historical system notifications across the entire fleet.
            </Lead>
            <Ref
              cols={['Severity Tier', 'Visual Indicator', 'Operational Meaning']}
              rows={[
                ['Critical', 'Red glow Lamp + Rose edge-light', 'Immediate operational threat — high TDS, extreme pressure differential (ΔP), critical tank levels, or severe telemetry spike.'],
                ['Warning', 'Amber glow Lamp + Amber edge-light', 'Approaching threshold or abnormal reading requiring supervisor remark or timely inspection.'],
                ['Info / Normal', 'Sky/Teal Lamp + Blue edge-light', 'Routine lifecycle events, PM completions, shift handovers, and informational system notices.'],
              ]}
            />
            <H3>Active Alarms vs. System Log</H3>
            <P>
              The triage console is split into two first-class tabs:
            </P>
            <List
              items={[
                <><strong className="font-sans font-semibold not-italic">Active Alarms</strong> — live telemetry conditions generated by sensor thresholds, flow rate deviation guards, and plant status. Active alarms remain visible until resolved, snoozed (1 hour or 24 hours), or dismissed.</>,
                <><strong className="font-sans font-semibold not-italic">System Log</strong> — immutable audit records of system events, user approvals, report exports, and broadcast notifications.</>,
              ]}
            />
            <H3>Triage and Batch Controls</H3>
            <P>
              KPI cards at the top provide instant counts for total active alarms, critical alarms, warnings, and unread logs.
              Operators and managers can filter by severity tier, switch between specific plants, search by keyword, or perform
              batch actions (<strong className="font-sans font-semibold not-italic">Snooze All (1h)</strong>,{' '}
              <strong className="font-sans font-semibold not-italic">Dismiss All</strong>, or{' '}
              <strong className="font-sans font-semibold not-italic">Mark All Read</strong>) to streamline high-volume shift changes.
            </P>
            <Note kind="tip">
              The notification bell in the top bar uses an anti-fatigue rate-limiter: it rings once upon the arrival
              of a new critical alarm rather than looping continuously, preventing alarm fatigue on shared shift terminals.
            </Note>
          </>
        ),
      },
      {
        id: 'compliance',
        number: 20,
        title: 'Compliance',
        dek: 'Scoring plants against configurable thresholds',
        body: (
          <>
            <Lead>
              Hidden for Operators. Compliance scores your plant(s) against ten configurable operating
              thresholds across three tabs: Status, Thresholds, and What-if.
            </Lead>
            <Ref
              cols={['Metric', 'Default threshold']}
              rows={[
                ['NRW % (Non-Revenue Water)', 'Max 20%'],
                ['Downtime (hrs/day)', 'Max 2 hrs'],
                ['Permeate TDS', 'Max 500 ppm'],
                ['Permeate pH', 'Min 6.5 / Max 8.5'],
                ['Raw turbidity', 'Max 5 NTU'],
                ['ΔP (differential pressure)', 'Max 15 psi'],
                ['Recovery %', 'Min 70%'],
                ['PV ratio', 'Max 1.2'],
                ['Chemical stock (days remaining)', 'Min 7 days'],
              ]}
            />
            <P>
              Running an evaluation — Technician and above — takes a scope (global or one plant) and a window
              in days, then returns an overall compliant/breached banner, a 0–100 Compliance Score, period
              averages with trend arrows against the previous window, and a list of any specific violations.
              Editing the thresholds themselves is Manager/Admin only, and doesn&rsquo;t retroactively change
              evaluations already run. The{' '}
              <strong className="font-sans font-semibold not-italic">What-if</strong> tab is for planning: type
              a hypothetical value into any metric and watch the violation list and score update live, without
              saving anything or waiting on new data — useful for figuring out exactly how much a metric needs
              to improve to clear compliance.
            </P>
          </>
        ),
      },
      {
        id: 'admin-console',
        number: 21,
        title: 'Admin Console',
        dek: "The system's control room for accounts, plants, and audit history",
        body: (
          <>
            <Lead>
              What you see here depends entirely on role. Admin gets five tabs — Users, Plants, Audit,
              Migrations, and Roles. Manager gets two — Plants and Audit only, no user management, no
              migrations. Data Analyst is redirected to Data Corrections instead. Technician and Operator have
              no access at all.
            </Lead>
            <H3>Approving and managing users</H3>
            <P>
              New sign-ups arrive as Pending, defaulting internally to the Operator role; an Admin reviews the
              account, sets its real role, and approves it — at which point the person can sign in immediately.
              An Admin can also create a user directly, skipping self-signup entirely, for someone who can&rsquo;t
              register themselves. Existing users, grouped by role, offer row actions to change their role,
              password, email, or plant assignments.
            </P>
            <H3>The soft / hard / force delete pattern</H3>
            <P>
              User and plant deletion follows the same three-tier pattern everywhere in the app.{' '}
              <strong className="font-sans font-semibold not-italic">Soft delete</strong> marks a record
              inactive — reversible, and never blocked. <strong className="font-sans font-semibold not-italic">Hard
              delete</strong> permanently removes it, but is automatically blocked if dependent records exist
              (a user who&rsquo;s recorded readings, a plant with wells attached) — the dialog lists exactly
              what&rsquo;s in the way. <strong className="font-sans font-semibold not-italic">Force delete</strong>{' '}
              overrides that block with an explicit acknowledgement checkbox, cascading through dependent
              records — this cannot be undone, and is written to the Audit tab with a visible FORCE flag.
            </P>
            <H3>Roles, Audit, and Migrations</H3>
            <P>
              The <strong className="font-sans font-semibold not-italic">Roles</strong> tab, Admin-only, is
              where named custom roles get built on top of a system role — kept out of Manager&rsquo;s reach
              since a role editor can grant access to everything else. The{' '}
              <strong className="font-sans font-semibold not-italic">Audit</strong> tab is specifically a
              deletion log — every soft, hard, and force delete performed anywhere, with actor, timestamp,
              reason, and a FORCE badge where relevant; day-to-day correction history lives in Data Corrections
              instead (Chapter 17). The{' '}
              <strong className="font-sans font-semibold not-italic">Migrations</strong> tab is a technical
              utility for whoever administers the underlying database — not a day-to-day operations screen.
            </P>
          </>
        ),
      },
      {
        id: 'profile',
        number: 22,
        title: 'My Profile',
        dek: 'Your own identity, access level, and assigned plants',
        body: (
          <>
            <Lead>
              Every signed-in user has a Profile page, reachable from the sidebar or the account menu, showing
              your active plant, role and computed access level, identity details, email, and assigned plants.
            </Lead>
            <P>
              You can edit your own first/middle/last name, suffix, username, and designation at any time. If
              you&rsquo;re a non-operator, you can also change your own login email directly from this page;
              shared-device Operators should ask an Admin instead, since that email is shared across everyone
              on the crew. Your list of assigned plants is shown for reference but is read-only — changing it
              requires an Admin.
            </P>
          </>
        ),
      },
    ],
  },
  {
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
  },
];
