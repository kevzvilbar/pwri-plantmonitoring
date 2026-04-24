from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Header
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Any, List, Optional
import uuid
from datetime import datetime

from import_parser import parse_xlsx
from ai_service import (
    ChatRequest, AnomalyRequest,
    chat_turn, list_sessions, get_session, detect_anomalies,
)
from ai_tools import ChatWithToolsRequest, chat_with_tools
from compliance_service import (
    Thresholds, ViolationsPayload, EvaluateResult,
    PmForecastRequest,
    get_thresholds, save_thresholds, evaluate, make_summary, forecast_pm,
)
from seed_service import seed_from_urls
from cron_service import (
    verify_secret, run_compliance_evaluate, run_pm_forecast_sweep,
)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class StatusCheckCreate(BaseModel):
    client_name: str


# --- Routes ----------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "Hello World"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


# ---- XLSX import ---------------------------------------------------------

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


@api_router.post("/import/parse-wellmeter")
async def parse_wellmeter(file: UploadFile = File(...)):
    """
    Accept an uploaded XLSX file with well/meter readings.
    Returns a structured preview with detected statuses and flags.
    Does NOT persist anything — the frontend commits rows into Supabase.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file")
    fname = file.filename.lower()
    if not (fname.endswith(".xlsx") or fname.endswith(".xlsm")):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xlsm supported")

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (>10MB)")

    try:
        result = parse_xlsx(data)
    except Exception as e:  # noqa: BLE001
        logging.exception("parse_xlsx failed")
        raise HTTPException(status_code=400, detail=f"Failed to parse: {e}")

    return JSONResponse(result)


# ---- AI assistant --------------------------------------------------------

@api_router.post("/ai/chat")
async def ai_chat(req: ChatRequest, x_user_id: Optional[str] = Header(None)):
    try:
        resp = await chat_turn(db, x_user_id, req)
        return resp
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logging.exception("ai_chat failed")
        raise HTTPException(status_code=500, detail=f"Unexpected: {e}")


@api_router.get("/ai/sessions")
async def ai_list_sessions(
    x_user_id: Optional[str] = Header(None),
    limit: int = 20,
):
    return await list_sessions(db, x_user_id, limit=max(1, min(limit, 100)))


@api_router.get("/ai/sessions/{session_id}")
async def ai_get_session(session_id: str):
    return await get_session(db, session_id)


@api_router.delete("/ai/sessions/{session_id}")
async def ai_delete_session(session_id: str):
    await db.ai_conversations.delete_one({"session_id": session_id})
    return {"ok": True, "session_id": session_id}


@api_router.post("/ai/anomalies")
async def ai_anomalies(req: AnomalyRequest):
    try:
        return await detect_anomalies(req)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logging.exception("ai_anomalies failed")
        raise HTTPException(status_code=500, detail=f"Unexpected: {e}")


@api_router.post("/ai/chat-tools")
async def ai_chat_tools(req: ChatWithToolsRequest, x_user_id: Optional[str] = Header(None)):
    """AI chat that can query Supabase via a constrained planner."""
    try:
        return await chat_with_tools(db, x_user_id, req)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logging.exception("ai_chat_tools failed")
        raise HTTPException(status_code=500, detail=f"Unexpected: {e}")


@api_router.get("/ai/health")
async def ai_health():
    """Quick probe to verify EMERGENT_LLM_KEY is configured."""
    key_set = bool(os.environ.get("EMERGENT_LLM_KEY"))
    return {"ok": key_set, "model": "gpt-5.1", "provider": "openai"}


# ---- Compliance ----------------------------------------------------------

@api_router.get("/compliance/thresholds")
async def get_compliance_thresholds(scope: str = "global"):
    t = await get_thresholds(db, scope)
    return {"scope": scope, "thresholds": t.dict()}


@api_router.put("/compliance/thresholds")
async def put_compliance_thresholds(body: dict):
    scope = str(body.get("scope") or "global")
    raw = body.get("thresholds") or {}
    try:
        t = Thresholds(**raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid thresholds: {e}")
    doc = await save_thresholds(db, scope, t)
    return {"scope": doc.scope, "thresholds": doc.thresholds.dict(),
            "updated_at": doc.updated_at.isoformat()}


@api_router.post("/compliance/evaluate")
async def compliance_evaluate(body: ViolationsPayload, summarize: bool = False):
    scope = body.plant_id or "global"
    t = await get_thresholds(db, scope)
    violations = evaluate(t, body.metrics)
    result: dict[str, Any] = {
        "scope": scope,
        "scope_label": body.scope_label,
        "evaluated_at": datetime.utcnow().isoformat(),
        "violations": [v.dict() for v in violations],
        "thresholds": t.dict(),
    }
    if summarize:
        try:
            result["summary"] = await make_summary(
                violations, body.metrics, body.scope_label or scope,
            )
        except Exception as e:  # noqa: BLE001
            logging.exception("compliance summary failed")
            result["summary_error"] = str(e)
    return result


# ---- Predictive PM -------------------------------------------------------

@api_router.post("/ai/pm-forecast")
async def ai_pm_forecast(req: PmForecastRequest):
    try:
        resp = await forecast_pm(req)
        return resp
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logging.exception("pm_forecast failed")
        raise HTTPException(status_code=500, detail=f"Unexpected: {e}")


# ---- XLSX seeding (bulk ingest from URLs) --------------------------------

class SeedTarget(BaseModel):
    plant_name: str
    url: str
    source: str = "auto"  # 'auto' | 'meter' | 'downtime'


class SeedRequest(BaseModel):
    targets: List[SeedTarget]
    include_defective: bool = False
    downtime_as_zero: bool = True


@api_router.post("/import/seed-from-url")
async def import_seed_from_url(
    body: SeedRequest,
    authorization: Optional[str] = Header(None),
):
    """Download one or more XLSX files from public URLs and upsert them
    into Supabase + Mongo. Pass the user's Supabase JWT via the
    `Authorization: Bearer <jwt>` header so RLS policies apply under
    their identity.
    """
    if not body.targets:
        raise HTTPException(status_code=400, detail="No targets supplied")
    token: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip() or None
    try:
        report = await seed_from_urls(
            db,
            [t.dict() for t in body.targets],
            include_defective=body.include_defective,
            downtime_as_zero=body.downtime_as_zero,
            access_token=token,
        )
        return report
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logging.exception("seed_from_urls failed")
        raise HTTPException(status_code=500, detail=f"Seed failed: {e}")


# ---- Downtime events (dashboard list) ------------------------------------

@api_router.get("/downtime/events")
async def downtime_events(
    plant_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 500,
):
    q: dict[str, Any] = {}
    if plant_id:
        q["plant_id"] = plant_id
    if date_from or date_to:
        r: dict[str, Any] = {}
        if date_from:
            r["$gte"] = date_from
        if date_to:
            r["$lte"] = date_to
        q["event_date"] = r
    cursor = (db.downtime_events.find(q, {"_id": 0})
              .sort("event_date", -1)
              .limit(max(1, min(limit, 2000))))
    docs: list[dict[str, Any]] = [d async for d in cursor]
    # summary
    total_hours = sum(float(d.get("duration_hrs") or 0) for d in docs)
    by_sub: dict[str, float] = {}
    for d in docs:
        sub = d.get("subsystem") or "Plant"
        by_sub[sub] = by_sub.get(sub, 0.0) + float(d.get("duration_hrs") or 0)
    return {
        "count": len(docs),
        "total_duration_hrs": round(total_hours, 2),
        "by_subsystem": [{"subsystem": k, "hours": round(v, 2)} for k, v in
                          sorted(by_sub.items(), key=lambda x: -x[1])],
        "events": docs,
    }


# ---- Serverless-friendly cron endpoints ----------------------------------

@api_router.post("/cron/compliance-evaluate")
async def cron_compliance_evaluate(x_cron_secret: Optional[str] = Header(None)):
    verify_secret(x_cron_secret)
    try:
        return await run_compliance_evaluate(db)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logging.exception("cron compliance failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/cron/pm-forecast-sweep")
async def cron_pm_forecast_sweep(x_cron_secret: Optional[str] = Header(None)):
    verify_secret(x_cron_secret)
    try:
        return await run_pm_forecast_sweep(db)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logging.exception("cron pm sweep failed")
        raise HTTPException(status_code=500, detail=str(e))


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
