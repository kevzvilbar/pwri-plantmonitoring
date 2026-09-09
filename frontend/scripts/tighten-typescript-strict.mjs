#!/usr/bin/env node
/**
 * tighten-typescript-strict.mjs
 * 
 * Incrementally enables TypeScript strict flags across the codebase.
 * Run this script periodically to tighten one flag at a time.
 * 
 * Usage:
 *   node scripts/tighten-typescript-strict.mjs          # Check current status
 *   node scripts/tighten-typescript-strict.mjs --enable noUnusedLocals  # Enable a flag
 *   node scripts/tighten-typescript-strict.mjs --dry-run             # Preview changes
 */

import fs from 'fs';
import path from 'path';

const TS_CONFIG_PATH = path.resolve('tsconfig.app.json');

const STRICT_FLAGS = [
  { name: 'strict', description: 'Enable all strict type-checking options' },
  { name: 'noImplicitAny', description: 'Error on expressions and declarations with implied any type' },
  { name: 'strictNullChecks', description: 'Enable strict null checks (already enabled)' },
  { name: 'noUnusedLocals', description: 'Error on unused local variables' },
  { name: 'noUnusedParameters', description: 'Error on unused parameters' },
  { name: 'noFallthroughCasesInSwitch', description: 'Error on fallthrough cases in switch statements' },
  { name: 'noImplicitReturns', description: 'Error on functions missing return statements' },
  { name: 'noImplicitThis', description: 'Error on this expressions with implied any type' },
  { name: 'alwaysStrict', description: 'Parse in strict mode and emit "use strict"' },
];

function readConfig() {
  const content = fs.readFileSync(TS_CONFIG_PATH, 'utf8');
  return JSON.parse(content);
}

function writeConfig(config) {
  const content = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(TS_CONFIG_PATH, content);
}

function checkCurrentFlags(config) {
  const compilerOptions = config.compilerOptions || {};
  console.log('\n=== Current TypeScript Strict Flags ===\n');
  
  for (const flag of STRICT_FLAGS) {
    const value = compilerOptions[flag.name];
    const status = value === true ? '✅ ENABLED' : '❌ DISABLED';
    console.log(`  ${flag.name.padEnd(25)} ${status}`);
    if (value !== true && value !== false) {
      console.log(`    (current value: ${JSON.stringify(value)})`);
    }
  }
  
  // Check overall strict mode
  const strictMode = compilerOptions.strict === true;
  console.log(`\nOverall strict mode: ${strictMode ? '✅ ENABLED' : '❌ DISABLED'}`);
  
  return compilerOptions;
}

function enableFlag(config, flagName) {
  const compilerOptions = config.compilerOptions || {};
  
  if (compilerOptions[flagName] === true) {
    console.log(`\n${flagName} is already enabled.`);
    return false;
  }
  
  const flag = STRICT_FLAGS.find(f => f.name === flagName);
  if (!flag) {
    console.error(`\nUnknown flag: ${flagName}`);
    console.log(`Available flags: ${STRICT_FLAGS.map(f => f.name).join(', ')}`);
    return false;
  }
  
  compilerOptions[flagName] = true;
  config.compilerOptions = compilerOptions;
  writeConfig(config);
  
  console.log(`\n✅ Enabled ${flagName}: ${flag.description}`);
  return true;
}

function dryRunEnable(config, flagName) {
  const compilerOptions = config.compilerOptions || {};
  
  if (compilerOptions[flagName] === true) {
    console.log(`\n${flagName} is already enabled - no change needed.`);
    return;
  }
  
  console.log(`\nWould enable: ${flagName}`);
  console.log(`  Description: ${STRICT_FLAGS.find(f => f.name === flagName)?.description}`);
  console.log(`  Current value: ${JSON.stringify(compilerOptions[flagName])}`);
  console.log(`  New value: true`);
}

async function main() {
  const args = process.argv.slice(2);
  const config = readConfig();
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node scripts/tighten-typescript-strict.mjs [options]

Options:
  --enable <flag>     Enable a specific strict flag
  --dry-run <flag>    Preview enabling a flag without changing config
  --list              List all available strict flags
  --check             Check current flag status (default)
  --help              Show this help

Available flags:
${STRICT_FLAGS.map(f => `  ${f.name.padEnd(25)} ${f.description}`).join('\n')}

Example:
  node scripts/tighten-typescript-strict.mjs --enable noUnusedLocals
  node scripts/tighten-typescript-strict.mjs --dry-run noUnusedParameters
    `);
    return;
  }
  
  if (args.includes('--list')) {
    console.log('\nAvailable TypeScript strict flags:\n');
    for (const flag of STRICT_FLAGS) {
      console.log(`  ${flag.name.padEnd(25)} ${flag.description}`);
    }
    return;
  }
  
  if (args.includes('--check') || args.length === 0) {
    checkCurrentFlags(config);
    return;
  }
  
  const enableIndex = args.indexOf('--enable');
  if (enableIndex !== -1 && args[enableIndex + 1]) {
    enableFlag(config, args[enableIndex + 1]);
    return;
  }
  
  const dryRunIndex = args.indexOf('--dry-run');
  if (dryRunIndex !== -1 && args[dryRunIndex + 1]) {
    dryRunEnable(config, args[dryRunIndex + 1]);
    return;
  }
  
  console.error('\nInvalid arguments. Use --help for usage.');
  process.exit(1);
}

main().catch(console.error);