/*
# Subscription checkout claims

1. New tables
- `subscription_checkout_attempts`: one in-flight subscription checkout per user and tier,
  so a double-click or retry can never create two payable checkouts. Server-only.

2. New server-only functions
- `claim_subscription_checkout`, `attach_subscription_checkout`, `release_subscription_checkout`.

3. Security
- RLS enabled, no policies; all privileges revoked from browser roles; server role only.
*/

CREATE TABLE IF NOT EXISTS public.subscription_checkout_attempts (
  user_id uuid NOT NULL,
  tier text NOT NULL,
  attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  checkout_params jsonb NOT NULL,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,tier),
  UNIQUE(attempt_id),
  UNIQUE(stripe_session_id),
  CHECK(tier='pro'),
  CHECK(jsonb_typeof(checkout_params)='object')
);
ALTER TABLE public.subscription_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_checkout_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.subscription_checkout_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.claim_subscription_checkout(p_user_id uuid,p_tier text,p_checkout_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE attempt public.subscription_checkout_attempts%ROWTYPE;
BEGIN
  INSERT INTO public.subscription_checkout_attempts(user_id,tier,checkout_params)
  VALUES(p_user_id,p_tier,p_checkout_params) ON CONFLICT(user_id,tier) DO NOTHING;
  SELECT * INTO STRICT attempt FROM public.subscription_checkout_attempts
    WHERE user_id=p_user_id AND tier=p_tier;
  RETURN to_jsonb(attempt);
END $$;
REVOKE ALL ON FUNCTION public.claim_subscription_checkout(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscription_checkout(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.attach_subscription_checkout(p_user_id uuid,p_tier text,p_attempt_id uuid,p_session_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_session_id IS NULL OR p_session_id NOT LIKE 'cs_%' THEN RAISE EXCEPTION 'Invalid checkout session'; END IF;
  UPDATE public.subscription_checkout_attempts SET stripe_session_id=p_session_id,updated_at=now()
  WHERE user_id=p_user_id AND tier=p_tier AND attempt_id=p_attempt_id
    AND (stripe_session_id IS NULL OR stripe_session_id=p_session_id);
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.attach_subscription_checkout(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_subscription_checkout(uuid,text,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_subscription_checkout(p_user_id uuid,p_tier text,p_attempt_id uuid,p_session_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_session_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.subscription_checkout_attempts
  WHERE user_id=p_user_id AND tier=p_tier AND attempt_id=p_attempt_id AND stripe_session_id=p_session_id;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.release_subscription_checkout(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_subscription_checkout(uuid,text,uuid,text) TO service_role;
