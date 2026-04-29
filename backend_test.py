#!/usr/bin/env python3
"""
Backend regression test for P2 backend complexity refactor.

Tests all endpoints specified in the review request to ensure zero behavior change
after extracting helpers from admin_service.py and ai_import_service.py into
admin_helpers.py and ai_import_helpers.py, plus introducing dataclasses.

Critical: Any 5xx response with dataclass names in traceback indicates regression.
"""

import json
import os
import requests
import uuid
from typing import Any, Dict, Optional

# Get backend URL from frontend .env
BACKEND_URL = "https://typescript-upgrade-5.preview.emergentagent.com/api"
TEST_EMAIL = "kevzvilbar@gmail.com"
TEST_PASSWORD = "BPWI2025!"

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.jwt_token: Optional[str] = None
        self.test_results: Dict[str, Any] = {
            "ai_endpoints": {},
            "compliance_endpoints": {},
            "xlsx_import": {},
            "admin_auth_gating": {},
            "ai_universal_import": {},
            "summary": {"passed": 0, "failed": 0, "errors": []}
        }

    def log_result(self, category: str, test_name: str, passed: bool, details: str = ""):
        """Log test result and update summary"""
        self.test_results[category][test_name] = {
            "passed": passed,
            "details": details
        }
        if passed:
            self.test_results["summary"]["passed"] += 1
            print(f"✅ {category}.{test_name}: PASSED")
        else:
            self.test_results["summary"]["failed"] += 1
            self.test_results["summary"]["errors"].append(f"{category}.{test_name}: {details}")
            print(f"❌ {category}.{test_name}: FAILED - {details}")
        
        if details:
            print(f"   Details: {details}")

    def check_for_regression_indicators(self, response_text: str) -> Optional[str]:
        """Check for dataclass names in error responses that would indicate regression"""
        regression_indicators = [
            "AnalysisPersistPayload", "ReadingsInsertContext", "AuditEntry", 
            "AuditDecision", "_audit_decision", "_persist_analysis", "_insert_readings",
            "FrozenInstanceError"
        ]
        
        for indicator in regression_indicators:
            if indicator in response_text:
                return f"REGRESSION DETECTED: {indicator} found in response"
        return None

    def get_jwt_token(self) -> bool:
        """Get JWT token for authenticated requests"""
        try:
            # Try to get JWT token via Supabase auth
            auth_url = "https://lreqxclzoxmswglvdstv.supabase.co/auth/v1/token"
            auth_data = {
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD,
                "grant_type": "password"
            }
            headers = {
                "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZXF4Y2x6b3htc3dnbHZkc3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NzQwNDQsImV4cCI6MjA5MjE1MDA0NH0.66ej8i4lhROCQhSPmGW2xuDmrguMIhz1Hc86-Zb25JA",
                "Content-Type": "application/json"
            }
            
            response = self.session.post(auth_url, json=auth_data, headers=headers)
            if response.status_code == 200:
                data = response.json()
                self.jwt_token = data.get("access_token")
                print(f"✅ Successfully obtained JWT token")
                return True
            else:
                print(f"❌ Failed to get JWT token: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Exception getting JWT token: {e}")
            return False

    def test_ai_endpoints(self):
        """Test AI endpoints for regression"""
        print("\n=== Testing AI Endpoints ===")
        
        # A1. GET /api/ai/health
        try:
            response = self.session.get(f"{BACKEND_URL}/ai/health")
            if response.status_code == 200:
                data = response.json()
                expected_keys = {"ok", "model", "provider"}
                if all(key in data for key in expected_keys):
                    if data.get("ok") is True and data.get("model") == "gpt-5.1" and data.get("provider") == "openai":
                        self.log_result("ai_endpoints", "health_check", True, f"Response: {data}")
                    else:
                        self.log_result("ai_endpoints", "health_check", False, f"Unexpected values: {data}")
                else:
                    self.log_result("ai_endpoints", "health_check", False, f"Missing keys: {data}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_endpoints", "health_check", False, 
                               f"Status {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_endpoints", "health_check", False, f"Exception: {e}")

        # A2. POST /api/ai/chat with valid message
        try:
            chat_data = {"message": "In one short sentence, what does NRW stand for?"}
            response = self.session.post(f"{BACKEND_URL}/ai/chat", json=chat_data)
            if response.status_code == 200:
                data = response.json()
                expected_keys = {"session_id", "reply", "created_at"}
                if all(key in data for key in expected_keys):
                    self.log_result("ai_endpoints", "chat_valid", True, f"Got session_id: {data.get('session_id')}")
                else:
                    self.log_result("ai_endpoints", "chat_valid", False, f"Missing keys: {data}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_endpoints", "chat_valid", False, 
                               f"Status {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_endpoints", "chat_valid", False, f"Exception: {e}")

        # A3. POST /api/ai/chat with empty message
        try:
            chat_data = {"message": ""}
            response = self.session.post(f"{BACKEND_URL}/ai/chat", json=chat_data)
            if response.status_code == 422:
                self.log_result("ai_endpoints", "chat_empty_validation", True, "Correctly rejected empty message")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_endpoints", "chat_empty_validation", False, 
                               f"Expected 422, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_endpoints", "chat_empty_validation", False, f"Exception: {e}")

        # A4. POST /api/ai/anomalies with test data
        try:
            anomaly_data = {
                "readings": [
                    {"well": "Well 2", "date": "2026-01-01", "initial": 117322, "final": 117322, "volume": 0, "status": "defective"},
                    {"well": "Well 2", "date": "2026-01-02", "initial": 117322, "final": 117322, "volume": 0, "status": "defective"},
                    {"well": "Well 2", "date": "2026-01-03", "initial": 117322, "final": 117322, "volume": 0, "status": "defective"},
                    {"well": "Well 2", "date": "2026-01-04", "initial": 117322, "final": 120000, "volume": 2678, "status": "valid"},
                    {"well": "Well 2", "date": "2026-01-07", "initial": 125000, "final": 140000, "volume": 15000, "status": "valid"},
                    {"well": "Well 2", "date": "2026-01-08", "initial": 140000, "final": 140000, "volume": 0, "status": "shutoff"}
                ]
            }
            response = self.session.post(f"{BACKEND_URL}/ai/anomalies", json=anomaly_data)
            if response.status_code == 200:
                data = response.json()
                if "anomalies" in data and "summary" in data:
                    self.log_result("ai_endpoints", "anomalies_with_data", True, f"Found {len(data.get('anomalies', []))} anomalies")
                else:
                    self.log_result("ai_endpoints", "anomalies_with_data", False, f"Missing keys: {data}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_endpoints", "anomalies_with_data", False, 
                               f"Status {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_endpoints", "anomalies_with_data", False, f"Exception: {e}")

        # A4b. POST /api/ai/anomalies with empty readings
        try:
            anomaly_data = {"readings": []}
            response = self.session.post(f"{BACKEND_URL}/ai/anomalies", json=anomaly_data)
            if response.status_code == 200:
                data = response.json()
                if "anomalies" in data and data["anomalies"] == []:
                    self.log_result("ai_endpoints", "anomalies_empty", True, "Correctly handled empty readings")
                else:
                    self.log_result("ai_endpoints", "anomalies_empty", False, f"Unexpected response: {data}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_endpoints", "anomalies_empty", False, 
                               f"Status {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_endpoints", "anomalies_empty", False, f"Exception: {e}")

    def test_compliance_endpoints(self):
        """Test compliance endpoints for regression"""
        print("\n=== Testing Compliance Endpoints ===")
        
        # B1. GET /api/compliance/thresholds
        try:
            response = self.session.get(f"{BACKEND_URL}/compliance/thresholds")
            if response.status_code == 200:
                data = response.json()
                if "scope" in data and "thresholds" in data:
                    thresholds = data["thresholds"]
                    expected_keys = {
                        "nrw_pct_max", "downtime_hrs_per_day_max", "permeate_tds_max",
                        "permeate_ph_min", "permeate_ph_max", "raw_turbidity_max", 
                        "dp_psi_max", "recovery_pct_min", "pv_ratio_max", "chem_low_stock_days_min"
                    }
                    if all(key in thresholds for key in expected_keys):
                        self.log_result("compliance_endpoints", "get_thresholds", True, f"All 10 threshold keys present")
                    else:
                        missing = expected_keys - set(thresholds.keys())
                        self.log_result("compliance_endpoints", "get_thresholds", False, f"Missing keys: {missing}")
                else:
                    self.log_result("compliance_endpoints", "get_thresholds", False, f"Missing scope/thresholds: {data}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("compliance_endpoints", "get_thresholds", False, 
                               f"Status {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("compliance_endpoints", "get_thresholds", False, f"Exception: {e}")

        # B2. POST /api/compliance/evaluate with test metrics
        try:
            eval_data = {
                "metrics": {
                    "nrw_pct": 32.5,
                    "downtime_hrs": 3.5,
                    "permeate_tds": 620,
                    "permeate_ph": 6.1,
                    "dp_psi": 45,
                    "recovery_pct": 65,
                    "pv_ratio": 1.35
                }
            }
            response = self.session.post(f"{BACKEND_URL}/compliance/evaluate", json=eval_data)
            if response.status_code == 200:
                data = response.json()
                if "violations" in data:
                    violations = data["violations"]
                    if len(violations) >= 7:
                        # Check that violations have proper severity
                        severities = {v.get("severity") for v in violations}
                        valid_severities = {"low", "medium", "high"}
                        if severities.issubset(valid_severities):
                            self.log_result("compliance_endpoints", "evaluate_violations", True, 
                                          f"Found {len(violations)} violations with valid severities")
                        else:
                            self.log_result("compliance_endpoints", "evaluate_violations", False, 
                                          f"Invalid severities: {severities}")
                    else:
                        self.log_result("compliance_endpoints", "evaluate_violations", False, 
                                      f"Expected ≥7 violations, got {len(violations)}")
                else:
                    self.log_result("compliance_endpoints", "evaluate_violations", False, f"Missing violations: {data}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("compliance_endpoints", "evaluate_violations", False, 
                               f"Status {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("compliance_endpoints", "evaluate_violations", False, f"Exception: {e}")

        # B3. POST /api/compliance/evaluate with empty metrics
        try:
            eval_data = {"metrics": {}}
            response = self.session.post(f"{BACKEND_URL}/compliance/evaluate", json=eval_data)
            if response.status_code == 200:
                data = response.json()
                if "violations" in data and data["violations"] == []:
                    self.log_result("compliance_endpoints", "evaluate_empty", True, "Correctly handled empty metrics")
                else:
                    self.log_result("compliance_endpoints", "evaluate_empty", False, f"Unexpected response: {data}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("compliance_endpoints", "evaluate_empty", False, 
                               f"Status {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("compliance_endpoints", "evaluate_empty", False, f"Exception: {e}")

    def test_xlsx_import(self):
        """Test XLSX import endpoint for regression"""
        print("\n=== Testing XLSX Import ===")
        
        # C1. POST /api/import/parse-wellmeter with Mambaling sample
        try:
            # Download the sample file
            sample_url = "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/cv6d08yp_MAMBALING%203%20Well%20Meter%20Reading%202026_2.xlsx"
            file_response = requests.get(sample_url)
            if file_response.status_code == 200:
                files = {'file': ('mambaling.xlsx', file_response.content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
                response = self.session.post(f"{BACKEND_URL}/import/parse-wellmeter", files=files)
                
                if response.status_code == 200:
                    data = response.json()
                    if "sheets" in data and "file_summary" in data:
                        sheets = data["sheets"]
                        if len(sheets) == 1:
                            sheet = sheets[0]
                            if "rows" in sheet and len(sheet["rows"]) == 90:
                                # Check for expected downtime count
                                downtime_count = sum(1 for row in sheet["rows"] if row.get("is_downtime"))
                                if downtime_count == 13:
                                    self.log_result("xlsx_import", "mambaling_parse", True, 
                                                  f"1 sheet, 90 rows, 13 downtime (exact match)")
                                else:
                                    self.log_result("xlsx_import", "mambaling_parse", False, 
                                                  f"Expected 13 downtime, got {downtime_count}")
                            else:
                                self.log_result("xlsx_import", "mambaling_parse", False, 
                                              f"Expected 90 rows, got {len(sheet.get('rows', []))}")
                        else:
                            self.log_result("xlsx_import", "mambaling_parse", False, 
                                          f"Expected 1 sheet, got {len(sheets)}")
                    else:
                        self.log_result("xlsx_import", "mambaling_parse", False, f"Missing sheets/file_summary: {data}")
                else:
                    regression = self.check_for_regression_indicators(response.text)
                    self.log_result("xlsx_import", "mambaling_parse", False, 
                                   f"Status {response.status_code}: {regression or response.text[:200]}")
            else:
                self.log_result("xlsx_import", "mambaling_parse", False, f"Failed to download sample file: {file_response.status_code}")
        except Exception as e:
            self.log_result("xlsx_import", "mambaling_parse", False, f"Exception: {e}")

        # C2. POST /api/import/parse-wellmeter with empty body
        try:
            response = self.session.post(f"{BACKEND_URL}/import/parse-wellmeter")
            if response.status_code in [422, 400]:
                self.log_result("xlsx_import", "empty_body", True, f"Correctly rejected empty body with {response.status_code}")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("xlsx_import", "empty_body", False, 
                               f"Expected 422/400, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("xlsx_import", "empty_body", False, f"Exception: {e}")

        # C3. POST /api/import/parse-wellmeter with wrong file extension
        try:
            files = {'file': ('test.txt', b'some text content', 'text/plain')}
            response = self.session.post(f"{BACKEND_URL}/import/parse-wellmeter", files=files)
            if response.status_code == 400:
                self.log_result("xlsx_import", "wrong_extension", True, "Correctly rejected .txt file")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("xlsx_import", "wrong_extension", False, 
                               f"Expected 400, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("xlsx_import", "wrong_extension", False, f"Exception: {e}")

    def test_admin_auth_gating(self):
        """Test admin endpoints without auth for proper 401 responses"""
        print("\n=== Testing Admin Auth Gating ===")
        
        random_uuid = str(uuid.uuid4())
        
        # D1. DELETE /api/admin/users/<uuid> without auth
        try:
            response = self.session.delete(f"{BACKEND_URL}/admin/users/{random_uuid}")
            if response.status_code == 401:
                self.log_result("admin_auth_gating", "delete_user_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("admin_auth_gating", "delete_user_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("admin_auth_gating", "delete_user_no_auth", False, f"Exception: {e}")

        # D2. DELETE /api/admin/users/<uuid> with malformed bearer
        try:
            headers = {"Authorization": "Bearer foo"}
            response = self.session.delete(f"{BACKEND_URL}/admin/users/{random_uuid}", headers=headers)
            if response.status_code == 401:
                self.log_result("admin_auth_gating", "delete_user_bad_token", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("admin_auth_gating", "delete_user_bad_token", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("admin_auth_gating", "delete_user_bad_token", False, f"Exception: {e}")

        # D3. DELETE /api/admin/plants/<uuid> without auth
        try:
            response = self.session.delete(f"{BACKEND_URL}/admin/plants/{random_uuid}")
            if response.status_code == 401:
                self.log_result("admin_auth_gating", "delete_plant_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("admin_auth_gating", "delete_plant_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("admin_auth_gating", "delete_plant_no_auth", False, f"Exception: {e}")

        # D4. GET /api/admin/audit-log without auth
        try:
            response = self.session.get(f"{BACKEND_URL}/admin/audit-log")
            if response.status_code == 401:
                self.log_result("admin_auth_gating", "audit_log_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("admin_auth_gating", "audit_log_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("admin_auth_gating", "audit_log_no_auth", False, f"Exception: {e}")

        # D5. GET /api/admin/users/<uuid>/dependencies without auth
        try:
            response = self.session.get(f"{BACKEND_URL}/admin/users/{random_uuid}/dependencies")
            if response.status_code == 401:
                self.log_result("admin_auth_gating", "user_deps_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("admin_auth_gating", "user_deps_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("admin_auth_gating", "user_deps_no_auth", False, f"Exception: {e}")

        # D6. POST /api/admin/plants/cleanup without auth
        try:
            cleanup_data = {"names": ["test"], "reason": "testing"}
            response = self.session.post(f"{BACKEND_URL}/admin/plants/cleanup", json=cleanup_data)
            if response.status_code == 401:
                self.log_result("admin_auth_gating", "cleanup_plants_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("admin_auth_gating", "cleanup_plants_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("admin_auth_gating", "cleanup_plants_no_auth", False, f"Exception: {e}")

        # D7. Optional: GET /api/admin/audit-log with JWT (if we have one)
        if self.jwt_token:
            try:
                headers = {"Authorization": f"Bearer {self.jwt_token}"}
                response = self.session.get(f"{BACKEND_URL}/admin/audit-log", headers=headers)
                if response.status_code == 200:
                    data = response.json()
                    if "count" in data and "entries" in data:
                        self.log_result("admin_auth_gating", "audit_log_with_auth", True, 
                                      f"Got {data['count']} audit entries")
                    else:
                        self.log_result("admin_auth_gating", "audit_log_with_auth", False, f"Missing keys: {data}")
                else:
                    regression = self.check_for_regression_indicators(response.text)
                    self.log_result("admin_auth_gating", "audit_log_with_auth", False, 
                                   f"Status {response.status_code}: {regression or response.text[:200]}")
            except Exception as e:
                self.log_result("admin_auth_gating", "audit_log_with_auth", False, f"Exception: {e}")

    def test_ai_universal_import(self):
        """Test AI universal import endpoints without auth"""
        print("\n=== Testing AI Universal Import ===")
        
        random_uuid = str(uuid.uuid4())
        
        # E1. POST /api/import/ai-analyze without auth (with valid file to test auth)
        try:
            files = {'file': ('test.xlsx', b'fake xlsx content', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
            response = self.session.post(f"{BACKEND_URL}/import/ai-analyze", files=files)
            if response.status_code == 401:
                self.log_result("ai_universal_import", "analyze_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_universal_import", "analyze_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_universal_import", "analyze_no_auth", False, f"Exception: {e}")

        # E2. POST /api/import/ai-sync/<uuid> without auth (with valid body to test auth)
        try:
            sync_data = {"reason": "testing", "plant_id": random_uuid, "decisions": []}
            response = self.session.post(f"{BACKEND_URL}/import/ai-sync/{random_uuid}", json=sync_data)
            if response.status_code == 401:
                self.log_result("ai_universal_import", "sync_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_universal_import", "sync_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_universal_import", "sync_no_auth", False, f"Exception: {e}")

        # E3. GET /api/import/ai-analyses without auth
        try:
            response = self.session.get(f"{BACKEND_URL}/import/ai-analyses")
            if response.status_code == 401:
                self.log_result("ai_universal_import", "list_no_auth", True, "Correctly returned 401")
            else:
                regression = self.check_for_regression_indicators(response.text)
                self.log_result("ai_universal_import", "list_no_auth", False, 
                               f"Expected 401, got {response.status_code}: {regression or response.text[:200]}")
        except Exception as e:
            self.log_result("ai_universal_import", "list_no_auth", False, f"Exception: {e}")

    def run_all_tests(self):
        """Run all regression tests"""
        print("🔍 Starting P2 Backend Complexity Refactor Regression Tests")
        print(f"Backend URL: {BACKEND_URL}")
        
        # Try to get JWT token (optional for most tests)
        self.get_jwt_token()
        
        # Run all test categories
        self.test_ai_endpoints()
        self.test_compliance_endpoints()
        self.test_xlsx_import()
        self.test_admin_auth_gating()
        self.test_ai_universal_import()
        
        # Print summary
        print(f"\n=== REGRESSION TEST SUMMARY ===")
        print(f"✅ Passed: {self.test_results['summary']['passed']}")
        print(f"❌ Failed: {self.test_results['summary']['failed']}")
        
        if self.test_results['summary']['errors']:
            print(f"\n🚨 FAILURES:")
            for error in self.test_results['summary']['errors']:
                print(f"   • {error}")
        
        # Check for any critical regressions
        critical_failures = []
        for category, tests in self.test_results.items():
            if category == "summary":
                continue
            for test_name, result in tests.items():
                if not result["passed"] and "REGRESSION DETECTED" in result["details"]:
                    critical_failures.append(f"{category}.{test_name}: {result['details']}")
        
        if critical_failures:
            print(f"\n🔥 CRITICAL REGRESSIONS DETECTED:")
            for failure in critical_failures:
                print(f"   • {failure}")
            return False
        
        return self.test_results['summary']['failed'] == 0

if __name__ == "__main__":
    tester = BackendTester()
    success = tester.run_all_tests()
    
    if success:
        print(f"\n🎉 ALL REGRESSION TESTS PASSED - No behavior change detected")
        exit(0)
    else:
        print(f"\n💥 REGRESSION TESTS FAILED - Behavior change detected")
        exit(1)