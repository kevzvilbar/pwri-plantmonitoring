#!/usr/bin/env python3
"""
Backend API Testing for XLSX Import Endpoint
Tests the POST /api/import/parse-wellmeter endpoint with various scenarios.
"""

import requests
import json
import tempfile
import os
from pathlib import Path

# Backend URL from frontend/.env
BACKEND_URL = "https://quality-guard-5.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

def test_basic_api_health():
    """Test basic API connectivity"""
    print("🔍 Testing basic API health...")
    try:
        response = requests.get(f"{API_BASE}/")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
        assert response.status_code == 200
        assert response.json() == {"message": "Hello World"}
        print("   ✅ Basic API health check passed")
        return True
    except Exception as e:
        print(f"   ❌ Basic API health check failed: {e}")
        return False

def download_test_file(url, filename):
    """Download a test file from the given URL"""
    print(f"📥 Downloading {filename}...")
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        # Save to temp file
        temp_path = Path(tempfile.gettempdir()) / filename
        with open(temp_path, 'wb') as f:
            f.write(response.content)
        
        print(f"   ✅ Downloaded {filename} ({len(response.content)} bytes)")
        return temp_path
    except Exception as e:
        print(f"   ❌ Failed to download {filename}: {e}")
        return None

def test_xlsx_upload(file_path, expected_sheets=None, expected_rows=None, 
                    expected_defective=None, expected_downtime=None, test_name=""):
    """Test XLSX file upload and parsing"""
    print(f"🧪 Testing XLSX upload: {test_name}")
    
    if not file_path or not file_path.exists():
        print(f"   ❌ File not found: {file_path}")
        return False
    
    try:
        with open(file_path, 'rb') as f:
            files = {'file': (file_path.name, f, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
            response = requests.post(f"{API_BASE}/import/parse-wellmeter", files=files, timeout=60)
        
        print(f"   Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"   ❌ Expected 200, got {response.status_code}")
            print(f"   Response: {response.text}")
            return False
        
        data = response.json()
        
        # Validate response structure
        assert "sheets" in data, "Response missing 'sheets' key"
        assert "file_summary" in data, "Response missing 'file_summary' key"
        assert isinstance(data["sheets"], list), "'sheets' should be a list"
        assert isinstance(data["file_summary"], dict), "'file_summary' should be a dict"
        
        # Check file summary structure
        file_summary = data["file_summary"]
        required_summary_keys = ["sheet_count", "total_rows", "total_defective", "total_downtime", "total_flagged"]
        for key in required_summary_keys:
            assert key in file_summary, f"file_summary missing '{key}'"
        
        print(f"   📊 File Summary:")
        print(f"      Sheets: {file_summary['sheet_count']}")
        print(f"      Total rows: {file_summary['total_rows']}")
        print(f"      Defective: {file_summary['total_defective']}")
        print(f"      Downtime: {file_summary['total_downtime']}")
        print(f"      Flagged: {file_summary['total_flagged']}")
        
        # Validate each sheet structure
        for i, sheet in enumerate(data["sheets"]):
            required_sheet_keys = ["sheet_name", "suggested_well_name", "rows", "summary", "warnings"]
            for key in required_sheet_keys:
                assert key in sheet, f"Sheet {i} missing '{key}'"
            
            # Validate rows structure
            for j, row in enumerate(sheet["rows"][:3]):  # Check first 3 rows
                required_row_keys = ["date", "initial", "final", "volume", "status", "status_raw", 
                                   "include_in_totals", "is_downtime", "flags", "warnings", 
                                   "row_index", "block_index"]
                for key in required_row_keys:
                    assert key in row, f"Sheet {i}, row {j} missing '{key}'"
                
                # Validate status values
                valid_statuses = {"valid", "blend", "blend_shutdown", "defective", "shutoff", 
                                "no_operation", "no_reading", "new_meter", "standby", "tripped", "unknown"}
                assert row["status"] in valid_statuses, f"Invalid status: {row['status']}"
                
                # Validate boolean fields
                assert isinstance(row["include_in_totals"], bool), "include_in_totals should be boolean"
                assert isinstance(row["is_downtime"], bool), "is_downtime should be boolean"
                assert isinstance(row["flags"], list), "flags should be a list"
                assert isinstance(row["warnings"], list), "warnings should be a list"
        
        # Check expected values if provided
        if expected_sheets is not None:
            assert file_summary["sheet_count"] == expected_sheets, \
                f"Expected {expected_sheets} sheets, got {file_summary['sheet_count']}"
        
        if expected_rows is not None:
            assert file_summary["total_rows"] == expected_rows, \
                f"Expected {expected_rows} rows, got {file_summary['total_rows']}"
        
        if expected_defective is not None:
            assert file_summary["total_defective"] >= expected_defective, \
                f"Expected ≥{expected_defective} defective, got {file_summary['total_defective']}"
        
        if expected_downtime is not None:
            assert file_summary["total_downtime"] >= expected_downtime, \
                f"Expected ≥{expected_downtime} downtime, got {file_summary['total_downtime']}"
        
        print(f"   ✅ {test_name} passed all validations")
        return True
        
    except Exception as e:
        print(f"   ❌ {test_name} failed: {e}")
        return False

def test_edge_cases():
    """Test various edge cases that should return 400"""
    print("🧪 Testing edge cases...")
    
    # Test 1: No file field
    print("   Testing empty request...")
    try:
        response = requests.post(f"{API_BASE}/import/parse-wellmeter")
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print("   ✅ Empty request correctly rejected")
    except Exception as e:
        print(f"   ❌ Empty request test failed: {e}")
    
    # Test 2: Empty file
    print("   Testing empty file...")
    try:
        files = {'file': ('empty.xlsx', b'', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        response = requests.post(f"{API_BASE}/import/parse-wellmeter", files=files)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("   ✅ Empty file correctly rejected")
    except Exception as e:
        print(f"   ❌ Empty file test failed: {e}")
    
    # Test 3: Wrong file extension
    print("   Testing wrong file extension...")
    try:
        files = {'file': ('test.pdf', b'fake pdf content', 'application/pdf')}
        response = requests.post(f"{API_BASE}/import/parse-wellmeter", files=files)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("   ✅ Wrong extension correctly rejected")
    except Exception as e:
        print(f"   ❌ Wrong extension test failed: {e}")
    
    # Test 4: Non-XLSX content with .xlsx extension
    print("   Testing fake XLSX file...")
    try:
        files = {'file': ('fake.xlsx', b'This is not an Excel file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        response = requests.post(f"{API_BASE}/import/parse-wellmeter", files=files)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("   ✅ Fake XLSX correctly rejected")
    except Exception as e:
        print(f"   ❌ Fake XLSX test failed: {e}")
    
    # Test 5: Large file (simulate >10MB)
    print("   Testing large file simulation...")
    try:
        # Create a large fake file content
        large_content = b'x' * (11 * 1024 * 1024)  # 11MB
        files = {'file': ('large.xlsx', large_content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        response = requests.post(f"{API_BASE}/import/parse-wellmeter", files=files)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("   ✅ Large file correctly rejected")
    except Exception as e:
        print(f"   ❌ Large file test failed: {e}")

def test_specific_file_requirements():
    """Test specific requirements for each sample file"""
    print("🧪 Testing specific file requirements...")
    
    # Test SRP file specific requirements
    print("   Testing SRP file date range and status detection...")
    srp_url = "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/jwi04ofl_SRP%20Well%20Meter%20Reading%202026_1.xlsx"
    srp_file = download_test_file(srp_url, "srp_test.xlsx")
    
    if srp_file:
        try:
            with open(srp_file, 'rb') as f:
                files = {'file': (srp_file.name, f, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
                response = requests.post(f"{API_BASE}/import/parse-wellmeter", files=files, timeout=60)
            
            if response.status_code == 200:
                data = response.json()
                
                # Check for "Well 2 Meter Reading" sheet
                well2_sheet = None
                for sheet in data["sheets"]:
                    if "Well 2" in sheet["sheet_name"]:
                        well2_sheet = sheet
                        break
                
                if well2_sheet:
                    print(f"      Found Well 2 sheet: {well2_sheet['sheet_name']}")
                    
                    # Check for defective status with include_in_totals=false
                    defective_found = False
                    new_meter_found = False
                    
                    for row in well2_sheet["rows"]:
                        if row["status"] == "defective" and not row["include_in_totals"]:
                            defective_found = True
                        if row["status"] == "new_meter" and row["include_in_totals"]:
                            new_meter_found = True
                    
                    if defective_found:
                        print("      ✅ Found defective status with include_in_totals=false")
                    else:
                        print("      ⚠️ No defective status with include_in_totals=false found")
                    
                    if new_meter_found:
                        print("      ✅ Found new_meter status with include_in_totals=true")
                    else:
                        print("      ⚠️ No new_meter status with include_in_totals=true found")
                
                # Check date range for 2026
                dates_found = []
                for sheet in data["sheets"]:
                    for row in sheet["rows"]:
                        if row["date"] and row["date"].startswith("2026"):
                            dates_found.append(row["date"])
                
                if dates_found:
                    dates_found.sort()
                    print(f"      Date range: {dates_found[0]} to {dates_found[-1]}")
                    if dates_found[0] >= "2026-01-01" and dates_found[-1] <= "2026-03-31":
                        print("      ✅ Dates in expected 2026 Q1 range")
                    else:
                        print("      ⚠️ Dates outside expected 2026-01-01 to 2026-03-31 range")
                
        except Exception as e:
            print(f"      ❌ SRP specific tests failed: {e}")
    
    # Test Umapad file specific requirements
    print("   Testing Umapad file Collection box 2 requirements...")
    umapad_url = "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/xa13et84_UMAPAD%20Well%20Meter%20Reading%202026_2.xlsx"
    umapad_file = download_test_file(umapad_url, "umapad_test.xlsx")
    
    if umapad_file:
        try:
            with open(umapad_file, 'rb') as f:
                files = {'file': (umapad_file.name, f, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
                response = requests.post(f"{API_BASE}/import/parse-wellmeter", files=files, timeout=60)
            
            if response.status_code == 200:
                data = response.json()
                
                # Check for Collection box 2 sheet
                collection_sheet = None
                for sheet in data["sheets"]:
                    if "Collection box 2" in sheet["sheet_name"] or "6am cut-off" in sheet["sheet_name"]:
                        collection_sheet = sheet
                        break
                
                if collection_sheet:
                    print(f"      Found Collection box 2 sheet: {collection_sheet['sheet_name']}")
                    
                    # Check for new_meter status
                    new_meter_found = False
                    for row in collection_sheet["rows"]:
                        if row["status"] == "new_meter":
                            new_meter_found = True
                            break
                    
                    if new_meter_found:
                        print("      ✅ Found new_meter status in Collection box 2")
                    else:
                        print("      ⚠️ No new_meter status found in Collection box 2")
                
        except Exception as e:
            print(f"      ❌ Umapad specific tests failed: {e}")

def main():
    """Run all tests"""
    print("🚀 Starting XLSX Import Endpoint Tests")
    print("=" * 60)
    
    # Test 1: Basic API health
    if not test_basic_api_health():
        print("❌ Basic API health failed, stopping tests")
        return
    
    print()
    
    # Test 2: Edge cases
    test_edge_cases()
    print()
    
    # Test 3: Sample files
    test_files = [
        {
            "url": "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/cv6d08yp_MAMBALING%203%20Well%20Meter%20Reading%202026_2.xlsx",
            "filename": "mambaling_test.xlsx",
            "expected_sheets": 1,
            "expected_rows": 90,
            "expected_defective": 0,
            "expected_downtime": 13,
            "name": "Mambaling file"
        },
        {
            "url": "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/jwi04ofl_SRP%20Well%20Meter%20Reading%202026_1.xlsx",
            "filename": "srp_test.xlsx",
            "expected_sheets": 17,
            "expected_rows": 1533,
            "expected_defective": 51,
            "expected_downtime": 789,
            "name": "SRP file"
        },
        {
            "url": "https://customer-assets.emergentagent.com/job_quality-guard-5/artifacts/xa13et84_UMAPAD%20Well%20Meter%20Reading%202026_2.xlsx",
            "filename": "umapad_test.xlsx",
            "expected_sheets": 6,
            "expected_defective": None,
            "expected_downtime": None,
            "name": "Umapad file"
        }
    ]
    
    success_count = 0
    for test_file in test_files:
        file_path = download_test_file(test_file["url"], test_file["filename"])
        if file_path:
            if test_xlsx_upload(
                file_path, 
                test_file.get("expected_sheets"),
                test_file.get("expected_rows"),
                test_file.get("expected_defective"),
                test_file.get("expected_downtime"),
                test_file["name"]
            ):
                success_count += 1
        print()
    
    # Test 4: Specific requirements
    test_specific_file_requirements()
    
    print("=" * 60)
    print(f"🏁 Tests completed. {success_count}/{len(test_files)} sample files passed")
    
    if success_count == len(test_files):
        print("✅ All critical tests passed!")
    else:
        print("❌ Some tests failed - check output above")

if __name__ == "__main__":
    main()