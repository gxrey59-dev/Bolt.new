-- Revoke EXECUTE on SECURITY DEFINER helper functions from anon and authenticated.
-- These are internal functions called only by edge functions using the service role key.
-- Public API access would let anyone proxy arbitrary requests through the Binance API.

REVOKE EXECUTE ON FUNCTION public.binance_fetch_response(bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.binance_http_call(text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.binance_proxy_request(text, text, jsonb, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.binance_submit_request(text, text, jsonb, text) FROM anon, authenticated;
