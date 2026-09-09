#!/usr/bin/env node
/**
 * cleanup-dead-config.mjs
 * 
 * Phase 5: Operational Maturity
 * Cleans up dead configuration files identified in the roadmap:
 * - .replit (Lovable artifact)
 * - Vite /api proxy config
 * - Stale PRD sections
 * - Other dead configs
 */

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve('..');

const DEAD_CONFIGS = [
  // Lovable artifact
  '.replit',
  
  // Vite proxy config (handled by Supabase directly now)
  'vite.config.ts', // Will be checked for /api proxy
  
  // Stale PRD sections (in docs/)
  'docs/PRD.md', // Check for stale sections
];

function checkFileExists(filePath) {
  return fs.existsSync(path.join(PROJECT_ROOT, filePath));
}

function readFile(filePath) {
  try {
    return fs.readFileSync(path.join(PROJECT_ROOT, filePath), 'utf8');
  } catch {
    return null;
  }
}

function writeFile(filePath, content) {
  fs.writeFileSync(path.join(PROJECT_ROOT, filePath), content, 'utf8');
}

function removeFile(filePath) {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    console.log(`✅ Removed: ${filePath}`);
    return true;
  }
  return false;
}

function checkReplit() {
  if (checkFileExists('.replit')) {
    console.log('🔍 Found .replit (Lovable artifact)');
    return true;
  }
  return false;
}

function checkViteProxy() {
  const viteConfig = readFile('vite.config.ts');
  if (viteConfig && viteConfig.includes('/api')) {
    console.log('🔍 Found Vite /api proxy config (may be stale)');
    return true;
  }
  return false;
}

function checkStalePRD() {
  const prd = readFile('docs/PRD.md');
  if (prd) {
    const staleSections = [
      'Python backend',
      'FastAPI',
      'PostgreSQL direct',
      'Docker Compose',
      'Celery',
      'Redis',
    ];
    
    let found = false;
    for (const section of staleSections) {
      if (prd.includes(section)) {
        console.log(`🔍 Found potentially stale PRD section: ${section}`);
        found = true;
      }
    }
    return found;
  }
  return false;
}

function cleanup() {
  let cleaned = 0;
  
  // Remove .replit
  if (removeFile('.replit')) cleaned++;
  
  // Note: vite.config.ts cleanup requires manual review
  // Note: PRD cleanup requires manual review
  
  return cleaned;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--check') || args.length === 0) {
    console.log('=== Dead Config Check ===\n');
    
    let found = false;
    found |= checkReplit();
    found |= checkViteProxy();
    found |= checkStalePRD();
    
    if (!found) {
      console.log('✅ No dead configs found');
    }
    
    return;
  }
  
  if (args.includes('--clean')) {
    console.log('=== Cleaning Dead Configs ===\n');
    const cleaned = cleanup();
    console.log(`\n✅ Cleaned ${cleaned} dead config(s)`);
    return;
  }
  
  console.error('Usage: node scripts/cleanup-dead-config.mjs [--check|--clean]');
  process.exit(1);
}

main().catch(console.error);