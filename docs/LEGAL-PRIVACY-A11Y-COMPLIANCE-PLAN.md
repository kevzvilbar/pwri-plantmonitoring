# Legal, Privacy, and Accessibility (a11y) Compliance Plan

**Application:** PWRI Plant Monitoring System (Pilipinas Water Resources, Inc.)  
**Head Office Address:** Cebu South Coastal Road, Cogon Pardo, 6000 Cebu City, Philippines  
**Official Website:** https://www.pilipinaswater.com.ph/  
**Jurisdiction:** Republic of the Philippines (Philippine Data Privacy Act of 2012 / RA 10173; National Privacy Commission Circulars 16-01, 16-03, 2022-04; WCAG 2.1 Level AA)  
**Effective Date:** October 2026 (v2026-10)

---

## 1. Executive Summary & Legal Framework

The PWRI Plant Monitoring System is an internal enterprise operational and industrial control platform used by operators, technicians, plant managers, and engineers across multiple water treatment and reverse osmosis (RO) facilities in the Philippines.

Because the system manages user identity records, shift duty timestamps, equipment audit logs, operational data corrections, and telemetry, it is subject to:
1. **Republic Act No. 10173 (Philippine Data Privacy Act of 2012 / DPA 2012)** and its Implementing Rules and Regulations (IRR).
2. **National Privacy Commission (NPC)** Circulars regarding Data Protection Officers (DPO), security of personal data in government/corporate bodies, and mandatory 72-hour personal data breach notification.
3. **Web Content Accessibility Guidelines (WCAG) 2.1 Level AA** ensuring usable, keyboard-navigable, screen-reader compatible interfaces for all plant personnel.

---

## 2. Architecture & Data Flow

```
[ Plant Operator / Technician / Manager ]
                   │
                   ▼ (HTTPS / PWA / WebPush)
         ┌───────────────────┐
         │ React + Vite PWA  │
         │ (WCAG 2.1 AA UI)  │
         └─────────┬─────────┘
                   │
         ┌─────────┴─────────┐
         │  Client Controls  │ ◄── DNT / Anonymous Telemetry Opt-out
         │  Data Portability │ ◄── Download My Data (JSON)
         └─────────┬─────────┘
                   │
                   ▼ (RLS Enforced JWT)
         ┌───────────────────┐
         │ Supabase Database │
         │  - user_profiles  │ (notice_version, notice_acknowledged_at)
         │  - audit_logs     │ (historical immutability)
         │  - readings       │ (operational metrics)
         └─────────┬─────────┘
                   │
    ┌──────────────┴──────────────┐
    ▼                             ▼
[ Sub-Processor: Supabase ]   [ Sub-Processor: Sentry ]
(Encrypted at rest / transit) (Session Replay Masked)
```

---

## 3. Compliance Matrix

| Regulation / Standard | Requirement | Implementation in PWRI System | Verification Mechanism |
|---|---|---|---|
| **RA 10173 Sec. 16** (Rights of Data Subject) | Right to be Informed | Transparent Public Privacy Notice (`/privacy`) and Terms (`/terms`) accessible pre- and post-auth. | Route tests, navigation links in Auth/Profile/Help |
| **RA 10173 Sec. 16** | Explicit / Informed Consent | Mandatory notice acknowledgement on account onboarding/sign-up, tracked via `notice_version` and `notice_acknowledged_at`. | Migration `20261004000002`, SignUpForm tests |
| **RA 10173 Sec. 18** | Data Portability | Self-service "Download My Data" exporting profile metadata, audit history, and corrections in machine-readable JSON. | `ProfilePrivacyCard.tsx` |
| **RA 10173 Sec. 16(e)** | Right to Erasure / Rectification | Pseudonymization workflow (`Former Employee (<ID>)`, email obfuscation, device token purges) preserving immutable regulatory audit trails. | `DeleteEntityMenu/useDeleteEntity.ts` |
| **NPC Circ. 16-03** | 72-Hour Breach Notification | Established incident response runbook identifying containment, triage, notification to NPC and affected subjects. | `supabase/runbooks/DATA-BREACH-RESPONSE-PLAN.md` |
| **NPC Security Rules** | Data Retention & Storage Limits | 90-day retention on transient navigation telemetry and deleted session tokens; 5-year retention on regulatory water logs. | `supabase/runbooks/DATA-RETENTION-SCHEDULE.md` |
| **Privacy by Design** | Sentry Session Replay Guard | Enforced `maskAllText: true`, `blockAllMedia: true` in Sentry replay integration to prevent accidental capture of PII or credentials. | `frontend/src/shared/sentry.ts` |
| **WCAG 2.1 Level AA** | Screen Readers & Keyboard Navigation | Valid ARIA roles (`role-has-required-aria-props`, `aria-haspopup="dialog"` on date pickers, accessible headings, keyboard handlers). | ESLint ceiling ratchet `check-lint-ceiling.mjs` |

---

## 4. Operational Runbooks
- **Data Retention Policy:** [`supabase/runbooks/DATA-RETENTION-SCHEDULE.md`](file:///c:/Users/vilba/.antigravity/pwri-plantmonitoring-main/pwri-plantmonitoring/supabase/runbooks/DATA-RETENTION-SCHEDULE.md)
- **Data Breach Response Protocol:** [`supabase/runbooks/DATA-BREACH-RESPONSE-PLAN.md`](file:///c:/Users/vilba/.antigravity/pwri-plantmonitoring-main/pwri-plantmonitoring/supabase/runbooks/DATA-BREACH-RESPONSE-PLAN.md)
