-- Migration File: 20260423_security_fixes.sql
-- These migrations contain security policies and helper functions to enhance system security

-- 1. Security Fix: Prevent users from reading all profiles
CREATE POLICY "select_own_profile" ON profiles
FOR SELECT
USING (auth.uid() = user_id);

-- 2. Security Fix: Prevent users from escalating plant access
CREATE POLICY "select_own_plant" ON plants
FOR SELECT
USING (auth.uid() = owner_id);

-- 3. Security Fix: Prevent self-reactivation of suspended accounts
CREATE OR REPLACE FUNCTION admin_reactivate_account(user_id uuid)
RETURNS void AS $$
BEGIN
  IF (SELECT status FROM users WHERE id = user_id) = 'suspended' THEN
    UPDATE users SET status = 'active' WHERE id = user_id AND EXISTS (SELECT 1 FROM admins WHERE uid = auth.uid());
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant execute on admin_reactivate_account function to admin role
GRANT EXECUTE ON FUNCTION admin_reactivate_account(uuid) TO admin;

-- Additional checks and functions can be added here as necessary.