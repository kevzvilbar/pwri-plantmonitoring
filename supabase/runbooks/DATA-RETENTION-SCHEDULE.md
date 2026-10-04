# Data Retention & Disposal Schedule

**Organization:** PrimeWater Resources, Inc. (PWRI)  
**System:** Plant Monitoring & Operational Intelligence Platform  
**Compliance Standard:** Philippine Data Privacy Act of 2012 (RA 10173), NPC Guidelines, DOH/PNSDW Regulatory Requirements  
**Revision:** 2026-10

---

## 1. Purpose

This schedule outlines the retention periods, archiving requirements, and secure disposal policies for all data classes stored in the PWRI Plant Monitoring Platform.

---

## 2. Retention Schedule by Data Category

| Category | Description | Retention Period | Disposal / Archival Method |
|---|---|---|---|
| **Water Quality & Production Readings** | Daily plant logs, RO train operational logs, flow meter records, pressure differentials, chemical dosing records | **5 Years minimum** (Regulatory compliance with PNSDW / Philippine National Standards for Drinking Water) | Permanent cold storage backup, immutable audit logs |
| **Data Correction Audit Trails** | Corrections submitted via `reading_data_corrections`, `reading_audit_logs`, approval timestamps, reviewer IDs | **5 Years** | Linked to reading historical record |
| **Active Employee / User Profiles** | First name, last name, email, username, designation, plant assignments | **Duration of Employment + 1 Year** | Pseudonymization on departure (`Former Employee (<ID>)`, email reset, tokens deleted) |
| **Departed Employee Audit Records** | Historical authorship of submitted readings and equipment approvals | **Retained indefinitely under pseudonymized key** | Preserved foreign keys to maintain integrity of regulatory compliance logs |
| **Anonymous Navigation Telemetry** | Screen view counts, route patterns, client device type (`nav_page_views`) | **90 Days** | Automated sliding window cleanup cron |
| **Authentication & Session Logs** | Auth token refreshes, failed password attempts, IP sessions | **30 Days** | Managed by Supabase Auth engine |
| **Push Notification Tokens** | Web Push endpoint credentials (`user_push_subscriptions`) | **Active session lifetime or revoked on logout** | Hard delete upon invalid endpoint response or explicit unsubscribe |

---

## 3. Pseudonymization Procedure for Departed Staff

When an employee leaves PWRI:
1. Administrator navigates to **Employees** -> **User Profile** -> **Anonymize User**.
2. First name, middle name, last name, suffix, and phone/personal identifiers are replaced with `'Former Employee'` and anonymized hash.
3. Push notification endpoints and active auth sessions are revoked.
4. Historical readings retain user ID reference without displaying personal identification.
