-- Revoke EXECUTE from PUBLIC on SECURITY DEFINER helper functions.
-- anon and authenticated inherit from PUBLIC, so the earlier revoke was insufficient.
-- These functions are only called by edge functions using the service_role key.

REVOKE EXECUTE ON FUNCTION public.binance_fetch_response(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.binance_http_call(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.binance_proxy_request(text, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.binance_submit_request(text, text, jsonb, text) FROM PUBLIC;
