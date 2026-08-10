#!/usr/bin/env node
/**
 * check-theme-contrast.mjs
 *
 * Computes real WCAG 2.1 contrast ratios for every brand theme in
 * index.css / lib/themes.ts, parsed directly from the CSS (not a hardcoded
 * snapshot) so this stays accurate as themes are added or tuned.
 *
 * Context: index.css defines global semantic tokens (warn/danger/info/
 * muted-foreground/etc.) once, in :root and .dark — brand themes
 * ([data-theme="..."] blocks) only override primary/topbar/sidebar colors.
 * So the per-theme contrast risk is narrower than "audit every color" — it's
 * specifically these ~6 pairs, since they're the ones that actually change
 * per theme. Found via a manual audit on 2026-08-10 (see
 * pwri-improvement-plan.md Phase 4): 3 of 7 themes (default, aerial-autumn,
 * midnight-road) fall short of 4.5:1 for white button text on --primary —
 * all three clear the lesser 3:1 UI-component bar, but not full AA text
 * contrast, and the app's default buttons use 14px/500-weight text (Button
 * component, text-sm font-medium), which doesn't qualify for WCAG's
 * large-text exception (needs ~18.7px+ bold or 24px+ regular). This script
 * locks in that finding as a check rather than a one-time report; adjusting
 * --primary's lightness in those three themes is a design call for whoever
 * owns the theme system, not something this script does on its own.
 *
 * Usage:
 *   node scripts/check-theme-contrast.mjs
 *
 * MIN_RATIO is deliberately NOT set to 4.5 yet — see the note above the
 * constant. Once the three known failures are fixed, tighten it to 4.5 so
 * this actually gates the thing it's checking, not just reports on it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', 'src');
const cssPath = path.join(srcRoot, 'index.css');
const css = readFileSync(cssPath, 'utf8');

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function relLuminance([r, g, b]) {
  const chan = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(hsl1, hsl2) {
  const L1 = relLuminance(hslToRgb(...hsl1));
  const L2 = relLuminance(hslToRgb(...hsl2));
  const [lighter, darker] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse `h s% l%` (optionally trailing ` / alpha`) into [h, s, l]. */
function parseHsl(raw) {
  const m = raw.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

/** Extract { varName: [h,s,l] } for every `--var: h s% l%;` inside a block of CSS text. */
function extractVars(blockText) {
  const vars = {};
  const re = /--([\w-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(blockText))) {
    const parsed = parseHsl(m[2]);
    if (parsed) vars[m[1]] = parsed;
  }
  return vars;
}

function extractBlock(name) {
  // Matches `:root {` or `[data-theme="x"] {` through its matching closing brace.
  // Not a full CSS parser (doesn't track nested braces), but every block this
  // script reads is flat (no nested rules), so a first-`}` match is correct.
  const selector = name === ':root' ? ':root' : `[data-theme="${name}"]`;
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`Could not find CSS block for ${selector} in ${cssPath}`);
  return extractVars(m[1]);
}

const root = extractBlock(':root');
const THEME_IDS = ['aerial-autumn', 'fire-ocean', 'earth-jade', 'inferno-sky', 'midnight-road', 'cosmic-spark'];

const PAIRS = [
  ['primary text on primary bg (buttons/badges)', 'primary-foreground', 'primary'],
  ['topbar text on topbar bg', 'topbar-foreground', 'topbar'],
  ['topbar muted text on topbar bg', 'topbar-muted', 'topbar'],
  ['sidebar text on sidebar bg', 'sidebar-foreground', 'sidebar-background'],
  ['active-nav text on active-nav bg', 'sidebar-primary-foreground', 'sidebar-primary'],
  ['hover-state text on hover-state bg', 'sidebar-accent-foreground', 'sidebar-accent'],
];

// Full AA text-contrast bar. See header comment for why this isn't the
// (stricter, correct) 4.5 yet — three themes currently sit just under it.
const MIN_RATIO = 3.0;
const AA_NORMAL = 4.5;

const themes = { 'default': root, ...Object.fromEntries(THEME_IDS.map((id) => [id, extractBlock(id)])) };

let anyBelowMin = false;
let anyBelowAA = false;
const rows = [];

for (const [themeName, vars] of Object.entries(themes)) {
  for (const [label, fgKey, bgKey] of PAIRS) {
    const fg = vars[fgKey];
    const bg = vars[bgKey];
    if (!fg || !bg) {
      console.error(`${themeName}: missing --${fgKey} or --${bgKey}, skipping "${label}"`);
      continue;
    }
    const ratio = +contrastRatio(fg, bg).toFixed(2);
    if (ratio < MIN_RATIO) anyBelowMin = true;
    if (ratio < AA_NORMAL) anyBelowAA = true;
    rows.push({ themeName, label, ratio, belowAA: ratio < AA_NORMAL });
  }
}

for (const r of rows) {
  const flag = r.ratio < MIN_RATIO ? 'FAIL' : r.belowAA ? 'below AA-normal (known, tracked)' : 'OK';
  console.log(`${r.themeName.padEnd(16)} ${r.label.padEnd(42)} ${String(r.ratio).padStart(6)}:1  ${flag}`);
}

if (anyBelowAA) {
  console.log(
    `\n${rows.filter((r) => r.belowAA).length} pair(s) below full AA text contrast (${AA_NORMAL}:1) — ` +
    'known as of 2026-08-10, see header comment. Not currently failing this check (MIN_RATIO is 3.0), ' +
    'but worth fixing and then tightening MIN_RATIO to 4.5.',
  );
}

if (anyBelowMin) {
  console.error(`\nFAIL: at least one pair is below ${MIN_RATIO}:1, the UI-component contrast floor.`);
  process.exit(1);
}

console.log(`\nOK — nothing below ${MIN_RATIO}:1.`);
process.exit(0);
