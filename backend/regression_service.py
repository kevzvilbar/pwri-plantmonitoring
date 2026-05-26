"""
regression_service.py
─────────────────────
Runs linear regression + Z-score outlier detection on a column of readings
pulled from Supabase. Stores results in the regression_results table.

Supported source tables:
  well_readings, locator_readings, product_meter_readings, ro_train_readings

The regression models time (ordinal day index) as the independent variable
and the selected column as the dependent variable. Outliers are flagged when
|Z-score| > Z_THRESHOLD.  Each flagged point receives a corrected_value
projected from the fitted line.

All DB I/O goes through the Supabase REST API (no MongoDB).
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, date
from typing import Any, Optional

import numpy as np
from pydantic import BaseModel, Field
from supabase import create_client, Client

log = logging.getLogger(__name__)

Z_THRESHOLD = 2.5          # Flag readings with |z| > this
MIN_ROWS    = 5            # Need at least this many rows to fit

# Tables and their queryable numeric columns
SUPPORTED_TABLES: dict[str, list[str]] = {
    "well_readings":          ["daily_volume", "current_reading", "previous_reading", "power_meter_reading"],
    "locator_readings":       ["daily_volume", "current_reading", "previous_reading"],
    "product_meter_readings": ["daily_volume", "current_reading", "previous_reading"],
    "ro_train_readings":      ["permeate_tds", "permeate_ph", "raw_turbidity", "dp_psi", "recovery_pct"],
}


# ── Pydantic request/response models ─────────────────────────────────────────

class RegressionRequest(BaseModel):
    source_table: str
    column_name: str
    plant_id: Optional[str] = None
    date_from: Optional[str] = None   # ISO date string
    date_to: Optional[str] = None
    user_id: Optional[str] = None
    user_role: str = "Data Analyst"


class CorrectionRow(BaseModel):
    reading_id: str
    reading_datetime: str
    original_value: Optional[float]
    corrected_value: Optional[float]
    z_score: Optional[float]
    is_outlier: bool
    note: str


class RegressionResponse(BaseModel):
    result_id: str
    source_table: str
    column_name: str
    plant_id: Optional[str]
    date_from: Optional[str]
    date_to: Optional[str]
    row_count: int
    outlier_count: int
    r_squared: Optional[float]
    slope: Optional[float]
    intercept: Optional[float]
    corrections: list[CorrectionRow]
    status: str
    created_at: str


# ── Supabase client ───────────────────────────────────────────────────────────

def _supa(access_token: Optional[str] = None) -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    client = create_client(url, key)
    if access_token:
        try:
            client.postgrest.auth(access_token)
        except Exception:
            pass
    return client


# ── Core regression logic ─────────────────────────────────────────────────────

def _fit_and_flag(
    readings: list[dict[str, Any]],
    column: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Fit a linear regression of column ~ day_index and flag outliers.

    Returns:
        corrections: list of dicts per reading
        stats: {r_squared, slope, intercept}
    """
    # Extract (day_index, value) pairs where value is not None
    pairs = []
    for i, row in enumerate(readings):
        val = row.get(column)
        if val is not None:
            try:
                pairs.append((i, float(val), row))
            except (TypeError, ValueError):
                pass

    if len(pairs) < MIN_ROWS:
        # Not enough data — return as-is, no regression
        corrections = [
            {
                "reading_id":       str(r.get("id", "")),
                "reading_datetime": str(r.get("reading_datetime", "")),
                "original_value":   r.get(column),
                "corrected_value":  None,
                "z_score":          None,
                "is_outlier":       False,
                "note":             "Insufficient data for regression",
            }
            for r in readings
        ]
        return corrections, {"r_squared": None, "slope": None, "intercept": None}

    xs = np.array([p[0] for p in pairs], dtype=float)
    ys = np.array([p[1] for p in pairs], dtype=float)

    # Fit linear regression
    coeffs = np.polyfit(xs, ys, 1)
    slope, intercept = float(coeffs[0]), float(coeffs[1])
    y_pred = np.polyval(coeffs, xs)

    # R²
    ss_res = float(np.sum((ys - y_pred) ** 2))
    ss_tot = float(np.sum((ys - np.mean(ys)) ** 2))
    r_squared = float(1 - ss_res / ss_tot) if ss_tot > 0 else None

    # Z-scores on residuals
    residuals = ys - y_pred
    std_res = float(np.std(residuals)) if len(residuals) > 1 else 0.0
    z_scores = residuals / std_res if std_res > 0 else np.zeros_like(residuals)

    # Build a lookup for rows that had valid values
    pair_by_idx = {p[0]: (p[1], float(z_scores[j]), float(y_pred[j])) for j, p in enumerate(pairs)}

    corrections = []
    for i, row in enumerate(readings):
        val = row.get(column)
        rid = str(row.get("id", ""))
        rdt = str(row.get("reading_datetime", ""))

        if i not in pair_by_idx:
            corrections.append({
                "reading_id":       rid,
                "reading_datetime": rdt,
                "original_value":   None,
                "corrected_value":  None,
                "z_score":          None,
                "is_outlier":       False,
                "note":             "Missing value — skipped",
            })
            continue

        orig, z, predicted = pair_by_idx[i]
        is_outlier = abs(z) > Z_THRESHOLD
        note = ""
        if is_outlier:
            direction = "high" if z > 0 else "low"
            note = f"out of range (z={z:.2f}, {direction}); regression-corrected"
        else:
            note = "within normal range"

        corrections.append({
            "reading_id":       rid,
            "reading_datetime": rdt,
            "original_value":   orig,
            "corrected_value":  round(predicted, 4) if is_outlier else None,
            "z_score":          round(z, 4),
            "is_outlier":       is_outlier,
            "note":             note,
        })

    stats = {
        "r_squared": round(r_squared, 6) if r_squared is not None else None,
        "slope":     round(slope, 6),
        "intercept": round(intercept, 6),
    }
    return corrections, stats


# ── Public API ────────────────────────────────────────────────────────────────

async def run_regression(
    req: RegressionRequest,
    access_token: Optional[str] = None,
) -> RegressionResponse:
    """
    Fetch raw readings from Supabase, run regression, persist result, and return.
    """
    if req.source_table not in SUPPORTED_TABLES:
        raise ValueError(f"Table '{req.source_table}' is not supported.")
    allowed_cols = SUPPORTED_TABLES[req.source_table]
    if req.column_name not in allowed_cols:
        raise ValueError(f"Column '{req.column_name}' is not supported for '{req.source_table}'.")

    client = _supa(access_token)

    # ── Fetch readings ──────────────────────────────────────────────────────
    select_cols = f"id,reading_datetime,{req.column_name},norm_status"
    if req.source_table in ("well_readings", "locator_readings"):
        select_cols += ",plant_id"

    q = client.table(req.source_table).select(select_cols)

    if req.plant_id:
        q = q.eq("plant_id", req.plant_id)
    if req.date_from:
        q = q.gte("reading_datetime", req.date_from)
    if req.date_to:
        q = q.lte("reading_datetime", req.date_to + "T23:59:59")

    q = q.order("reading_datetime", desc=False).limit(2000)
    res = q.execute()
    readings: list[dict[str, Any]] = res.data or []

    # ── Run regression ──────────────────────────────────────────────────────
    corrections, stats = _fit_and_flag(readings, req.column_name)

    # ── Persist result ─────────────────────────────────────────────────────
    result_id = str(uuid.uuid4())
    now_str = datetime.utcnow().isoformat()
    outlier_count = sum(1 for c in corrections if c.get("is_outlier"))

    doc = {
        "id":          result_id,
        "source_table": req.source_table,
        "column_name":  req.column_name,
        "plant_id":     req.plant_id,
        "date_from":    req.date_from,
        "date_to":      req.date_to,
        "created_by":   req.user_id,
        "created_role": req.user_role,
        "row_count":    len(readings),
        "r_squared":    stats["r_squared"],
        "slope":        stats["slope"],
        "intercept":    stats["intercept"],
        "corrections":  corrections,
        "status":       "pending",
    }

    try:
        client.table("regression_results").insert(doc).execute()
    except Exception as exc:
        log.warning("Failed to persist regression result: %s", exc)

    return RegressionResponse(
        result_id=result_id,
        source_table=req.source_table,
        column_name=req.column_name,
        plant_id=req.plant_id,
        date_from=req.date_from,
        date_to=req.date_to,
        row_count=len(readings),
        outlier_count=outlier_count,
        r_squared=stats["r_squared"],
        slope=stats["slope"],
        intercept=stats["intercept"],
        corrections=[CorrectionRow(**c) for c in corrections],
        status="pending",
        created_at=now_str,
    )


async def apply_regression(
    result_id: str,
    user_id: Optional[str],
    user_role: str,
    access_token: Optional[str] = None,
) -> dict[str, Any]:
    """
    Apply a pending regression result: write adjusted values back to the
    source table's norm_status and append reading_normalizations rows.
    """
    client = _supa(access_token)

    res = client.table("regression_results").select("*").eq("id", result_id).maybeSingle().execute()
    row = res.data
    if not row:
        raise ValueError(f"Regression result '{result_id}' not found.")
    if row["status"] != "pending":
        raise ValueError(f"Result is '{row['status']}' — can only apply 'pending' results.")

    source_table  = row["source_table"]
    corrections   = row["corrections"] or []
    outliers      = [c for c in corrections if c.get("is_outlier") and c.get("corrected_value") is not None]

    norm_rows = []
    for c in outliers:
        # Update norm_status on source table
        try:
            client.table(source_table).update(
                {"norm_status": "normalized"}
            ).eq("id", c["reading_id"]).execute()
        except Exception as exc:
            log.warning("Failed to update norm_status for %s: %s", c["reading_id"], exc)

        norm_rows.append({
            "source_table":   source_table,
            "source_id":      c["reading_id"],
            "action":         "normalize",
            "original_value": c.get("original_value"),
            "adjusted_value": c.get("corrected_value"),
            "note":           c.get("note") or f"Regression correction (result_id={result_id})",
            "performed_by":   user_id,
            "performed_role": user_role,
            "retractable":    True,
        })

    if norm_rows:
        try:
            client.table("reading_normalizations").insert(norm_rows).execute()
        except Exception as exc:
            log.warning("Failed to insert normalization rows: %s", exc)

    # Mark result as applied
    client.table("regression_results").update({"status": "applied"}).eq("id", result_id).execute()

    return {"ok": True, "applied": len(outliers), "result_id": result_id}


async def retract_regression(
    result_id: str,
    user_id: Optional[str],
    user_role: str,
    access_token: Optional[str] = None,
) -> dict[str, Any]:
    """
    Retract an applied regression: restore norm_status to 'retracted' and
    append retract rows to reading_normalizations.
    """
    client = _supa(access_token)

    res = client.table("regression_results").select("*").eq("id", result_id).maybeSingle().execute()
    row = res.data
    if not row:
        raise ValueError(f"Regression result '{result_id}' not found.")
    if row["status"] != "applied":
        raise ValueError(f"Result is '{row['status']}' — can only retract 'applied' results.")

    source_table = row["source_table"]
    corrections  = row["corrections"] or []
    outliers     = [c for c in corrections if c.get("is_outlier")]

    norm_rows = []
    for c in outliers:
        try:
            client.table(source_table).update(
                {"norm_status": "retracted"}
            ).eq("id", c["reading_id"]).execute()
        except Exception as exc:
            log.warning("Failed to update norm_status for retract %s: %s", c["reading_id"], exc)

        norm_rows.append({
            "source_table":   source_table,
            "source_id":      c["reading_id"],
            "action":         "retract",
            "original_value": c.get("original_value"),
            "adjusted_value": None,
            "note":           f"Retracted regression correction (result_id={result_id})",
            "performed_by":   user_id,
            "performed_role": user_role,
            "retractable":    False,
        })

    if norm_rows:
        try:
            client.table("reading_normalizations").insert(norm_rows).execute()
        except Exception as exc:
            log.warning("Failed to insert retraction rows: %s", exc)

    client.table("regression_results").update({"status": "retracted"}).eq("id", result_id).execute()

    return {"ok": True, "retracted": len(outliers), "result_id": result_id}


async def list_regression_results(
    plant_id: Optional[str] = None,
    source_table: Optional[str] = None,
    limit: int = 50,
    access_token: Optional[str] = None,
) -> list[dict[str, Any]]:
    client = _supa(access_token)
    q = client.table("regression_results").select(
        "id,source_table,column_name,plant_id,date_from,date_to,created_at,"
        "created_role,row_count,outlier_count:corrections,r_squared,status"
    )
    if plant_id:
        q = q.eq("plant_id", plant_id)
    if source_table:
        q = q.eq("source_table", source_table)
    q = q.order("created_at", desc=True).limit(max(1, min(limit, 200)))
    res = q.execute()
    rows = res.data or []
    # outlier_count is stored as the corrections JSON array; compute count here
    for r in rows:
        corrs = r.get("outlier_count") or []
        r["outlier_count"] = sum(1 for c in corrs if c.get("is_outlier"))
    return rows
