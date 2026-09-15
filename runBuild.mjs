import fs from 'fs';
import { spawnSync } from 'child_process';
// Locate the vite binary directly to bypass npm.cmd invocation issues.
const viteBin = 'node_modules/vite/bin/vite.js';
const npxBin = 'frontend/node_modules/.bin';
// Build with vite directly: vite build
const res = spawnSync('node', [viteBin, 'build'], {
  cwd: 'frontend',
  encoding: 'utf8',
  maxBuffer: 1 << 27,
  env: { ...process.env, PATH: npxBin + ';' + (process.env.PATH || '') },
});
const out = (res.stdout || '') + (res.stderr || '');
fs.writeFileSync('build_result.txt', out);
fs.writeFileSync('build_status.txt', `status=${res.status}\nsignal=${res.signal}\nexit=${res.error ? 'ERR' : res.status}\n`);
console.log(out.includes('✓ built') ? 'BUILD_OK' : (out.includes('error') || res.status ? 'BUILD_FAIL' : 'UNKNOWN'));




