import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyScriptSrc, inlineScriptHashes, CSP_SCRIPT_TOKEN } from './cspHashes';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const page = (extra = '') => `<html><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'self' ${CSP_SCRIPT_TOKEN};" />
<script>var a = 1;</script>
<script type="module" src="/src/main.tsx"></script>
<script>var b = 2;</script>${extra}
</head></html>`;

describe('cspHashes', () => {
  it('hashes inline scripts only, ignoring src scripts', () => {
    expect(inlineScriptHashes(page())).toEqual([sha('var a = 1;'), sha('var b = 2;')]);
  });

  it('build mode writes hashes and never unsafe-inline', () => {
    const out = applyScriptSrc(page(), 'build');
    expect(out).toContain(sha('var a = 1;'));
    expect(out).not.toContain('unsafe-inline');
    expect(out).not.toContain(CSP_SCRIPT_TOKEN);
  });

  it('ignores <script> text inside HTML comments', () => {
    expect(inlineScriptHashes(page('<!-- <script>evil()</script> -->'))).toHaveLength(2);
  });

  it('picks up a newly added inline script (no stale hashes)', () => {
    expect(applyScriptSrc(page('<script>var c = 3;</script>'), 'build')).toContain(sha('var c = 3;'));
  });

  it('dev mode allows unsafe-inline for the HMR preamble', () => {
    expect(applyScriptSrc(page(), 'dev')).toContain(`'unsafe-inline'`);
  });

  it('throws when the token is missing', () => {
    expect(() => applyScriptSrc('<html></html>', 'build')).toThrow(/not found/);
  });
});
