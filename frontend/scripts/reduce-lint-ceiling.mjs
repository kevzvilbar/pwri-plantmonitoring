#!/usr/bin/env node
/**
 * reduce-lint-ceiling.mjs
 * 
 * Automates the reduction of ESLint warning ceiling by 100 warnings per sprint.
 * This script helps track progress toward the Phase 5 goal of reducing
 * the lint ceiling by 100 warnings per sprint.
 * 
 * Usage:
 *   node scripts/reduce-lint-ceiling.mjs --check          # Check current progress
 *   node scripts/reduce-lint-ceiling.mjs --target 100     # Set target reduction for sprint
 *   node scripts/reduce-lint-ceiling.mjs --record         # Record current count as baseline
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const ceilingPath = path.join(frontendRoot, 'lint-ceiling.json');
const progressPath = path.join(frontendRoot, 'lint-progress.json');

const DEFAULT_SPRINT_REDUCTION = 100;

function runEslintJson() {
  let stdout;
  try {
    stdout = execFileSync('npx', ['eslint', '.', '--format', 'json'], {
      cwd: frontendRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
      shell: true,
    });
  } catch (err) {
    if (err.stdout) {
      stdout = err.stdout.toString();
    } else {
      console.error('Failed to run ESLint:', err.message);
      process.exit(2);
    }
  }
  return JSON.parse(stdout);
}

function summarize(results) {
  let warnings = 0;
  let errors = 0;
  const byRule = {};
  for (const file of results) {
    warnings += file.warningCount;
    errors += file.errorCount;
    for (const msg of file.messages) {
      if (msg.severity === 1) {
        const rule = msg.ruleId ?? '(no rule id)';
        byRule[rule] = (byRule[rule] ?? 0) + 1;
      }
    }
  }
  return { warnings, errors, byRule };
}

function loadCeiling() {
  if (!existsSync(ceilingPath)) {
    return { maxWarnings: null, lastUpdated: null, history: [] };
  }
  return JSON.parse(readFileSync(ceilingPath, 'utf8'));
}

function loadProgress() {
  if (!existsSync(progressPath)) {
    return { 
      sprints: [], 
      currentSprint: 1,
      baselineWarnings: null,
      targetReductionPerSprint: DEFAULT_SPRINT_REDUCTION 
    };
  }
  return JSON.parse(readFileSync(progressPath, 'utf8'));
}

function saveProgress(progress) {
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');
}

function saveCeiling(ceiling) {
  writeFileSync(ceilingPath, JSON.stringify(ceiling, null, 2) + '\n');
}

function recordBaseline() {
  const results = runEslintJson();
  const { warnings, errors, byRule } = summarize(results);
  
  const ceiling = loadCeiling();
  ceiling.maxWarnings = warnings;
  ceiling.lastUpdated = new Date().toISOString();
  if (!ceiling.history) ceiling.history = [];
  ceiling.history.push({ date: ceiling.lastUpdated, warnings, errors, type: 'baseline' });
  saveCeiling(ceiling);
  
  const progress = loadProgress();
  progress.baselineWarnings = warnings;
  progress.currentSprint = 1;
  progress.sprints = [];
  saveProgress(progress);
  
  console.log(`✅ Recorded baseline: ${warnings} warnings, ${errors} errors`);
  console.log(`   Baseline saved to ${ceilingPath} and ${progressPath}`);
}

function checkProgress() {
  const results = runEslintJson();
  const { warnings, errors, byRule } = summarize(results);
  
  const ceiling = loadCeiling();
  const progress = loadProgress();
  
  const maxWarnings = ceiling.maxWarnings;
  const targetReduction = progress.targetReductionPerSprint || DEFAULT_SPRINT_REDUCTION;
  const baseline = progress.baselineWarnings ?? maxWarnings;
  const currentSprint = progress.currentSprint || 1;
  const targetForCurrentSprint = baseline - (currentSprint * targetReduction);
  
  console.log('\n=== Lint Ceiling Progress ===\n');
  console.log(`Current warnings:     ${warnings}`);
  console.log(`Current errors:       ${errors}`);
  console.log(`Baseline (sprint 0):  ${baseline}`);
  console.log(`Current sprint:       ${currentSprint}`);
  console.log(`Target reduction/sprint: ${targetReduction}`);
  console.log(`Target for sprint ${currentSprint}: ${targetForCurrentSprint}`);
  console.log(`Ceiling (maxWarnings): ${maxWarnings}`);
  
  const remaining = warnings - targetForCurrentSprint;
  if (remaining <= 0) {
    console.log(`\n✅ Sprint ${currentSprint} TARGET MET! (${-remaining} under target)`);
  } else {
    console.log(`\n⚠️  Sprint ${currentSprint}: ${remaining} warnings OVER target`);
  }
  
  const totalReduction = baseline - warnings;
  const sprintsNeeded = Math.ceil(totalReduction / targetReduction);
  console.log(`\nTotal reduction so far: ${totalReduction} warnings`);
  console.log(`Estimated sprints to zero: ${sprintsNeeded}`);
  
  // Top rules by count
  const sortedRules = Object.entries(byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log('\nTop rules by warning count:');
  for (const [rule, count] of sortedRules) {
    console.log(`  ${rule}: ${count}`);
  }
  
  // Check if ceiling needs update
  if (warnings < maxWarnings) {
    console.log(`\n💡 Warnings decreased from ${maxWarnings} to ${warnings}. Run with --update-ceiling to update.`);
  } else if (warnings > maxWarnings) {
    console.log(`\n⚠️  Warnings increased from ${maxWarnings} to ${warnings}. Ceiling must be updated or warnings fixed.`);
  }
}

function updateCeiling() {
  const results = runEslintJson();
  const { warnings, errors } = summarize(results);
  
  const ceiling = loadCeiling();
  ceiling.maxWarnings = warnings;
  ceiling.lastUpdated = new Date().toISOString();
  if (!ceiling.history) ceiling.history = [];
  ceiling.history.push({ date: ceiling.lastUpdated, warnings, errors, type: 'update' });
  saveCeiling(ceiling);
  
  console.log(`✅ Updated ceiling to ${warnings} warnings`);
}

function advanceSprint() {
  const progress = loadProgress();
  progress.currentSprint += 1;
  progress.sprints.push({
    sprint: progress.currentSprint - 1,
    completedAt: new Date().toISOString(),
    targetReduction: progress.targetReductionPerSprint
  });
  saveProgress(progress);
  
  console.log(`✅ Advanced to sprint ${progress.currentSprint}`);
  console.log(`   Target for this sprint: ${(progress.baselineWarnings || 0) - (progress.currentSprint * progress.targetReductionPerSprint)} warnings`);
}

function setTargetReduction(reduction) {
  const progress = loadProgress();
  progress.targetReductionPerSprint = reduction;
  saveProgress(progress);
  console.log(`✅ Set target reduction per sprint to ${reduction} warnings`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node scripts/reduce-lint-ceiling.mjs [options]

Options:
  --baseline              Record current warning count as sprint 0 baseline
  --check                 Check progress against sprint targets
  --update-ceiling        Update ceiling.json to current warning count
  --advance-sprint        Move to next sprint
  --target <number>       Set target reduction per sprint (default: 100)
  --record                Alias for --baseline

Examples:
  node scripts/reduce-lint-ceiling.mjs --baseline
  node scripts/reduce-lint-ceiling.mjs --check
  node scripts/reduce-lint-ceiling.mjs --update-ceiling
  node scripts/reduce-lint-ceiling.mjs --advance-sprint
  node scripts/reduce-lint-ceiling.mjs --target 150
    `);
    return;
  }
  
  if (args.includes('--baseline') || args.includes('--record')) {
    recordBaseline();
    return;
  }
  
  if (args.includes('--check')) {
    checkProgress();
    return;
  }
  
  if (args.includes('--update-ceiling')) {
    updateCeiling();
    return;
  }
  
  if (args.includes('--advance-sprint')) {
    advanceSprint();
    return;
  }
  
  const targetIndex = args.indexOf('--target');
  if (targetIndex !== -1 && args[targetIndex + 1]) {
    setTargetReduction(parseInt(args[targetIndex + 1], 10));
    return;
  }
  
  console.error('\nInvalid arguments. Use --help for usage.');
  process.exit(1);
}

main().catch(console.error);