"""
AI service for the PWRI monitoring app.

Provides:
  - /api/ai/chat      : multi-turn conversational Q&A (message history persisted in Mongo)
  - /api/ai/anomalies : stateless batch anomaly detection on a list of readings

Uses EMERGENT_LLM_KEY via the `emergentintegrations` library.
Default model: OpenAI gpt-5.1 (recommended per playbook) — overridable from frontend.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from emergentintegrations.llm.chat import LlmChat, UserMessage

log = logging.getLogger(__name__)

DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-5.1"

# --- System prompts -------------------------------------------------------

CHAT_SYSTEM = """You are the on-duty AI analyst for a water-treatment operations system (PWRI).

You help operators understand well/plant readings, meter statuses, NRW, downtime and
chemical consumption. You speak concisely, use plain language, and always ground answers
in the data snippets you are given.

When you receive a message that includes a JSON block prefixed with "DATA:", treat it as
ground truth for that turn and cite specific numbers. If a question cannot be answered from
the data provided, say so briefly and suggest what data would be needed.

Formatting rules:
 - Keep answers under ~150 words unless explicitly asked for more.
 - Use short bullet points for multi-fact answers.
 - When listing dates, always YYYY-MM-DD.
 - Never invent plant or well names that aren't in the data.
"""

ANOMALY_SYSTEM = """You are an anomaly-detection reviewer for water-plant meter readings.

You will be given a JSON list of daily readings for one or more wells. For each clearly
abnormal point (spike, drop, frozen value, repeated 'defective meter', 'shutoff'
cluster, Final<Initial, etc.), output a single entry.

Return STRICT JSON only, matching this schema:

{
  "anomalies": [
    {
      "well": "string",
      "date": "YYYY-MM-DD",
      "type": "spike|drop|frozen|defective_cluster|downtime_cluster|inconsistent|baseline_shift|other",
      "severity": "low|medium|high",
      "value": number | null,
      "baseline": number | null,
      "message": "one-sentence human description",
      "suggested_action": "one-sentence actionable recommendation"
    }
  ],
  "summary": "one-sentence overall assessment"
}

If nothing looks anomalous, return {"anomalies": [], "summary": "No anomalies detected."}.
Do not include any prose outside the JSON.
"""


# --- Pydantic request/response models --------------------------------------

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    # Optional data snippet to ground this turn (e.g. filtered readings)
    context: Optional[dict[str, Any]] = None


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    created_at: datetime


class AnomalyRequest(BaseModel):
    readings: list[dict[str, Any]] = Field(..., min_items=0, max_items=2000)
    provider: Optional[str] = None
    model: Optional[str] = None


class AnomalyResponse(BaseModel):
    anomalies: list[dict[str, Any]]
    summary: str


# --- Helpers ---------------------------------------------------------------

def _make_chat(session_id: str, system: str, provider: Optional[str], model: Optional[str]) -> LlmChat:
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise RuntimeError(
            "EMERGENT_LLM_KEY is not set on the backend. Add it to /app/backend/.env.",
        )
    p = (provider or DEFAULT_PROVIDER).lower()
    m = model or DEFAULT_MODEL
    chat = LlmChat(
        api_key=key,
        session_id=session_id,
        system_message=system,
    ).with_model(p, m)
    return chat


def _strip_code_fences(s: str) -> str:
    """LLMs sometimes wrap JSON in ```json ... ``` fences."""
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s)
    return s.strip()


def _safe_parse_json(s: str) -> dict[str, Any]:
    s = _strip_code_fences(s)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        # Try to grab first {...} block
        m = re.search(r"\{[\s\S]*\}", s)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        raise


# --- Public service methods ------------------------------------------------

async def chat_turn(
    db,
    user_id: Optional[str],
    req: ChatRequest,
) -> ChatResponse:
    """
    Persists the turn in `ai_conversations` (Mongo) and runs the model.

    Mongo doc shape:
      { _id (uuid), user_id, session_id, messages: [{role, content, created_at}], updated_at }
    """
    session_id = req.session_id or f"sess_{uuid.uuid4().hex[:12]}"

    # Restore persisted messages for the session so the model gets context,
    # BUT emergentintegrations LlmChat already persists history server-side per
    # session_id in its own store. We still keep our own Mongo copy for UI.
    now = datetime.utcnow()

    # Build the user payload: include optional data snippet for grounding
    user_text = req.message
    if req.context:
        try:
            ctx_json = json.dumps(req.context, default=str)[:8000]
            user_text = f"{req.message}\n\nDATA: {ctx_json}"
        except Exception:  # noqa: BLE001
            pass

    try:
        chat = _make_chat(session_id, CHAT_SYSTEM, req.provider, req.model)
        reply = await chat.send_message(UserMessage(text=user_text))
        if not isinstance(reply, str):
            reply = str(reply)
    except Exception as e:  # noqa: BLE001
        log.exception("chat_turn failed")
        raise RuntimeError(f"AI call failed: {e}") from e

    # Persist turn to Mongo (append to messages array, upsert session doc)
    try:
        await db.ai_conversations.update_one(
            {"session_id": session_id},
            {
                "$setOnInsert": {
                    "_id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "session_id": session_id,
                    "created_at": now,
                },
                "$set": {"updated_at": datetime.utcnow()},
                "$push": {
                    "messages": {
                        "$each": [
                            {"role": "user", "content": req.message, "created_at": now},
                            {"role": "assistant", "content": reply,
                             "created_at": datetime.utcnow()},
                        ]
                    }
                },
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        log.exception("Mongo persist failed (non-fatal)")

    return ChatResponse(session_id=session_id, reply=reply, created_at=datetime.utcnow())


async def list_sessions(db, user_id: Optional[str], limit: int = 20) -> list[dict[str, Any]]:
    q: dict[str, Any] = {}
    if user_id:
        q["user_id"] = user_id
    cursor = db.ai_conversations.find(
        q,
        {"session_id": 1, "updated_at": 1, "created_at": 1,
         "messages": {"$slice": -1}},  # last message only
    ).sort("updated_at", -1).limit(limit)
    out: list[dict[str, Any]] = []
    async for d in cursor:
        last_msg = (d.get("messages") or [{}])[-1].get("content", "")
        out.append({
            "session_id": d["session_id"],
            "updated_at": d.get("updated_at"),
            "preview": (last_msg or "")[:120],
        })
    return out


async def get_session(db, session_id: str) -> dict[str, Any]:
    doc = await db.ai_conversations.find_one({"session_id": session_id})
    if not doc:
        return {"session_id": session_id, "messages": []}
    return {
        "session_id": session_id,
        "messages": [
            {"role": m.get("role"), "content": m.get("content"),
             "created_at": m.get("created_at")}
            for m in (doc.get("messages") or [])
        ],
    }


async def detect_anomalies(req: AnomalyRequest) -> AnomalyResponse:
    """
    Send the readings payload to the model and ask for strict JSON anomaly output.
    Truncates large payloads to keep tokens in check.
    """
    payload = req.readings[:1500]
    if not payload:
        return AnomalyResponse(anomalies=[], summary="No readings supplied.")

    # Keep only the fields we care about to save tokens
    slim = []
    for r in payload:
        slim.append({k: r.get(k) for k in
                     ("well", "well_name", "date", "reading_datetime",
                      "initial", "final", "previous_reading", "current_reading",
                      "volume", "daily_volume", "status", "status_raw",
                      "flags", "off_location_flag") if k in r})

    # Fire a stateless single-turn session for JSON mode
    session_id = f"anom_{uuid.uuid4().hex[:10]}"
    chat = _make_chat(session_id, ANOMALY_SYSTEM, req.provider, req.model)

    user_text = (
        "Analyze the following readings and return STRICT JSON as specified.\n\n"
        "READINGS:\n" + json.dumps(slim, default=str)
    )
    raw = await chat.send_message(UserMessage(text=user_text))
    if not isinstance(raw, str):
        raw = str(raw)

    try:
        parsed = _safe_parse_json(raw)
    except json.JSONDecodeError:
        log.warning("Anomaly model returned unparseable JSON: %s", raw[:400])
        return AnomalyResponse(
            anomalies=[],
            summary="Model returned invalid JSON; no anomalies extracted.",
        )

    anomalies = parsed.get("anomalies", [])
    summary = parsed.get("summary", "") or "Analysis complete."
    if not isinstance(anomalies, list):
        anomalies = []
    # clamp to max 100 anomalies for UI
    return AnomalyResponse(anomalies=anomalies[:100], summary=str(summary)[:500])
