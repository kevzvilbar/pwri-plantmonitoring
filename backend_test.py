#!/usr/bin/env python3
"""
Comprehensive backend API testing for AI Assistant endpoints and XLSX import.
Tests all endpoints specified in test_result.md agent_communication.
"""

import requests
import json
import sys
import time
from typing import Dict, Any, Optional

# Use external URL from frontend/.env
BASE_URL = "https://quality-guard-5.preview.emergentagent.com/api"

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

def main():
    """Run all AI endpoint tests in the specified sequence"""
    print("🚀 Starting AI Assistant Backend Testing")
    print(f"📍 Base URL: {BASE_URL}")
    print("=" * 60)
    
    results = {}
    session_id = None
    
    # Test sequence as specified in test_result.md
    
    # 1. Health check
    results["health"] = test_ai_health()
    
    # 2. Single turn chat
    if results["health"]:
        session_id = test_ai_chat_single_turn()
        results["chat_single"] = session_id is not None
    else:
        results["chat_single"] = False
        print("⚠️  Skipping chat tests due to health check failure")
    
    # 3. Multi-turn chat
    if session_id:
        results["chat_multi"] = test_ai_chat_multi_turn(session_id)
    else:
        results["chat_multi"] = False
        print("⚠️  Skipping multi-turn test due to single-turn failure")
    
    # 4. Sessions list
    if session_id:
        results["sessions_list"] = test_ai_sessions_list(session_id)
    else:
        results["sessions_list"] = False
        print("⚠️  Skipping sessions list test")
    
    # 5. Session detail
    if session_id:
        results["session_detail"] = test_ai_session_detail(session_id)
    else:
        results["session_detail"] = False
        print("⚠️  Skipping session detail test")
    
    # 6. Anomalies with data
    results["anomalies_data"] = test_ai_anomalies_with_data()
    
    # 7. Anomalies empty
    results["anomalies_empty"] = test_ai_anomalies_empty()
    
    # 8. Session delete
    if session_id:
        results["session_delete"] = test_ai_session_delete(session_id)
    else:
        results["session_delete"] = False
        print("⚠️  Skipping session delete test")
    
    # 9. Validation
    results["chat_validation"] = test_ai_chat_validation()
    
    # 10. XLSX import regression
    results["xlsx_regression"] = test_xlsx_import_regression()
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for result in results.values() if result)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {test_name}")
    
    print(f"\n🎯 Overall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! AI endpoints are working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the details above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())