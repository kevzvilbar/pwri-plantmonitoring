import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Replaces the `__CSP_SCRIPT_SRC__` token in index.html's CSP <meta> tag.
 *
 *  - build: SHA-256 hashes of every inline <script> in the final HTML, so the
 *           policy can drop `'unsafe-inline'` from script-src. Hashes are
 *           recomputed on every build, so editing an inline script can never
 *           leave a stale hash behind.
 *  - dev:   `'unsafe-inline'`, because Vite's dev server injects an inline
 *           React-refresh preamble that cannot be hashed ahead of time.
 */
export const CSP_SCRIPT_TOKEN = '__CSP_SCRIPT_SRC__';

// Inline = no src attribute. Attribute values never contain '>' in this repo.
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of withoutComments.matchAll(INLINE_SCRIPT)) {
    const body = match[1];
    if (!body.trim()) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

export function applyScriptSrc(html: string, mode: 'build' | 'dev'): string {
  if (!html.includes(CSP_SCRIPT_TOKEN)) {
    throw new Error(`cspHashes: ${CSP_SCRIPT_TOKEN} not found in index.html CSP <meta> tag`);
  }
  const replacement = mode === 'build' ? inlineScriptHashes(html).join(' ') : `'unsafe-inline'`;
  return html.replace(CSP_SCRIPT_TOKEN, replacement);
}

export function cspHashes(): Plugin {
  let mode: 'build' | 'dev' = 'dev';
  return {
    name: 'pwri-csp-script-hashes',
    configResolved(config) {
      mode = config.command === 'build' ? 'build' : 'dev';
    },
    transformIndexHtml: {
      // 'post' so scripts injected by other plugins (e.g. PWA registration) are hashed too.
      order: 'post',
      handler: (html) => applyScriptSrc(html, mode),
    },
  };
}
