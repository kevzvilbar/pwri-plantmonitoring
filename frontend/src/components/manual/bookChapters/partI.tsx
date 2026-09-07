import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partI : BookPart =   {
    part: 'Part I â€” Orientation',
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
              mechanics â€” the tabs you&rsquo;ll see, the fields on each form, and the rules the system enforces
              automatically (cooldowns, duplicate protection, spike detection, and so on). Where it matters,
              a chapter also says plainly who can do what â€” a field Operator sees a very different app than a
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
              There is no app store install â€” open the app&rsquo;s URL in any browser and you land on a single
              Sign in / Sign up screen. Before creating an account, it helps to know which of two account
              types you need, because the sign-up form itself branches based on your choice.
            </Lead>
            <Ref
              cols={['Account type', "Who it's for", 'Key difference']}
              rows={[
                [
                  'Operator',
                  'Field/shift staff logging readings on a shared plant device or their own phone.',
                  'All Operators at one plant can share a single email â€” each person just picks their own username at sign-in. Limited to exactly one plant.',
                ],
                [
                  'Non-operator',
                  'Office, management, or technical staff â€” Admin, Manager, Supervisor, Maintenance, Quality Assurance, Data Analyst.',
                  'Requires its own unique email address. Can be assigned to multiple plants.',
                ],
              ]}
            />
            <P>
              Signing up walks you through a short wizard: email, password, and a designation (your job
              title â€” Operator switches the whole wizard into shared-email mode); how many operators will
              share this device, if applicable; each person&rsquo;s username and name; which plant(s) you belong
              to; and a final review step. Every new account â€” however it was created â€” starts in{' '}
              <strong className="font-sans font-semibold not-italic">Pending</strong> status. Trying to sign in
              before an Admin approves you lands you on an &ldquo;awaiting approval&rdquo; screen with a{' '}
              <strong className="font-sans font-semibold not-italic">Refresh status</strong> button that drops
              you straight into the app the moment you&rsquo;re approved â€” no need to sign out and back in.
            </P>
            <H3>Signing in, and the operator picker</H3>
            <P>
              Enter your email and password as usual. If more than one Operator is active at your assigned
              plant, a &ldquo;Who is signing in?&rdquo; screen appears listing every Operator there â€” tap your
              name, and everything you do for the rest of the session is attributed to you specifically, even
              though the device itself is shared. Forgot your password? Use{' '}
              <strong className="font-sans font-semibold not-italic">Forgot password?</strong> on the sign-in
              tab; an 8-digit code is emailed to you, and you set a new password from there.
            </P>
            <Note kind="tip">
              On a shared plant tablet, get in the habit of using{' '}
              <strong className="font-sans font-semibold not-italic">Switch operator</strong> (in the account
              menu) at the start of every shift, rather than staying logged in as whoever used the device
              last â€” it&rsquo;s the difference between readings being attributed correctly and not.
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
              groups â€” Overview, Operations, Maintenance, Finance, Team, Data, Analysis, Admin â€” and which
              groups you actually see depends entirely on your role.
            </Lead>
            <P>
              The top bar is constant across every page. A{' '}
              <strong className="font-sans font-semibold not-italic">plant selector</strong> controls which
              plant&rsquo;s data the current page shows â€” Operators are locked to their one assigned plant,
              everyone else can switch freely. A{' '}
              <strong className="font-sans font-semibold not-italic">notification bell</strong> surfaces active
              alarms and system logs with anti-fatigue rate-limited ringing on new critical events, quick snooze (1h / 24h),
              and one-click dismissal. It also links directly to the dedicated{' '}
              <strong className="font-sans font-semibold not-italic">Alert &amp; Notification Center</strong> (Chapter 19)
              for fleet-wide triage. Rounding it out: a real-time sync status indicator, theme palette selector,
              and your account menu (Profile, Switch operator, Sign out).
            </P>
            <Note kind="tip">
              Chapter 4 covers exactly who can see what, module by module â€” but as a shortcut while reading the
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
              Every account is assigned one or more roles, and roles are what actually control access â€” not
              designation, which is just your descriptive job title (&ldquo;Maintenance Technician,&rdquo;
              say). An Admin sets your real role when approving your account, separately from whatever
              designation you picked at sign-up.
            </Lead>
            <Ref
              cols={['Role', 'Typical user', 'Access level']}
              rows={[
                ['Operator', 'Field operator, shared shift terminal', 'Narrowest access â€” Dashboard, Plants, Operations, RO Trains, Maintenance, Incidents, Employees, Profile only.'],
                ['Technician', 'Maintenance / QA staff', 'Same page-level navigation as Manager/Admin, but Manager-and-above actions inside a page â€” deletions, budget, admin tools â€” stay blocked.'],
                ['Manager', 'Plant / area manager', 'Full operational visibility plus Exports, Data Analysis (view-only), Data Corrections, Budget, and a limited Admin Console (Plants + Audit only).'],
                ['Data Analyst', 'Data quality / analytics staff', 'Everything a Manager can see for data purposes, plus full edit access in Data Analysis & Data Corrections. Redirected to Data Corrections instead of the Admin Console.'],
                ['Admin', 'System administrator', 'Full access to every module, including the complete Admin Console â€” user approval, role assignment, plant lifecycle, migrations, and audit log.'],
              ]}
            />
            <P>
              A user can hold more than one role at once â€” the system always grants the most generous
              applicable permission, so someone with both Technician and Manager, for instance, simply gets
              Manager-level access. An Admin can also go further and build named{' '}
              <strong className="font-sans font-semibold not-italic">custom roles</strong> on top of a system
              role, from the Roles tab in the Admin Console (Chapter 20) â€” useful for a title like &ldquo;Senior
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
  };


