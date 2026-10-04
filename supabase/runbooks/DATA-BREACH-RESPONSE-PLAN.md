# Personal Data Breach Management & Incident Response Plan

**Organization:** Pilipinas Water Resources, Inc. (PWRI)  
**Head Office:** Cebu South Coastal Road, Cogon Pardo, 6000 Cebu City, Philippines  
**Website:** https://www.pilipinaswater.com.ph/  
**System:** Plant Monitoring & Operational Intelligence Platform  
**Compliance Standard:** National Privacy Commission (NPC) Circular No. 16-03 (Personal Data Breach Management) & RA 10173  
**DPO Contact:** `dpo@pwri.com.ph`  
**Security Incident Response Team (SIRT):** Lead Engineer, Plant Operations Manager, Data Protection Officer  
**Revision:** 2026-10

---

## 1. Incident Severity Classification

1. **Level 1 - Low / Minor Vulnerability:**
   - Isolated failed authentication attempts, rate limiting alarms, non-sensitive client errors.
   - *Action:* Triage within 24 hours, patch in regular release.
2. **Level 2 - Moderate / Security Anomaly:**
   - Unscheduled database reboot, abnormal token activity, unexpected schema access attempts.
   - *Action:* Contain within 4 hours, notify SIRT.
3. **Level 3 - Critical / Reportable Personal Data Breach:**
   - Unauthorized access, exfiltration, or loss of user profile credentials, unmasked employee records, or tampering with water quality safety logs.
   - *Action:* Immediate containment, mandatory NPC notification within **72 hours** from discovery under NPC Circular 16-03.

---

## 2. 72-Hour Response Protocol (NPC Circular 16-03)

```
[ Hour 00:00 - Discovery & Identification ]
   │
   ├─► 1. Trigger SIRT alert & designate Incident Commander.
   ├─► 2. Isolate compromised sessions (Revoke Supabase JWTs, rotate API keys).
   │
[ Hour 00:00 to 24:00 - Containment & Forensic Triage ]
   │
   ├─► 3. Inspect Supabase Auth & Audit Logs (`reading_audit_logs`, `access_logs`).
   ├─► 4. Determine scope: number of affected personnel, nature of data involved.
   ├─► 5. Assess risk of harm or identity theft to data subjects.
   │
[ Hour 24:00 to 72:00 - Notification & Remediation ]
   │
   ├─► 6. Draft Breach Notification Report to NPC (Form NPC-BR-2016-01).
   ├─► 7. Submit formal report to NPC (`complaints@privacy.gov.ph` / NPC portal).
   ├─► 8. Notify affected employees/operators via registered email with guidance.
   ├─► 9. Deploy code patch / database mitigation to eliminate root cause.
   └─► 10. Document post-incident review and retain log records for NPC verification.
```

---

## 3. Key Contact Registry

- **Data Protection Officer:** `dpo@pwri.com.ph`
- **IT Security Operations:** `it-security@pwri.com.ph`
- **National Privacy Commission (NPC):** `https://privacy.gov.ph` | `complaints@privacy.gov.ph`
