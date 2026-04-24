from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Header
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime

from import_parser import parse_xlsx
from ai_service import (
    ChatRequest, AnomalyRequest,
    chat_turn, list_sessions, get_session, detect_anomalies,
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


@api_router.get("/ai/health")
async def ai_health():
    """Quick probe to verify EMERGENT_LLM_KEY is configured."""
    key_set = bool(os.environ.get("EMERGENT_LLM_KEY"))
    return {"ok": key_set, "model": "gpt-5.1", "provider": "openai"}


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
