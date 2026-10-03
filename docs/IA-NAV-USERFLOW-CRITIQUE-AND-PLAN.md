# Information architecture, navigation and user-flow critique

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` at `bfe232f` |
| Date | 2026-10-03 |
| Scope | Whole-app IA, navigation model, tab structure, and the main user flows |
| Method | Static read of the code (see Appendix B). **The app was not run, and there is no usage data.** |
| Suggested path | `docs/IA-NAV-USERFLOW-CRITIQUE-AND-PLAN.md` |
| Relation to earlier work | Builds on `docs/NAV-IA-REMEDIATION-PLAN.md`. Most of that plan's structural fixes are visible in the code now. This document does not repeat it; it looks at what is left and what the new Hydraulics page changed. |

Effort sizes: **S** under half a day, **M** one to two days, **L** three or more. Items marked **[verify]** are things I could not confirm from code alone.

---

## 1. Summary

The navigation *plumbing* is now good. The *structure* behind it has three problems:

1. **The same things live in several places.** Wells, RO trains, locators, product and power each exist both as a task-first page (Daily Readings, RO Trains) and as an entity-first tab (Plants → Wells / Trains / Power ...), and now Hydraulics adds a third path to wells. Nothing links these paths to each other.
2. **Most of the app is hidden one level down.** 19 sidebar items sit on top of at least **39 tabs**. Tabs are linkable but are invisible to the sidebar, the page header and (as far as I saw) search.
3. **Work queues are not signposted.** A Manager's daily job is a loop through Alerts, Compliance, Data Corrections, Scorecard and PM. Only Alerts and Admin approvals carry a badge, so the queues that need action look the same as the reference pages.

None of these needs a redesign. They need cross-links, a few renames and regroupings, badges on queues, and one rule for where things live.

---

## 2. What is already good (keep it)

| Strength | Evidence |
|---|---|
| One navigation source of truth for desktop and mobile | `navConfig.ts` feeds `AppSidebar` and `BottomNav` through `useNavGroups()`; `buildNavConfig(can)` takes a permission predicate |
| Nav visibility follows permissions, not hand-coded roles | `modules: [...]` per item; custom-role overrides apply |
| Route guard and nav cannot silently drift | `ProtectedRoute.OPERATOR_ALLOWED_PATHS` plus `navConfig.test.ts` |
| Tabs are URL state, not component state | `useUrlTab('tab', ...)` on Costs, Admin, Compliance, Corrections, Incidents, PM, Employees, RO Trains, Operations, Plants. Tabs are deep-linkable and survive reload. |
| Deep link survives sign-in | `ProtectedRoute` passes `state={{ from: loc }}`; `AuthPage` reads it |
| Role-aware landing | `getPostLoginPath.ts` (has its own test) |
| Sensible auth gate sequence | `/auth` → `/onboarding` → `/pending-approval` → app |
| Legacy URLs redirect | `/scorecard` → `/manager-scorecard` |
| Global search exists | Command palette (Ctrl+K) in the top bar |
| Good mobile bar | Readings · RO Trains · Dashboard (hero) · Alerts · More, with the rest in a grouped sheet |
| Page animation does not remount pages | `PageAnimationWrapper` preserves filter and form state across navigation |

---

## 3. Current IA map

```
Overview        Dashboard · Alerts(badge) · Compliance(4 tabs)
Daily Logs      Daily Readings(5 tabs) · RO Trains · PM Schedule(3) · Incidents(3) · My Corrections
Assets          Plants(6 tabs + /plants/:id/wells/:wellId) · Hydraulics · Network Topology
Review          Data Analysis & Review · Data Corrections(4) · Manager Scorecard
Reports & Data  Costs & Tariffs(6) · Data Exports · Smart Import
Team & Admin    Employees(3) · Admin Console(5, badge)
(avatar menu)   Profile · Help & Manual · theme · sign out
(not in nav)    /chemicals → redirect
```

Tab inventory (from the `useUrlTab` / `TabsTrigger` values; RO Trains not counted):

| Page | Tabs |
|---|---|
| Plants | locators, wells, product, trains, power, configuration |
| Costs & Tariffs | rollup, power, compare, prices, filters, budget |
| Daily Readings | locator, well, product, blending, power |
| Admin Console | users, plants, audit, migrations, roles |
| Compliance | status, fleet, thresholds, whatif |
| Data Corrections | pending, inbox, history, operators |
| Employees | staff, kpi, org-chart |
| Incidents | open, report, history |
| PM Schedule | calendar, records, add |

---

## 4. Findings

Severity: **High** blocks or misleads users; **Medium** costs time or causes confusion; **Low** polish.

### F1 (High): Parallel hierarchies for the same entities

`OperationsPage` tabs are `locator · well · product · blending · power`. `PlantDetail` tabs are `locators · wells · product · trains · power · configuration`. These are the same domain objects reached by two routes, one by *type of log*, one by *plant*. RO trains are likewise a top-level page **and** a Plants tab. Hydraulics adds a third entry to wells.

Consequences:

- A user who finds a well in one place cannot tell the other places exist.
- Tab names differ by one letter (`locator` / `locators`, `well` / `wells`), which is a sign the two lists were built separately and will drift.
- Support and training must explain three routes to one thing.

I found **no link from Plants or Wells to `/hydraulics`**, or the reverse beyond the fleet page's own row click **[verify the row click target]**. `AssetLink.tsx` already exists and is the natural mechanism.

### F2 (High): Work queues look like reference pages

`NavItem.badge` supports only `'alerts' | 'approvals'`. These are also queues that someone must act on:

| Queue | Who acts | Signposted? |
|---|---|---|
| Data Corrections → Pending | Manager, Data Analyst | No badge |
| My Corrections (status of my requests) | Operator | No badge or "decided" indicator |
| PM tasks overdue | Technician, Manager | No badge |
| Hydraulic surveys overdue | Manager | Only on the Hydraulics page itself |
| Compliance exceedances | Technician and up | Only inside Compliance |

The Dashboard links to several of these, but a user must go to the Dashboard first.

### F3 (High): Manager's review loop spans five pages with no spine

A typical Manager morning is Dashboard → Alerts → Compliance → Data Corrections → Scorecard → (PM or Hydraulics). Each is a separate sidebar entry in two different groups (`Overview` and `Review`), and the group names are near-synonyms ("Overview" vs "Review"). Compliance and Alerts are *monitoring/review* tasks but sit in `Overview`.

### F4 (Medium): Tabs are a hidden second navigation layer

At least 39 tabs sit behind 19 items. Costs has six, Plants six, Daily Readings five, Admin five. Problems:

- The sidebar, the page title and the browser tab name show only the page, not the tab (title behavior **[verify `useDocumentTitle`]**).
- Search is described as "pages, plants, and wells" plus "Daily Readings rows". I saw no indexing of tabs, so "Budget", "Thresholds" or "What-if" are not findable by name **[verify]**.
- All pages use the same query key `tab`, which is consistent, but the sets differ in length and in how they handle role-hidden tabs (Costs swaps the whole tab list; Admin filters it).

### F5 (Medium): Labels, titles and URLs disagree

| Nav label | Route | Page title / note |
|---|---|---|
| Daily Readings | `/operations` | Module comment: "Renamed from 'Operations' — page holds Wells, Locators, Product, Blending, Power". "Daily Readings" undersells a five-type data-entry hub. |
| PM Schedule | `/maintenance` | `PM Schedule` |
| Incidents | `/incidents` | `Incident Management & HSE Log` |
| Network Topology | `/topology` | file `PlantTopology*` |
| Data Analysis & Review / Data Corrections / My Corrections | three routes | three "data/correct/review" labels in two groups |

Also, only **four** pages call `<PageHeader title=...>` (Incidents, PM Schedule, Admin Console, Help). The rest use their own headers, so page identity is inconsistent.

### F6 (Medium): Three "import / entry" doors

`ReadingImportDialog` inside Daily Readings, `SmartImportPanel`, and the `/import` page ("Smart Import", filed under *Reports & Data*). Import is data entry, but it is grouped with Costs and Exports. A user looking for "bulk upload readings" has no single obvious place.

### F7 (Medium): Plant context has two sources of truth **[verify]**

The top bar plant selector (`selectedPlantId`, `All plants`) is global. Plants has its own `/plants/:id` route. Hydraulics has its own plant filter option. What happens to the top-bar selection when the user opens `/plants/B` while "Plant A" is selected? This is the classic IA bug (context disagrees with content). `Dashboard.plantScope.test.tsx` shows the Dashboard is covered; other pages are not obviously covered.

### F8 (Medium): Group names and placement

- `Daily Logs` mixes data entry (Readings, RO Trains), scheduling (PM), event reporting (Incidents) and a request tracker (My Corrections).
- `My Corrections` is operator-facing but sits far from the Manager-side `Data Corrections` that it feeds.
- `Reports & Data` mixes finance (Costs), outputs (Exports) and input (Import).
- `Hydraulics` is a *surveillance* view of wells but is filed beside Plants as an asset. That is defensible, but it has a status workflow (Overdue / Incomplete / No survey) that behaves like a queue.

### F9 (Low): Utility destinations are only in the avatar menu

Profile and Help are in `OperatorSwitcher`'s dropdown (and an alert panel link to Profile). That is conventional and fine, but the component name suggests *operator switching on a shared device*, while it also hosts account functions. Worth confirming these two jobs are clear to users **[verify in UI]**.

### F10 (Low): Mobile "More" sheet length

A Manager's More sheet holds around 15 items in 5 groups. Hydraulics, Plants and Compliance, which are used in the field, are all behind More. Needs usage data before changing (see decision D4).

### F11 (Low): Route naming

`/operations`, `/maintenance`, `/topology`, `/manager-scorecard` do not match the labels. Harmless, but it hurts support, analytics and anyone reading URLs. Changing them costs redirects, so only do it if other work already touches those routes.

---

## 5. User-flow critique

### Flow A: Operator daily shift

`Sign in → (role landing) → Daily Readings → pick tab (locator / well / product / blending / power) → enter → RO Trains → log → (Incidents if needed)`

- **Good:** Readings and RO Trains occupy bar slots 1 and 2 on mobile.
- **Gap:** Reading tabs are by *type*, not by *round*. An operator doing a plant walk must hop tabs. The plant-first Plants tabs would suit a walk better but live elsewhere (F1). **[verify against how operators actually work]**.
- **Gap:** No "what's left to log today?" cue in the nav.

### Flow B: Correction loop

`Operator sees wrong reading → "Fix" → CorrectionRequestDialog → My Corrections → Manager: Data Corrections → Pending → approve/reject → Operator sees outcome`

- **Gap:** Neither end has a badge (F2). The Manager discovers pending items by visiting; the Operator discovers a decision by visiting.
- **Gap:** The two halves are in different groups with different names ("My Corrections", "Data Corrections", "Data Analysis & Review").

### Flow C: Manager morning review

`Dashboard → Alerts → Compliance → Data Corrections → Scorecard → Hydraulics`

- Six hops across two groups (F3). The Dashboard has links to corrections, maintenance and compliance, which partially acts as a spine, but there is no single "needs your attention" list with counts.

### Flow D: Hydraulics (new)

- **Fleet-first:** `Hydraulics → filter Overdue → row → quick-look / well detail`. Good.
- **Entity-first:** `Plants → plant → Wells → well → Hydraulic card`. Works, but the card has no link up to the fleet, and the fleet filter state is not reachable from the plant.
- **Alerts/Dashboard:** survey-overdue is not surfaced outside the page (planned in `HYDRAULIC-DATA-ACCESS-PLAN.md` H3-2/H3-3).

### Flow E: First run

`/auth → sign up → /onboarding → /pending-approval → (Admin approves) → app`

- **Good:** `approvals` badge for Admins.
- **Gap:** `PendingApproval` polls **[verify]**; a user waiting for approval gets no expectation of how long it takes or whom to contact.
- **Gap:** After approval, is the new user told which plant they are assigned to? `NoPlantsAssigned` handles the zero-plant case, which is good.

### Flow F: Plant switching

`Top bar selector → All plants / one plant`. See F7. Test every page that has its own plant concept.

---

## 6. Proposed structure

Principle: **task-first for entering data, entity-first for inspecting things, and every entity page links to its siblings.**

### 6.1 Navigation (changes in bold)

| Group | Items | Change |
|---|---|---|
| **Monitor** (was Overview) | Dashboard · Alerts · Compliance | Rename only; removes the Overview/Review clash |
| Daily Logs | Daily Readings · RO Trains · PM Schedule · Incidents | Move **My Corrections** out (see Review) |
| Assets | Plants · Hydraulics · Network Topology | Unchanged |
| **Review & Corrections** (was Review) | Data Corrections · **My Corrections** · Data Analysis & Review · Manager Scorecard | My Corrections joins its counterpart. Operators see a one-item group. |
| **Data** (was Reports & Data) | Costs & Tariffs · Data Exports · Smart Import | Rename only (optional); see D3 |
| Team & Admin | Employees · Admin Console | Unchanged |

If D2 (below) is "no", keep My Corrections where it is and do only the renames and badges.

### 6.2 Cross-linking rules

| From | To | Mechanism |
|---|---|---|
| Hydraulic card (well detail) | Hydraulics fleet, pre-filtered to that plant | `AssetLink` / `CanLink` |
| Hydraulics row | Well detail with `?tab=hydraulic` anchored | existing `wellDetailPath` |
| Plants → Trains tab | RO Trains page for that plant/train | link with `?train=` (already a param) |
| Daily Readings entry | "View in Plants" for the selected locator/well | `AssetLink` |
| Alert row | the owning page and tab | alert `link` field |

### 6.3 Queue badges

Extend `NavItem.badge` from `'alerts' | 'approvals'` to include `'corrections-pending'`, `'my-corrections-decided'`, `'pm-overdue'`, `'surveys-overdue'`. Badges must be count-only and driven by cheap queries (use the existing aggregate approach; see D5 and `EGRESS-REDUCTION-PLAN.md`).

### 6.4 One header pattern

All pages use `PageHeader` with `title === nav label`. Deep pages (`/plants/:id/wells/:wellId`) add a breadcrumb: `Plants › Plant A › Wells › BH-01`. Tabs update the document title: `Costs & Tariffs · Budget`.

### 6.5 Tab governance

Create one registry (`lib/tabRegistry.ts`) listing every page's tabs with id, label and required module. Use it for: the tabs themselves, the document title, the command palette (so "Budget" finds *Costs → Budget*), and a test that fails when a tab id is added without a label. Cap new pages at six tabs; beyond that, split the page or use a secondary menu.

---

## 7. Phased plan

### Phase 0: Decide and measure (before moving anything)

| ID | Task | Size |
|---|---|---|
| IA0-1 | Add a route-level page-view event (route, role, plant count; no personal data). Even two weeks of data settles D4 and the regrouping. | S |
| IA0-2 | Resolve decisions D1 to D5 below. | S |
| IA0-3 | Run the **[verify]** list in Appendix A (30 minutes in the running app, once per role). | S |

### Phase 1: Quick wins (no restructure)

| ID | Task | Size |
|---|---|---|
| IA1-1 | Make every page title equal its nav label; render with `PageHeader`. Incidents → "Incidents" (keep "HSE log" as subtitle). | S |
| IA1-2 | Document title shows page and active tab. | S |
| IA1-3 | Rename group `Overview` → `Monitor` (D1). Update `navConfig.test.ts` expectations. | S |
| IA1-4 | Unify tab ids (`locator`/`locators`, `well`/`wells`) via aliases in `useUrlTab` so old links keep working. | S |
| IA1-5 | Hydraulics ↔ Plants cross-links (6.2 rows 1 and 2). | S |

### Phase 2: Queues and flows

| ID | Task | Size |
|---|---|---|
| IA2-1 | Badges for Data Corrections (pending) and My Corrections (decided since last visit). | M |
| IA2-2 | Badges for PM overdue and Hydraulics surveys overdue. Reuse `isSurveyDue` from `features/wells/lib/hydraulics.ts`. | M |
| IA2-3 | Dashboard "Needs your attention" card for Managers: counts + links, one row per queue. | M |
| IA2-4 | Move My Corrections next to Data Corrections (D2). Add a "Fix" confirmation toast that links to My Corrections. | S |

### Phase 3: Structure

| ID | Task | Size |
|---|---|---|
| IA3-1 | `tabRegistry.ts` and migrate pages to it (6.5). Add the "every tab has a label and module" test. | M |
| IA3-2 | Command palette indexes pages + tabs (+ existing wells, plants, rows). | M |
| IA3-3 | Breadcrumbs on `/plants/:id` and `/plants/:id/wells/:wellId`. | M |
| IA3-4 | Single plant-scope contract: one hook (`usePlantScope`) that every page uses; define what a route `:id` does to the top-bar selection (F7). Add a test per page that has its own plant concept. | L |
| IA3-5 | Cross-links for RO Trains ↔ Plants → Trains, Daily Readings → Plants (6.2). | M |

### Phase 4: Optional, once data exists

| ID | Task | Size |
|---|---|---|
| IA4-1 | Round-based entry mode for operators ("plant walk": one plant, all locators in order). Only if Phase 0 data or operator interviews support it. | L |
| IA4-2 | Revisit the mobile bar using IA0-1 data (D4). | S |
| IA4-3 | Consolidate the three import doors into one entry (F6), with the dialog kept as a shortcut. | M |
| IA4-4 | Align route paths with labels, with redirects (F11). | S |

---

## 8. Decisions needed

| ID | Question | Recommendation |
|---|---|---|
| D1 | Rename `Overview` → `Monitor` and `Review` → `Review & Corrections`? | Yes. Cheap, removes the near-synonym. |
| D2 | Move My Corrections into the Review group? | Yes, if Operators seeing a one-item group is acceptable. Otherwise leave it and rely on badges. |
| D3 | Rename `Reports & Data`? | Optional. Skip unless Import moves (IA4-3). |
| D4 | Change the mobile bottom bar? | Not yet. Wait for IA0-1 data; the current layout is reasoned and tested. |
| D5 | How are queue counts computed? | A single lightweight RPC or view returning all badge counts for the signed-in user, refreshed on focus. Do not add one query per badge. |

---

## 8a. Decisions taken (2026-10-03)

| ID | Decision | Status |
|---|---|---|
| D1 | Rename `Overview` → `Monitor` and `Review` → `Review & Corrections` | Agreed. Shipped in patch 02. |
| D2 | Move My Corrections into `Review & Corrections` | Agreed. Shipped in patch 02. Operators see a one-item group. |
| IA0-1 | Add the page-view event **before** any layout change | Agreed. Shipped in patch 01 (`nav_page_views`, see `supabase/runbooks/nav-page-views.md`). Collect data before D4 (mobile bar) or any further regrouping. |

D3, D4 and D5 stay open.

---

## 9. Acceptance criteria

- A Manager sees pending corrections, overdue PM and overdue surveys as counts **without leaving the page they are on**.
- Every page title matches its sidebar label; every deep page has a breadcrumb.
- From a well, one click reaches that plant's hydraulic fleet view, and back.
- Typing a tab name (for example "Budget") in Ctrl+K finds *Costs → Budget*.
- Every tab id has a label and a required module, enforced by a test.
- For each page with a plant concept, a test shows what happens when the top-bar plant and the route plant disagree.
- `navConfig.test.ts` per-role expectations are updated, and `ProtectedRoute`/`navConfig` still agree for Operators.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Renames break muscle memory and the in-app manual | Update `chapterRoutes.ts` and the manual in the same PR; keep old URLs |
| Badge queries add load on every page | One aggregate call (D5); check against the egress plan |
| Moving My Corrections changes what Operators see | Ship behind D2 and check with two or three operators first |
| Tab id renames break saved links | Aliases in `useUrlTab` (it already supports `aliases`) |
| Regrouping without usage data | Phase 0 first; Phase 1 is deliberately low-risk |

---

## Appendix A: verify in the running app

1. Role landing page for each of the five roles (`getPostLoginPath`).
2. Top-bar plant = A, then open `/plants/B`: which plant do Dashboard, Hydraulics and Alerts show?
3. Does the browser tab title change with the active tab (`useDocumentTitle`)?
4. Does Ctrl+K find a tab name, a nav page, a plant, a well?
5. Hydraulics row click: where does it go, and does Back restore the filter?
6. Operator view: count and order of items in the More sheet on a 360 px phone.
7. Pending-approval screen: copy, polling, and what happens after approval.
8. Is there any breadcrumb or "back to list" on `/plants/:id/wells/:wellId`?

## Appendix B: what this critique is based on

- Read: `navConfig.ts`, `App.tsx` routes, `AppShell.tsx`, `BottomNav.tsx`, `ProtectedRoute.tsx`, `TopBar/index.tsx`, `CommandPalette.tsx`, `features/admin/lib/permissions.ts` (`MODULE_LABELS`), the `useUrlTab` call sites and tab values for ten pages, `PageHeader` usage, Dashboard link targets, and `docs/NAV-IA-REMEDIATION-PLAN.md`.
- Searched: references to `/hydraulics` from Plants and Operations (none outside nav and the hydraulics feature), `badge` kinds in `navConfig.ts` (`alerts`, `approvals` only).
- **Not done:** running the app, screenshots (other than the earlier Hydraulic card), usage analytics, accessibility testing, performance measurement, and reading every page. Findings marked **[verify]** are hypotheses.
- Tab counts exclude RO Trains, whose tab list I did not extract.
