"""
Backend tests for iteration 4 review:
 - /api/ai/health (EMERGENT_LLM_KEY wired, model=gpt-5.1 openai)
 - /api/ai/chat  (emergentintegrations migration, replies non-empty)
 - /api/ai/anomalies (shape only, with empty/small readings)
 - /api/ai/sessions (list, no Mongo _id leak)
 - /api/admin/users & /api/admin/plants soft-delete/hard-delete/dependencies
   -> must require Authorization bearer token (401 without, 401 on malformed)
 - Regression: /api/, /api/compliance/thresholds, /api/downtime/events,
   /api/alerts/feed, /api/blending/wells
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://verify-error-ready.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- Regression: core endpoints still work -------------------

class TestRegressionCore:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_compliance_thresholds(self, api):
        r = api.get(f"{BASE_URL}/api/compliance/thresholds", timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("scope") == "global"
        assert isinstance(body.get("thresholds"), dict)

    def test_downtime_events(self, api):
        r = api.get(f"{BASE_URL}/api/downtime/events", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "events" in data and isinstance(data["events"], list)
        assert "count" in data

    def test_alerts_feed(self, api):
        r = api.get(f"{BASE_URL}/api/alerts/feed?days=7", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "alerts" in data and isinstance(data["alerts"], list)

    def test_blending_wells(self, api):
        r = api.get(f"{BASE_URL}/api/blending/wells", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "wells" in data and isinstance(data["wells"], list)


# ---------------- AI: EMERGENT_LLM_KEY migration --------------------------

class TestAiEndpoints:
    def test_ai_health_gpt51_openai(self, api):
        r = api.get(f"{BASE_URL}/api/ai/health", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data.get("ok") is True, data
        assert data.get("model") == "gpt-5.1"
        assert data.get("provider") == "openai"

    def test_ai_chat_returns_reply_and_session(self, api):
        payload = {"message": "ping"}
        r = api.post(f"{BASE_URL}/api/ai/chat", json=payload, timeout=120)
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        # Session id must be returned and reply non-empty.
        assert "session_id" in data and isinstance(data["session_id"], str)
        assert data["session_id"]
        assert "reply" in data and isinstance(data["reply"], str)
        assert len(data["reply"]) > 0, f"empty reply: {data}"

    def test_ai_anomalies_shape_empty(self, api):
        # Empty readings payload — endpoint must still return shape (not 500).
        r = api.post(
            f"{BASE_URL}/api/ai/anomalies",
            json={"readings": []},
            timeout=120,
        )
        assert r.status_code in (200, 400), r.text[:500]
        if r.status_code == 200:
            data = r.json()
            assert "anomalies" in data
            assert isinstance(data["anomalies"], list)

    def test_ai_anomalies_shape_small(self, api):
        # Minimal realistic payload
        r = api.post(
            f"{BASE_URL}/api/ai/anomalies",
            json={"readings": [
                {"well": "W1", "date": "2026-01-01",
                 "initial": 100.0, "final": 110.0, "status": "ok"},
                {"well": "W1", "date": "2026-01-02",
                 "initial": 110.0, "final": 109.0,
                 "status": "defective meter"},
            ]},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert "anomalies" in data and isinstance(data["anomalies"], list)

    def test_ai_sessions_list_no_mongo_id(self, api):
        r = api.get(f"{BASE_URL}/api/ai/sessions?limit=5", timeout=30)
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        # Accept either {"sessions": [...]} or bare list; both must not leak _id
        items = data.get("sessions") if isinstance(data, dict) else data
        assert isinstance(items, list)
        for s in items:
            assert "_id" not in s, f"Mongo _id leaked: {s}"


# ---------------- Admin: RBAC auth required -------------------------------

ADMIN_ROUTES_GET = [
    "/api/admin/users/00000000-0000-0000-0000-000000000000/dependencies",
    "/api/admin/plants/TEST_plant_xyz/dependencies",
]
ADMIN_ROUTES_POST = [
    "/api/admin/users/00000000-0000-0000-0000-000000000000/soft-delete",
    "/api/admin/plants/TEST_plant_xyz/soft-delete",
]
ADMIN_ROUTES_DELETE = [
    "/api/admin/users/00000000-0000-0000-0000-000000000000",
    "/api/admin/plants/TEST_plant_xyz",
]


class TestAdminAuthRequired:
    @pytest.mark.parametrize("path", ADMIN_ROUTES_GET)
    def test_get_requires_bearer(self, api, path):
        r = api.get(f"{BASE_URL}{path}", timeout=30)
        assert r.status_code == 401, (path, r.status_code, r.text[:300])
        assert "bearer" in r.text.lower() or "token" in r.text.lower() \
            or "auth" in r.text.lower()

    @pytest.mark.parametrize("path", ADMIN_ROUTES_POST)
    def test_post_requires_bearer(self, api, path):
        r = api.post(f"{BASE_URL}{path}", json={}, timeout=30)
        assert r.status_code == 401, (path, r.status_code, r.text[:300])

    @pytest.mark.parametrize("path", ADMIN_ROUTES_DELETE)
    def test_delete_requires_bearer(self, api, path):
        r = api.delete(f"{BASE_URL}{path}", timeout=30)
        assert r.status_code == 401, (path, r.status_code, r.text[:300])

    # Malformed bearer token must surface as auth error, NOT 500.
    @pytest.mark.parametrize("path", ADMIN_ROUTES_GET + ADMIN_ROUTES_POST)
    def test_malformed_bearer_rejected(self, api, path):
        headers = {"Authorization": "Bearer not-a-real-jwt"}
        method = api.get if path in ADMIN_ROUTES_GET else api.post
        kwargs = {"headers": headers, "timeout": 30}
        if method is api.post:
            kwargs["json"] = {}
        r = method(f"{BASE_URL}{path}", **kwargs)
        assert r.status_code in (401, 403), (
            path, r.status_code, r.text[:300],
        )
        assert r.status_code != 500, f"500 on malformed token: {r.text[:300]}"

    def test_missing_bearer_scheme(self, api):
        # Authorization present but without "Bearer " prefix
        r = api.post(
            f"{BASE_URL}/api/admin/users/"
            f"00000000-0000-0000-0000-000000000000/soft-delete",
            json={},
            headers={"Authorization": "some-random-string"},
            timeout=30,
        )
        assert r.status_code == 401, r.text[:300]


# ---------------- Iteration 5: audit-log endpoint + force param ----------

AUDIT_PATH = "/api/admin/audit-log"


class TestAuditLogEndpoint:
    """GET /api/admin/audit-log — Admin+Manager gated."""

    def test_audit_log_requires_bearer(self, api):
        r = api.get(f"{BASE_URL}{AUDIT_PATH}", timeout=30)
        assert r.status_code == 401, r.text[:300]
        # Must be clean JSON, not a stack trace
        body = r.text.lower()
        assert "traceback" not in body
        assert "bearer" in body or "token" in body or "auth" in body

    def test_audit_log_malformed_bearer_not_500(self, api):
        r = api.get(
            f"{BASE_URL}{AUDIT_PATH}",
            headers={"Authorization": "Bearer not-a-real-jwt"},
            timeout=30,
        )
        assert r.status_code in (401, 403), (r.status_code, r.text[:300])
        assert r.status_code != 500
        # Clean JSON body expected
        try:
            body = r.json()
            assert isinstance(body, dict)
            assert "detail" in body
        except ValueError:
            pytest.fail(f"Non-JSON error body: {r.text[:300]}")

    def test_audit_log_with_kind_filter_requires_bearer(self, api):
        r = api.get(f"{BASE_URL}{AUDIT_PATH}?kind=user&limit=10", timeout=30)
        assert r.status_code == 401, r.text[:300]

    def test_audit_log_no_auth_scheme(self, api):
        r = api.get(
            f"{BASE_URL}{AUDIT_PATH}",
            headers={"Authorization": "random-not-bearer"},
            timeout=30,
        )
        assert r.status_code == 401, r.text[:300]


class TestForceParamAuthGating:
    """DELETE with ?force=true still requires bearer auth (no 500)."""

    def test_hard_delete_user_force_requires_bearer(self, api):
        r = api.delete(
            f"{BASE_URL}/api/admin/users/"
            f"00000000-0000-0000-0000-000000000000?force=true",
            timeout=30,
        )
        assert r.status_code == 401, (r.status_code, r.text[:300])
        assert r.status_code != 500

    def test_hard_delete_user_force_with_reason_requires_bearer(self, api):
        r = api.delete(
            f"{BASE_URL}/api/admin/users/"
            f"00000000-0000-0000-0000-000000000000"
            f"?force=true&reason=cleanup",
            timeout=30,
        )
        assert r.status_code == 401, r.text[:300]

    def test_hard_delete_plant_force_requires_bearer(self, api):
        r = api.delete(
            f"{BASE_URL}/api/admin/plants/TEST_plant_xyz?force=true",
            timeout=30,
        )
        assert r.status_code == 401, r.text[:300]
        assert r.status_code != 500

    def test_hard_delete_user_force_malformed_bearer_not_500(self, api):
        r = api.delete(
            f"{BASE_URL}/api/admin/users/"
            f"00000000-0000-0000-0000-000000000000?force=true",
            headers={"Authorization": "Bearer not-a-real-jwt"},
            timeout=30,
        )
        assert r.status_code in (401, 403), (r.status_code, r.text[:300])
        assert r.status_code != 500

    def test_hard_delete_plant_force_malformed_bearer_not_500(self, api):
        r = api.delete(
            f"{BASE_URL}/api/admin/plants/TEST_plant_xyz?force=true",
            headers={"Authorization": "Bearer not-a-real-jwt"},
            timeout=30,
        )
        assert r.status_code in (401, 403), (r.status_code, r.text[:300])
        assert r.status_code != 500


class TestSoftDeleteJsonBody:
    """POST soft-delete accepts {reason:'...'} body and still requires bearer."""

    def test_user_soft_delete_with_reason_body_requires_bearer(self, api):
        r = api.post(
            f"{BASE_URL}/api/admin/users/"
            f"00000000-0000-0000-0000-000000000000/soft-delete",
            json={"reason": "resigned employee"},
            timeout=30,
        )
        assert r.status_code == 401, r.text[:300]

    def test_plant_soft_delete_with_reason_body_requires_bearer(self, api):
        r = api.post(
            f"{BASE_URL}/api/admin/plants/TEST_plant_xyz/soft-delete",
            json={"reason": "decommissioned"},
            timeout=30,
        )
        assert r.status_code == 401, r.text[:300]

    def test_user_soft_delete_empty_body_ok(self, api):
        # Body is Optional — endpoint must not 422 when body is omitted.
        # It should 401 first due to missing bearer.
        r = api.post(
            f"{BASE_URL}/api/admin/users/"
            f"00000000-0000-0000-0000-000000000000/soft-delete",
            timeout=30,
        )
        assert r.status_code == 401, (r.status_code, r.text[:300])
        assert r.status_code != 422, "Body should be optional"

    def test_plant_soft_delete_empty_body_ok(self, api):
        r = api.post(
            f"{BASE_URL}/api/admin/plants/TEST_plant_xyz/soft-delete",
            timeout=30,
        )
        assert r.status_code == 401, (r.status_code, r.text[:300])
        assert r.status_code != 422

    def test_user_soft_delete_malformed_bearer_with_body_not_500(self, api):
        r = api.post(
            f"{BASE_URL}/api/admin/users/"
            f"00000000-0000-0000-0000-000000000000/soft-delete",
            json={"reason": "bad actor"},
            headers={"Authorization": "Bearer not-a-real-jwt"},
            timeout=30,
        )
        assert r.status_code in (401, 403), (r.status_code, r.text[:300])
        assert r.status_code != 500


# ---------------- Iteration 5 regression: /api/cron/compliance-evaluate ---

class TestCronComplianceEvaluate:
    def test_cron_compliance_evaluate_returns_200(self, api):
        r = api.post(f"{BASE_URL}/api/cron/compliance-evaluate", timeout=60)
        # Endpoint is dev-mode open (no CRON_SECRET required by default).
        # If a secret is set, 401 is acceptable; the critical check is NOT 404.
        assert r.status_code != 404, (
            f"Route not registered! {r.status_code}: {r.text[:300]}"
        )
        assert r.status_code in (200, 401), (r.status_code, r.text[:300])
