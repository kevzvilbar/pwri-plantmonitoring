const fs = require('fs');
const { spawnSync } = require('child_process');
const out = 'c:/Users/vilba/.antigravity/pwri-plantmonitoring-main/pwri-plantmonitoring/tsc-check2.txt';
const t0 = Date.now();
fs.writeFileSync(out, 'STARTED\n');
const r = spawnSync('node', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.app.json'], {
  cwd: 'c:/Users/vilba/.antigravity/pwri-plantmonitoring-main/pwri-plantmonitoring/frontend',
  encoding: 'utf8',
  timeout: 600000,
});
const lines = ((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').filter(l => l.trim());
fs.writeFileSync(out, 'DONE exit=' + r.status + ' ms=' + (Date.now() - t0) + '\n' +
  lines.filter(l => /ROTrains|ChemDosing|error TS|Cannot find/.test(l)).join('\n'));