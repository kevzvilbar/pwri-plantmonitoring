-- ============================================================================
-- Migration: 20260918000001_push_subscriptions.sql
-- Description: Web Push Notifications Subscriptions Table & RLS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast user subscription lookups
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id 
    ON public.push_subscriptions(user_id);

-- Enable Row Level Security
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view only their own push subscriptions
DROP POLICY IF EXISTS "push_subscriptions_own_select" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own_select" ON public.push_subscriptions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- RLS: Users can register their own push subscriptions
DROP POLICY IF EXISTS "push_subscriptions_own_insert" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own_insert" ON public.push_subscriptions
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- RLS: Users can update their own subscriptions
DROP POLICY IF EXISTS "push_subscriptions_own_update" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own_update" ON public.push_subscriptions
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RLS: Users can remove their own subscriptions
DROP POLICY IF EXISTS "push_subscriptions_own_delete" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own_delete" ON public.push_subscriptions
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- Grants
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

-- RPC helper to upsert subscription atomically
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
    p_endpoint TEXT,
    p_p256dh TEXT,
    p_auth TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS public.push_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_result public.push_subscriptions;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to register push subscriptions';
    END IF;

    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
    VALUES (v_user_id, p_endpoint, p_p256dh, p_auth, p_user_agent, now())
    ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = COALESCE(EXCLUDED.user_agent, public.push_subscriptions.user_agent),
        updated_at = now()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(TEXT, TEXT, TEXT, TEXT) TO service_role;

