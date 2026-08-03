"""
Unit tests for import_parser.py — the Well/Meter reading XLSX importer.

Covers the status taxonomy (the core business rule: which raw labels count
toward production totals vs. downtime vs. exclusion) and the small value
coercion helpers that feed it.
"""
from __future__ import annotations

from datetime import date, datetime

from import_parser import (
    _as_date,
    _as_float,
    _clean_sheet_name,
    _detect_blocks,
    _resolve_date,
    classify_status,
)


# ---------------------------------------------------------------------------
# classify_status — the core status taxonomy
# ---------------------------------------------------------------------------

class TestClassifyStatus:
    def test_none_is_valid(self):
        assert classify_status(None) == ("valid", None)

    def test_empty_string_is_valid(self):
        assert classify_status("") == ("valid", None)
        assert classify_status("   ") == ("valid", None)

    def test_defective_meter(self):
        code, raw = classify_status("Defective Meter")
        assert code == "defective"
        assert raw == "Defective Meter"

    def test_new_meter_reading(self):
        code, _ = classify_status("New Meter Reading")
        assert code == "new_meter"

    def test_blend_shutdown_takes_priority_over_plain_blend(self):
        # blend_shutdown must be matched before the plain 'blend' pattern
        code, _ = classify_status("Blend/Shutdown")
        assert code == "blend_shutdown"

    def test_plain_blend(self):
        code, _ = classify_status("Blend")
        assert code == "blend"

    def test_shutoff_variants(self):
        assert classify_status("Shut-Off")[0] == "shutoff"
        assert classify_status("Shutoff")[0] == "shutoff"
        assert classify_status("Shutdown")[0] == "shutoff"

    def test_tripped_off(self):
        assert classify_status("Tripped-Off")[0] == "tripped"

    def test_standby(self):
        assert classify_status("Standby")[0] == "standby"

    def test_no_operation(self):
        assert classify_status("No Operation")[0] == "no_operation"

    def test_no_reading_with_reason(self):
        code, raw = classify_status("No Reading Due to Rain")
        assert code == "no_reading"
        assert raw == "No Reading Due to Rain"

    def test_unrecognized_label_is_unknown_but_preserved(self):
        code, raw = classify_status("Something Weird")
        assert code == "unknown"
        assert raw == "Something Weird"

    def test_case_insensitive(self):
        assert classify_status("DEFECTIVE METER")[0] == "defective"
        assert classify_status("shut off")[0] == "shutoff"


# ---------------------------------------------------------------------------
# _as_float
# ---------------------------------------------------------------------------

class TestAsFloat:
    def test_none_and_empty(self):
        assert _as_float(None) is None
        assert _as_float("") is None

    def test_bool_is_rejected(self):
        # bool is a subclass of int in Python — must not silently become 0.0/1.0
        assert _as_float(True) is None
        assert _as_float(False) is None

    def test_plain_number(self):
        assert _as_float(42) == 42.0
        assert _as_float(3.5) == 3.5

    def test_string_with_commas(self):
        assert _as_float("1,234.5") == 1234.5

    def test_garbage_string_returns_none(self):
        assert _as_float("N/A") is None


# ---------------------------------------------------------------------------
# _as_date
# ---------------------------------------------------------------------------

class TestAsDate:
    def test_none_and_empty(self):
        assert _as_date(None) is None
        assert _as_date("") is None

    def test_datetime_object(self):
        assert _as_date(datetime(2026, 3, 15, 8, 30)) == "2026-03-15"

    def test_date_object(self):
        assert _as_date(date(2026, 3, 15)) == "2026-03-15"

    def test_iso_string(self):
        assert _as_date("2026-03-15") == "2026-03-15"

    def test_us_slash_format(self):
        assert _as_date("03/15/2026") == "2026-03-15"

    def test_unparseable_string_returns_none(self):
        assert _as_date("not a date") is None


# ---------------------------------------------------------------------------
# _resolve_date — day-of-month + anchor month combination
# ---------------------------------------------------------------------------

class TestResolveDate:
    def test_full_datetime_cell(self):
        assert _resolve_date(datetime(2026, 3, 15), None) == "2026-03-15"

    def test_day_of_month_int_with_anchor(self):
        anchor = date(2026, 3, 1)
        assert _resolve_date(15, anchor) == "2026-03-15"

    def test_day_of_month_without_anchor_returns_none(self):
        assert _resolve_date(15, None) is None

    def test_out_of_range_day_returns_none(self):
        anchor = date(2026, 3, 1)
        assert _resolve_date(45, anchor) is None

    def test_date_string_with_anchor_present_but_unused(self):
        anchor = date(2026, 1, 1)
        assert _resolve_date("2026-03-15", anchor) == "2026-03-15"

    def test_none_and_empty(self):
        assert _resolve_date(None, None) is None
        assert _resolve_date("", None) is None


# ---------------------------------------------------------------------------
# _clean_sheet_name
# ---------------------------------------------------------------------------

class TestCleanSheetName:
    def test_strips_meter_reading_suffix(self):
        assert _clean_sheet_name("Well 2 Meter Reading") == "Well 2"

    def test_strips_parenthetical(self):
        assert _clean_sheet_name("Well 2 (backup)") == "Well 2"

    def test_falls_back_to_original_if_nothing_left(self):
        assert _clean_sheet_name("Meter Reading") == "Meter Reading"

    def test_collapses_whitespace(self):
        assert _clean_sheet_name("Well   3   Meter Reading") == "Well 3"


# ---------------------------------------------------------------------------
# _detect_blocks
# ---------------------------------------------------------------------------

class TestDetectBlocks:
    def test_detects_datetime_header_cells(self):
        header = (datetime(2026, 3, 1), "Initial", "Final", "Volume", "Status")
        blocks = _detect_blocks(header)
        assert blocks == [(0, date(2026, 3, 1))]

    def test_detects_literal_date_string(self):
        header = ("Date", "Initial", "Final", "Volume", "Status")
        blocks = _detect_blocks(header)
        assert blocks == [(0, None)]

    def test_multiple_blocks(self):
        header = (
            "Date", "Initial", "Final", "Volume", "Status",
            "Date", "Initial", "Final", "Volume", "Status",
        )
        blocks = _detect_blocks(header)
        assert [b[0] for b in blocks] == [0, 5]

    def test_no_blocks_found(self):
        header = ("Well Name", "Location", "Notes")
        assert _detect_blocks(header) == []
