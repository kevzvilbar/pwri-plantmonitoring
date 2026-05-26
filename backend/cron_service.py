"""cron_service.py — 100% Supabase, no MongoDB."""
from __future__ import annotations
import logging, os
from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import HTTPException
from supabase import create_client
from compliance_service import get_thresholds, evaluate, forecast_pm, PmForecastRequest

log = logging.getLogger(__name__)

def _svc():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    return create_client(url, key) if url and key else None

def verify_secret(secret: Optional[str]) -> None:
    want = os.environ.get("CRON_SECRET")
    if want and secret != want:
        raise HTTPException(status_code=401, detail="Invalid cron secret")

async def run_compliance_evaluate(db) -> dict[str, Any]:
    sb = _svc()
    if sb is None:
        raise HTTPException(500, "Supabase not configured")
    plants = sb.table("plants").select("id,name").execute().data or []
    results = []
    for p in plants:
        pid = p["id"]
        rows = (sb.table("daily_plant_summary").select("*").eq("plant_id", pid)
                .order("summary_date", desc=True).limit(1).execute().data or [])
        if not rows: continue
        latest = rows[0]
        t = await get_thresholds(None, pid)
        metrics = {k: latest.get(k) for k in ("nrw_pct","downtime_hrs","permeate_tds","permeate_ph","raw_turbidity","dp_psi","recovery_pct","pv_ratio")}
        violations = evaluate(t, metrics)
        snap = {"plant_id": pid, "evaluated_at": datetime.now(timezone.utc).isoformat(),
                "violations": [v.dict() for v in violations], "summary": None}
        try:
            sb.table("compliance_snapshots").insert(snap).execute()
        except Exception as e:
            log.warning("snapshot insert failed %s: %s", pid, e)
        snap.update({"plant_name": p["name"], "metrics": metrics, "thresholds": t.dict(), "violation_count": len(violations)})
        results.append(snap)
    return {"ok": True, "evaluated_at": datetime.now(timezone.utc).isoformat(), "plant_count": len(results), "results": results}

async def run_pm_forecast_sweep(db, limit: int = 50) -> dict[str, Any]:
    sb = _svc()
    if sb is None:
        raise HTTPException(500, "Supabase not configured")
    templates = (sb.table("checklist_templates").select("id,equipment_name,category,frequency,schedule_start_date,plant_id").execute().data or [])
    forecasts = []
    for tpl in templates[:limit]:
        req = PmForecastRequest(equipment_name=tpl.get("equipment_name") or "Unknown",
            category=tpl.get("category") or "General", frequency=tpl.get("frequency") or "Monthly",
            last_execution_date=tpl.get("schedule_start_date"))
        try:
            resp = await forecast_pm(req)
            doc = {"template_id": tpl["id"], "plant_id": tpl.get("plant_id"),
                   "equipment_name": req.equipment_name, "category": req.category,
                   "frequency": req.frequency, "recommended_next_date": resp.recommended_next_date,
                   "confidence": resp.confidence, "rationale": resp.rationale,
                   "risk_factors": resp.risk_factors, "generated_at": datetime.now(timezone.utc).isoformat()}
            try:
                sb.table("pm_forecasts").upsert(doc, on_conflict="template_id").execute()
            except Exception as e:
                log.warning("pm_forecasts upsert failed %s: %s", tpl["id"], e)
            forecasts.append(doc)
        except Exception as e:
            log.exception("pm forecast failed for %s", tpl.get("id"))
            forecasts.append({"template_id": tpl["id"], "error": str(e)})
    return {"ok": True, "finished_at": datetime.now(timezone.utc).isoformat(), "count": len(forecasts), "forecasts": forecasts}
