import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression test for a bug found in the 2026-08-17 review: TrainLogModal's
// ro_train_readings query has four schema-fallback column tiers (ALL_COLS /
// TIER2 / TIER3 / TIER4). None of them selected `norm_status`, so every row
// this modal ever saw had `norm_status === undefined` — silently disabling
// canEditEntry()'s pending-review self-edit lockdown (helpers.tsx) for RO
// Train readings specifically, even though the exact same guard already
// works for well/locator/product readings elsewhere in the app. This test
// can't easily render TrainLogModal itself (it needs live useAuth/supabase/
// react-query context), so it asserts the invariant directly against the
// source: every tier must request norm_status, or the query silently
// starves canEditEntry of the one field it needs to do its job.

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'TrainLogModal.tsx'), 'utf8');

function extractTier(name: string): string {
  const re = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find ${name} definition in TrainLogModal.tsx`);
  return match[1];
}

describe('TrainLogModal ro_train_readings column tiers', () => {
  it.each(['ALL_COLS', 'TIER2', 'TIER3', 'TIER4'])(
    '%s selects norm_status (required for canEditEntry pending-review lockdown)',
    (tierName) => {
      const tierBody = extractTier(tierName);
      expect(tierBody).toContain("'norm_status'");
    },
  );
});
