"""
PWRI Plant Monitoring Backend API — v2 (100% Supabase, no MongoDB/Railway)
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware
from supabase import create_client, Client

from import_parser import parse_xlsx
from ai_service import (
    ChatRequest, AnomalyRequest,
    chat_turn, list_sessions, get_session, detect_anomalies,
)
from ai_tools import ChatWithToolsRequest, chat_with_tools
from compliance_service import (
    Thresholds, ViolationsPayload,
    PmForecastRequest,
    get_thresholds, save_thresholds, evaluate, make_summary, forecast_pm,
)
from seed_service import seed_from_urls
from cron_service import verify_secret, run_compliance_evaluate, run_pm_forecast_sweep
from admin_service import (
    soft_delete_user, hard_delete_user,
    soft_delete_plant, hard_delete_plant,
    get_user_dependencies, get_plant_dependencies,
    list_audit_log, cleanup_plants,
)
from admin_helpers import bearer_token, caller_identity, require_roles, service_role_client
from ai_import_service import (
    analyze_upload as ai_analyze_upload,
    sync_analysis as ai_sync_analysis,
    list_analyses as ai_list_analyses,
    MAX_FILE_BYTES as AI_MAX_FILE_BYTES,
)
from regression_service import (
    RegressionRequest, run_regression,
    apply_regression, retract_regression,
    list_regression_results, SUPPORTED_TABLES as REGRESSION_TABLES,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
log = logging.getLogger(__name__)

_anon_singleton: Optional[Client] = None


def supa() -> Optional[Client]:
    global _anon_singleton
    if _anon_singleton is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_ANON_KEY")
        if url and key:
            _anon_singleton = create_client(url, key)
    return _anon_singleton


app = FastAPI(title="PWRI API", version="2.0.0")
api_router = APIRouter(prefix="/api")


# ── Models ─────────────────────────────────────────────────────────────────────

class DeletionRequest(BaseModel):
    reason: Optional[str] = None

class HardDeleteRequest(BaseModel):
    reason: Optional[str] = None
    force: bool = False
    archive: bool = False

class CleanupPlantsRequest(BaseModel):
    names: List[str] = Field(..., min_length=1, max_length=50)
    reason: str = Field(..., min_length=5, max_length=500)

class StatusCheckCreate(BaseModel):
    client_name: str

class SeedTarget(BaseModel):
    plant_name: str
    url: str
    source: str = "auto"

class SeedRequest(BaseModel):
    targets: List[SeedTarget]
    include_defective: bool = False
    downtime_as_zero: bool = True

class BlendingToggleRequest(BaseModel):
    well_id: str
    plant_id: str
    is_blending: bool
    well_name: Optional[str] = None
    plant_name: Optional[str] = None
    note: Optional[str] = None

class BlendingAuditRequest(BaseModel):
    plant_id: str
    well_id: str
    well_name: Optional[str] = None
    plant_name: Optional[str] = None
    event_date: str
    volume_m3: float

class RegressionRunRequest(BaseModel):
    source_table: str
    column_name: str
    plant_id: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None

class RawEditRequest(BaseModel):
    source_table: str
    source_id: str
    column_name: str
    old_value: Optional[float] = None
    new_value: float
    note: Optional[str] = None

class ApplyRegressionRequest(BaseModel):
    result_id: str

class RetractRegressionRequest(BaseModel):
    result_id: str

class OperatorSwitchLogRequest(BaseModel):
    plant_id: str
    from_username: str
    to_username: str
    device_id: str

class AdminCreateUserRequest(BaseModel):
    email: str
    password: str
    username: str
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    suffix: Optional[str] = None
    designation: Optional[str] = None

class MigrationMarkRequest(BaseModel):
    note: Optional[str] = None

class MigrationHistoryImportRequest(BaseModel):
    history: dict[str, dict[str, Any]]
    mode: Optional[str] = "fill_gaps"


# ── Root ───────────────────────────────────────────────────────────────────────

@api_router.get("/")
async def root():
    return {"message": "PWRI API v2 — 100% Supabase"}


@api_router.post("/status")
async def create_status_check(body: StatusCheckCreate):
    db = supa()
    if db is None:
        raise HTTPException(503, "Supabase not configured")
    r = {"id": str(uuid.uuid4()), "client_name": body.client_name,
         "created_at": datetime.utcnow().isoformat()}
    db.table("status_checks").insert(r).execute()
    return r

@api_router.get("/status")
async def get_status_checks():
    db = supa()
    if db is None:
        return []
    return (db.table("status_checks").select("*").order("created_at", desc=True).limit(100).execute().data or [])


# ── Import ─────────────────────────────────────────────────────────────────────

MAX_UPLOAD_BYTES = 10 * 1024 * 1024

@api_router.post("/import/parse-wellmeter")
async def parse_wellmeter(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Missing file")
    fname = file.filename.lower()
    if not (fname.endswith(".xlsx") or fname.endswith(".xlsm")):
        raise HTTPException(400, "Only .xlsx / .xlsm supported")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File too large (>10MB)")
    try:
        return JSONResponse(parse_xlsx(data))
    except Exception as e:
        log.exception("parse_xlsx failed")
        raise HTTPException(400, f"Failed to parse: {e}")


# ── AI ─────────────────────────────────────────────────────────────────────────

@api_router.post("/ai/chat")
async def ai_chat(req: ChatRequest, x_user_id: Optional[str] = Header(None)):
    try:
        return await chat_turn(None, x_user_id, req)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("ai_chat failed"); raise HTTPException(500, str(e))

@api_router.get("/ai/sessions")
async def ai_list_sessions(x_user_id: Optional[str] = Header(None), limit: int = 20):
    return await list_sessions(None, x_user_id, limit=max(1, min(limit, 100)))

@api_router.get("/ai/sessions/{session_id}")
async def ai_get_session(session_id: str):
    return await get_session(None, session_id)

@api_router.delete("/ai/sessions/{session_id}")
async def ai_delete_session(session_id: str):
    db = supa()
    if db:
        db.table("ai_chat_sessions").delete().eq("session_id", session_id).execute()
    return {"ok": True, "session_id": session_id}

@api_router.post("/ai/anomalies")
async def ai_anomalies(req: AnomalyRequest):
    try:
        return await detect_anomalies(req)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("ai_anomalies failed"); raise HTTPException(500, str(e))

@api_router.post("/ai/chat-tools")
async def ai_chat_tools(req: ChatWithToolsRequest, x_user_id: Optional[str] = Header(None)):
    try:
        return await chat_with_tools(None, x_user_id, req)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("ai_chat_tools failed"); raise HTTPException(500, str(e))

@api_router.get("/ai/health")
async def ai_health():
    return {"ok": bool(os.environ.get("EMERGENT_LLM_KEY")), "model": "gpt-5.1", "provider": "openai"}

@api_router.post("/ai/pm-forecast")
async def ai_pm_forecast(req: PmForecastRequest):
    try:
        return await forecast_pm(req)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("pm_forecast failed"); raise HTTPException(500, str(e))


# ── Compliance ─────────────────────────────────────────────────────────────────

@api_router.get("/compliance/thresholds")
async def get_compliance_thresholds(scope: str = "global"):
    t = await get_thresholds(None, scope)
    return {"scope": scope, "thresholds": t.dict()}

@api_router.put("/compliance/thresholds")
async def put_compliance_thresholds(body: dict):
    scope = str(body.get("scope") or "global")
    try:
        t = Thresholds(**(body.get("thresholds") or {}))
    except Exception as e:
        raise HTTPException(400, f"Invalid thresholds: {e}")
    doc = await save_thresholds(None, scope, t)
    return {"scope": doc.scope, "thresholds": doc.thresholds.dict(), "updated_at": doc.updated_at.isoformat()}

@api_router.post("/compliance/evaluate")
async def compliance_evaluate(body: ViolationsPayload, summarize: bool = False):
    scope = body.plant_id or "global"
    t = await get_thresholds(None, scope)
    violations = evaluate(t, body.metrics)
    result: dict[str, Any] = {
        "scope": scope, "scope_label": body.scope_label,
        "evaluated_at": datetime.utcnow().isoformat(),
        "violations": [v.dict() for v in violations], "thresholds": t.dict(),
    }
    if summarize:
        try:
            result["summary"] = await make_summary(violations, body.metrics, body.scope_label or scope)
        except Exception as e:
            log.exception("compliance summary failed"); result["summary_error"] = str(e)
        try:
            db = supa()
            if db and body.plant_id:
                db.table("compliance_snapshots").insert({
                    "plant_id": body.plant_id,
                    "evaluated_at": datetime.utcnow().isoformat(),
                    "violations": [v.dict() for v in violations],
                    "summary": result.get("summary"),
                }).execute()
        except Exception as e:
            log.warning("Failed to persist compliance snapshot: %s", e)
    return result


# ── Seed ───────────────────────────────────────────────────────────────────────

@api_router.post("/import/seed-from-url")
async def import_seed_from_url(body: SeedRequest, authorization: Optional[str] = Header(None)):
    if not body.targets:
        raise HTTPException(400, "No targets supplied")
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip() or None
    try:
        return await seed_from_urls(None, [t.dict() for t in body.targets],
                                     include_defective=body.include_defective,
                                     downtime_as_zero=body.downtime_as_zero,
                                     access_token=token)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        log.exception("seed_from_urls failed"); raise HTTPException(500, f"Seed failed: {e}")


# ── Downtime events ────────────────────────────────────────────────────────────

@api_router.get("/downtime/events")
async def downtime_events(plant_id: Optional[str] = None, date_from: Optional[str] = None,
                           date_to: Optional[str] = None, limit: int = 500):
    db = supa()
    if db is None:
        return {"count": 0, "total_duration_hrs": 0, "by_subsystem": [], "events": []}
    q = db.table("downtime_events").select("*")
    if plant_id: q = q.eq("plant_id", plant_id)
    if date_from: q = q.gte("event_date", date_from)
    if date_to:   q = q.lte("event_date", date_to)
    docs = (q.order("event_date", desc=True).limit(max(1, min(limit, 2000))).execute().data or [])
    total_hours = sum(float(d.get("duration_hrs") or 0) for d in docs)
    by_sub: dict[str, float] = {}
    for d in docs:
        sub = d.get("subsystem") or "Plant"
        by_sub[sub] = by_sub.get(sub, 0.0) + float(d.get("duration_hrs") or 0)
    return {
        "count": len(docs), "total_duration_hrs": round(total_hours, 2),
        "by_subsystem": [{"subsystem": k, "hours": round(v, 2)}
                         for k, v in sorted(by_sub.items(), key=lambda x: -x[1])],
        "events": docs,
    }


# ── Blending ───────────────────────────────────────────────────────────────────

@api_router.get("/blending/wells")
async def blending_wells_list(plant_id: Optional[str] = None):
    db = supa()
    if db is None: return {"wells": []}
    q = db.table("blending_wells").select("*").order("tagged_at", desc=True)
    if plant_id: q = q.eq("plant_id", plant_id)
    return {"wells": q.execute().data or []}

@api_router.post("/blending/toggle")
async def blending_toggle(body: BlendingToggleRequest, x_user_id: Optional[str] = Header(None)):
    db = supa()
    if db is None: raise HTTPException(503, "Supabase not configured")
    if body.is_blending:
        db.table("blending_wells").upsert({
            "well_id": body.well_id, "plant_id": body.plant_id,
            "well_name": body.well_name or "", "plant_name": body.plant_name or "",
            "tagged_by": x_user_id, "tagged_at": datetime.utcnow().isoformat(),
            "note": body.note or "",
        }, on_conflict="well_id").execute()
        return {"ok": True, "is_blending": True, "well_id": body.well_id}
    db.table("blending_wells").delete().eq("well_id", body.well_id).execute()
    return {"ok": True, "is_blending": False, "well_id": body.well_id}

@api_router.post("/blending/audit")
async def blending_log_event(body: BlendingAuditRequest):
    db = supa()
    if db is None: raise HTTPException(503, "Supabase not configured")
    db.table("blending_events").insert({
        "plant_id": body.plant_id, "well_id": body.well_id,
        "well_name": body.well_name or "", "plant_name": body.plant_name or "",
        "event_date": body.event_date, "volume_m3": body.volume_m3,
        "noted_at": datetime.utcnow().isoformat(),
    }).execute()
    return {"ok": True}

@api_router.get("/blending/volume")
async def blending_volume(plant_ids: Optional[str] = None, days: int = 14):
    db = supa()
    if db is None:
        return {"days": days, "total_m3": 0, "today_m3": 0, "series": [], "by_well": []}
    span = max(1, min(int(days or 14), 180))
    base = datetime.utcnow().date()
    since = (base - timedelta(days=span - 1)).isoformat()
    today = base.isoformat()
    q = db.table("blending_events").select("*").gte("event_date", since)
    if plant_ids:
        ids = [p.strip() for p in plant_ids.split(",") if p.strip()]
        if ids: q = q.in_("plant_id", ids)
    events = q.execute().data or []
    by_day: dict[str, float] = {}
    by_well: dict[str, dict[str, Any]] = {}
    total = today_total = 0.0
    for ev in events:
        day = str(ev.get("event_date", ""))[:10]
        vol = float(ev.get("volume_m3") or 0)
        by_day[day] = by_day.get(day, 0.0) + vol
        wid = ev.get("well_id") or ""
        if wid:
            cur = by_well.setdefault(wid, {"well_id": wid, "well_name": ev.get("well_name") or "",
                "plant_id": ev.get("plant_id"), "plant_name": ev.get("plant_name") or "",
                "volume_m3": 0.0, "today_volume_m3": 0.0, "previous_volume_m3": None,
                "previous_event_date": None})
            cur["volume_m3"] += vol
            if day == today: cur["today_volume_m3"] += vol
            elif day and day < today:
                prev_d = cur.get("previous_event_date")
                if prev_d is None or day > prev_d:
                    cur["previous_event_date"] = day; cur["previous_volume_m3"] = vol
        total += vol
        if day == today: today_total += vol
    series = [{"date": (base - timedelta(days=i)).isoformat(),
               "volume_m3": round(by_day.get((base - timedelta(days=i)).isoformat(), 0.0), 2)}
              for i in range(span - 1, -1, -1)]
    by_well_list = sorted(by_well.values(), key=lambda x: x["volume_m3"], reverse=True)
    for w in by_well_list:
        w["volume_m3"] = round(float(w["volume_m3"]), 2)
        w["today_volume_m3"] = round(float(w.get("today_volume_m3") or 0.0), 2)
        if w.get("previous_volume_m3") is not None:
            w["previous_volume_m3"] = round(float(w["previous_volume_m3"]), 2)
    return {"days": span, "total_m3": round(total, 2), "today_m3": round(today_total, 2),
            "series": series, "by_well": by_well_list}


# ── Alerts ─────────────────────────────────────────────────────────────────────

@api_router.get("/alerts/feed")
async def alerts_feed(plant_id: Optional[str] = None, days: int = 7):
    db = supa()
    if db is None: return {"count": 0, "alerts": []}
    since = (datetime.utcnow() - timedelta(days=max(1, days))).date().isoformat()
    alerts: list[dict[str, Any]] = []
    q_dt = db.table("downtime_events").select("*").gte("event_date", since)
    if plant_id: q_dt = q_dt.eq("plant_id", plant_id)
    events_by_day: dict[str, list] = {}
    for d in (q_dt.execute().data or []):
        events_by_day.setdefault(str(d.get("event_date", ""))[:10], []).append(d)
    for day, evs in events_by_day.items():
        total = sum(float(e.get("duration_hrs") or 0) for e in evs)
        long_ones = [e for e in evs if float(e.get("duration_hrs") or 0) >= 12]
        if long_ones:
            alerts.append({"kind": "downtime", "severity": "high", "date": day,
                "plant_id": long_ones[0].get("plant_id"),
                "title": f"Prolonged shutdown · {long_ones[0].get('subsystem')}",
                "detail": f"{long_ones[0].get('duration_hrs')}h", "count": len(long_ones)})
        elif len(evs) >= 3 and total >= 6:
            alerts.append({"kind": "downtime", "severity": "medium", "date": day,
                "plant_id": evs[0].get("plant_id"),
                "title": f"Abnormal downtime · {len(evs)} events / {total:.1f}h",
                "detail": "Multiple short shutdowns.", "count": len(evs)})
    q_be = db.table("blending_events").select("*").gte("event_date", since).order("event_date", desc=True).limit(50)
    if plant_id: q_be = q_be.eq("plant_id", plant_id)
    for d in (q_be.execute().data or []):
        alerts.append({"kind": "blending", "severity": "info",
            "date": str(d.get("event_date", ""))[:10], "plant_id": d.get("plant_id"),
            "title": f"Blending · {d.get('well_name')}",
            "detail": f"Injected {d.get('volume_m3')} m³ into product water."})
    q_snap = db.table("compliance_snapshots").select("*").order("evaluated_at", desc=True).limit(20)
    if plant_id: q_snap = q_snap.eq("plant_id", plant_id)
    seen: set[str] = set()
    for s in (q_snap.execute().data or []):
        pid = s.get("plant_id") or ""
        if pid in seen: continue
        seen.add(pid)
        for v in s.get("violations") or []:
            if v.get("code") == "recovery_pct_under":
                alerts.append({"kind": "recovery", "severity": v.get("severity", "medium"),
                    "date": str(s.get("evaluated_at", ""))[:10], "plant_id": pid,
                    "title": "Recovery below threshold",
                    "detail": f"Recovery {v.get('value')}% vs. min {v.get('threshold')}%"}); break
    sev_rank = {"high": 0, "medium": 1, "low": 2, "info": 3}
    alerts.sort(key=lambda a: (sev_rank.get(a.get("severity", "info"), 9),
                               -int(str(a.get("date", "")).replace("-", "") or "0")))
    capped = alerts[:80]
    return {"count": len(capped), "alerts": capped}


# ── Data Analysis & Review ─────────────────────────────────────────────────────

@api_router.get("/data-analysis/tables")
async def data_analysis_tables():
    return {"tables": [{"name": k, "columns": v} for k, v in REGRESSION_TABLES.items()]}

@api_router.post("/data-analysis/run-regression")
async def data_analysis_run_regression(body: RegressionRunRequest,
                                        authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    caller = caller_identity(token)
    require_roles(caller, {"Admin", "Data Analyst"})
    req = RegressionRequest(source_table=body.source_table, column_name=body.column_name,
        plant_id=body.plant_id, date_from=body.date_from, date_to=body.date_to,
        user_id=caller.get("uid"), user_role=caller.get("role", "Data Analyst"))
    try:
        return await run_regression(req, access_token=token)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("run_regression failed"); raise HTTPException(500, str(e))

@api_router.post("/data-analysis/apply-regression")
async def data_analysis_apply_regression(body: ApplyRegressionRequest,
                                          authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    caller = caller_identity(token)
    require_roles(caller, {"Admin", "Data Analyst"})
    try:
        return await apply_regression(body.result_id, user_id=caller.get("uid"),
                                       user_role=caller.get("role", "Data Analyst"), access_token=token)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("apply_regression failed"); raise HTTPException(500, str(e))

@api_router.post("/data-analysis/retract-regression")
async def data_analysis_retract_regression(body: RetractRegressionRequest,
                                            authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    caller = caller_identity(token)
    require_roles(caller, {"Admin", "Data Analyst"})
    try:
        return await retract_regression(body.result_id, user_id=caller.get("uid"),
                                         user_role=caller.get("role", "Data Analyst"), access_token=token)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("retract_regression failed"); raise HTTPException(500, str(e))

@api_router.get("/data-analysis/results")
async def data_analysis_list_results(plant_id: Optional[str] = None, source_table: Optional[str] = None,
                                      limit: int = 50, authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    caller = caller_identity(token)
    require_roles(caller, {"Admin", "Data Analyst", "Manager"})
    results = await list_regression_results(plant_id=plant_id, source_table=source_table,
                                             limit=limit, access_token=token)
    return {"results": results}

@api_router.post("/data-analysis/edit-raw")
async def data_analysis_edit_raw(body: RawEditRequest, authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    caller = caller_identity(token)
    require_roles(caller, {"Admin", "Data Analyst"})
    if body.source_table not in REGRESSION_TABLES:
        raise HTTPException(400, f"Table '{body.source_table}' not supported.")
    svc = service_role_client()
    try:
        svc.table(body.source_table).update({body.column_name: body.new_value}).eq("id", body.source_id).execute()
    except Exception as e:
        log.exception("edit_raw update failed"); raise HTTPException(500, f"Update failed: {e}")
    try:
        svc.table("raw_edit_log").insert({
            "source_table": body.source_table, "source_id": body.source_id,
            "column_name": body.column_name, "old_value": body.old_value, "new_value": body.new_value,
            "edited_by": caller.get("uid"), "edited_role": caller.get("role", "Data Analyst"),
            "edited_at": datetime.utcnow().isoformat(), "note": body.note or "",
        }).execute()
    except Exception as e:
        log.warning("raw_edit_log insert failed: %s", e)
    return {"ok": True, "source_id": body.source_id, "column_name": body.column_name,
            "new_value": body.new_value}

@api_router.get("/data-analysis/raw-edit-log")
async def data_analysis_raw_edit_log(source_table: Optional[str] = None, source_id: Optional[str] = None,
                                      limit: int = 100, authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    caller = caller_identity(token)
    require_roles(caller, {"Admin", "Data Analyst", "Manager"})
    db = supa()
    if db is None: return {"log": []}
    q = db.table("raw_edit_log").select("*")
    if source_table: q = q.eq("source_table", source_table)
    if source_id: q = q.eq("source_id", source_id)
    return {"log": (q.order("edited_at", desc=True).limit(max(1, min(limit, 500))).execute().data or [])}


# ── Admin ──────────────────────────────────────────────────────────────────────

@api_router.get("/admin/users/{user_id}/dependencies")
async def admin_user_dependencies(user_id: str, authorization: Optional[str] = Header(None)):
    return get_user_dependencies(authorization, user_id)

@api_router.post("/admin/users/{user_id}/soft-delete")
async def admin_user_soft_delete(user_id: str, body: Optional[DeletionRequest] = None,
                                  authorization: Optional[str] = Header(None)):
    return soft_delete_user(authorization, user_id, reason=(body.reason if body else None))

@api_router.post("/admin/users/{user_id}/hard-delete")
async def admin_user_hard_delete(user_id: str, body: Optional[HardDeleteRequest] = None,
                                  authorization: Optional[str] = Header(None)):
    return hard_delete_user(authorization, user_id, reason=(body.reason if body else None),
                             force=(body.force if body else False))

@api_router.get("/admin/plants/{plant_id}/dependencies")
async def admin_plant_dependencies(plant_id: str, authorization: Optional[str] = Header(None)):
    return get_plant_dependencies(authorization, plant_id)

@api_router.post("/admin/plants/{plant_id}/soft-delete")
async def admin_plant_soft_delete(plant_id: str, body: Optional[DeletionRequest] = None,
                                   authorization: Optional[str] = Header(None)):
    return soft_delete_plant(authorization, plant_id, reason=(body.reason if body else None))

@api_router.post("/admin/plants/{plant_id}/hard-delete")
async def admin_plant_hard_delete(plant_id: str, body: Optional[HardDeleteRequest] = None,
                                   authorization: Optional[str] = Header(None)):
    return hard_delete_plant(authorization, plant_id, reason=(body.reason if body else None),
                              force=(body.force if body else False), archive=(body.archive if body else False))

@api_router.post("/import/ai-analyze")
async def import_ai_analyze(file: UploadFile = File(...), plant_id: Optional[str] = None,
                             authorization: Optional[str] = Header(None)):
    if not file.filename: raise HTTPException(400, "Missing file")
    data = await file.read()
    if not data: raise HTTPException(400, "Empty file")
    if len(data) > AI_MAX_FILE_BYTES: raise HTTPException(413, "File too large (limit 25 MiB)")
    return ai_analyze_upload(authorization, file, data, plant_id)

@api_router.post("/import/ai-sync/{analysis_id}")
async def import_ai_sync(analysis_id: str, body: dict, authorization: Optional[str] = Header(None)):
    return ai_sync_analysis(authorization, analysis_id, body)

@api_router.get("/import/ai-analyses")
async def import_ai_list(limit: int = 25, authorization: Optional[str] = Header(None)):
    return ai_list_analyses(authorization, limit=limit)

@api_router.post("/admin/plants/cleanup")
async def admin_plants_cleanup(body: CleanupPlantsRequest, authorization: Optional[str] = Header(None)):
    return cleanup_plants(authorization, names=body.names, reason=body.reason)

@api_router.get("/admin/audit-log")
async def admin_audit_log(kind: Optional[str] = None, limit: int = 100,
                           authorization: Optional[str] = Header(None)):
    return list_audit_log(authorization, kind=kind, limit=limit)

@api_router.get("/admin/migrations/status")
async def admin_migrations_status(authorization: Optional[str] = Header(None)):
    from migrations_status import list_migration_status
    return list_migration_status(authorization)

@api_router.post("/admin/migrations/{filename}/mark-applied")
async def admin_migrations_mark_applied(filename: str, body: Optional[MigrationMarkRequest] = None,
                                         authorization: Optional[str] = Header(None)):
    from migrations_status import mark_migration_applied
    return mark_migration_applied(authorization, filename, note=(body.note if body else None))

@api_router.delete("/admin/migrations/{filename}/mark-applied")
async def admin_migrations_unmark_applied(filename: str, authorization: Optional[str] = Header(None)):
    from migrations_status import unmark_migration_applied
    return unmark_migration_applied(authorization, filename)

@api_router.post("/admin/migrations/apply-history/import")
async def admin_migrations_import_history(body: MigrationHistoryImportRequest,
                                           authorization: Optional[str] = Header(None)):
    from migrations_status import import_apply_history
    return import_apply_history(authorization, body.model_dump(exclude_none=True), mode=body.mode or "fill_gaps")


# ── Cron ───────────────────────────────────────────────────────────────────────

@api_router.post("/cron/compliance-evaluate")
async def cron_compliance_evaluate(x_cron_secret: Optional[str] = Header(None)):
    verify_secret(x_cron_secret)
    try:
        return await run_compliance_evaluate(None)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("cron compliance failed"); raise HTTPException(500, str(e))

@api_router.post("/cron/pm-forecast-sweep")
async def cron_pm_forecast_sweep(x_cron_secret: Optional[str] = Header(None)):
    verify_secret(x_cron_secret)
    try:
        return await run_pm_forecast_sweep(None)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("cron pm sweep failed"); raise HTTPException(500, str(e))


# ── Operator switch ────────────────────────────────────────────────────────────

@api_router.post("/operator/switch-log")
async def operator_switch_log(body: OperatorSwitchLogRequest, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    db = supa()
    if db is None: raise HTTPException(503, "Supabase not configured")
    user_resp = db.auth.get_user(token)
    caller_id = user_resp.user.id if user_resp and user_resp.user else None
    if not caller_id: raise HTTPException(401, "Token validation failed")
    db.table("operator_switch_log").insert({
        "plant_id": body.plant_id, "from_operator_id": None, "to_operator_id": None,
        "switched_by": caller_id, "switched_at": datetime.utcnow().isoformat(),
    }).execute()
    return {"ok": True}


# ── Admin user creation ────────────────────────────────────────────────────────

def _make_admin_api():
    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise HTTPException(500, "SUPABASE_SERVICE_ROLE_KEY is not configured.")
    from gotrue import SyncGoTrueAdminAPI
    return SyncGoTrueAdminAPI(url=f"{url.rstrip('/')}/auth/v1",
                               headers={"Authorization": f"Bearer {service_key}"})

@api_router.post("/admin/users/create")
async def admin_create_user(body: AdminCreateUserRequest, authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    caller = caller_identity(token)
    require_roles(caller, {"Admin"})
    try:
        from gotrue.types import AdminUserAttributes
        auth_resp = _make_admin_api().create_user(
            AdminUserAttributes(email=body.email, password=body.password, email_confirm=True))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, getattr(e, "message", None) or str(e))
    uid = getattr(auth_resp.user, "id", None) if auth_resp and auth_resp.user else None
    if not uid: raise HTTPException(500, "Admin API returned no user ID.")
    svc = service_role_client()
    profile_data = {"username": body.username, "first_name": body.first_name,
        "middle_name": body.middle_name or None, "last_name": body.last_name,
        "suffix": body.suffix or None, "designation": body.designation or None,
        "profile_complete": True}
    try:
        res = svc.table("user_profiles").update(profile_data).eq("id", uid).execute()
    except Exception as e:
        raise HTTPException(500, f"Profile update failed: {e}")
    if not (res.data or []):
        try:
            svc.table("user_profiles").upsert({"id": uid, "status": "Pending",
                "plant_assignments": [], **profile_data}).execute()
        except Exception as e:
            raise HTTPException(500, f"Profile upsert failed: {e}")
    try:
        svc.table("user_roles").upsert({"user_id": uid, "role": "Operator"}).execute()
    except Exception as e:
        log.warning("role assignment failed: %s", e)
    return {"ok": True, "user_id": uid, "email": body.email, "username": body.username}


# ── Middleware & startup ───────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get(
        "CORS_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000,http://localhost:5173"
    ).split(","),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)

app.include_router(api_router)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
