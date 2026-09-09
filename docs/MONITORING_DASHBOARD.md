# Monitoring Dashboard Configuration
## Phase 5: Operational Maturity

This document describes the monitoring setup for PWRI Plant Monitoring.

---

## Sentry Dashboard

### Project Setup
1. Create Sentry project: `pwri-plantmonitoring`
2. Configure DSN in environment variables:
   ```
   VITE_SENTRY_DSN=https://<key>@sentry.io/<project-id>
   VITE_SENTRY_ENVIRONMENT=production  # or staging
   VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
   VITE_SENTRY_REPLAYS_SAMPLE_RATE=0.01
   ```

### Required Alerts

| Alert | Condition | Severity | Notification |
|-------|-----------|----------|--------------|
| **Error Spike** | > 10 errors/min for 5 min | Critical | PagerDuty + Slack |
| **New Error** | New error type detected | High | Slack |
| **Crash Rate** | > 1% sessions crash | High | Slack |
| **Performance** | > 5s page load p95 | Medium | Slack |
| **API Errors** | > 5% 5xx rate for 5 min | High | Slack |
| **React Errors** | > 20 React errors/hour | High | Slack |

### Sentry Dashboards

#### 1. Error Overview
- **Widgets:**
  - Error rate over time (1h, 24h, 7d)
  - Top 10 errors by frequency
  - Errors by browser/OS
  - Errors by release
  - New vs. regressed errors

#### 2. Performance
- **Widgets:**
  - Page load time (p50, p95, p99)
  - API latency (p50, p95, p99)
  - Largest Contentful Paint (LCP)
  - First Input Delay (FID)
  - Cumulative Layout Shift (CLS)

#### 3. User Impact
- **Widgets:**
  - Sessions with errors
  - Users affected
  - Crash-free sessions %
  - Adoption by release

#### 4. Plant-Specific (Custom)
- **Widgets:**
  - Errors by plant_id
  - Errors by entity type (well, locator, RO train)
  - Operator-specific error rates
  - Data correction rejection rates

---

## Grafana / Prometheus (Infrastructure)

### Metrics to Collect

#### Application Metrics
```promql
# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])

# Latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Active users
count(user_sessions_active)

# Business metrics
rate(well_readings_inserted_total[5m])
rate(correction_requests_created_total[5m])
```

#### Database Metrics
```promql
# Connection pool
pg_stat_database_numbackends
pg_stat_database_xact_commit / pg_stat_database_xact_rollback

# Query performance
pg_stat_statements_mean_time
pg_stat_statements_calls

# Lock contention
pg_locks_waiting
```

#### Supabase-Specific
```promql
# Edge Function invocations
supabase_edge_function_invocations_total
supabase_edge_function_duration_seconds

# Realtime connections
supabase_realtime_connections_active

# Storage
supabase_storage_bucket_size_bytes
```

### Grafana Dashboards

#### 1. Application Overview
- Request rate / error rate / latency (RED metrics)
- Active users over time
- Top endpoints by traffic
- Error budget burn rate

#### 2. Business KPIs
- Daily active operators
- Readings submitted per hour
- Data correction approval rate
- Compliance snapshot frequency
- Import success rate

#### 3. Plant Health
- Readings per plant per hour
- Data freshness (last reading age)
- NRW % trends
- Compliance scores
- Chemical supply days remaining

#### 4. Infrastructure
- Supabase CPU / memory / disk
- Database connections
- Edge Function cold starts
- CDN cache hit rate

---

## Alert Routing

### Slack Channels
| Channel | Purpose | Alerts |
|---------|---------|--------|
| `#alerts-critical` | Page on-call | Error spikes, crash rate, API 5xx |
| `#alerts-high` | Notify team | New errors, performance, API 4xx |
| `#alerts-medium` | Daily digest | Performance trends, business KPIs |
| `#alerts-plant` | Plant operators | Plant-specific issues |

### PagerDuty Integration
- **Service:** `pwri-plantmonitoring`
- **Escalation Policy:** 
  1. Primary on-call (immediate)
  2. Secondary on-call (5 min)
  3. Team lead (15 min)
  4. Manager (30 min)

---

## Runbooks

### Common Alert Runbooks

#### 🔴 Error Spike (>10 errors/min)
1. Check Sentry for error pattern
2. Identify affected plant/component
3. Check recent deployments
4. Rollback if deployment-related
5. Apply hotfix if code bug
6. Document in incident log

#### 🔴 High Crash Rate
1. Check Sentry crash reports
2. Identify common device/browser
3. Check for memory leaks
4. Verify latest release
5. Rollback if needed

#### 🟡 High API Latency
1. Check Supabase dashboard
2. Check database locks
3. Check Edge Function cold starts
4. Scale if needed
5. Check query plans

#### 🟡 Plant Data Stale
1. Check operator activity
2. Check sync status
3. Verify internet connectivity
4. Check for offline mode issues

---

## On-Call Schedule

### Rotation
- **Primary:** Week 1, 3, 5... (Monday 9 AM → Monday 9 AM)
- **Secondary:** Week 2, 4... (Monday 9 AM → Monday 9 AM)
- **Backup:** Tech lead (always available)

### Handoff Checklist
- [ ] Review open incidents
- [ ] Check recent deployments
- [ ] Review error trends
- [ ] Note any planned maintenance
- [ ] Update on-call calendar

---

## Incident Response

### Severity Levels
| Level | Definition | Response Time | Communication |
|-------|------------|---------------|---------------|
| **SEV-1** | Data loss, security breach, total outage | 15 min | Page + Slack + Email |
| **SEV-2** | Major feature broken, partial outage | 30 min | Slack + Email |
| **SEV-3** | Minor feature degraded, performance | 2 hours | Slack |
| **SEV-4** | Cosmetic, minor bug, enhancement | Next sprint | GitHub Issue |

### Incident Process
1. **Acknowledge** (within response time)
2. **Assess** severity and impact
3. **Communicate** to stakeholders
4. **Investigate** root cause
5. **Mitigate** immediate impact
6. **Resolve** permanent fix
7. **Postmortem** (SEV-1/2 within 48h)

---

## Log Retention

| Log Type | Retention | Storage |
|----------|-----------|---------|
| Sentry events | 90 days | Sentry Cloud |
| Application logs | 30 days | Vercel / Supabase |
| Audit logs | 7 years | PostgreSQL (compliance) |
| Access logs | 1 year | Vercel / Cloudflare |
| Database logs | 90 days | Supabase |

---

## Cost Optimization

### Sentry
- Sample rate: 10% transactions, 1% replays
- Drop health check endpoints
- Filter known benign errors

### Grafana Cloud
- Retain 30 days metrics, 1 year for billing
- Drop high-cardinality labels
- Use recording rules for common queries

---

*Document version: 1.0*
*Created: 2026-09-09*
*Owner: Platform Team*