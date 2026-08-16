# Runbooks

Manual, DBA-run SQL — moved out of `supabase/migrations/` on 2026-08-16.

These are **not** schema migrations and were never meant to apply
automatically. Both used to live in `supabase/migrations/` without a
`YYYYMMDD` timestamp prefix, which broke the filename-order convention the
root README and the app's own **Admin → Migrations** panel rely on: files
without a numeric prefix sort *after* every real timestamped migration
regardless of when they were actually written, and the Admin panel has no
way to tell "read-only audit query" or "requires you to edit an email
address first" apart from a real, unattended-safe migration — it would list
either of these as a pending migration like any other.

Neither file is dangerous to run — `confirm-and-fix-ro-delete.sql`'s
placeholder email is only in a diagnostic `SELECT`, not the actual policy
fix — but neither belongs in the same folder or the same mental bucket as
`supabase/migrations/*.sql`, which must stay safe to apply unattended, in
order, exactly once.

| File | What it is |
|---|---|
| `confirm-and-fix-ro-delete.sql` | Interactive 3-step script (confirm → fix → verify) for granting Manager/Data Analyst write access to RO train and pretreatment readings. Edit the placeholder email in Step 1 before running. Run manually in the Supabase SQL Editor. |
| `reading_chain_drift_audit.sql` | Read-only diagnostic query. Finds `well_readings` / `blending_events` rows whose stored `previous_reading` no longer matches the true chronological predecessor (drift from out-of-order edits/deletes/backfills). No writes. Run manually in the Supabase SQL Editor. |

If a script here turns out to need to run automatically and unattended
(no placeholders, no read-only caveat), promote it into
`supabase/migrations/` with a proper `YYYYMMDD_description.sql` name at
that point — don't add new files to this folder that quietly grow that
requirement.
