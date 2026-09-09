import fs from 'fs';
const t = fs.readFileSync('src/integrations/supabase/types.ts', 'utf8');
const idx = t.indexOf('correction_requests:');
console.log(t.slice(idx, idx+800));