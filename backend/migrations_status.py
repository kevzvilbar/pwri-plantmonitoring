"""
Supabase migrations status — Admin-only endpoint that scans the
`supabase/migrations/*.sql` files, parses out the tables and columns each
migration is expected to create, and probes the live Supabase project to
report which ones are already applied vs missing.

The frontend Admin → Migrations tab uses this to show the user the exact
SQL to paste into the Supabase Dashboard SQL Editor for each pending file.

We deliberately do NOT execute any DDL ourselves — the anon-role JWT does
not have CREATE permission, and the user prefers the explicit "copy → paste
in Supabase" flow so they retain a clear audit trail of schema changes.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from admin_service import (
    _bearer_token,
    _caller_identity,
    _is_missing_table_error,
    _require_roles,
    _user_scoped_client,
)

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"

# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

_RE_CREATE_TABLE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)

# Captures the table name in a multi-column ALTER TABLE … ADD COLUMN block.
_RE_ALTER_TABLE = re.compile(
    r"alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)

_RE_ADD_COLUMN = re.compile(
    r"add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)

# Captures `select id into <var> from <table>` and similar references that we
# never want to treat as "must exist" probes (DO blocks, RPCs, etc).
_RE_NOISE = re.compile(r"^\s*(--|/\*|\*)", re.MULTILINE)


def _parse_migration(sql: str) -> dict[str, Any]:
    """Return {tables: [...], columns: [(table, column), ...]} for a SQL file.

    We strip line comments first so commented-out statements don't get probed.
    """
    # Strip simple line comments to reduce false positives. We don't fully
    # parse SQL — just enough to find the canonical CREATE TABLE / ADD COLUMN
    # statements that an applied migration must have produced.
    cleaned_lines = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        cleaned_lines.append(line)
    cleaned = "\n".join(cleaned_lines)

    tables: list[str] = []
    seen: set[str] = set()
    for m in _RE_CREATE_TABLE.finditer(cleaned):
        name = m.group(1).lower()
        if name in seen:
            continue
        seen.add(name)
        tables.append(name)

    # Walk each ALTER TABLE … ADD COLUMN … chunk independently so we attribute
    # the column to the right table when a file has multiple ALTERs.
    columns: list[tuple[str, str]] = []
    column_seen: set[tuple[str, str]] = set()
    for alter in re.finditer(
        r"alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)(.*?)(?=alter\s+table|$)",
        cleaned,
        re.IGNORECASE | re.DOTALL,
    ):
        table = alter.group(1).lower()
        body = alter.group(2)
        for col in _RE_ADD_COLUMN.finditer(body):
            colname = col.group(1).lower()
            key = (table, colname)
            if key in column_seen:
                continue
            column_seen.add(key)
            columns.append(key)

    return {"tables": tables, "columns": columns}


# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------

def _probe_table(client, table: str) -> dict[str, Any]:
    """Returns {exists: bool, error: str|None}.

    'exists' is True even when the table is RLS-restricted from the caller —
    we only flip it False on a genuine missing-table error.
    """
    try:
        client.table(table).select("*", head=True, count="exact").limit(1).execute()
        return {"exists": True, "error": None}
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if _is_missing_table_error(msg):
            return {"exists": False, "error": msg}
        # RLS denial / permission errors: treat as "exists, just not visible"
        return {"exists": True, "error": None}


def _probe_column(client, table: str, column: str) -> dict[str, Any]:
    """Probe a single column. Returns {exists: bool, error: str|None}."""
    try:
        client.table(table).select(column).limit(0).execute()
        return {"exists": True, "error": None}
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        lower = msg.lower()
        # PostgREST returns PGRST204 / "column ... does not exist" for missing cols.
        if "column" in lower and (
            "does not exist" in lower
            or "could not find" in lower
            or "pgrst204" in lower
        ):
            return {"exists": False, "error": msg}
        if _is_missing_table_error(lower):
            # Table itself missing — the table-level probe will surface that;
            # we mark the column missing too so the migration shows pending.
            return {"exists": False, "error": msg}
        return {"exists": True, "error": None}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_migration_status(authorization: Optional[str]) -> dict[str, Any]:
    """Admin-only. Scan migrations dir, probe live schema, return per-file status."""
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin"})

    if not MIGRATIONS_DIR.is_dir():
        raise HTTPException(
            status_code=500,
            detail=f"Migrations directory not found at {MIGRATIONS_DIR}",
        )

    client = _user_scoped_client(token)

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    out: list[dict[str, Any]] = []
    summary = {"total": 0, "applied": 0, "pending": 0, "partial": 0, "indeterminate": 0}

    for path in files:
        sql = path.read_text(encoding="utf-8", errors="replace")
        parsed = _parse_migration(sql)

        table_probes: list[dict[str, Any]] = []
        for t in parsed["tables"]:
            res = _probe_table(client, t)
            table_probes.append({"name": t, "exists": res["exists"]})

        column_probes: list[dict[str, Any]] = []
        for table, col in parsed["columns"]:
            res = _probe_column(client, table, col)
            column_probes.append({"table": table, "column": col, "exists": res["exists"]})

        all_probes = [p["exists"] for p in table_probes] + [
            p["exists"] for p in column_probes
        ]

        if not all_probes:
            status = "indeterminate"
        elif all(all_probes):
            status = "applied"
        elif not any(all_probes):
            status = "pending"
        else:
            status = "partial"

        summary["total"] += 1
        summary[status] += 1

        out.append({
            "filename": path.name,
            "size": path.stat().st_size,
            "status": status,
            "table_probes": table_probes,
            "column_probes": column_probes,
            "sql": sql,
        })

    return {
        "migrations_dir": str(MIGRATIONS_DIR),
        "summary": summary,
        "files": out,
    }
