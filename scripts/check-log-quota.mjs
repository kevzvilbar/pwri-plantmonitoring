#!/usr/bin/env node
/**
 * scripts/check-log-quota.mjs
 *
 * Log Quota & Traffic Regression Guardrail (LOG-QUOTA-REMEDIATION-PLAN.md & EGRESS-REDUCTION-PLAN.md)
 *
 * Checks recent REST request volume via Supabase Analytics Logs API over a narrow
 * 1-hour window (to conserve the Log Query quota while catching runaway polling loops).
 *
 * Can also run offline in audit mode to verify that no frontend hook introduces
 * uncoordinated refetch intervals under 5 minutes.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'sosfbfxovtleuvahxvpm';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const HOURLY_REQUEST_THRESHOLD = Number(process.env.LOG_REQUEST_THRESHOLD || 500);

async function runLiveLogCheck() {
  if (!ACCESS_TOKEN) {
    console.log('[log-quota-guard] SUPABASE_ACCESS_TOKEN not set. Running static codebase audit...');
    return runStaticAudit();
  }

  console.log(`[log-quota-guard] Querying 1-hour REST log volume for project ${PROJECT_REF}...`);

  const sql = `
    select
      log_attributes['request.method'] as method,
      log_attributes['request.path'] as path,
      count(*) as requests
    from logs
    where source = 'edge_logs'
      and log_attributes['request.path'] like '/rest/v1/%'
      and log_attributes['request.method'] != 'OPTIONS'
      and timestamp >= now() - interval '1 hour'
    group by method, path
    order by requests desc
    limit 20;
  `.trim();

  try {
    const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[log-quota-guard] Supabase API responded with HTTP ${res.status}: ${errText}`);
      console.log('[log-quota-guard] Falling back to static codebase audit...');
      return runStaticAudit();
    }

    const json = await res.json();
    const rows = json.data || json.result || [];

    console.log('\n--- Top 20 REST Request Endpoints (Last 1 Hour) ---');
    console.table(rows);

    const breaches = rows.filter((r) => Number(r.requests || 0) > HOURLY_REQUEST_THRESHOLD);
    if (breaches.length > 0) {
      console.error(`\n::error::[log-quota-guard] Found ${breaches.length} endpoint(s) exceeding threshold of ${HOURLY_REQUEST_THRESHOLD} req/hr:`);
      breaches.forEach((b) => console.error(`  - ${b.method} ${b.path}: ${b.requests} requests`));
      process.exit(1);
    }

    console.log(`\n[log-quota-guard] All REST endpoints are within the healthy threshold (<= ${HOURLY_REQUEST_THRESHOLD} req/hr).`);
  } catch (err) {
    console.warn('[log-quota-guard] Failed to query Supabase Management API:', err.message);
    console.log('[log-quota-guard] Falling back to static codebase audit...');
    return runStaticAudit();
  }
}

function runStaticAudit() {
  console.log('[log-quota-guard] Scanning frontend codebase for uncoordinated short polling intervals (< 300s)...');
  const frontendSrc = resolve('frontend/src');
  const violations = [];

  function scanDir(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
        const content = readFileSync(fullPath, 'utf8');
        // Match refetchInterval: <expression>
        const matches = content.matchAll(/refetchInterval:\s*([^,\n}]+)/g);
        for (const m of matches) {
          const rawExpr = m[1].trim();
          if (rawExpr === 'false' || rawExpr === 'null' || rawExpr === 'undefined') continue;
          
          let evaluatedMs = null;
          // Safely evaluate simple numeric and multiplication expressions like 5 * 60_000
          if (/^[\d\s*_]+$/.test(rawExpr)) {
            try {
              evaluatedMs = Function(`"use strict"; return (${rawExpr});`)();
            } catch {
              // fallback
            }
          }

          if (evaluatedMs !== null && evaluatedMs > 0 && evaluatedMs < 300_000) {
            violations.push({
              file: fullPath.replace(resolve('.'), ''),
              intervalMs: evaluatedMs,
              expr: rawExpr,
            });
          }
        }
      }
    }
  }

  try {
    scanDir(frontendSrc);
  } catch (err) {
    console.error('[log-quota-guard] Error scanning codebase:', err);
  }

  if (violations.length > 0) {
    console.warn(`\n[log-quota-guard] Warning: Found ${violations.length} query instance(s) with short refetchInterval (< 5 min):`);
    violations.forEach((v) => {
      console.warn(`  - ${v.file}: ${v.intervalMs}ms (${v.intervalMs / 1000}s)`);
    });
  } else {
    console.log('[log-quota-guard] Codebase audit clean: No short (< 5min) periodic refetchInterval timers found.');
  }
}

runLiveLogCheck();
