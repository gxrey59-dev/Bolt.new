/*
# Fix binance_http_call to force IPv4 via CURLOPT_IPRESOLVE

1. Problem
   - The `http` extension (libcurl) defaults to IPv6 in Supabase's Postgres.
   - CURLOPT_IPRESOLVE must be set per-session; it doesn't persist across RPC connections.
   - Binance.US rejects IPv6 connections on signed endpoints with "IPv6 not supported".

2. Changes
   - Add `PERFORM extensions.http_set_curlopt('CURLOPT_IPRESOLVE', '1')` at the start of binance_http_call
   - CURLOPT_IPRESOLVE = 1 means CURL_IPRESOLVE_V4 (force IPv4 only)
   - Also reset after the request to avoid affecting other sessions
*/

CREATE OR REPLACE FUNCTION public.binance_http_call(
  p_url text,
  p_api_key text,
  p_method text DEFAULT 'GET',
  p_body text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req extensions.http_request;
  v_resp extensions.http_response;
BEGIN
  -- Force IPv4 only (CURL_IPRESOLVE_V4 = 1)
  PERFORM extensions.http_set_curlopt('CURLOPT_IPRESOLVE', '1');
  
  v_req.method := UPPER(p_method)::extensions.http_method;
  v_req.uri := p_url;
  v_req.headers := ARRAY[extensions.http_header('X-MBX-APIKEY', p_api_key)];
  
  IF UPPER(p_method) = 'POST' AND p_body IS NOT NULL THEN
    v_req.content_type := 'application/x-www-form-urlencoded';
    v_req.content := p_body;
  ELSE
    v_req.content_type := 'application/json';
    v_req.content := '';
  END IF;
  
  SELECT * INTO v_resp FROM extensions.http(v_req);
  
  -- Reset curl options to default
  PERFORM extensions.http_reset_curlopt();
  
  RETURN jsonb_build_object(
    'status_code', v_resp.status,
    'content', v_resp.content,
    'error', CASE WHEN v_resp.status >= 200 AND v_resp.status < 300 THEN NULL ELSE v_resp.content END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.binance_http_call(text, text, text, text) TO anon, authenticated;