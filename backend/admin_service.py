"""
Admin service — user & plant deletion with RBAC and dependency checks.

Rules:
    Users:
        - Only Admin may delete users.
        - Soft delete -> user_profiles.status = 'Suspended' (keeps audit trail, blocks login).
        - Hard delete -> only if no dependencies (roles, logs, readings, incidents, etc).
        - Cascade handling -> existing logs remain with the original user_id for audit.

    Plants:
        - Admin or Manager may delete plants.
        - Soft delete -> plants.status = 'Inactive'.
        - Hard delete -> only if no dependencies (wells, locators, trains, readings, etc).
        - Cascade handling -> linked records are surfaced in dependency check; caller must
          archive/reassign before hard-delete.

Endpoints authenticate via the caller's Supabase JWT (Authorization: Bearer <jwt>).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import HTTPException
from supabase import Client, create_client

log = logging.getLogger(__name__)

# Tables that may reference a user id (column name -> list of tables) ---------
USER_REF_TABLES: list[tuple[str, str]] = [
    ("well_readings", "recorded_by"),
    ("locator_readings", "recorded_by"),
    ("ro_train_readings", "recorded_by"),
    ("afm_readings", "recorded_by"),
    ("cartridge_readings", "recorded_by"),
    ("pump_readings", "recorded_by"),
    ("ro_pretreatment_readings", "recorded_by"),
    ("power_readings", "recorded_by"),
    ("chemical_dosing_logs", "recorded_by"),
    ("chemical_residual_samples", "recorded_by"),
    ("downtime_events", "recorded_by"),
    ("incidents", "recorded_by"),
    ("well_pms_records", "performed_by"),
    ("well_meter_replacements", "replaced_by"),
    ("locator_meter_replacements", "replaced_by"),
    ("checklist_templates", "created_by"),
    ("checklist_executions", "performed_by"),
]

# Tables that directly reference a plant_id ----------------------------------
PLANT_REF_TABLES: list[str] = [
    "wells", "locators", "ro_trains",
    "well_readings", "locator_readings", "ro_train_readings",
    "afm_readings", "cartridge_readings", "pump_readings",
    "ro_pretreatment_readings",
    "power_readings", "electric_bills", "power_tariffs",
    "chemical_inventory", "chemical_deliveries", "chemical_dosing_logs",
    "chemical_residual_samples", "chemical_prices",
    "cip_logs",
    "daily_plant_summary", "downtime_events", "incidents",
    "checklist_templates", "train_status_log", "production_costs",
    "notifications",
]


# --- Supabase helpers -------------------------------------------------------

def _service_client(access_token: Optional[str] = None) -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    client = create_client(url, key)
    if access_token:
        try:
            client.postgrest.auth(access_token)
        except Exception:  # noqa: BLE001
            log.exception("Failed to attach JWT to Supabase client")
    return client


def _bearer_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")
    return token


def _caller_identity(access_token: str) -> dict[str, Any]:
    """Resolve the caller's user_id and roles from Supabase.

    Returns {"user_id": str, "roles": list[str]}.
    """
    client = _service_client(access_token)
    try:
        user_resp = client.auth.get_user(access_token)
    except Exception as e:  # noqa: BLE001
        log.exception("auth.get_user failed")
        raise HTTPException(status_code=401, detail=f"Invalid session: {e}")
    user = getattr(user_resp, "user", None) or (user_resp.get("user") if isinstance(user_resp, dict) else None)
    user_id = getattr(user, "id", None) if user else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Unable to identify caller")

    roles: list[str] = []
    try:
        rows = client.table("user_roles").select("role").eq("user_id", user_id).execute()
        roles = [r.get("role") for r in (rows.data or []) if r.get("role")]
    except Exception:
        log.exception("Failed to load caller roles")

    return {"user_id": user_id, "roles": roles}


def _require_roles(caller: dict[str, Any], allowed: set[str]) -> None:
    if not (set(caller.get("roles") or []) & allowed):
        raise HTTPException(
            status_code=403,
            detail=f"Forbidden. Required role(s): {sorted(allowed)}.",
        )


# --- Dependency counters ----------------------------------------------------

def _count_refs(client: Client, table: str, column: str, value: Any) -> int:
    """Cheap count() using head=True + exact count; returns 0 on failure."""
    try:
        res = client.table(table).select("id", count="exact", head=True).eq(column, value).execute()
        return int(getattr(res, "count", 0) or 0)
    except Exception as e:  # noqa: BLE001
        log.debug("count failed for %s.%s=%s: %s", table, column, value, e)
        return 0


def user_dependencies(client: Client, user_id: str) -> dict[str, Any]:
    """Collect dependency counts for a user deletion."""
    roles_count = _count_refs(client, "user_roles", "user_id", user_id)
    refs: list[dict[str, Any]] = []
    total = 0
    for table, col in USER_REF_TABLES:
        n = _count_refs(client, table, col, user_id)
        if n:
            refs.append({"table": table, "column": col, "count": n})
            total += n

    # plants assigned (array column on user_profiles)
    assigned: list[str] = []
    try:
        res = client.table("user_profiles").select("plant_assignments").eq("id", user_id).single().execute()
        assigned = list((res.data or {}).get("plant_assignments") or [])
    except Exception:
        pass

    return {
        "user_id": user_id,
        "role_rows": roles_count,
        "references": refs,
        "total_references": total,
        "assigned_plants": assigned,
        "blocking": total > 0 or bool(assigned),
    }


def plant_dependencies(client: Client, plant_id: str) -> dict[str, Any]:
    """Collect dependency counts for a plant deletion."""
    refs: list[dict[str, Any]] = []
    total = 0
    for table in PLANT_REF_TABLES:
        n = _count_refs(client, table, "plant_id", plant_id)
        if n:
            refs.append({"table": table, "count": n})
            total += n

    assigned_users = 0
    try:
        res = client.table("user_profiles").select(
            "id", count="exact", head=True,
        ).contains("plant_assignments", [plant_id]).execute()
        assigned_users = int(getattr(res, "count", 0) or 0)
    except Exception:
        log.debug("assigned_users count failed", exc_info=True)

    return {
        "plant_id": plant_id,
        "references": refs,
        "total_references": total,
        "assigned_users": assigned_users,
        "blocking": total > 0 or assigned_users > 0,
    }


# --- Deletion actions -------------------------------------------------------

def soft_delete_user(authorization: Optional[str], user_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin"})
    if caller["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    client = _service_client(token)
    try:
        res = client.table("user_profiles").update(
            {"status": "Suspended"},
        ).eq("id", user_id).execute()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Supabase update failed: {e}")
    if not (res.data or []):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "mode": "soft", "user_id": user_id, "status": "Suspended"}


def hard_delete_user(authorization: Optional[str], user_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin"})
    if caller["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    client = _service_client(token)
    deps = user_dependencies(client, user_id)
    if deps["blocking"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "User has active dependencies; cannot hard-delete.",
                "dependencies": deps,
            },
        )

    # Remove role rows first, then profile. auth.users row requires service key
    # to delete — we surface that via the response.
    try:
        client.table("user_roles").delete().eq("user_id", user_id).execute()
        client.table("user_profiles").delete().eq("id", user_id).execute()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Hard delete failed: {e}")
    return {
        "ok": True,
        "mode": "hard",
        "user_id": user_id,
        "note": "Profile and role rows removed. Auth record (auth.users) must be removed separately via Supabase dashboard if desired.",
    }


def soft_delete_plant(authorization: Optional[str], plant_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _service_client(token)
    try:
        res = client.table("plants").update(
            {"status": "Inactive"},
        ).eq("id", plant_id).execute()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Supabase update failed: {e}")
    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Plant not found")
    return {"ok": True, "mode": "soft", "plant_id": plant_id, "status": "Inactive"}


def hard_delete_plant(authorization: Optional[str], plant_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _service_client(token)
    deps = plant_dependencies(client, plant_id)
    if deps["blocking"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Plant has active dependencies; archive or reassign them first.",
                "dependencies": deps,
            },
        )
    try:
        client.table("plants").delete().eq("id", plant_id).execute()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Hard delete failed: {e}")
    return {"ok": True, "mode": "hard", "plant_id": plant_id}


def get_user_dependencies(authorization: Optional[str], user_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _service_client(token)
    return user_dependencies(client, user_id)


def get_plant_dependencies(authorization: Optional[str], plant_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _service_client(token)
    return plant_dependencies(client, plant_id)
