"""
Unit tests for downtime_parser.py — the Downtime worksheet remark parser.

These exercise the pure text-parsing helpers with real-world remark strings
(the docstring examples in the module itself, plus edge cases) so a future
change to the regex rules gets caught here instead of silently mis-parsing
plant downtime reports.
"""
from __future__ import annotations

import io

from openpyxl import Workbook

from downtime_parser import (
    _clean_cause,
    _duration_hours,
    _normalize_sub,
    _to_float,
    parse_downtime_xlsx,
    parse_event,
    split_remarks,
)


# ---------------------------------------------------------------------------
# _normalize_sub
# ---------------------------------------------------------------------------

class TestNormalizeSub:
    def test_ro_variants_collapse_to_ro(self):
        assert _normalize_sub("R.O #1") == "RO #1"
        assert _normalize_sub("RO #1") == "RO #1"

    def test_ro_with_trailing_dot_before_hash_keeps_the_dot(self):
        # \bR\.?O\.?\b backtracks off the second dot here because '.' before '#'
        # isn't a word boundary — this documents that real (if slightly odd)
        # behavior rather than asserting an idealized one.
        assert _normalize_sub("R.O.#1") == "RO.#1"

    def test_wells_apostrophe_s(self):
        assert _normalize_sub("Well's") == "Wells"

    def test_and_becomes_ampersand(self):
        assert _normalize_sub("Well 1 and 4") == "Well 1 & 4"

    def test_collapses_repeated_whitespace_to_single_space(self):
        assert _normalize_sub("Well   #1") == "Well #1"


# ---------------------------------------------------------------------------
# _duration_hours
# ---------------------------------------------------------------------------

class TestDurationHours:
    def test_hours_and_minutes(self):
        # "6hrs.&44mins." -> 6 + 44/60
        assert _duration_hours("6hrs.&44mins.") == round(6 + 44 / 60, 3)

    def test_hours_only(self):
        assert _duration_hours("24hrs.") == 24.0

    def test_minutes_only(self):
        assert _duration_hours("45mins.") == round(45 / 60, 3)

    def test_no_duration_found_returns_zero(self):
        assert _duration_hours("Due to routine maintenance") == 0.0

    def test_singular_hr_and_min(self):
        assert _duration_hours("1hr.&10mins.") == round(1 + 10 / 60, 3)


# ---------------------------------------------------------------------------
# _clean_cause
# ---------------------------------------------------------------------------

class TestCleanCause:
    def test_extracts_cause_after_due_to(self):
        assert _clean_cause(
            "Shutdown RO #1:6hrs.&44mins. Due to Replacement of RO System."
        ) == "Replacement of RO System"

    def test_no_due_to_returns_empty(self):
        assert _clean_cause("Shutdown RO #1:6hrs.&44mins.") == ""

    def test_stops_before_next_shutdown_event(self):
        cause = _clean_cause(
            "Due to High Raw Water Level. Shutdown Well #2:2hrs."
        )
        assert cause == "High Raw Water Level"

    def test_truncates_to_240_chars(self):
        long_reason = "A" * 300
        cause = _clean_cause(f"Due to {long_reason}")
        assert len(cause) <= 240


# ---------------------------------------------------------------------------
# _to_float
# ---------------------------------------------------------------------------

class TestToFloat:
    def test_none_and_empty_string(self):
        assert _to_float(None) is None
        assert _to_float("") is None

    def test_valid_numeric_string(self):
        assert _to_float("12.5") == 12.5

    def test_valid_number(self):
        assert _to_float(7) == 7.0

    def test_garbage_returns_none(self):
        assert _to_float("not a number") is None


# ---------------------------------------------------------------------------
# split_remarks — the multi-event splitter
# ---------------------------------------------------------------------------

class TestSplitRemarks:
    def test_empty_and_none(self):
        assert split_remarks("") == []
        assert split_remarks(None) == []  # type: ignore[arg-type]

    def test_normal_operation_is_filtered_out(self):
        assert split_remarks("Normal Operation.") == []

    def test_splits_two_shutdown_events_joined_by_ampersand(self):
        remark = (
            "Shutdown R.O #1:6hrs.&44mins. Due to Replacement of RO System.,"
            " Shutdown Well #1:6hrs.&33mins. Due to High Raw Water Level."
        )
        parts = split_remarks(remark)
        assert len(parts) == 2
        assert parts[0].startswith("Shutdown R.O #1")
        assert parts[1].startswith("Shutdown Well #1")

    def test_single_event_returns_one_part(self):
        parts = split_remarks("Shutdown Well #3:2hrs. Due to Power Interruption.")
        assert len(parts) == 1


# ---------------------------------------------------------------------------
# parse_event — full event construction from a remark segment
# ---------------------------------------------------------------------------

class TestParseEvent:
    def test_basic_event_fields(self):
        ev = parse_event(
            "Shutdown R.O #1:6hrs.&44mins. Due to Replacement of RO System.",
            "2026-01-05",
            op_hrs=18.0,
            shutdown_hrs=6.7,
        )
        assert ev is not None
        assert ev.event_date == "2026-01-05"
        assert ev.subsystem == "RO #1"
        assert ev.duration_hrs == round(6 + 44 / 60, 3)
        assert ev.cause == "Replacement of RO System"
        assert ev.op_hrs == 18.0
        assert ev.shutdown_hrs == 6.7

    def test_zero_duration_returns_none(self):
        assert parse_event("Due to routine check.", "2026-01-05", None, None) is None

    def test_no_subsystem_match_defaults_to_plant(self):
        ev = parse_event("6hrs. Due to citywide power outage.", "2026-01-05", None, None)
        assert ev is not None
        assert ev.subsystem == "Plant"


# ---------------------------------------------------------------------------
# parse_downtime_xlsx — end-to-end sheet parsing
# ---------------------------------------------------------------------------

class TestParseDowntimeXlsx:
    def _build_workbook_bytes(self) -> bytes:
        wb = Workbook()
        ws = wb.active
        ws.title = "Downtime"
        ws.append(["Jan. 2026", "Total Operation, Hrs", "Total Shutdown, Hrs", "Remarks"])
        ws.append([
            5, 18.0, 6.0,
            "Shutdown R.O #1:6hrs. Due to Replacement of RO System.",
        ])
        ws.append([6, 24.0, 0.0, "Normal Operation."])
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def test_parses_events_from_real_workbook(self):
        events = parse_downtime_xlsx(self._build_workbook_bytes())
        assert len(events) == 1
        assert events[0]["event_date"] == "2026-01-05"
        assert events[0]["subsystem"] == "RO #1"
        assert events[0]["duration_hrs"] == 6.0

    def test_missing_sheet_returns_empty_list(self):
        events = parse_downtime_xlsx(self._build_workbook_bytes(), sheet_name="NoSuchSheet")
        assert events == []
