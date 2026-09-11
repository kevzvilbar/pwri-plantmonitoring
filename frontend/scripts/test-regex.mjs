import fs from 'fs';
import path from 'path';

const migrationsDir = path.resolve('../supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.includes('baseline_schema') && f.endsWith('.sql')).sort();
const sql = files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');
const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
let match;
const tables = new Set();
while ((match = regex.exec(sql)) !== null) {
  tables.add(match[1]);
}
console.log('Tables found in baseline migration:', Array.from(tables).sort().join(', '));
console.log('Count:', tables.size);