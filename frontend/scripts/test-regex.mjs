import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.resolve('../../supabase/migrations/20260908000000_baseline_schema.sql'), 'utf8');
const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi;
let match;
const tables = new Set();
while ((match = regex.exec(sql)) !== null) {
  tables.add(match[1]);
}
console.log('Tables found in baseline migration:', Array.from(tables).sort().join(', '));
console.log('Count:', tables.size);