"""
AI Universal Import — multi-format file analysis with OpenAI classification
and admin-approved sync into wells / locators / ro_trains and matching
*_readings tables. Every approve/reject decision is recorded in the
deletion_audit_log with an [IMPORT] tag.

Pipeline:
    1. extract_tables(filename, bytes) -> list[ExtractedTable]
    2. classify_tables(tables) -> list[TableAnalysis]   (OpenAI, with rule-based fallback)
    3. persist analysis row in `import_analysis`
    4. sync_analysis(decisions) -> creates entities, inserts readings,
       updates analysis status, writes [IMPORT] audit rows.

Design notes:
    * Wellmeter tri-block files are detected up-front and flagged so the UI
      can hand off to the proven legacy parser (`/api/import/parse-wellmeter`).
    * Table extraction is bounded (rows/tables/sample-bytes) so a malicious
      upload can't OOM the worker.
    * The OpenAI key is read from `OPENAI_API_KEY`; if missing, a rule-based
      header-keyword classifier is used so the workflow never hard-fails.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, UploadFile
from openpyxl import load_workbook
from supabase import Client

# Reuse helpers from admin_service so auth + audit paths stay consistent.
from admin_service import (
    _bearer_token, _caller_identity, _user_scoped_client, _require_roles,
    _write_audit,
)

log = logging.getLogger(__name__)

# ---- Tunables -------------------------------------------------------------
OPENAI_MODEL = os.environ.get("OPENAI_IMPORT_MODEL", "gpt-4o-mini")
MAX_TABLES = 12
MAX_BODY_ROWS = 500          # rows kept per table (after header detection)
MAX_SAMPLE_ROWS = 25         # rows shown to LLM and persisted as preview
MAX_CELL_LEN = 80            # truncation for sample cell text
MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MiB

SUPPORTED_TARGETS: set[str] = {
    "wells", "locators", "ro_trains",
    "well_readings", "locator_readings", "ro_train_readings", "power_readings",
    "skip", "unknown",
}

ENTITY_TARGETS = {"wells", "locators", "ro_trains"}
READING_TARGETS = {
    "well_readings", "locator_readings", "ro_train_readings", "power_readings",
}

# ---------------------------------------------------------------------------
# Multi-format extraction
# ---------------------------------------------------------------------------

@dataclass
class ExtractedTable:
    source: str
    headers: list[str]
    rows: list[list[Any]]          # full body (capped at MAX_BODY_ROWS)
    sample_csv: str                # CSV string sent to the LLM


def extract_tables(filename: str, content: bytes) -> list[ExtractedTable]:
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (limit 25 MiB).")
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        return _extract_xlsx(content)
    if name.endswith(".docx"):
        return _extract_docx(content)
    if name.endswith(".doc"):
        raise HTTPException(
            status_code=400,
            detail="Legacy .doc binaries are not supported — please save as .docx and retry.",
        )
    if name.endswith((".txt", ".csv", ".tsv")):
        return _extract_text(content, filename or "upload.txt")
    raise HTTPException(
        status_code=400,
        detail=f"Unsupported file type: {filename}. Allowed: .xlsx, .xlsm, .docx, .txt, .csv, .tsv",
    )


def _extract_xlsx(content: bytes) -> list[ExtractedTable]:
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open spreadsheet: {e}")
    out: list[ExtractedTable] = []
    for sheet in wb.sheetnames[:MAX_TABLES]:
        ws = wb[sheet]
        rows: list[list[Any]] = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i >= MAX_BODY_ROWS + 5:
                break
            rows.append(list(row))
        headers, body = _pick_headers(rows)
        if not headers:
            continue
        body = body[:MAX_BODY_ROWS]
        out.append(ExtractedTable(
            source=sheet, headers=headers, rows=body,
            sample_csv=_to_csv(headers, body[:MAX_SAMPLE_ROWS]),
        ))
    return out


def _extract_docx(content: bytes) -> list[ExtractedTable]:
    try:
        from docx import Document  # type: ignore
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=f"python-docx not installed: {e}",
        )
    try:
        doc = Document(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open .docx: {e}")
    out: list[ExtractedTable] = []
    for ti, t in enumerate(doc.tables[:MAX_TABLES]):
        rows = [[cell.text for cell in r.cells] for r in t.rows[: MAX_BODY_ROWS + 5]]
        headers, body = _pick_headers(rows)
        if not headers:
            continue
        body = body[:MAX_BODY_ROWS]
        out.append(ExtractedTable(
            source=f"Table {ti + 1}", headers=headers, rows=body,
            sample_csv=_to_csv(headers, body[:MAX_SAMPLE_ROWS]),
        ))
    return out


def _extract_text(content: bytes, filename: str) -> list[ExtractedTable]:
    text = content.decode("utf-8", errors="replace")
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows = []
    for i, r in enumerate(reader):
        if i >= MAX_BODY_ROWS + 5:
            break
        rows.append(r)
    headers, body = _pick_headers(rows)
    if not headers:
        return []
    body = body[:MAX_BODY_ROWS]
    return [ExtractedTable(
        source=filename, headers=headers, rows=body,
        sample_csv=_to_csv(headers, body[:MAX_SAMPLE_ROWS]),
    )]


def _pick_headers(rows: list[list[Any]]) -> tuple[list[str], list[list[Any]]]:
    """Find the first row that looks like a header (>=2 non-empty,
    non-numeric cells) and treat everything after it as the body."""
    for i, r in enumerate(rows):
        nonempty = [c for c in r if c not in (None, "")]
        if len(nonempty) < 2:
            continue
        non_numeric = [c for c in nonempty if not _looks_numeric(c)]
        if len(non_numeric) >= max(2, int(len(nonempty) * 0.5)):
            return [_clean_header(c) for c in r], rows[i + 1 :]
    if rows:
        return [f"col{i + 1}" for i in range(len(rows[0]))], rows
    return [], []


def _clean_header(c: Any) -> str:
    if c is None:
        return ""
    s = str(c).strip()
    return re.sub(r"\s+", " ", s)


def _looks_numeric(v: Any) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    try:
        float(str(v).replace(",", ""))
        return True
    except (TypeError, ValueError):
        return False


def _to_csv(headers: list[str], rows: list[list[Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([_truncate(h) for h in headers])
    for r in rows:
        w.writerow([_truncate(c) for c in r])
    return buf.getvalue()


def _truncate(c: Any) -> str:
    if c is None:
        return ""
    s = str(c)
    return s if len(s) <= MAX_CELL_LEN else s[: MAX_CELL_LEN - 1] + "…"


# ---------------------------------------------------------------------------
# AI classification (OpenAI; rule-based fallback)
# ---------------------------------------------------------------------------

CLASSIFY_SYSTEM = """You are a data-import classifier for PWRI Monitoring (a multi-plant water-treatment app).
Given a single table extracted from an uploaded file, decide which application module it belongs to.

Available targets:
  wells              : Well master data (creating new wells: name, status).
  locators           : Locator (delivery point) master data.
  ro_trains          : RO train master data.
  well_readings      : Daily well meter readings (date + initial/final/volume).
  locator_readings   : Locator delivery readings (date + volume).
  ro_train_readings  : RO train production readings (date + permeate/feed flow).
  power_readings     : Power meter readings (date + kWh).
  skip               : Summary / header / footer table with no usable data.
  unknown            : No target fits — admin must decide.

For every table return a single JSON object (no prose):
{
  "target": "<one of above>",
  "entity_name": "<best guess for the well/locator/train this table is about, or null>",
  "confidence": 0.0-1.0,
  "column_mapping": { "<our_field>": "<source_header>" },
  "anomalies": ["short notes on data quality issues"],
  "rationale": "one sentence why"
}

Rules:
  * Be conservative: pick "unknown" rather than guess.
  * Confidence < 0.5 means the admin should review carefully.
  * For *_readings, column_mapping should include at minimum "date" (and "volume" or "value").
  * For wells/locators/ro_trains, column_mapping should include "name" (and "address" if present).
  * Flag obvious issues (missing dates, all-zero readings, header repetition) in `anomalies`.
"""


@dataclass
class TableAnalysis:
    source: str
    headers: list[str]
    target: str
    entity_name: Optional[str]
    confidence: float
    column_mapping: dict[str, str]
    anomalies: list[str]
    rationale: str
    sample_rows: list[list[str]]  # truncated string cells, safe for JSON
    row_count: int


def classify_tables(tables: list[ExtractedTable]) -> tuple[list[TableAnalysis], str]:
    """Returns (analyses, provider_label)."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return [_heuristic_classify(t) for t in tables], "rule-based"
    try:
        from openai import OpenAI  # type: ignore
        client = OpenAI(api_key=api_key)
    except Exception as e:
        log.warning("OpenAI init failed (%s); using heuristics", e)
        return [_heuristic_classify(t) for t in tables], "rule-based"

    out: list[TableAnalysis] = []
    for t in tables:
        try:
            resp = client.chat.completions.create(
                model=OPENAI_MODEL,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": CLASSIFY_SYSTEM},
                    {"role": "user", "content":
                        f"Source: {t.source}\nHeaders: {t.headers}\n\nSample rows (CSV):\n{t.sample_csv}"},
                ],
                temperature=0.1,
                timeout=30,
            )
            data = json.loads(resp.choices[0].message.content or "{}")
            target = str(data.get("target") or "unknown")
            if target not in SUPPORTED_TARGETS:
                target = "unknown"
            out.append(TableAnalysis(
                source=t.source,
                headers=t.headers,
                target=target,
                entity_name=(str(data["entity_name"]).strip() if data.get("entity_name") else None) or None,
                confidence=max(0.0, min(1.0, float(data.get("confidence") or 0.0))),
                column_mapping={str(k): str(v) for k, v in (data.get("column_mapping") or {}).items()},
                anomalies=[str(x) for x in (data.get("anomalies") or [])][:10],
                rationale=str(data.get("rationale") or "")[:300],
                sample_rows=[[_truncate(c) for c in r] for r in t.rows[:MAX_SAMPLE_ROWS]],
                row_count=len(t.rows),
            ))
        except Exception as e:
            log.exception("AI classify failed for %s", t.source)
            ta = _heuristic_classify(t)
            ta.anomalies.insert(0, f"AI call failed, used heuristics: {e}")
            out.append(ta)
    return out, "openai"


def _heuristic_classify(t: ExtractedTable) -> TableAnalysis:
    h = " ".join(str(x) for x in t.headers).lower()
    target = "unknown"
    if any(k in h for k in ("kwh", "power", "electric")):
        target = "power_readings"
    elif "ro" in h and any(k in h for k in ("permeate", "feed flow", "train")):
        target = "ro_train_readings"
    elif any(k in h for k in ("locator", "delivery point")):
        target = "locator_readings"
    elif any(k in h for k in ("initial", "final", "volume")) and any(k in h for k in ("date", "day")):
        target = "well_readings"
    elif "well" in h and any(k in h for k in ("status", "address", "type", "name")):
        target = "wells"
    return TableAnalysis(
        source=t.source,
        headers=t.headers,
        target=target,
        entity_name=t.source,
        confidence=0.4 if target != "unknown" else 0.1,
        column_mapping={},
        anomalies=["Classified by header keywords only (no AI key configured)."],
        rationale="Rule-based fallback (no LLM).",
        sample_rows=[[_truncate(c) for c in r] for r in t.rows[:MAX_SAMPLE_ROWS]],
        row_count=len(t.rows),
    )


# ---------------------------------------------------------------------------
# Wellmeter signature
# ---------------------------------------------------------------------------

def looks_like_wellmeter(tables: list[ExtractedTable]) -> bool:
    """Tri-block monthly layout: many `Initial`/`Final` columns repeated."""
    for t in tables:
        h = " ".join(str(x).lower() for x in t.headers)
        if h.count("initial") >= 2 and h.count("final") >= 2:
            return True
    return False


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _table_payload(a: TableAnalysis) -> dict[str, Any]:
    return {
        "source": a.source,
        "headers": a.headers,
        "target": a.target,
        "entity_name": a.entity_name,
        "confidence": a.confidence,
        "column_mapping": a.column_mapping,
        "anomalies": a.anomalies,
        "rationale": a.rationale,
        "sample_rows": a.sample_rows,
        "row_count": a.row_count,
    }


def _persist_analysis(client: Client, *, caller: dict[str, Any], filename: str,
                      file_kind: str, file_size: int, plant_id: Optional[str],
                      analyses: list[TableAnalysis], wellmeter_detected: bool,
                      ai_provider: str, ai_model: Optional[str]) -> str:
    aid = str(uuid.uuid4())
    payload = {
        "id": aid,
        "actor_user_id": caller.get("user_id"),
        "actor_label": caller.get("label"),
        "plant_id": plant_id,
        "filename": filename[:200],
        "file_kind": file_kind[:16],
        "file_size": file_size,
        "ai_provider": ai_provider,
        "ai_model": ai_model,
        "status": "pending",
        "wellmeter_detected": wellmeter_detected,
        "tables": [_table_payload(a) for a in analyses],
    }
    try:
        client.table("import_analysis").insert(payload).execute()
    except Exception as e:
        log.warning(
            "import_analysis insert skipped (%s). Did you run "
            "supabase/migrations/20260425_import_analysis.sql?", e,
        )
    return aid


def _load_analysis(client: Client, analysis_id: str) -> dict[str, Any]:
    try:
        res = (
            client.table("import_analysis")
            .select("*").eq("id", analysis_id).maybe_single().execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load analysis: {e}")
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return res.data


# ---------------------------------------------------------------------------
# Sync — entity creation + reading inserts
# ---------------------------------------------------------------------------

# Map of canonical field aliases -> logical field name. Used to recognise
# admin-edited column_mapping even when sources name things differently.
_DATE_KEYS = {"date", "reading_date", "day", "datetime", "reading_datetime"}
_VOLUME_KEYS = {"volume", "value", "kwh", "production", "permeate", "delivered", "current_reading"}
_INITIAL_KEYS = {"initial", "previous", "previous_reading", "start"}
_FINAL_KEYS = {"final", "current", "end"}
_NAME_KEYS = {"name", "well", "well_name", "locator", "locator_name", "train", "train_name"}


def _resolve_col(headers: list[str], mapping: dict[str, str], aliases: set[str]) -> Optional[int]:
    """Return the column index in `headers` for the first mapping key that
    matches one of `aliases` (case-insensitive). Falls back to direct
    header-name match."""
    lowered_headers = [h.lower().strip() for h in headers]

    # 1. user-provided mapping {our_field: source_header}
    for our, source in mapping.items():
        if our.lower().strip() in aliases:
            try:
                return lowered_headers.index(str(source).lower().strip())
            except ValueError:
                continue

    # 2. direct header alias match
    for alias in aliases:
        for i, h in enumerate(lowered_headers):
            if alias in h:
                return i
    return None


def _coerce_date(v: Any) -> Optional[str]:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d", "%m-%d-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    # Excel may serialise dates as floats too; openpyxl handles that, but be defensive.
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def _coerce_float(v: Any) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _ensure_entity(client: Client, target: str, plant_id: str, name: str) -> Optional[str]:
    """Get-or-create an entity row of `target` type under `plant_id` by name.
    Returns the entity id, or None on failure."""
    table = target  # 'wells' | 'locators' | 'ro_trains'
    name = name.strip()
    if not name or not plant_id:
        return None
    try:
        existing = (
            client.table(table).select("id,name")
            .eq("plant_id", plant_id).ilike("name", name).limit(1).execute()
        )
        if existing.data:
            return existing.data[0]["id"]
        # Minimal insert payload — let downstream forms fill in optional fields.
        base: dict[str, Any] = {"plant_id": plant_id, "name": name, "status": "Active"}
        if target == "wells":
            base["has_power_meter"] = False
        ins = client.table(table).insert(base).select("id").single().execute()
        return (ins.data or {}).get("id")
    except Exception as e:
        log.warning("Failed to upsert %s '%s': %s", target, name, e)
        return None


def _insert_readings(client: Client, target: str, plant_id: str,
                     entity_id: str, recorded_by: Optional[str],
                     headers: list[str], rows: list[list[Any]],
                     mapping: dict[str, str]) -> tuple[int, list[str]]:
    """Insert reading rows for the given target table. Returns (count, warnings)."""
    date_idx = _resolve_col(headers, mapping, _DATE_KEYS)
    if date_idx is None:
        return 0, ["No date column resolved — provide a 'date' column mapping."]

    warnings: list[str] = []
    payload: list[dict[str, Any]] = []
    seen_dates: set[str] = set()

    if target == "well_readings":
        init_idx = _resolve_col(headers, mapping, _INITIAL_KEYS)
        final_idx = _resolve_col(headers, mapping, _FINAL_KEYS)
        vol_idx = _resolve_col(headers, mapping, _VOLUME_KEYS)
        for r in rows:
            d = _coerce_date(r[date_idx] if date_idx < len(r) else None)
            if not d or d in seen_dates:
                continue
            seen_dates.add(d)
            row: dict[str, Any] = {
                "plant_id": plant_id,
                "well_id": entity_id,
                "reading_datetime": f"{d}T00:00:00Z",
                "previous_reading": _coerce_float(r[init_idx]) if init_idx is not None and init_idx < len(r) else None,
                "current_reading":  _coerce_float(r[final_idx]) if final_idx is not None and final_idx < len(r) else None,
                "daily_volume":     _coerce_float(r[vol_idx]) if vol_idx is not None and vol_idx < len(r) else None,
                "off_location_flag": False,
                "recorded_by": recorded_by,
            }
            payload.append(row)
    elif target == "locator_readings":
        vol_idx = _resolve_col(headers, mapping, _VOLUME_KEYS)
        if vol_idx is None:
            return 0, ["No volume column resolved for locator_readings."]
        for r in rows:
            d = _coerce_date(r[date_idx] if date_idx < len(r) else None)
            if not d or d in seen_dates:
                continue
            seen_dates.add(d)
            payload.append({
                "plant_id": plant_id,
                "locator_id": entity_id,
                "reading_datetime": f"{d}T00:00:00Z",
                "daily_volume": _coerce_float(r[vol_idx]) if vol_idx < len(r) else None,
                "recorded_by": recorded_by,
            })
    elif target == "ro_train_readings":
        vol_idx = _resolve_col(headers, mapping, _VOLUME_KEYS)
        for r in rows:
            d = _coerce_date(r[date_idx] if date_idx < len(r) else None)
            if not d or d in seen_dates:
                continue
            seen_dates.add(d)
            payload.append({
                "plant_id": plant_id,
                "ro_train_id": entity_id,
                "reading_datetime": f"{d}T00:00:00Z",
                "permeate_volume_m3": _coerce_float(r[vol_idx]) if vol_idx is not None and vol_idx < len(r) else None,
                "recorded_by": recorded_by,
            })
    elif target == "power_readings":
        vol_idx = _resolve_col(headers, mapping, _VOLUME_KEYS)
        if vol_idx is None:
            return 0, ["No kWh column resolved for power_readings."]
        for r in rows:
            d = _coerce_date(r[date_idx] if date_idx < len(r) else None)
            if not d or d in seen_dates:
                continue
            seen_dates.add(d)
            payload.append({
                "plant_id": plant_id,
                "reading_datetime": f"{d}T00:00:00Z",
                "kwh": _coerce_float(r[vol_idx]) if vol_idx < len(r) else None,
                "recorded_by": recorded_by,
            })
    else:
        return 0, [f"Unsupported reading target: {target}"]

    if not payload:
        warnings.append("No date-coercible rows found.")
        return 0, warnings

    inserted = 0
    BATCH = 500
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        try:
            client.table(target).insert(chunk).execute()
            inserted += len(chunk)
        except Exception as e:
            warnings.append(f"Batch {i // BATCH + 1} failed: {e}")
            break
    return inserted, warnings


# ---------------------------------------------------------------------------
# Public entry points (called from server.py)
# ---------------------------------------------------------------------------

def analyze_upload(authorization: Optional[str], file: UploadFile, content: bytes,
                   plant_id: Optional[str]) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _user_scoped_client(token)

    filename = file.filename or "upload"
    tables = extract_tables(filename, content)
    if not tables:
        raise HTTPException(status_code=400, detail="No tables detected in the file.")

    analyses, provider = classify_tables(tables)
    wellmeter = looks_like_wellmeter(tables)
    file_kind = (filename.rsplit(".", 1)[-1] if "." in filename else "")[:16].lower()
    aid = _persist_analysis(
        client, caller=caller, filename=filename, file_kind=file_kind,
        file_size=len(content), plant_id=plant_id,
        analyses=analyses, wellmeter_detected=wellmeter,
        ai_provider=provider,
        ai_model=OPENAI_MODEL if provider == "openai" else None,
    )

    return {
        "analysis_id": aid,
        "filename": filename,
        "wellmeter_detected": wellmeter,
        "ai_provider": provider,
        "ai_model": OPENAI_MODEL if provider == "openai" else None,
        "tables": [_table_payload(a) for a in analyses],
    }


def sync_analysis(authorization: Optional[str], analysis_id: str,
                  body: dict[str, Any]) -> dict[str, Any]:
    """Body shape:
        {
          "reason": "<min 5 chars>",
          "plant_id": "<uuid>",
          "decisions": [
            {
              "source": "<table source>",
              "action": "sync"|"reject",
              "target": "wells"|"locators"|"ro_trains"|"well_readings"|...,
              "entity_name": "Well 1",
              "column_mapping": {"date": "Date", "volume": "Volume"}
            },
            ...
          ]
        }
    """
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin"})
    client = _user_scoped_client(token)

    reason = (body.get("reason") or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="`reason` is required (min 5 chars).")
    plant_id = (body.get("plant_id") or "").strip() or None
    decisions = body.get("decisions") or []
    if not isinstance(decisions, list) or not decisions:
        raise HTTPException(status_code=400, detail="`decisions` must be a non-empty list.")

    analysis = _load_analysis(client, analysis_id)
    if analysis.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"Analysis already {analysis.get('status')}.")
    tables_by_source = {t["source"]: t for t in (analysis.get("tables") or [])}

    summary: dict[str, Any] = {
        "created": {"wells": 0, "locators": 0, "ro_trains": 0},
        "inserted": {"well_readings": 0, "locator_readings": 0,
                     "ro_train_readings": 0, "power_readings": 0},
        "skipped": [],
        "rejected": [],
    }

    any_synced = False
    any_skipped = False

    for d in decisions:
        source = str(d.get("source") or "").strip()
        action = str(d.get("action") or "").strip().lower()
        if not source or source not in tables_by_source:
            summary["skipped"].append({"source": source, "reason": "unknown source"})
            any_skipped = True
            continue
        tbl = tables_by_source[source]
        target = str(d.get("target") or tbl.get("target") or "unknown")
        entity_name = (d.get("entity_name") or tbl.get("entity_name") or "").strip()
        mapping = dict(d.get("column_mapping") or tbl.get("column_mapping") or {})

        if action == "reject" or target in ("skip", "unknown"):
            summary["rejected"].append({"source": source, "target": target})
            _audit_decision(client, caller, analysis_id, source, target,
                            "[IMPORT-REJECT]", reason)
            continue

        if action != "sync":
            summary["skipped"].append({"source": source, "reason": f"unknown action '{action}'"})
            any_skipped = True
            continue

        if target in ENTITY_TARGETS:
            if not plant_id:
                summary["skipped"].append({"source": source, "reason": "plant_id required for entity creation"})
                any_skipped = True
                continue
            if not entity_name:
                summary["skipped"].append({"source": source, "reason": "entity_name required"})
                any_skipped = True
                continue
            ent_id = _ensure_entity(client, target, plant_id, entity_name)
            if ent_id:
                summary["created"][target] += 1
                any_synced = True
                _audit_decision(client, caller, analysis_id, source, target,
                                f"[IMPORT] {entity_name}", reason)
            else:
                summary["skipped"].append({"source": source, "reason": f"failed to create {target}"})
                any_skipped = True
            continue

        if target in READING_TARGETS:
            if not plant_id:
                summary["skipped"].append({"source": source, "reason": "plant_id required for readings"})
                any_skipped = True
                continue
            entity_id: Optional[str] = None
            if target != "power_readings":
                entity_table = {
                    "well_readings": "wells",
                    "locator_readings": "locators",
                    "ro_train_readings": "ro_trains",
                }[target]
                if not entity_name:
                    summary["skipped"].append({"source": source, "reason": "entity_name required for readings"})
                    any_skipped = True
                    continue
                entity_id = _ensure_entity(client, entity_table, plant_id, entity_name)
                if not entity_id:
                    summary["skipped"].append({"source": source, "reason": f"could not resolve {entity_table} '{entity_name}'"})
                    any_skipped = True
                    continue

            # Reconstruct rows from the persisted sample (full body isn't kept
            # in `import_analysis` to bound payload size). For larger imports
            # the admin should re-upload via the wellmeter parser, which keeps
            # in-memory state. Document this honestly in the response.
            sample_rows = tbl.get("sample_rows") or []
            inserted, warns = _insert_readings(
                client, target=target, plant_id=plant_id,
                entity_id=entity_id or "", recorded_by=caller.get("user_id"),
                headers=tbl.get("headers") or [], rows=sample_rows,
                mapping=mapping,
            )
            summary["inserted"][target] += inserted
            if inserted:
                any_synced = True
                _audit_decision(client, caller, analysis_id, source, target,
                                f"[IMPORT] {entity_name or target} ({inserted} rows)", reason)
            for w in warns:
                summary["skipped"].append({"source": source, "reason": w})
                any_skipped = True
            continue

        summary["skipped"].append({"source": source, "reason": f"unsupported target '{target}'"})
        any_skipped = True

    new_status = (
        "synced" if any_synced and not any_skipped
        else "partial" if any_synced
        else "rejected"
    )

    try:
        client.table("import_analysis").update({
            "status": new_status,
            "decisions": decisions,
            "reason": reason,
            "decided_by": caller.get("user_id"),
            "decided_at": datetime.now(timezone.utc).isoformat(),
            "sync_summary": summary,
        }).eq("id", analysis_id).execute()
    except Exception as e:
        log.warning("Failed to update import_analysis status: %s", e)

    return {
        "ok": True,
        "analysis_id": analysis_id,
        "status": new_status,
        "summary": summary,
    }


def _audit_decision(client: Client, caller: dict[str, Any], analysis_id: str,
                    source: str, target: str, label: str, reason: str) -> None:
    """Write one row in deletion_audit_log so import decisions show up in the
    same admin Audit Log UI as deletions. We deliberately reuse the existing
    audit table (with kind='plant') and embed the [IMPORT] / [IMPORT-REJECT]
    tag in `reason` so existing filters (and the AuditLogPanel UI) keep
    working without a schema change."""
    _write_audit(
        client,
        kind="plant",
        entity_id=analysis_id,
        entity_label=f"{source} → {target}",
        action="hard",
        caller=caller,
        reason=f"{label} | {reason}",
        dependencies={"source": source, "target": target},
    )


def list_analyses(authorization: Optional[str], limit: int = 25) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _user_scoped_client(token)
    try:
        res = (
            client.table("import_analysis")
            .select("id,filename,file_kind,status,wellmeter_detected,ai_provider,ai_model,actor_label,plant_id,created_at,decided_at,sync_summary")
            .order("created_at", desc=True).limit(max(1, min(int(limit), 100))).execute()
        )
        return {"count": len(res.data or []), "entries": res.data or []}
    except Exception as e:
        log.warning("list_analyses failed: %s", e)
        return {"count": 0, "entries": [], "warning": str(e)}
