#!/usr/bin/env node
// Throwaway validator for .github/workflows/ci.yml — checks YAML parses,
// that `on` is a real trigger map (not the YAML 1.1 boolean gotcha), and
// that every `run:` step's referenced script/file exists on disk.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let yaml;
try { yaml = require('./frontend/node_modules/js-yaml'); }
catch { yaml = require('js-yaml'); }

const src = readFileSync('.github/workflows/ci.yml', 'utf8');
let doc;
try {
  doc = yaml.load(src);
  console.log('YAML PARSE: OK');
} catch (e) {
  console.log('YAML PARSE ERROR:', e.message);
  process.exit(1);
}

// YAML 1.1 gotcha: bare `on:` parses as boolean true in js-yaml's default schema.
const triggerKey = Object.keys(doc).find((k) => k === 'on' || k === 'on' || k === true);
console.log('trigger key present as:', JSON.stringify(triggerKey));
const triggers = doc[triggerKey];
console.log('triggers:', JSON.stringify(triggers));

// Walk every job step; verify working-directory + referenced local scripts exist.
const jobs = doc.jobs ?? {};
for (const [jobName, job] of Object.entries(jobs)) {
  for (const step of job.steps ?? []) {
    if (!step.run) continue;
    const wd = step['working-directory'] ?? '.';
    // crude extraction of node script paths from run lines
    const scriptMatches = [...step.run.matchAll(/node\s+(\S+\.mjs)/g)];
    for (const m of scriptMatches) {
      const p = (wd === '.' ? '' : wd + '/') + m[1];
      console.log(`job=${jobName} script=${p} exists=${existsSync(p)}`);
    }
    if (step.run.includes('npm test') || step.run.includes('npm run')) {
      console.log(`job=${jobName} npm step (wd=${wd}): ${step.run.trim()}`);
    }
  }
}
console.log('DONE');