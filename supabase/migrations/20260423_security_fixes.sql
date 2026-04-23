-- Comprehensive RLS Policy Fixes for Plant Monitoring

-- 1) profiles_select_own and profiles_select_admin policies restricting profile visibility
CREATE OR REPLACE POLICY profiles_select_own ON profiles
FOR SELECT
USING (auth.uid() = user_id OR has_role('admin'));

CREATE OR REPLACE POLICY profiles_select_admin ON profiles
FOR SELECT
USING (has_role('admin'));

-- 2) profiles_update_self_safe policy preventing plant_assignments and status modification
CREATE OR REPLACE POLICY profiles_update_self_safe ON profiles
FOR UPDATE
USING (auth.uid() = user_id AND NOT (status IS DISTINCT FROM EXCLUDED.status OR plant_assignments IS DISTINCT FROM EXCLUDED.plant_assignments));

-- 3) profiles_update_admin_all for admin full access
CREATE OR REPLACE POLICY profiles_update_admin_all ON profiles
FOR UPDATE
USING (has_role('admin'));

-- 4) roles_admin_only_write for role management
CREATE OR REPLACE POLICY roles_admin_only_write ON roles
FOR INSERT, UPDATE, DELETE
USING (has_role('admin'));

-- Secure SECURITY DEFINER functions with proper authorization checks
CREATE OR REPLACE FUNCTION admin_update_user_status(user_id UUID, new_status TEXT) RETURNS VOID
AS $$
BEGIN
    IF has_role('admin') THEN
        UPDATE users SET status = new_status WHERE id = user_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_assign_plant_to_user(user_id UUID, plant_id UUID) RETURNS VOID
AS $$
BEGIN
    IF has_role('admin') THEN
        INSERT INTO plant_assignments(user_id, plant_id) VALUES (user_id, plant_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_remove_plant_from_user(user_id UUID, plant_id UUID) RETURNS VOID
AS $$
BEGIN
    IF has_role('admin') THEN
        DELETE FROM plant_assignments WHERE user_id = user_id AND plant_id = plant_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_assign_role(user_id UUID, role_name TEXT) RETURNS VOID
AS $$
BEGIN
    IF has_role('admin') THEN
        INSERT INTO user_roles(user_id, role_name) VALUES (user_id, role_name);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_remove_role(user_id UUID, role_name TEXT) RETURNS VOID
AS $$
BEGIN
    IF has_role('admin') THEN
        DELETE FROM user_roles WHERE user_id = user_id AND role_name = role_name;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant statements to authenticated role
GRANT EXECUTE ON FUNCTION admin_update_user_status TO authenticated;
GRANT EXECUTE ON FUNCTION admin_assign_plant_to_user TO authenticated;
GRANT EXECUTE ON FUNCTION admin_remove_plant_from_user TO authenticated;
GRANT EXECUTE ON FUNCTION admin_assign_role TO authenticated;
GRANT EXECUTE ON FUNCTION admin_remove_role TO authenticated;