# PWRI Plant Monitoring System — System Architecture

**Pilipinas Water Resources, Inc. (PWRI)**  
*Cebu South Coastal Road, Cogon Pardo, 6000 Cebu City*  
*Website:* [https://www.pilipinaswater.com.ph/](https://www.pilipinaswater.com.ph/)

---

## 1. Executive Architectural Overview

The PWRI Plant Monitoring System is a cloud-native, offline-capable Progressive Web Application (PWA) designed for real-time operational monitoring, water balance reconciliation, power consumption tracking, compliance assurance, and equipment maintenance across PWRI's water treatment and Reverse Osmosis (RO) plants.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT LAYER (PWA)                             │
│   React 18 + Vite + TypeScript + Tailwind CSS / shadcn/ui + TanStack Query   │
│   ┌───────────────────────────┐     ┌───────────────────────────────────┐   │
│   │   Offline IndexedDB Outbox │ ◄───┤ Service Worker & Precache Assets  │   │
│   └─────────────┬─────────────┘     └───────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────────────────┘
                  │ HTTPS (PostgREST / Auth / Realtime)
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE BACKEND PLATFORM                          │
│                                                                             │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
│  │     Supabase Auth     │  │     PostgREST API     │  │ Realtime Engine │  │
│  │  (JWT / RBAC / TOTP)  │  │  (Schema Auto-expose) │  │  (WebSockets)   │  │
│  └──────────┬────────────┘  └───────────┬───────────┘  └────────┬────────┘  │
│             │                           │                       │           │
│  ┌──────────▼───────────────────────────▼───────────────────────▼────────┐  │
│  │                    POSTGRESQL 15 DATABASE CORE                       │  │
│  │  • Row-Level Security (RLS) on all 99 tables                          │  │
│  │  • Security Definer RPCs with fixed search_path                       │  │
│  │  • Trigger Cascade Circuit Breakers & Column-Restricted Triggers      │  │
│  │  • Water Balance Reconciliation & PNSDW Compliance Analytics          │  │
│  │  • pg_cron scheduled jobs & pg_net asynchronous HTTP workers          │  │
│  └──────────────────────────────────────┬────────────────────────────────┘  │
│                                         │ pg_net trigger dispatches         │
│                                         ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        DENO EDGE FUNCTIONS                            │  │
│  │  • admin-update-user-email (JWT + Admin role validated)               │  │
│  │  • notify-train-offline (Resend SMTP notifications)                   │  │
│  │  • send-push-notification (VAPID Web Push delivery)                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Layer

- **Framework:** React 18.3.1 with TypeScript 5.8.3, bundled with Vite 6.4.3.
- **State & Data Caching:** TanStack Query v5 with IndexedDB persistence persister, paired with lightweight Zustand stores for client-only UI state (active plant, theme, collapsed sidebars).
- **Component Architecture:** Radix UI primitives with shadcn/ui design tokens, lucide-react iconography, and Recharts for time-series and trend visualizations.
- **Security Ratchets & Verification:**
  - `check-types-sync.mjs`: Validates 1:1 synchronization between database migration schema and generated TypeScript types.
  - `check-bundle-size.mjs`: Enforces production bundle gzip limits (1155.7 kB baseline).
  - `check-lint-ceiling.mjs`: Strict ceiling ratchet on TypeScript and accessibility lints.
  - `security-audit.mjs`: Enforces strict CSP, safe CSV exports (CWE-1236 formula injection defense), and edge function authorization.

---

## 3. Offline-First & Data Sync Pipeline

Field operators frequently collect meter readings and equipment logs in subterranean pump stations or areas with spotty cellular coverage:
1. **Mutation Interception:** When network connectivity is severed (`navigator.onLine === false`), reading mutations are saved to an IndexedDB outbox (`idb-keyval`).
2. **Optimistic UI Updates:** UI counters and tabular history reflect pending submissions immediately with an "Offline Queued" badge.
3. **Background Synchronization:** As soon as connectivity is restored, the outbox worker replays queued mutations in sequence, handling idempotency and logging audit records.
4. **Data Protection:** Queued items are never evicted during idle timeouts to prevent data loss.

---

## 4. Database Layer & Security Boundary

The database is the definitive security boundary:
- **Zero-Trust Row-Level Security (RLS):** All public tables enforce RLS policies. Unauthenticated or unapproved users cannot read operational records.
- **Role-Based Access Control (RBAC):** Roles (`Admin`, `Manager`, `Operator`, `Technician`, `Viewer`) are stored in `public.user_roles` and synced with JWT app metadata.
- **Cascade Integrity & Circuit Breakers:** PostgreSQL trigger chains on reading tables enforce max cascade depth limits (`cascade_depth_audit`) to prevent recursive execution.
- **Data Retention & Privacy (RA 10173):** Automated retention schedules prune transient navigation telemetry after 90 days, while preserving immutable 5-year water treatment operational logs. User pseudonymization workflows allow compliant profile erasure while preserving historical attribution.

---

## 5. Edge Functions Layer

Three dedicated serverless Deno functions run under `supabase/functions/`:
1. **`admin-update-user-email`:** Enables administrative email updates for field operators without requiring manual email re-confirmation. Validates caller JWT and Admin role before invoking `auth.admin.updateUserById`.
2. **`notify-train-offline`:** Dispatches immediate alert emails via Resend when a Reverse Osmosis train transitions to offline status.
3. **`send-push-notification`:** Delivers push alerts to subscribed operators' devices using VAPID keys.

---

## 6. Hosting & CI/CD Infrastructure

- **Production Hosting:** Vercel (primary SPA host) with custom security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).
- **Continuous Integration:** GitHub Actions (`.github/workflows/ci.yml`) executes full multi-stage gates:
  1. TypeScript strict type-checking (`tsc --noEmit`)
  2. Vitest unit and component tests (197 test suites, 1,462 tests)
  3. Production build and bundle size verification
  4. Security audit (CSP, CSV sanitization, Edge Function guards)
  5. Playwright smoke and authenticated E2E workflows against disposable local Supabase instance
  6. PostgreSQL pgTAP regression test suites
  7. CodeQL analysis and weekly npm vulnerability scans.
