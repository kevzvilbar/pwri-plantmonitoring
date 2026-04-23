-- Security Fixes for RLS Policies and Admin Functions

-- 1. Profile Visibility
-- Ensure that users can only see profiles they are authorized to view.
ALTER POLICY profile_visibility ON profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- 2. Plant Access Escalation
-- Restrict access to plant records to prevent unauthorized escalation.
ALTER POLICY plant_access ON plants
  FOR SELECT, UPDATE
  USING (auth.uid() = owner_id OR is_admin);

-- 3. Suspension Bypass
-- Prevent users from bypassing their suspension status.
ALTER POLICY suspension_check ON users
  FOR SELECT
  USING (active = true AND (auth.uid() = user_id OR is_admin));

-- 4. Role Manipulation Vulnerabilities
-- Ensure that role assignments cannot be altered by unauthorized users.
ALTER POLICY role_management ON users
  FOR UPDATE
  USING (auth.uid() = user_id AND is_admin);

-- Additional security measures can include logging access attempts and monitoring suspicious activities.