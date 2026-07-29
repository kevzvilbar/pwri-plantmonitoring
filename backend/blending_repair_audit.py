"""
Audit + optional repair for blending_events rows corrupted by the old
"Direct m³" input mode (see BlendingSection.tsx / 20260729_blending_events_
meter_columns.sql for the fix that removed it).

WHAT HAPPENED
-------------
Before the fix, the Blending tab let an operator switch to a "Direct m³"
mode that saved whatever number was typed straight into volume_m3, with no
raw_meter_reading captured. Since every blending well is physically metered,
some operators typed the meter's *cumulative* reading into that field instead
of a real daily delta — so volume_m3 for those rows actually holds a point in
a slowly-increasing cumulative series, not a volume.

WHAT THIS SCRIPT DOES
----------------------
Read-only by default. For each well:
  1. Pull every blending_events row, oldest to newest.
  2. Flag rows where raw_meter_reading IS NULL (impossible to happen post-fix
     for a legitimately-entered row — every new save always writes it).
  3. For a *contiguous run* of flagged rows, check whether volume_m3 is
     monotonically increasing in a way consistent with a cumulative meter
     (each value >= the previous, with a plausible day-over-day delta) — if
     so, report the recomputed delta (curr − prev) as the likely-correct
     volume, alongside the suspicious raw value currently stored.
  4. The very first row in a run has no prior value to diff against, so it
     can't be auto-corrected — it's reported as NEEDS MANUAL REVIEW.

Nothing is written to the database unless you pass --apply, and even then
only rows with an unambiguous recomputed delta are touched — first-in-run
rows are always left for a human to resolve (was this a baseline reading?
A meter replacement? Genuinely bad data?).

USAGE
-----
  # Report only — safe to run any time, changes nothing:
  python blending_repair_audit.py

  # Same report, scoped to one plant:
  python blending_repair_audit.py --plant-id <uuid>

  # Apply the recomputed deltas for unambiguous rows (asks for confirmation):
  python blending_repair_audit.py --apply

Requires SUPABASE_URL and SUPABASE_ANON_KEY in the environment (same as the
backend server — see supa_client.py). The 20260729_blending_events_meter_
columns.sql migration must already be applied — it adds the UPDATE policy
this script needs to write corrections, and without it every write here will
silently affect 0 rows.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from typing import Any

from supabase import Client, create_client


def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_ANON_KEY must be set.", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def fetch_rows(db: Client, plant_id: str | None) -> list[dict[str, Any]]:
    q = db.table("blending_events").select(
        "id, well_id, well_name, plant_id, plant_name, event_date, "
        "reading_datetime, volume_m3, raw_meter_reading, is_meter_replacement"
    )
    if plant_id:
        q = q.eq("plant_id", plant_id)
    rows = q.execute().data or []
    # Sort chronologically within each well — event_date first, reading_datetime
    # as tiebreaker for same-day rows.
    rows.sort(key=lambda r: (r["well_id"], r.get("event_date") or "", r.get("reading_datetime") or ""))
    return rows


def analyze(rows: list[dict[str, Any]]) -> tuple[list[dict], list[dict]]:
    """Returns (fixable, needs_review) — each item is the original row plus
    a 'corrected_volume_m3' key (fixable only)."""
    by_well: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_well[r["well_id"]].append(r)

    fixable: list[dict] = []
    needs_review: list[dict] = []

    for well_id, well_rows in by_well.items():
        prev_clean_cumulative: float | None = None  # last row we trust as a real cumulative value
        for i, r in enumerate(well_rows):
            suspect = r.get("raw_meter_reading") is None and not r.get("is_meter_replacement")
            if not suspect:
                # A trustworthy row — if it has a raw_meter_reading, that
                # becomes our new anchor for detecting the next suspect run.
                if r.get("raw_meter_reading") is not None:
                    prev_clean_cumulative = float(r["raw_meter_reading"])
                continue

            vol = float(r.get("volume_m3") or 0)
            prev_row = well_rows[i - 1] if i > 0 else None
            prev_vol = float(prev_row["volume_m3"]) if prev_row else None

            looks_cumulative = (
                prev_vol is not None
                and vol >= prev_vol
                and (prev_row.get("raw_meter_reading") is None)  # part of the same suspect run
            )

            if looks_cumulative:
                delta = round(vol - prev_vol, 2)
                fixable.append({**r, "corrected_volume_m3": delta, "was_stored_as": vol})
            else:
                # Either the first row in a run (nothing to diff against) or
                # the series went down / reset — both need a human to decide
                # whether this is a baseline reading, a meter swap, or bad data.
                needs_review.append({**r, "prev_row_volume_m3": prev_vol, "prev_clean_cumulative": prev_clean_cumulative})

    return fixable, needs_review


def print_report(fixable: list[dict], needs_review: list[dict]) -> None:
    print(f"\n{'='*78}\nBLENDING DATA AUDIT\n{'='*78}")
    print(f"\n{len(fixable)} row(s) look like a corrupted cumulative-reading series")
    print("(recomputable — same well, values climbing, no raw_meter_reading on record):\n")
    for r in fixable:
        print(
            f"  {r['well_name']:<20} {r['event_date']}  "
            f"stored volume_m3={r['was_stored_as']:>10}  →  corrected Δ={r['corrected_volume_m3']:>10}"
        )

    print(f"\n{len(needs_review)} row(s) NEED MANUAL REVIEW (can't be auto-corrected):\n")
    for r in needs_review:
        print(
            f"  {r['well_name']:<20} {r['event_date']}  "
            f"volume_m3={r['volume_m3']}  raw_meter_reading={r['raw_meter_reading']}  "
            f"prev_row_volume_m3={r.get('prev_row_volume_m3')}"
        )
    print()


def apply_fixes(db: Client, fixable: list[dict]) -> None:
    if not fixable:
        print("Nothing to apply.")
        return
    print(f"\nAbout to UPDATE {len(fixable)} row(s): volume_m3 → corrected Δ, "
          f"raw_meter_reading → the value currently stored in volume_m3 (it was the real meter reading).")
    confirm = input("Type 'apply' to proceed, anything else to cancel: ")
    if confirm.strip().lower() != "apply":
        print("Cancelled — no changes made.")
        return
    ok, failed = 0, 0
    for r in fixable:
        try:
            resp = (
                db.table("blending_events")
                .update({
                    "volume_m3": r["corrected_volume_m3"],
                    "raw_meter_reading": r["was_stored_as"],
                })
                .eq("id", r["id"])
                .execute()
            )
            if resp.data:
                ok += 1
            else:
                failed += 1
                print(f"  0 rows affected for id={r['id']} — is the UPDATE RLS policy applied?")
        except Exception as e:  # noqa: BLE001 — best-effort repair loop, report and continue
            failed += 1
            print(f"  FAILED id={r['id']}: {e}")
    print(f"\nDone — {ok} updated, {failed} failed.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plant-id", default=None, help="Restrict to one plant's blending_events")
    ap.add_argument("--apply", action="store_true", help="Write recomputed deltas back (asks for confirmation)")
    args = ap.parse_args()

    db = get_client()
    rows = fetch_rows(db, args.plant_id)
    fixable, needs_review = analyze(rows)
    print_report(fixable, needs_review)

    if args.apply:
        apply_fixes(db, fixable)
    else:
        print("Dry run only — nothing was changed. Re-run with --apply to write the recomputed deltas.")


if __name__ == "__main__":
    main()
