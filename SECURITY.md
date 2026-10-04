# Security Policy

## Pilipinas Water Resources, Inc. (PWRI) Plant Monitoring System

Pilipinas Water Resources, Inc. (PWRI) takes the security and integrity of our critical water infrastructure monitoring platform seriously. This document outlines our security policy, vulnerability reporting procedures, and architectural security standards.

---

## 1. Supported Versions

Security updates and patches are actively applied to the following branch/releases:

| Version / Branch | Supported | Notes |
| :--- | :---: | :--- |
| `main` | ✅ | Active production deployment branch |
| Staging (`staging`) | ✅ | Active pre-production environment |
| Historical branches | ❌ | Not supported; upgrade to latest `main` |

---

## 2. Reporting a Vulnerability

If you discover a potential security vulnerability within the PWRI Plant Monitoring System, please report it promptly through private channels. **Do not create public GitHub issues or discussions for security vulnerabilities.**

### Private Reporting Channels
- **Security Contact:** `security@pilipinaswater.com.ph` / `kevzvilbar@gmail.com`
- **Subject Line:** `[SECURITY VULNERABILITY] PWRI Plant Monitoring - <Brief Summary>`
- **Information to Include:**
  1. Description of the vulnerability and its potential impact.
  2. Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
  3. Affected component(s) (e.g. Frontend route, Supabase RLS policy, Edge Function, Database RPC).
  4. Any proposed mitigations or remediations.

### Response SLA & Expectations
- **Initial Acknowledgment:** Within 24 hours of receipt.
- **Triage & Assessment:** Within 48 hours to confirm validity and severity.
- **Remediation & Patching:** Critical severity issues are prioritized for hotfix deployment within 72 hours, aligned with NPC Circular 16-03 breach containment guidelines.
- **Coordinated Disclosure:** We request reporters allow up to 30 days for remediation prior to any public disclosure.

---

## 3. Core Architectural Security Controls

1. **Row-Level Security (RLS) & Database Boundary:**
   - Every public table has Postgres Row-Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
   - All data access is strictly governed by server-side policies checking `auth.uid()` against authenticated `user_roles` and `plant_access`.
   - Admin-destructive operations (e.g., hard deletes, entity purges, role promotions) are enforced through security definer RPCs with search path constraints and role validation.

2. **Edge Function Security:**
   - Edge functions running privileged operations (e.g. `admin-update-user-email`, `notify-train-offline`, `send-push-notification`) verify caller JWT authorization and role claims before executing actions.

3. **Data Privacy Compliance (RA 10173 - Philippine Data Privacy Act):**
   - Personal data collected for employee user profiles is managed strictly under privacy principles.
   - User anonymization and pseudonymization workflows ensure compliance with the Right to Erasure while maintaining immutable regulatory water treatment audit trails.
   - Sentry Session Replay guards enforce strict masking (`maskAllText: true`, `blockAllMedia: true`) to prevent PII exposure.

4. **Browser & Network Security:**
   - Strict Content Security Policy (CSP), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin` are enforced to prevent clickjacking, MIME-sniffing, and injection attacks.
   - All communication is encrypted in transit via TLS 1.3.
