# Retired Edge Function: data-analysis

**Retired Date**: 2026-08-31
**Reason**: All regression calculation logic and residual outlier detection is executed client-side via `frontend/src/lib/regressionCorrection.ts`, and database cascading/updates are executed transactionally via PostgreSQL RPCs (`fn_cascade_reading_correction`). This Edge Function was dormant and not deployed to production.

