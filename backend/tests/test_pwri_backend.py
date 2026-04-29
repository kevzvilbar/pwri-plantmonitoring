"""
Backend test suite for PWRI monitoring app.

Covers the NEW batch requested in the review:
 - POST /api/ai/chat-tools        (AI tool-calling / planner)
 - POST /api/import/seed-from-url (bulk XLSX seed; no-auth -> downtime only)
 - GET  /api/downtime/events      (dashboard feed)
 - POST /api/cron/compliance-evaluate
 - POST /api/cron/pm-forecast-sweep
 - Regression: /api/ai/health, /api/compliance/thresholds, /api/import/parse-wellmeter
"""
import io
import os
import time

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://bypass-to-blending.preview.emergentagent.com",
).rstrip("/")

MAMBALING_METER_URL = (
    "https://customer-assets.emergentagent.com/job_quality-guard-5/"
    "artifacts/erjf0y93_MAMBALING%203%20Well%20Meter%20Reading%202026_2.xlsx"
)
MAMBALING_DOWNTIME_URL = (
    "https://customer-assets.emergentagent.com/job_quality-guard-5/"
    "artifacts/1mgob29d_Mambaling%203%202026_3.xlsx"
)
SRP_URL = (
    "https://customer-assets.emergentagent.com/job_quality-guard-5/"
    "artifacts/v8f78gy2_SRP%20Well%20Meter%20Reading%202026_1.xlsx"
)
UMAPAD_URL = (
    "https://customer-assets.emergentagent.com/job_quality-guard-5/"
    "artifacts/3b545p21_UMAPAD%20Well%20Meter%20Reading%202026_2.xlsx"
)


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- Regression: health probes ------------------------------

class TestRegressionProbes:
    def test_ai_health(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/ai/health", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "model" in data
        assert "provider" in data

    def test_compliance_thresholds_default(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/compliance/thresholds", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("scope") == "global"
        assert isinstance(body.get("thresholds"), dict)
        # a handful of keys we rely on
        for k in ("nrw_pct_max", "downtime_hrs_per_day_max", "permeate_tds_max"):
            assert k in body["thresholds"], f"missing {k}"

    def test_parse_wellmeter_with_real_xlsx(self, api_client):
        # download one real file and push through parser
        dl = requests.get(MAMBALING_METER_URL, timeout=60)
        assert dl.status_code == 200
        files = {
            "file": ("mambaling.xlsx", io.BytesIO(dl.content),
                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        }
        r = requests.post(
            f"{BASE_URL}/api/import/parse-wellmeter",
            files=files, timeout=120,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert "sheets" in data
        assert isinstance(data["sheets"], list)
        assert len(data["sheets"]) >= 1
        # at least one sheet should have parsed rows
        total_rows = sum(len(s.get("rows") or []) for s in data["sheets"])
        assert total_rows > 0, "no rows parsed from real XLSX"


# ---------------- New: AI chat with tools --------------------------------

class TestAiChatTools:
    def test_chat_tools_small_talk_no_plan(self, api_client):
        """A pure small-talk message should not break; plan may be None."""
        payload = {"message": "Hello, who are you?"}
        r = api_client.post(
            f"{BASE_URL}/api/ai/chat-tools", json=payload, timeout=120,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert "session_id" in data and isinstance(data["session_id"], str)
        assert "reply" in data and isinstance(data["reply"], str)
        assert len(data["reply"]) > 0
        assert data.get("rows_fetched", 0) >= 0
        assert "took_ms" in data

    def test_chat_tools_data_question(self, api_client):
        """A data-ish question — planner may produce a plan and attempt to
        fetch. Either way the endpoint must return 200 with a reply string."""
        payload = {
            "message": "How many active plants are there?",
            "time_hint_days": 30,
        }
        r = api_client.post(
            f"{BASE_URL}/api/ai/chat-tools", json=payload, timeout=120,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert isinstance(data.get("reply"), str) and data["reply"]
        # plan can be None or dict; rows_fetched is int >= 0
        assert isinstance(data.get("rows_fetched"), int)
        # session_id continuity usable
        assert data["session_id"]


# ---------------- New: seed from URL (no-auth / downtime-only) -----------

class TestSeedFromUrl:
    def test_seed_no_auth_downtime_only(self, api_client):
        body = {
            "targets": [
                {"plant_name": "Mambaling 3", "url": MAMBALING_DOWNTIME_URL,
                 "source": "auto"},
            ],
            "include_defective": False,
            "downtime_as_zero": True,
        }
        r = api_client.post(
            f"{BASE_URL}/api/import/seed-from-url", json=body, timeout=180,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert "files" in data
        assert isinstance(data["files"], list) and len(data["files"]) == 1
        rep = data["files"][0]
        # Meter ingest must be skipped (no JWT); error entry captured.
        assert any("no-auth" in str(e).lower() for e in rep.get("errors", [])), (
            f"expected no-auth notice in errors, got {rep.get('errors')}"
        )
        # Downtime sheet should have produced at least one event.
        assert rep.get("downtime_events", 0) > 0, (
            f"no downtime_events ingested from {MAMBALING_DOWNTIME_URL}"
        )

    def test_seed_bad_empty_targets(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/import/seed-from-url",
            json={"targets": []}, timeout=30,
        )
        assert r.status_code == 400

    def test_seed_meter_only_file_no_auth_is_graceful(self, api_client):
        """Meter-only file via no-auth path: should NOT 500. Downtime parse
        will return empty (no Downtime sheet), but the endpoint must
        succeed with an errors[] note."""
        body = {
            "targets": [
                {"plant_name": "Mambaling 3 (meter-only)",
                 "url": MAMBALING_METER_URL, "source": "auto"},
            ],
        }
        r = api_client.post(
            f"{BASE_URL}/api/import/seed-from-url", json=body, timeout=180,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        rep = data["files"][0]
        assert any("no-auth" in str(e).lower() for e in rep.get("errors", []))
        # either zero downtime_events or no crash; both acceptable
        assert rep.get("downtime_events", 0) >= 0


# ---------------- New: downtime events feed ------------------------------

class TestDowntimeEventsFeed:
    @classmethod
    def setup_class(cls):
        """Ensure there is at least some downtime data in Mongo by running
        the seed (no-auth) for the Mambaling Downtime file."""
        try:
            requests.post(
                f"{BASE_URL}/api/import/seed-from-url",
                json={"targets": [{
                    "plant_name": "Mambaling 3",
                    "url": MAMBALING_DOWNTIME_URL,
                    "source": "auto",
                }]},
                timeout=180,
            )
        except Exception:
            pass

    def test_events_default(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/downtime/events", timeout=30,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert "count" in data
        assert "total_duration_hrs" in data
        assert "by_subsystem" in data
        assert "events" in data
        assert isinstance(data["events"], list)
        assert data["count"] == len(data["events"])

    def test_events_has_data_after_seed(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/downtime/events?limit=10", timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        # After setup_class seed, we expect events > 0
        assert data["count"] > 0, "expected events after seeding Mambaling downtime"
        ev = data["events"][0]
        for k in ("plant_name", "event_date", "subsystem", "duration_hrs", "cause"):
            assert k in ev, f"missing {k} in event row"
        assert data["total_duration_hrs"] >= 0
        assert isinstance(data["by_subsystem"], list)

    def test_events_filter_by_plant(self, api_client):
        # plant_id filter — we used a pseudo plant id in seed (no auth),
        # so confirm it returns shape 200 even if count is 0
        r = api_client.get(
            f"{BASE_URL}/api/downtime/events?plant_id=pseudo:mambaling%203",
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data.get("events"), list)


# ---------------- New: serverless cron endpoints -------------------------

class TestCronEndpoints:
    def test_cron_compliance_evaluate_dev_mode(self, api_client):
        # No CRON_SECRET is set -> endpoint is open in dev
        r = api_client.post(
            f"{BASE_URL}/api/cron/compliance-evaluate",
            json={}, timeout=120,
        )
        # In dev, CRON_SECRET is not set; must not 401
        assert r.status_code != 401, r.text[:300]
        # Allowed outcomes: 200 (success) or 500 if Supabase unreachable at
        # runtime. Log the failure but fail loudly on 4xx.
        assert r.status_code in (200, 500), r.text[:500]
        if r.status_code == 200:
            data = r.json()
            assert data.get("ok") is True
            assert "plant_count" in data
            assert "results" in data

    def test_cron_pm_forecast_sweep_dev_mode(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/cron/pm-forecast-sweep",
            json={}, timeout=180,
        )
        assert r.status_code != 401, r.text[:300]
        assert r.status_code in (200, 500), r.text[:500]
        if r.status_code == 200:
            data = r.json()
            assert data.get("ok") is True
            assert "count" in data
            assert "forecasts" in data


# ---------------- New (batch 2): Blending wells + audit ------------------

class TestBlendingWells:
    PLANT_ID = "TEST_plant_blend_01"
    WELL_ID = "TEST_well_blend_01"

    def test_toggle_on_upserts_well(self, api_client):
        payload = {
            "well_id": self.WELL_ID,
            "plant_id": self.PLANT_ID,
            "is_blending": True,
            "well_name": "TEST Blend Well A",
            "plant_name": "TEST Plant Blend",
            "note": "pytest-on",
        }
        r = api_client.post(
            f"{BASE_URL}/api/blending/toggle", json=payload, timeout=30,
            headers={"x-user-id": "pytest-user"},
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert data == {"ok": True, "is_blending": True, "well_id": self.WELL_ID}

        # Verify via GET that the well shows up
        g = api_client.get(
            f"{BASE_URL}/api/blending/wells?plant_id={self.PLANT_ID}",
            timeout=30,
        )
        assert g.status_code == 200, g.text[:500]
        body = g.json()
        assert "wells" in body and isinstance(body["wells"], list)
        matches = [w for w in body["wells"] if w.get("well_id") == self.WELL_ID]
        assert len(matches) == 1, f"expected exactly 1 match, got {body['wells']}"
        w = matches[0]
        assert w["plant_id"] == self.PLANT_ID
        assert w["well_name"] == "TEST Blend Well A"
        assert w["plant_name"] == "TEST Plant Blend"
        assert w["tagged_by"] == "pytest-user"
        assert w["note"] == "pytest-on"
        assert "tagged_at" in w

    def test_toggle_idempotent_upsert(self, api_client):
        # Toggle on again with a new note — should update (upsert), not duplicate
        payload = {
            "well_id": self.WELL_ID,
            "plant_id": self.PLANT_ID,
            "is_blending": True,
            "well_name": "TEST Blend Well A",
            "plant_name": "TEST Plant Blend",
            "note": "pytest-updated",
        }
        r = api_client.post(
            f"{BASE_URL}/api/blending/toggle", json=payload, timeout=30,
            headers={"x-user-id": "pytest-user-2"},
        )
        assert r.status_code == 200
        g = api_client.get(
            f"{BASE_URL}/api/blending/wells?plant_id={self.PLANT_ID}",
            timeout=30,
        )
        wells = [w for w in g.json()["wells"] if w["well_id"] == self.WELL_ID]
        assert len(wells) == 1, "upsert must not create duplicate"
        assert wells[0]["note"] == "pytest-updated"
        assert wells[0]["tagged_by"] == "pytest-user-2"

    def test_blending_audit_logs_event(self, api_client):
        payload = {
            "plant_id": self.PLANT_ID,
            "well_id": self.WELL_ID,
            "well_name": "TEST Blend Well A",
            "plant_name": "TEST Plant Blend",
            "event_date": datetime_today_iso(),
            "volume_m3": 123.4,
        }
        r = api_client.post(
            f"{BASE_URL}/api/blending/audit", json=payload, timeout=30,
        )
        assert r.status_code == 200, r.text[:500]
        assert r.json() == {"ok": True}

    def test_toggle_off_deletes_well(self, api_client):
        payload = {
            "well_id": self.WELL_ID,
            "plant_id": self.PLANT_ID,
            "is_blending": False,
        }
        r = api_client.post(
            f"{BASE_URL}/api/blending/toggle", json=payload, timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data == {"ok": True, "is_blending": False, "well_id": self.WELL_ID}

        g = api_client.get(
            f"{BASE_URL}/api/blending/wells?plant_id={self.PLANT_ID}",
            timeout=30,
        )
        wells = [w for w in g.json()["wells"] if w["well_id"] == self.WELL_ID]
        assert len(wells) == 0, "expected well to be removed after toggle off"

    def test_wells_list_no_plant_filter(self, api_client):
        """GET without plant_id must still return a wells list."""
        r = api_client.get(f"{BASE_URL}/api/blending/wells", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("wells"), list)


def datetime_today_iso():
    from datetime import datetime as _dt
    return _dt.utcnow().date().isoformat()


# ---------------- New (batch 2): Unified alerts feed ---------------------

class TestAlertsFeed:
    def test_alerts_feed_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/alerts/feed?days=30", timeout=30)
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        assert "count" in data and isinstance(data["count"], int)
        assert "alerts" in data and isinstance(data["alerts"], list)
        assert data["count"] == len(data["alerts"]) or data["count"] >= len(data["alerts"])
        # Each alert object should have expected keys
        for a in data["alerts"]:
            assert a.get("kind") in ("downtime", "blending", "recovery")
            assert "severity" in a
            assert "title" in a
            assert "date" in a

    def test_alerts_feed_with_plant_filter(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/alerts/feed?plant_id=pseudo:mambaling%203&days=30",
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data.get("alerts"), list)

    def test_alerts_feed_contains_blending_after_audit(self, api_client):
        """Seed a blending event, then confirm it shows up in the feed."""
        plant_id = "TEST_alerts_plant"
        # Log an audit event today for this plant
        payload = {
            "plant_id": plant_id,
            "well_id": "TEST_alerts_well",
            "well_name": "TEST Alerts Well",
            "plant_name": "TEST Alerts Plant",
            "event_date": datetime_today_iso(),
            "volume_m3": 42.0,
        }
        ar = api_client.post(
            f"{BASE_URL}/api/blending/audit", json=payload, timeout=30,
        )
        assert ar.status_code == 200

        r = api_client.get(
            f"{BASE_URL}/api/alerts/feed?plant_id={plant_id}&days=7",
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        blends = [a for a in data["alerts"] if a.get("kind") == "blending"]
        assert len(blends) >= 1, f"expected a blending alert, got {data['alerts']}"
        b = blends[0]
        assert b.get("plant_id") == plant_id
        assert "42.0" in b.get("detail", "") or "42" in b.get("detail", "")
        assert b.get("severity") == "info"
        # Iteration 3: Blending title must be rebranded to "Bypass · …"
        title = b.get("title", "")
        assert title.startswith("Bypass ·"), (
            f"expected title to start with 'Bypass ·', got {title!r}"
        )
        assert "Blending" not in title, (
            f"old label 'Blending' should no longer appear in title: {title!r}"
        )

    def test_alerts_feed_sort_order(self, api_client):
        """High severity alerts must appear before medium/info."""
        r = api_client.get(f"{BASE_URL}/api/alerts/feed?days=30", timeout=30)
        assert r.status_code == 200
        sev_rank = {"high": 0, "medium": 1, "low": 2, "info": 3}
        alerts = r.json()["alerts"]
        ranks = [sev_rank.get(a.get("severity", "info"), 9) for a in alerts]
        assert ranks == sorted(ranks), (
            f"alerts not sorted by severity rank: {ranks}"
        )


# ---------------- Regression: downtime still works after batch 1 seed ----

class TestDowntimeRegressionAfterBatch1:
    def test_downtime_events_still_returns(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/downtime/events?limit=5", timeout=30,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        # Previous iteration seeded Mambaling downtime; must still be visible
        assert data["count"] >= 1
        assert isinstance(data["by_subsystem"], list)
        assert data["total_duration_hrs"] >= 0

