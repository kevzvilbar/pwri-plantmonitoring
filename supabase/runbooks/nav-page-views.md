# Navigation page-view telemetry

Table `public.nav_page_views`, written by `frontend/src/lib/navTelemetry.ts`.
Purpose: give the IA review (`docs/IA-NAV-USERFLOW-CRITIQUE-AND-PLAN.md`) real
usage numbers before navigation is regrouped.

**Privacy:** no user id, plant id, IP or free text. `route` is a pattern
(`/plants/:id`), `session_id` is a random id that dies with the browser tab,
`role` is self-reported. Browsers with Do Not Track, and builds with
`VITE_NAV_TELEMETRY=off`, record nothing. Only Admins can read the table.

Run these in the Supabase SQL editor (as an Admin or the service role).

```sql
-- Most used pages, last 28 days, with how many separate visits used them
SELECT route, count(*) AS views, count(DISTINCT session_id) AS sessions
FROM nav_page_views
WHERE occurred_at > now() - interval '28 days'
GROUP BY route ORDER BY views DESC;

-- Same, by role (is Hydraulics a Manager page? is Compliance used by Operators?)
SELECT role, route, count(*) AS views
FROM nav_page_views
WHERE occurred_at > now() - interval '28 days'
GROUP BY role, route ORDER BY role, views DESC;

-- Which tabs get opened (pages with tabs only)
SELECT route, coalesce(tab, '(default)') AS tab, count(*) AS views
FROM nav_page_views
WHERE occurred_at > now() - interval '28 days'
GROUP BY route, tab ORDER BY route, views DESC;

-- Mobile vs desktop per page (informs the bottom bar slots)
SELECT route,
       count(*) FILTER (WHERE device = 'mobile')  AS mobile,
       count(*) FILTER (WHERE device = 'desktop') AS desktop
FROM nav_page_views
WHERE occurred_at > now() - interval '28 days'
GROUP BY route ORDER BY mobile DESC;
```

Notes for reading the numbers: a "view" is one route or tab change, not time
spent. A reload counts as a new visit. Views of `/*` are paths that match no
known route. Rows can be missing if a tab was closed while offline.

## Retention

Keep about 90 days:

```sql
DELETE FROM nav_page_views WHERE occurred_at < now() - interval '90 days';
```

No scheduled job exists for this yet; run it by hand, or add one with
`pg_cron` or a scheduled Edge Function using the service role.
