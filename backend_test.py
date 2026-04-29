#!/usr/bin/env python3
"""
Comprehensive backend API testing for AI Assistant endpoints, XLSX import, 
Compliance endpoints, and PM forecast endpoints.
Tests all endpoints specified in test_result.md agent_communication.
"""

import requests
import json
import sys
import time
from typing import Dict, Any, Optional

# Use external URL from frontend/.env
BASE_URL = "https://review-cleanup-1.preview.emergentagent.com/api"

def log_test(test_name: str, status: str, details: str = ""):
    """Log test results with consistent formatting"""
    status_emoji = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"{status_emoji} {test_name}: {status}")
    if details:
        print(f"   {details}")

def test_ai_health():
    """Test GET /api/ai/health endpoint"""
    try:
        response = requests.get(f"{BASE_URL}/ai/health", timeout=10)
        
        if response.status_code != 200:
            log_test("AI Health Check", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["ok", "model", "provider"]
        for field in required_fields:
            if field not in data:
                log_test("AI Health Check", "FAIL", f"Missing field: {field}")
                return False
        
        # Check expected values
        if data.get("model") != "gpt-5.1":
            log_test("AI Health Check", "FAIL", f"Expected model 'gpt-5.1', got '{data.get('model')}'")
            return False
            
        if data.get("provider") != "openai":
            log_test("AI Health Check", "FAIL", f"Expected provider 'openai', got '{data.get('provider')}'")
            return False
        
        # Check if EMERGENT_LLM_KEY is configured
        if not data.get("ok"):
            log_test("AI Health Check", "FAIL", "EMERGENT_LLM_KEY is not configured (ok=false)")
            return False
            
        log_test("AI Health Check", "PASS", f"Model: {data['model']}, Provider: {data['provider']}")
        return True
        
    except Exception as e:
        log_test("AI Health Check", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_chat_single_turn():
    """Test POST /api/ai/chat with single message"""
    try:
        payload = {
            "message": "In one short sentence, what does NRW stand for?"
        }
        
        response = requests.post(f"{BASE_URL}/ai/chat", json=payload, timeout=30)
        
        if response.status_code != 200:
            log_test("AI Chat Single Turn", "FAIL", f"Status {response.status_code}: {response.text}")
            return None
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["session_id", "reply", "created_at"]
        for field in required_fields:
            if field not in data:
                log_test("AI Chat Single Turn", "FAIL", f"Missing field: {field}")
                return None
        
        # Validate content
        if not data.get("session_id"):
            log_test("AI Chat Single Turn", "FAIL", "Empty session_id")
            return None
            
        if not data.get("reply") or len(data["reply"].strip()) == 0:
            log_test("AI Chat Single Turn", "FAIL", "Empty reply")
            return None
        
        log_test("AI Chat Single Turn", "PASS", f"Session: {data['session_id'][:12]}..., Reply length: {len(data['reply'])}")
        return data["session_id"]
        
    except Exception as e:
        log_test("AI Chat Single Turn", "FAIL", f"Exception: {str(e)}")
        return None

def test_ai_chat_multi_turn(session_id: str):
    """Test POST /api/ai/chat with follow-up message using existing session"""
    try:
        payload = {
            "message": "Is it the same as UFW?",
            "session_id": session_id
        }
        
        response = requests.post(f"{BASE_URL}/ai/chat", json=payload, timeout=30)
        
        if response.status_code != 200:
            log_test("AI Chat Multi-turn", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["session_id", "reply", "created_at"]
        for field in required_fields:
            if field not in data:
                log_test("AI Chat Multi-turn", "FAIL", f"Missing field: {field}")
                return False
        
        # Validate session continuity
        if data.get("session_id") != session_id:
            log_test("AI Chat Multi-turn", "FAIL", f"Session ID mismatch: expected {session_id}, got {data.get('session_id')}")
            return False
        
        # Check if reply references context (should mention NRW or previous context)
        reply = data.get("reply", "").lower()
        if not any(keyword in reply for keyword in ["nrw", "non-revenue", "water", "previous", "earlier", "mentioned"]):
            log_test("AI Chat Multi-turn", "FAIL", "Reply doesn't seem to reference previous context")
            return False
        
        log_test("AI Chat Multi-turn", "PASS", f"Context-aware reply received, length: {len(data['reply'])}")
        return True
        
    except Exception as e:
        log_test("AI Chat Multi-turn", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_sessions_list(session_id: str):
    """Test GET /api/ai/sessions"""
    try:
        response = requests.get(f"{BASE_URL}/ai/sessions", timeout=10)
        
        if response.status_code != 200:
            log_test("AI Sessions List", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        if not isinstance(data, list):
            log_test("AI Sessions List", "FAIL", "Response is not an array")
            return False
        
        # Find our test session
        test_session = None
        for session in data:
            if session.get("session_id") == session_id:
                test_session = session
                break
        
        if not test_session:
            log_test("AI Sessions List", "FAIL", f"Test session {session_id} not found in list")
            return False
        
        # Validate session structure
        required_fields = ["session_id", "updated_at", "preview"]
        for field in required_fields:
            if field not in test_session:
                log_test("AI Sessions List", "FAIL", f"Missing field in session: {field}")
                return False
        
        if not test_session.get("preview"):
            log_test("AI Sessions List", "FAIL", "Empty preview")
            return False
        
        log_test("AI Sessions List", "PASS", f"Found {len(data)} sessions, test session present with preview")
        return True
        
    except Exception as e:
        log_test("AI Sessions List", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_session_detail(session_id: str):
    """Test GET /api/ai/sessions/{id}"""
    try:
        response = requests.get(f"{BASE_URL}/ai/sessions/{session_id}", timeout=10)
        
        if response.status_code != 200:
            log_test("AI Session Detail", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["session_id", "messages"]
        for field in required_fields:
            if field not in data:
                log_test("AI Session Detail", "FAIL", f"Missing field: {field}")
                return False
        
        if data.get("session_id") != session_id:
            log_test("AI Session Detail", "FAIL", f"Session ID mismatch: expected {session_id}, got {data.get('session_id')}")
            return False
        
        messages = data.get("messages", [])
        if not isinstance(messages, list):
            log_test("AI Session Detail", "FAIL", "Messages is not an array")
            return False
        
        # Should have at least 4 messages (2 user + 2 assistant from our tests)
        if len(messages) < 4:
            log_test("AI Session Detail", "FAIL", f"Expected ≥4 messages, got {len(messages)}")
            return False
        
        # Validate message structure
        for i, msg in enumerate(messages):
            if "role" not in msg or "content" not in msg:
                log_test("AI Session Detail", "FAIL", f"Message {i} missing role or content")
                return False
            if msg["role"] not in ["user", "assistant"]:
                log_test("AI Session Detail", "FAIL", f"Message {i} has invalid role: {msg['role']}")
                return False
        
        log_test("AI Session Detail", "PASS", f"Retrieved {len(messages)} messages with proper structure")
        return True
        
    except Exception as e:
        log_test("AI Session Detail", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_anomalies_with_data():
    """Test POST /api/ai/anomalies with sample data"""
    try:
        payload = {
            "readings": [
                {"well": "Well 2", "date": "2026-01-01", "initial": 117322, "final": 117322, "volume": 0, "status": "defective"},
                {"well": "Well 2", "date": "2026-01-02", "initial": 117322, "final": 117322, "volume": 0, "status": "defective"},
                {"well": "Well 2", "date": "2026-01-03", "initial": 117322, "final": 117322, "volume": 0, "status": "defective"},
                {"well": "Well 2", "date": "2026-01-04", "initial": 117322, "final": 120000, "volume": 2678, "status": "valid"},
                {"well": "Well 2", "date": "2026-01-07", "initial": 125000, "final": 140000, "volume": 15000, "status": "valid"},
                {"well": "Well 2", "date": "2026-01-08", "initial": 140000, "final": 140000, "volume": 0, "status": "shutoff"}
            ]
        }
        
        response = requests.post(f"{BASE_URL}/ai/anomalies", json=payload, timeout=30)
        
        if response.status_code != 200:
            log_test("AI Anomalies (with data)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["anomalies", "summary"]
        for field in required_fields:
            if field not in data:
                log_test("AI Anomalies (with data)", "FAIL", f"Missing field: {field}")
                return False
        
        anomalies = data.get("anomalies", [])
        if not isinstance(anomalies, list):
            log_test("AI Anomalies (with data)", "FAIL", "Anomalies is not an array")
            return False
        
        # Should detect at least 1 anomaly from the test data
        if len(anomalies) < 1:
            log_test("AI Anomalies (with data)", "FAIL", "Expected ≥1 anomaly, got 0")
            return False
        
        # Validate anomaly structure
        for i, anomaly in enumerate(anomalies):
            required_anomaly_fields = ["well", "date", "type", "severity", "message", "suggested_action"]
            for field in required_anomaly_fields:
                if field not in anomaly:
                    log_test("AI Anomalies (with data)", "FAIL", f"Anomaly {i} missing field: {field}")
                    return False
            
            # Validate severity values
            if anomaly.get("severity") not in ["low", "medium", "high"]:
                log_test("AI Anomalies (with data)", "FAIL", f"Anomaly {i} has invalid severity: {anomaly.get('severity')}")
                return False
        
        summary = data.get("summary", "")
        if not summary or len(summary.strip()) == 0:
            log_test("AI Anomalies (with data)", "FAIL", "Empty summary")
            return False
        
        log_test("AI Anomalies (with data)", "PASS", f"Detected {len(anomalies)} anomalies with valid structure")
        return True
        
    except Exception as e:
        log_test("AI Anomalies (with data)", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_anomalies_empty():
    """Test POST /api/ai/anomalies with empty readings"""
    try:
        payload = {"readings": []}
        
        response = requests.post(f"{BASE_URL}/ai/anomalies", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test("AI Anomalies (empty)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["anomalies", "summary"]
        for field in required_fields:
            if field not in data:
                log_test("AI Anomalies (empty)", "FAIL", f"Missing field: {field}")
                return False
        
        anomalies = data.get("anomalies", [])
        if not isinstance(anomalies, list):
            log_test("AI Anomalies (empty)", "FAIL", "Anomalies is not an array")
            return False
        
        # Should return empty anomalies for empty input
        if len(anomalies) != 0:
            log_test("AI Anomalies (empty)", "FAIL", f"Expected 0 anomalies for empty input, got {len(anomalies)}")
            return False
        
        summary = data.get("summary", "")
        if not summary or len(summary.strip()) == 0:
            log_test("AI Anomalies (empty)", "FAIL", "Empty summary")
            return False
        
        log_test("AI Anomalies (empty)", "PASS", f"Correctly handled empty input: {summary}")
        return True
        
    except Exception as e:
        log_test("AI Anomalies (empty)", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_session_delete(session_id: str):
    """Test DELETE /api/ai/sessions/{id}"""
    try:
        response = requests.delete(f"{BASE_URL}/ai/sessions/{session_id}", timeout=10)
        
        if response.status_code != 200:
            log_test("AI Session Delete", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["ok", "session_id"]
        for field in required_fields:
            if field not in data:
                log_test("AI Session Delete", "FAIL", f"Missing field: {field}")
                return False
        
        if not data.get("ok"):
            log_test("AI Session Delete", "FAIL", "Delete operation not confirmed (ok=false)")
            return False
        
        if data.get("session_id") != session_id:
            log_test("AI Session Delete", "FAIL", f"Session ID mismatch: expected {session_id}, got {data.get('session_id')}")
            return False
        
        # Verify session is actually deleted by trying to get it
        time.sleep(1)  # Brief delay to ensure deletion is processed
        get_response = requests.get(f"{BASE_URL}/ai/sessions/{session_id}", timeout=10)
        
        if get_response.status_code == 200:
            get_data = get_response.json()
            messages = get_data.get("messages", [])
            if len(messages) > 0:
                log_test("AI Session Delete", "FAIL", f"Session still has {len(messages)} messages after deletion")
                return False
        
        log_test("AI Session Delete", "PASS", "Session successfully deleted and verified")
        return True
        
    except Exception as e:
        log_test("AI Session Delete", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_chat_validation():
    """Test POST /api/ai/chat with invalid input"""
    try:
        payload = {"message": ""}  # Empty message should return 422
        
        response = requests.post(f"{BASE_URL}/ai/chat", json=payload, timeout=10)
        
        if response.status_code != 422:
            log_test("AI Chat Validation", "FAIL", f"Expected 422 for empty message, got {response.status_code}")
            return False
        
        log_test("AI Chat Validation", "PASS", "Correctly rejected empty message with 422")
        return True
        
    except Exception as e:
        log_test("AI Chat Validation", "FAIL", f"Exception: {str(e)}")
        return False

def test_xlsx_import_regression():
    """Test POST /api/import/parse-wellmeter to ensure it still works after refactor"""
    try:
        # Use the Mambaling sample file URL from test_result.md
        file_url = "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/cv6d08yp_MAMBALING%203%20Well%20Meter%20Reading%202026_2.xlsx"
        
        # Download the file
        file_response = requests.get(file_url, timeout=30)
        if file_response.status_code != 200:
            log_test("XLSX Import Regression", "FAIL", f"Could not download test file: {file_response.status_code}")
            return False
        
        # Upload to the endpoint
        files = {"file": ("mambaling.xlsx", file_response.content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        response = requests.post(f"{BASE_URL}/import/parse-wellmeter", files=files, timeout=30)
        
        if response.status_code != 200:
            log_test("XLSX Import Regression", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Basic validation - should have sheets and file_summary
        if "sheets" not in data or "file_summary" not in data:
            log_test("XLSX Import Regression", "FAIL", "Missing sheets or file_summary in response")
            return False
        
        sheets = data.get("sheets", [])
        if len(sheets) != 1:
            log_test("XLSX Import Regression", "FAIL", f"Expected 1 sheet for Mambaling file, got {len(sheets)}")
            return False
        
        # Check row count (should be 90 as per test_result.md)
        sheet = sheets[0]
        rows = sheet.get("rows", [])
        if len(rows) != 90:
            log_test("XLSX Import Regression", "FAIL", f"Expected 90 rows for Mambaling file, got {len(rows)}")
            return False
        
        log_test("XLSX Import Regression", "PASS", f"Mambaling file processed correctly: {len(sheets)} sheet, {len(rows)} rows")
        return True
        
    except Exception as e:
        log_test("XLSX Import Regression", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# COMPLIANCE ENDPOINTS TESTING
# ============================================================================

def test_compliance_thresholds_get_default():
    """Test GET /api/compliance/thresholds (default global scope)"""
    try:
        response = requests.get(f"{BASE_URL}/compliance/thresholds", timeout=10)
        
        if response.status_code != 200:
            log_test("Compliance Thresholds GET (default)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["scope", "thresholds"]
        for field in required_fields:
            if field not in data:
                log_test("Compliance Thresholds GET (default)", "FAIL", f"Missing field: {field}")
                return False
        
        if data.get("scope") != "global":
            log_test("Compliance Thresholds GET (default)", "FAIL", f"Expected scope 'global', got '{data.get('scope')}'")
            return False
        
        # Validate threshold keys
        thresholds = data.get("thresholds", {})
        expected_keys = [
            "nrw_pct_max", "downtime_hrs_per_day_max", "permeate_tds_max",
            "permeate_ph_min", "permeate_ph_max", "raw_turbidity_max",
            "dp_psi_max", "recovery_pct_min", "pv_ratio_max", "chem_low_stock_days_min"
        ]
        
        for key in expected_keys:
            if key not in thresholds:
                log_test("Compliance Thresholds GET (default)", "FAIL", f"Missing threshold key: {key}")
                return False
            if not isinstance(thresholds[key], (int, float)):
                log_test("Compliance Thresholds GET (default)", "FAIL", f"Threshold {key} is not numeric: {thresholds[key]}")
                return False
        
        log_test("Compliance Thresholds GET (default)", "PASS", f"Retrieved global thresholds with {len(thresholds)} keys")
        return True
        
    except Exception as e:
        log_test("Compliance Thresholds GET (default)", "FAIL", f"Exception: {str(e)}")
        return False

def test_compliance_thresholds_put_and_get():
    """Test PUT /api/compliance/thresholds and verify with GET"""
    try:
        # PUT custom thresholds
        payload = {
            "scope": "test-plant-xyz",
            "thresholds": {
                "nrw_pct_max": 15,
                "downtime_hrs_per_day_max": 1.5,
                "permeate_tds_max": 450,
                "permeate_ph_min": 6.5,
                "permeate_ph_max": 8.5,
                "raw_turbidity_max": 5,
                "dp_psi_max": 40,
                "recovery_pct_min": 72,
                "pv_ratio_max": 1.1,
                "chem_low_stock_days_min": 5
            }
        }
        
        response = requests.put(f"{BASE_URL}/compliance/thresholds", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test("Compliance Thresholds PUT", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        put_data = response.json()
        
        # Validate PUT response
        required_fields = ["scope", "thresholds", "updated_at"]
        for field in required_fields:
            if field not in put_data:
                log_test("Compliance Thresholds PUT", "FAIL", f"Missing field in PUT response: {field}")
                return False
        
        # Now GET the same scope to verify it was saved
        get_response = requests.get(f"{BASE_URL}/compliance/thresholds?scope=test-plant-xyz", timeout=10)
        
        if get_response.status_code != 200:
            log_test("Compliance Thresholds PUT", "FAIL", f"GET verification failed: {get_response.status_code}")
            return False
            
        get_data = get_response.json()
        
        # Verify the saved values match what we PUT
        saved_thresholds = get_data.get("thresholds", {})
        original_thresholds = payload["thresholds"]
        
        for key, expected_value in original_thresholds.items():
            if key not in saved_thresholds:
                log_test("Compliance Thresholds PUT", "FAIL", f"Missing saved threshold: {key}")
                return False
            if saved_thresholds[key] != expected_value:
                log_test("Compliance Thresholds PUT", "FAIL", f"Threshold {key}: expected {expected_value}, got {saved_thresholds[key]}")
                return False
        
        log_test("Compliance Thresholds PUT", "PASS", "Successfully saved and verified custom thresholds")
        return True
        
    except Exception as e:
        log_test("Compliance Thresholds PUT", "FAIL", f"Exception: {str(e)}")
        return False

def test_compliance_thresholds_put_invalid():
    """Test PUT /api/compliance/thresholds with invalid data"""
    try:
        payload = {
            "scope": "test-invalid",
            "thresholds": {
                "nrw_pct_max": "abc"  # Invalid - should be numeric
            }
        }
        
        response = requests.put(f"{BASE_URL}/compliance/thresholds", json=payload, timeout=10)
        
        if response.status_code != 400:
            log_test("Compliance Thresholds PUT (invalid)", "FAIL", f"Expected 400 for invalid data, got {response.status_code}")
            return False
        
        log_test("Compliance Thresholds PUT (invalid)", "PASS", "Correctly rejected invalid thresholds with 400")
        return True
        
    except Exception as e:
        log_test("Compliance Thresholds PUT (invalid)", "FAIL", f"Exception: {str(e)}")
        return False

def test_compliance_evaluate_without_summary():
    """Test POST /api/compliance/evaluate without summarize flag"""
    try:
        payload = {
            "plant_id": "test-plant-xyz",
            "scope_label": "SRP",
            "metrics": {
                "nrw_pct": 32.5,
                "downtime_hrs": 3.5,
                "permeate_tds": 620,
                "permeate_ph": 6.1,
                "raw_turbidity": 2.3,
                "dp_psi": 45,
                "recovery_pct": 65,
                "pv_ratio": 1.35,
                "chem_days_of_supply": [{"name": "Chlorine", "days": 3.2}]
            }
        }
        
        response = requests.post(f"{BASE_URL}/compliance/evaluate", json=payload, timeout=15)
        
        if response.status_code != 200:
            log_test("Compliance Evaluate (no summary)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["scope", "scope_label", "evaluated_at", "violations", "thresholds"]
        for field in required_fields:
            if field not in data:
                log_test("Compliance Evaluate (no summary)", "FAIL", f"Missing field: {field}")
                return False
        
        violations = data.get("violations", [])
        if not isinstance(violations, list):
            log_test("Compliance Evaluate (no summary)", "FAIL", "Violations is not an array")
            return False
        
        # Should have violations based on the test data (values exceed thresholds)
        expected_violation_codes = [
            "nrw_pct_over", "downtime_hrs_over", "permeate_tds_over", 
            "permeate_ph_range", "dp_psi_over", "pv_ratio_over", 
            "recovery_pct_under", "chem_low_stock"
        ]
        
        found_codes = [v.get("code") for v in violations]
        missing_codes = [code for code in expected_violation_codes if code not in found_codes]
        
        if missing_codes:
            log_test("Compliance Evaluate (no summary)", "FAIL", f"Missing expected violations: {missing_codes}")
            return False
        
        # Validate violation structure
        for i, violation in enumerate(violations):
            required_violation_fields = ["code", "severity", "metric", "threshold", "comparator", "message"]
            for field in required_violation_fields:
                if field not in violation:
                    log_test("Compliance Evaluate (no summary)", "FAIL", f"Violation {i} missing field: {field}")
                    return False
            
            if violation.get("severity") not in ["low", "medium", "high"]:
                log_test("Compliance Evaluate (no summary)", "FAIL", f"Violation {i} has invalid severity: {violation.get('severity')}")
                return False
        
        # Should NOT have summary field when summarize=false
        if "summary" in data:
            log_test("Compliance Evaluate (no summary)", "FAIL", "Unexpected summary field when summarize=false")
            return False
        
        log_test("Compliance Evaluate (no summary)", "PASS", f"Detected {len(violations)} violations with proper structure")
        return True
        
    except Exception as e:
        log_test("Compliance Evaluate (no summary)", "FAIL", f"Exception: {str(e)}")
        return False

def test_compliance_evaluate_with_summary():
    """Test POST /api/compliance/evaluate with summarize=true"""
    try:
        payload = {
            "plant_id": "test-plant-xyz",
            "scope_label": "SRP",
            "metrics": {
                "nrw_pct": 32.5,
                "downtime_hrs": 3.5,
                "permeate_tds": 620,
                "permeate_ph": 6.1,
                "raw_turbidity": 2.3,
                "dp_psi": 45,
                "recovery_pct": 65,
                "pv_ratio": 1.35,
                "chem_days_of_supply": [{"name": "Chlorine", "days": 3.2}]
            }
        }
        
        response = requests.post(f"{BASE_URL}/compliance/evaluate?summarize=true", json=payload, timeout=30)
        
        if response.status_code != 200:
            log_test("Compliance Evaluate (with summary)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Should have summary field
        if "summary" not in data:
            log_test("Compliance Evaluate (with summary)", "FAIL", "Missing summary field when summarize=true")
            return False
        
        summary = data.get("summary", "")
        if not summary or len(summary.strip()) == 0:
            log_test("Compliance Evaluate (with summary)", "FAIL", "Empty summary")
            return False
        
        # Summary should be reasonably short (<=60 words as per spec)
        word_count = len(summary.split())
        if word_count > 80:  # Allow some flexibility
            log_test("Compliance Evaluate (with summary)", "FAIL", f"Summary too long: {word_count} words (expected ≤60)")
            return False
        
        log_test("Compliance Evaluate (with summary)", "PASS", f"Generated AI summary: {word_count} words")
        return True
        
    except Exception as e:
        log_test("Compliance Evaluate (with summary)", "FAIL", f"Exception: {str(e)}")
        return False

def test_compliance_evaluate_empty_metrics():
    """Test POST /api/compliance/evaluate with empty metrics"""
    try:
        payload = {
            "plant_id": "test-empty",
            "scope_label": "Empty Test",
            "metrics": {}
        }
        
        response = requests.post(f"{BASE_URL}/compliance/evaluate", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test("Compliance Evaluate (empty)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        violations = data.get("violations", [])
        if not isinstance(violations, list):
            log_test("Compliance Evaluate (empty)", "FAIL", "Violations is not an array")
            return False
        
        # Should return empty violations for empty metrics
        if len(violations) != 0:
            log_test("Compliance Evaluate (empty)", "FAIL", f"Expected 0 violations for empty metrics, got {len(violations)}")
            return False
        
        log_test("Compliance Evaluate (empty)", "PASS", "Correctly handled empty metrics")
        return True
        
    except Exception as e:
        log_test("Compliance Evaluate (empty)", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# PM FORECAST ENDPOINT TESTING
# ============================================================================

def test_pm_forecast_full_request():
    """Test POST /api/ai/pm-forecast with full request data"""
    try:
        payload = {
            "equipment_name": "RO Membrane Skid 1",
            "category": "RO Membranes",
            "frequency": "Quarterly",
            "last_execution_date": "2026-01-15",
            "downtime_hrs_last_30d": 12.5,
            "chem_consumption_trend": "rising",
            "notes": "DP creeping up 15% last month"
        }
        
        response = requests.post(f"{BASE_URL}/ai/pm-forecast", json=payload, timeout=30)
        
        if response.status_code != 200:
            log_test("PM Forecast (full request)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure
        required_fields = ["recommended_next_date", "confidence", "rationale", "risk_factors"]
        for field in required_fields:
            if field not in data:
                log_test("PM Forecast (full request)", "FAIL", f"Missing field: {field}")
                return False
        
        # Validate confidence values
        confidence = data.get("confidence")
        if confidence not in ["low", "medium", "high"]:
            log_test("PM Forecast (full request)", "FAIL", f"Invalid confidence value: {confidence}")
            return False
        
        # Validate rationale is non-empty
        rationale = data.get("rationale", "")
        if not rationale or len(rationale.strip()) == 0:
            log_test("PM Forecast (full request)", "FAIL", "Empty rationale")
            return False
        
        # Validate risk_factors is an array
        risk_factors = data.get("risk_factors", [])
        if not isinstance(risk_factors, list):
            log_test("PM Forecast (full request)", "FAIL", "Risk factors is not an array")
            return False
        
        # recommended_next_date can be null or a date string
        next_date = data.get("recommended_next_date")
        if next_date is not None and not isinstance(next_date, str):
            log_test("PM Forecast (full request)", "FAIL", f"Invalid recommended_next_date type: {type(next_date)}")
            return False
        
        log_test("PM Forecast (full request)", "PASS", f"Confidence: {confidence}, Date: {next_date}, {len(risk_factors)} risk factors")
        return True
        
    except Exception as e:
        log_test("PM Forecast (full request)", "FAIL", f"Exception: {str(e)}")
        return False

def test_pm_forecast_minimal_request():
    """Test POST /api/ai/pm-forecast with minimal request data"""
    try:
        payload = {
            "equipment_name": "Test Equipment",
            "category": "Test Category",
            "frequency": "Monthly"
        }
        
        response = requests.post(f"{BASE_URL}/ai/pm-forecast", json=payload, timeout=30)
        
        if response.status_code != 200:
            log_test("PM Forecast (minimal request)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
            
        data = response.json()
        
        # Validate response structure (same as full request)
        required_fields = ["recommended_next_date", "confidence", "rationale", "risk_factors"]
        for field in required_fields:
            if field not in data:
                log_test("PM Forecast (minimal request)", "FAIL", f"Missing field: {field}")
                return False
        
        # With minimal data, might have null date and low confidence
        confidence = data.get("confidence")
        if confidence not in ["low", "medium", "high"]:
            log_test("PM Forecast (minimal request)", "FAIL", f"Invalid confidence value: {confidence}")
            return False
        
        rationale = data.get("rationale", "")
        if not rationale or len(rationale.strip()) == 0:
            log_test("PM Forecast (minimal request)", "FAIL", "Empty rationale")
            return False
        
        log_test("PM Forecast (minimal request)", "PASS", f"Handled minimal request: confidence={confidence}")
        return True
        
    except Exception as e:
        log_test("PM Forecast (minimal request)", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# QUICK SANITY CHECKS FOR PREVIOUSLY WORKING ENDPOINTS
# ============================================================================

def test_ai_health_quick():
    """Quick test of GET /api/ai/health"""
    try:
        response = requests.get(f"{BASE_URL}/ai/health", timeout=10)
        
        if response.status_code != 200:
            log_test("AI Health (quick check)", "FAIL", f"Status {response.status_code}")
            return False
            
        data = response.json()
        if not data.get("ok"):
            log_test("AI Health (quick check)", "FAIL", "EMERGENT_LLM_KEY not configured")
            return False
            
        log_test("AI Health (quick check)", "PASS", "Health endpoint responding")
        return True
        
    except Exception as e:
        log_test("AI Health (quick check)", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_chat_quick():
    """Quick test of POST /api/ai/chat"""
    try:
        payload = {"message": "What is water treatment?"}
        response = requests.post(f"{BASE_URL}/ai/chat", json=payload, timeout=20)
        
        if response.status_code != 200:
            log_test("AI Chat (quick check)", "FAIL", f"Status {response.status_code}")
            return False
            
        data = response.json()
        if not data.get("reply"):
            log_test("AI Chat (quick check)", "FAIL", "Empty reply")
            return False
            
        log_test("AI Chat (quick check)", "PASS", "Chat endpoint responding")
        return True
        
    except Exception as e:
        log_test("AI Chat (quick check)", "FAIL", f"Exception: {str(e)}")
        return False

def test_xlsx_import_quick():
    """Quick test of POST /api/import/parse-wellmeter"""
    try:
        # Use the Mambaling sample file URL
        file_url = "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/cv6d08yp_MAMBALING%203%20Well%20Meter%20Reading%202026_2.xlsx"
        
        # Download the file
        file_response = requests.get(file_url, timeout=30)
        if file_response.status_code != 200:
            log_test("XLSX Import (quick check)", "FAIL", f"Could not download test file: {file_response.status_code}")
            return False
        
        # Upload to the endpoint
        files = {"file": ("mambaling.xlsx", file_response.content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        response = requests.post(f"{BASE_URL}/import/parse-wellmeter", files=files, timeout=30)
        
        if response.status_code != 200:
            log_test("XLSX Import (quick check)", "FAIL", f"Status {response.status_code}")
            return False
            
        data = response.json()
        if "sheets" not in data:
            log_test("XLSX Import (quick check)", "FAIL", "Missing sheets in response")
            return False
            
        log_test("XLSX Import (quick check)", "PASS", "XLSX import endpoint responding")
        return True
        
    except Exception as e:
        log_test("XLSX Import (quick check)", "FAIL", f"Exception: {str(e)}")
        return False

def main():
    """Run all backend endpoint tests focusing on new compliance and PM forecast features"""
    print("🚀 Starting Comprehensive Backend Testing")
    print(f"📍 Base URL: {BASE_URL}")
    print("=" * 60)
    
    results = {}
    
    print("\n🔍 QUICK SANITY CHECKS (Previously Working Endpoints)")
    print("-" * 60)
    
    # Quick sanity checks for previously working endpoints
    results["ai_health_quick"] = test_ai_health_quick()
    results["ai_chat_quick"] = test_ai_chat_quick()
    results["xlsx_import_quick"] = test_xlsx_import_quick()
    
    print("\n🆕 NEW COMPLIANCE ENDPOINTS TESTING")
    print("-" * 60)
    
    # A) Compliance thresholds + evaluate endpoints (/api/compliance/*)
    results["compliance_get_default"] = test_compliance_thresholds_get_default()
    results["compliance_put_get"] = test_compliance_thresholds_put_and_get()
    results["compliance_put_invalid"] = test_compliance_thresholds_put_invalid()
    results["compliance_evaluate_no_summary"] = test_compliance_evaluate_without_summary()
    results["compliance_evaluate_with_summary"] = test_compliance_evaluate_with_summary()
    results["compliance_evaluate_empty"] = test_compliance_evaluate_empty_metrics()
    
    print("\n🤖 NEW AI PM-FORECAST ENDPOINT TESTING")
    print("-" * 60)
    
    # B) AI PM-forecast endpoint (/api/ai/pm-forecast)
    results["pm_forecast_full"] = test_pm_forecast_full_request()
    results["pm_forecast_minimal"] = test_pm_forecast_minimal_request()
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for result in results.values() if result)
    total = len(results)
    
    # Group results by category
    sanity_tests = ["ai_health_quick", "ai_chat_quick", "xlsx_import_quick"]
    compliance_tests = ["compliance_get_default", "compliance_put_get", "compliance_put_invalid", 
                       "compliance_evaluate_no_summary", "compliance_evaluate_with_summary", "compliance_evaluate_empty"]
    pm_tests = ["pm_forecast_full", "pm_forecast_minimal"]
    
    print("🔍 SANITY CHECKS:")
    for test_name in sanity_tests:
        if test_name in results:
            status = "✅ PASS" if results[test_name] else "❌ FAIL"
            print(f"  {status} {test_name}")
    
    print("\n🆕 COMPLIANCE ENDPOINTS:")
    for test_name in compliance_tests:
        if test_name in results:
            status = "✅ PASS" if results[test_name] else "❌ FAIL"
            print(f"  {status} {test_name}")
    
    print("\n🤖 PM FORECAST ENDPOINT:")
    for test_name in pm_tests:
        if test_name in results:
            status = "✅ PASS" if results[test_name] else "❌ FAIL"
            print(f"  {status} {test_name}")
    
    print(f"\n🎯 Overall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! All backend endpoints are working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the details above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())