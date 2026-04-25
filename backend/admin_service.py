"""
Admin service — user & plant deletion with RBAC, dependency checks and
Supabase-backed audit logging.

Rules (per product spec):
    Users (Only Admin):
        - Soft delete -> user_profiles.status = 'Suspended'.
        - Hard delete -> only if no dependencies.
        - Audit row in `deletion_audit_log` on every action.
    Plants (Only Admin):
        - Soft delete -> plants.status = 'Inactive'.
        - Hard delete -> only if no dependencies.
        - Audit row in `deletion_audit_log` on every action.

Cascade handling is advisory (the dependency snapshot is returned to the caller
so linked records can be archived/reassigned before hard-delete).

Endpoints authenticate via the caller's Supabase JWT
(Authorization: Bearer <jwt>).
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

# Recognises the various ways Postgres / PostgREST tell us a table doesn't
# exist (raw SQL "does not exist", PostgREST's PGRST205 "schema cache" miss,
# generic "relation" errors). Used to skip optional/older tables instead of
# turning their absence into a 500.
def _is_missing_table_error(msg: str) -> bool:
    if not msg:
        return False
    lower = msg.lower()
    return (
        "does not exist" in lower
        or "schema cache" in lower
        or "could not find the table" in lower
        or "pgrst205" in lower
        or "relation" in lower
    )


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

def _user_scoped_client(access_token: Optional[str] = None) -> Client:
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
    """Resolve caller's user_id, display name, and roles from Supabase."""
    client = _user_scoped_client(access_token)
    try:
        user_resp = client.auth.get_user(access_token)
    except Exception as e:  # noqa: BLE001
        log.exception("auth.get_user failed")
        raise HTTPException(status_code=401, detail=f"Invalid session: {e}")
    user = getattr(user_resp, "user", None) or (
        user_resp.get("user") if isinstance(user_resp, dict) else None
    )
    user_id = getattr(user, "id", None) if user else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Unable to identify caller")

    roles: list[str] = []
    try:
        rows = client.table("user_roles").select("role").eq("user_id", user_id).execute()
        roles = [r.get("role") for r in (rows.data or []) if r.get("role")]
    except Exception:
        log.exception("Failed to load caller roles")

    label: Optional[str] = None
    try:
        prof = client.table("user_profiles").select(
            "first_name,last_name,username",
        ).eq("id", user_id).maybeSingle().execute()
        data = prof.data or {}
        label = (
            " ".join(filter(None, [data.get("first_name"), data.get("last_name")])).strip()
            or data.get("username")
        )
    except Exception:
        log.debug("caller profile lookup failed", exc_info=True)

    return {"user_id": user_id, "roles": roles, "label": label}


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
        res = (
            client.table(table)
            .select("id", count="exact", head=True)
            .eq(column, value)
            .execute()
        )
        return int(getattr(res, "count", 0) or 0)
    except Exception as e:  # noqa: BLE001
        log.debug("count failed for %s.%s=%s: %s", table, column, value, e)
        return 0


def user_dependencies(client: Client, user_id: str) -> dict[str, Any]:
    roles_count = _count_refs(client, "user_roles", "user_id", user_id)
    refs: list[dict[str, Any]] = []
    total = 0
    for table, col in USER_REF_TABLES:
        n = _count_refs(client, table, col, user_id)
        if n:
            refs.append({"table": table, "column": col, "count": n})
            total += n

    assigned: list[str] = []
    try:
        res = (
            client.table("user_profiles")
            .select("plant_assignments")
            .eq("id", user_id)
            .single()
            .execute()
        )
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
    refs: list[dict[str, Any]] = []
    total = 0
    for table in PLANT_REF_TABLES:
        n = _count_refs(client, table, "plant_id", plant_id)
        if n:
            refs.append({"table": table, "count": n})
            total += n

    assigned_users = 0
    try:
        res = (
            client.table("user_profiles")
            .select("id", count="exact", head=True)
            .contains("plant_assignments", [plant_id])
            .execute()
        )
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


# --- Audit log --------------------------------------------------------------

def _write_audit(
    client: Client,
    *,
    kind: str,
    entity_id: str,
    entity_label: Optional[str],
    action: str,
    caller: dict[str, Any],
    reason: Optional[str],
    dependencies: Optional[dict[str, Any]] = None,
) -> None:
    """Persist one audit row. Failure is logged but never blocks the action."""
    try:
        client.table("deletion_audit_log").insert(
            {
                "kind": kind,
                "entity_id": entity_id,
                "entity_label": (entity_label or "")[:200] or None,
                "action": action,
                "actor_user_id": caller.get("user_id"),
                "actor_label": caller.get("label"),
                "reason": (reason or "").strip()[:500] or None,
                "dependencies": dependencies,
            }
        ).execute()
    except Exception as e:  # noqa: BLE001
        log.warning(
            "deletion_audit_log insert skipped (%s). "
            "Did you run supabase/migrations/20260424_deletion_audit_log.sql?",
            e,
        )


def _entity_label(client: Client, kind: str, entity_id: str) -> Optional[str]:
    try:
        if kind == "user":
            row = (
                client.table("user_profiles")
                .select("first_name,last_name,username")
                .eq("id", entity_id)
                .maybeSingle()
                .execute()
            )
            d = row.data or {}
            return (
                " ".join(filter(None, [d.get("first_name"), d.get("last_name")])).strip()
                or d.get("username")
            )
        if kind == "plant":
            row = (
                client.table("plants")
                .select("name")
                .eq("id", entity_id)
                .maybeSingle()
                .execute()
            )
            return (row.data or {}).get("name")
    except Exception:
        log.debug("entity label lookup failed", exc_info=True)
    return None


# --- Deletion actions -------------------------------------------------------

def soft_delete_user(
    authorization: Optional[str], user_id: str, reason: Optional[str] = None,
) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    if caller["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    client = _user_scoped_client(token)
    label = _entity_label(client, "user", user_id)
    try:
        res = (
            client.table("user_profiles")
            .update({"status": "Suspended"})
            .eq("id", user_id)
            .execute()
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Supabase update failed: {e}")
    if not (res.data or []):
        raise HTTPException(status_code=404, detail="User not found")

    _write_audit(
        client, kind="user", entity_id=user_id, entity_label=label,
        action="soft", caller=caller, reason=reason,
    )
    return {"ok": True, "mode": "soft", "user_id": user_id, "status": "Suspended"}


def hard_delete_user(
    authorization: Optional[str], user_id: str,
    reason: Optional[str] = None, force: bool = False,
) -> dict[str, Any]:
    """Admin-only. If `force=True`, dependencies are orphaned but deletion proceeds."""
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin"})  # only Admin can hard-delete users
    if caller["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    client = _user_scoped_client(token)
    deps = user_dependencies(client, user_id)
    if deps["blocking"] and not force:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "User has active dependencies; cannot hard-delete.",
                "dependencies": deps,
                "force_allowed": True,  # Admin may retry with force=true
            },
        )
    label = _entity_label(client, "user", user_id)
    try:
        client.table("user_roles").delete().eq("user_id", user_id).execute()
        client.table("user_profiles").delete().eq("id", user_id).execute()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Hard delete failed: {e}")

    _write_audit(
        client, kind="user", entity_id=user_id, entity_label=label,
        action="hard", caller=caller,
        reason=(f"[FORCE] {reason or ''}".strip() if force else reason),
        dependencies=deps,
    )
    return {
        "ok": True,
        "mode": "hard",
        "forced": bool(force and deps["blocking"]),
        "user_id": user_id,
        "note": (
            "Profile and role rows removed. Auth record (auth.users) must be "
            "removed separately via the Supabase dashboard if desired."
            + (" Linked records were ORPHANED (their recorded_by/performed_by/"
               "replaced_by pointers now dangle)." if force and deps["blocking"] else "")
        ),
    }


def soft_delete_plant(
    authorization: Optional[str], plant_id: str, reason: Optional[str] = None,
) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _user_scoped_client(token)
    label = _entity_label(client, "plant", plant_id)
    try:
        res = (
            client.table("plants")
            .update({"status": "Inactive"})
            .eq("id", plant_id)
            .execute()
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Supabase update failed: {e}")
    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Plant not found")

    _write_audit(
        client, kind="plant", entity_id=plant_id, entity_label=label,
        action="soft", caller=caller, reason=reason,
    )
    return {"ok": True, "mode": "soft", "plant_id": plant_id, "status": "Inactive"}


def hard_delete_plant(
    authorization: Optional[str], plant_id: str,
    reason: Optional[str] = None, force: bool = False,
    archive: bool = False,
) -> dict[str, Any]:
    """Admin + Manager. Only Admin may `force=True` over a dependency block.

    When `archive=True` (Admin + force only), every row in the no-cascade
    child tables is snapshotted into `archived_plant_data` as JSONB before
    being deleted, so historical readings/incidents/PMs survive the hard
    delete for compliance review.
    """
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    roles = set(caller.get("roles") or [])
    is_admin = "Admin" in roles

    client = _user_scoped_client(token)
    deps = plant_dependencies(client, plant_id)
    if deps["blocking"]:
        if not (force and is_admin):
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        "Plant has active dependencies; archive or reassign them first."
                        if not force
                        else "Only Admin may force-delete a plant with dependencies."
                    ),
                    "dependencies": deps,
                    "force_allowed": is_admin,
                },
            )
    label = _entity_label(client, "plant", plant_id)

    # Several child tables reference plants(id) WITHOUT ON DELETE CASCADE
    # (well_readings, locator_readings, incidents, etc). We must clear them
    # ourselves before the parent DELETE — otherwise Postgres raises 23503.
    # We only do this when force=True; the dependency check above would
    # otherwise have already blocked the call with 409.
    deleted_counts: dict[str, int] = {}
    if force and deps["blocking"]:
        # Detach plant id from any user_profiles.plant_assignments arrays.
        try:
            assigned = (
                client.table("user_profiles")
                .select("id,plant_assignments")
                .contains("plant_assignments", [plant_id])
                .execute()
            )
            for prof in assigned.data or []:
                new_arr = [
                    p for p in (prof.get("plant_assignments") or []) if p != plant_id
                ]
                client.table("user_profiles").update(
                    {"plant_assignments": new_arr}
                ).eq("id", prof["id"]).execute()
        except Exception:  # noqa: BLE001
            log.debug("plant_assignments scrub failed", exc_info=True)

        archived_counts: dict[str, int] = {}
        for table in _PLANT_NO_CASCADE_CHILDREN:
            try:
                # Optionally snapshot rows into archived_plant_data BEFORE
                # we wipe them. Best-effort: if the archive table is missing
                # (migration not yet applied), the user told us not to
                # archive, or the snapshot fails, we still proceed with the
                # delete so the original force-delete contract holds.
                if archive and is_admin:
                    try:
                        snap = (
                            client.table(table)
                            .select("*")
                            .eq("plant_id", plant_id)
                            .execute()
                        )
                        rows = snap.data or []
                        if rows:
                            payload = [
                                {
                                    "plant_id": plant_id,
                                    "plant_name": label,
                                    "source_table": table,
                                    "source_row_id": (
                                        r.get("id") if isinstance(r.get("id"), str) else None
                                    ),
                                    "payload": r,
                                    "archived_by": caller.get("user_id"),
                                    "reason": (reason or "").strip()[:500] or None,
                                }
                                for r in rows
                            ]
                            try:
                                client.table("archived_plant_data").insert(payload).execute()
                                archived_counts[table] = len(payload)
                            except Exception as e:  # noqa: BLE001
                                msg = str(e)
                                if (
                                    "archived_plant_data" in msg
                                    and _is_missing_table_error(msg)
                                ):
                                    log.warning(
                                        "archived_plant_data table missing — run "
                                        "supabase/migrations/20260425_archived_plant_data.sql"
                                    )
                                else:
                                    log.exception("archive insert failed for %s", table)
                                    raise HTTPException(
                                        status_code=500,
                                        detail=(
                                            f"Failed archiving {table} for plant "
                                            f"'{label or plant_id}': {e}"
                                        ),
                                    )
                    except HTTPException:
                        raise
                    except Exception:  # noqa: BLE001
                        log.exception("archive snapshot read failed for %s", table)

                res = (
                    client.table(table)
                    .delete(count="exact")
                    .eq("plant_id", plant_id)
                    .execute()
                )
                deleted_counts[table] = int(getattr(res, "count", 0) or 0)
            except HTTPException:
                raise
            except Exception as e:  # noqa: BLE001
                msg = str(e)
                if _is_missing_table_error(msg):
                    log.debug("skipping missing table %s", table)
                    continue
                log.exception("force-delete child clear failed: %s", table)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed clearing {table} for plant '{label or plant_id}': {e}",
                )

    try:
        client.table("plants").delete().eq("id", plant_id).execute()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Hard delete failed: {e}")

    _write_audit(
        client, kind="plant", entity_id=plant_id, entity_label=label,
        action="hard", caller=caller,
        reason=(f"[FORCE] {reason or ''}".strip() if force and deps["blocking"] else reason),
        dependencies=deps,
    )
    return {
        "ok": True,
        "mode": "hard",
        "forced": bool(force and deps["blocking"]),
        "archived": bool(archive and is_admin and force and deps["blocking"]),
        "plant_id": plant_id,
        "deleted_counts": deleted_counts,
        "archived_counts": (
            archived_counts if archive and is_admin and force and deps["blocking"] else {}
        ),
    }


def get_user_dependencies(authorization: Optional[str], user_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _user_scoped_client(token)
    return user_dependencies(client, user_id)


def get_plant_dependencies(authorization: Optional[str], plant_id: str) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _user_scoped_client(token)
    return plant_dependencies(client, plant_id)


def list_audit_log(
    authorization: Optional[str],
    kind: Optional[str] = None,
    limit: int = 100,
) -> dict[str, Any]:
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin", "Manager"})
    client = _user_scoped_client(token)
    limit = max(1, min(int(limit), 500))
    try:
        q = client.table("deletion_audit_log").select("*").order(
            "created_at", desc=True,
        ).limit(limit)
        if kind in ("user", "plant", "well"):
            q = q.eq("kind", kind)
        res = q.execute()
        return {"count": len(res.data or []), "entries": res.data or []}
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        # Only swallow the "table/relation does not exist" error (pre-migration state).
        # Any other Supabase error (RLS denial, network, etc) must surface as 500.
        if "deletion_audit_log" in msg and _is_missing_table_error(msg):
            log.warning(
                "deletion_audit_log table missing — run supabase/migrations/"
                "20260424_deletion_audit_log.sql in Supabase SQL editor."
            )
            return {
                "count": 0,
                "entries": [],
                "table_missing": True,
                "warning": msg,
            }
        log.exception("audit log read failed")
        raise HTTPException(status_code=500, detail=f"Audit log read failed: {msg}")


# --- Plant cleanup (Admin one-click bulk hard-delete) ----------------------

# Tables whose plant_id FK has NO ON DELETE CASCADE — we must delete these
# rows ourselves before the parent plant can be removed.
_PLANT_NO_CASCADE_CHILDREN: list[str] = [
    "well_meter_replacements",
    "well_pms_records",
    "well_readings",
    "locator_meter_replacements",
    "locator_readings",
    "ro_train_readings",
    "ro_train_replacements",
    "incidents",
    "checklist_executions",
]


def cleanup_plants(
    authorization: Optional[str],
    names: list[str],
    reason: str,
) -> dict[str, Any]:
    """Admin-only. Bulk hard-delete a list of plants by name, clearing all
    no-cascade dependents and writing one audit-log row per plant.

    Returns:
        {
            "ok": True,
            "processed": [
                {
                    "name": "Mambaling 3",
                    "plant_id": "<uuid>",
                    "deleted_counts": {"wells": N, ...},
                },
                ...
            ],
            "not_found": ["..."],
        }
    """
    token = _bearer_token(authorization)
    caller = _caller_identity(token)
    _require_roles(caller, {"Admin"})

    if not isinstance(names, list) or not names:
        raise HTTPException(status_code=400, detail="`names` must be a non-empty list.")
    cleaned_names = [n.strip() for n in names if isinstance(n, str) and n.strip()]
    if not cleaned_names:
        raise HTTPException(status_code=400, detail="`names` must contain non-empty strings.")
    if not reason or len(reason.strip()) < 5:
        raise HTTPException(
            status_code=400,
            detail="`reason` is required and must be at least 5 characters.",
        )

    client = _user_scoped_client(token)
    processed: list[dict[str, Any]] = []
    not_found: list[str] = []

    for name in cleaned_names:
        # Resolve plant id by name.
        try:
            res = (
                client.table("plants")
                .select("id,name")
                .eq("name", name)
                .maybeSingle()
                .execute()
            )
            row = res.data or None
        except Exception as e:  # noqa: BLE001
            log.exception("plant lookup failed for %s", name)
            raise HTTPException(status_code=500, detail=f"Lookup failed for '{name}': {e}")
        if not row:
            not_found.append(name)
            continue
        plant_id = row["id"]

        # Snapshot dependency counts before mutation (for audit + response).
        deps = plant_dependencies(client, plant_id)

        # Audit log FIRST so even if a downstream delete fails midway, the
        # caller has a paper trail.
        _write_audit(
            client, kind="plant", entity_id=plant_id, entity_label=row.get("name"),
            action="hard", caller=caller,
            reason=f"[CLEANUP] {reason.strip()}",
            dependencies=deps,
        )

        deleted_counts: dict[str, int] = {}
        try:
            # Clear no-cascade descendants in dependency-safe order.
            for table in _PLANT_NO_CASCADE_CHILDREN:
                try:
                    res = (
                        client.table(table)
                        .delete(count="exact")
                        .eq("plant_id", plant_id)
                        .execute()
                    )
                    deleted_counts[table] = int(getattr(res, "count", 0) or 0)
                except Exception as e:  # noqa: BLE001
                    msg = str(e)
                    # Tolerate tables that may not exist in older deployments.
                    if _is_missing_table_error(msg):
                        log.debug("skipping missing table %s", table)
                        continue
                    log.exception("cleanup child delete failed: %s", table)
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed clearing {table} for plant '{name}': {e}",
                    )

            # Detach plant id from any user_profiles.plant_assignments arrays.
            try:
                assigned = (
                    client.table("user_profiles")
                    .select("id,plant_assignments")
                    .contains("plant_assignments", [plant_id])
                    .execute()
                )
                for prof in assigned.data or []:
                    new_arr = [
                        p for p in (prof.get("plant_assignments") or []) if p != plant_id
                    ]
                    client.table("user_profiles").update(
                        {"plant_assignments": new_arr}
                    ).eq("id", prof["id"]).execute()
            except Exception:
                log.debug("plant_assignments scrub failed", exc_info=True)

            # Finally drop the plant; CASCADE removes wells/locators/ro_trains/etc.
            client.table("plants").delete().eq("id", plant_id).execute()
            deleted_counts["plants"] = 1
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("plant cleanup failed for %s", name)
            raise HTTPException(
                status_code=500,
                detail=f"Cleanup failed mid-flight for '{name}': {e}",
            )

        processed.append({
            "name": name,
            "plant_id": plant_id,
            "deleted_counts": deleted_counts,
        })

    return {
        "ok": True,
        "processed": processed,
        "not_found": not_found,
        "actor_label": caller.get("label"),
    }
