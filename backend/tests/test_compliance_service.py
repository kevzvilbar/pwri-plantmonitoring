"""
Unit tests for compliance_service.py's pure evaluation logic.

`evaluate()` is the business-critical function here: it turns a plant's
current metrics into a list of Violations against configurable thresholds,
which drive the compliance dashboard and alerting. These tests exercise it
directly (no Supabase/db access — get_thresholds/save_thresholds are
intentionally not covered here since they require live network calls).
"""
from __future__ import annotations

from compliance_service import Thresholds, _coerce_float, _sev_for_ratio, evaluate


# ---------------------------------------------------------------------------
# _coerce_float
# ---------------------------------------------------------------------------

class TestCoerceFloat:
    def test_none_returns_none(self):
        assert _coerce_float(None) is None

    def test_numeric_string(self):
        assert _coerce_float("12.5") == 12.5

    def test_int(self):
        assert _coerce_float(7) == 7.0

    def test_garbage_returns_none(self):
        assert _coerce_float("abc") is None


# ---------------------------------------------------------------------------
# _sev_for_ratio
# ---------------------------------------------------------------------------

class TestSevForRatio:
    def test_just_over_threshold_is_low(self):
        assert _sev_for_ratio(1.1) == "low"

    def test_at_low_medium_boundary_is_medium(self):
        assert _sev_for_ratio(1.25) == "medium"

    def test_at_medium_high_boundary_is_high(self):
        assert _sev_for_ratio(1.5) == "high"

    def test_way_over_is_high(self):
        assert _sev_for_ratio(3.0) == "high"

    def test_exactly_at_threshold_is_low(self):
        assert _sev_for_ratio(1.0) == "low"


# ---------------------------------------------------------------------------
# evaluate — the main compliance rule engine
# ---------------------------------------------------------------------------

class TestEvaluate:
    def test_no_metrics_produces_no_violations(self):
        t = Thresholds()
        assert evaluate(t, {}) == []

    def test_all_metrics_within_limits_produce_no_violations(self):
        t = Thresholds()
        metrics = {
            "nrw_pct": 10.0,
            "downtime_hrs": 1.0,
            "permeate_tds": 300.0,
            "permeate_ph": 7.0,
            "raw_turbidity": 2.0,
            "dp_psi": 20.0,
            "recovery_pct": 80.0,
            "pv_ratio": 1.0,
        }
        assert evaluate(t, metrics) == []

    def test_nrw_over_threshold_flags_violation(self):
        t = Thresholds(nrw_pct_max=20.0)
        violations = evaluate(t, {"nrw_pct": 25.0})
        assert len(violations) == 1
        v = violations[0]
        assert v.code == "nrw_pct_over"
        assert v.comparator == ">"
        assert v.value == 25.0
        assert v.threshold == 20.0
        assert "25.0" in v.message

    def test_recovery_under_minimum_flags_violation(self):
        t = Thresholds(recovery_pct_min=70.0)
        violations = evaluate(t, {"recovery_pct": 60.0})
        assert len(violations) == 1
        v = violations[0]
        assert v.code == "recovery_pct_under"
        assert v.comparator == "<"

    def test_ph_below_range_flags_out_of_range_with_min_as_threshold(self):
        t = Thresholds(permeate_ph_min=6.5, permeate_ph_max=8.5)
        violations = evaluate(t, {"permeate_ph": 5.0})
        assert len(violations) == 1
        v = violations[0]
        assert v.code == "permeate_ph_range"
        assert v.comparator == "out_of_range"
        assert v.threshold == 6.5

    def test_ph_above_range_flags_out_of_range_with_max_as_threshold(self):
        t = Thresholds(permeate_ph_min=6.5, permeate_ph_max=8.5)
        violations = evaluate(t, {"permeate_ph": 9.0})
        assert len(violations) == 1
        assert violations[0].threshold == 8.5

    def test_ph_within_range_is_fine(self):
        t = Thresholds(permeate_ph_min=6.5, permeate_ph_max=8.5)
        assert evaluate(t, {"permeate_ph": 7.0}) == []

    def test_severity_scales_with_how_far_over_threshold(self):
        t = Thresholds(nrw_pct_max=20.0)
        low = evaluate(t, {"nrw_pct": 22.0})[0]        # ratio 1.1
        medium = evaluate(t, {"nrw_pct": 26.0})[0]      # ratio 1.3
        high = evaluate(t, {"nrw_pct": 35.0})[0]        # ratio 1.75
        assert low.severity == "low"
        assert medium.severity == "medium"
        assert high.severity == "high"

    def test_missing_metric_is_silently_skipped(self):
        t = Thresholds()
        # Only nrw_pct supplied — everything else missing must not raise
        # or produce spurious violations.
        violations = evaluate(t, {"nrw_pct": 5.0})
        assert violations == []

    def test_chem_low_stock_flags_per_chemical(self):
        t = Thresholds(chem_low_stock_days_min=7.0)
        metrics = {
            "chem_days_of_supply": [
                {"name": "Antiscalant", "days": 3.0},
                {"name": "Chlorine", "days": 10.0},
            ]
        }
        violations = evaluate(t, metrics)
        assert len(violations) == 1
        v = violations[0]
        assert v.code == "chem_low_stock"
        assert v.metric == "chem:Antiscalant"
        assert v.value == 3.0

    def test_chem_severity_high_below_half_threshold(self):
        t = Thresholds(chem_low_stock_days_min=10.0)
        # 3 days < 10/2=5 -> high
        violations = evaluate(t, {"chem_days_of_supply": [{"name": "X", "days": 3.0}]})
        assert violations[0].severity == "high"

    def test_chem_severity_medium_between_half_and_full_threshold(self):
        t = Thresholds(chem_low_stock_days_min=10.0)
        # 7 days is >= 5 (half) but < 10 -> medium
        violations = evaluate(t, {"chem_days_of_supply": [{"name": "X", "days": 7.0}]})
        assert violations[0].severity == "medium"

    def test_multiple_simultaneous_violations(self):
        t = Thresholds(nrw_pct_max=20.0, dp_psi_max=40.0)
        violations = evaluate(t, {"nrw_pct": 30.0, "dp_psi": 50.0})
        codes = {v.code for v in violations}
        assert codes == {"nrw_pct_over", "dp_psi_over"}

    def test_string_metric_values_are_coerced(self):
        # Metrics arriving from the frontend may be strings — must not raise.
        t = Thresholds(nrw_pct_max=20.0)
        violations = evaluate(t, {"nrw_pct": "25.0"})
        assert len(violations) == 1
        assert violations[0].value == 25.0
