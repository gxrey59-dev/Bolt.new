/*
# Revert IPv4 force — use default connection (IPv6 works for public endpoints)

1. Problem
   - Forcing IPv4 (CURLOPT_IPRESOLVE=1) causes connection timeouts
   - Supabase Postgres has no outbound IPv4 to external hosts
   - The default (IPv6) was actually working — the "IPv6 not supported" error
     only comes from Binance's signed endpoints, not from connectivity issues

2. Findings
   - extensions.http_get to /api/v3/ping → 200 OK (works via IPv6)
   - extensions.http_get to /sapi/v1/capital/config/getall with dummy key → -2014 "API-key format invalid" (reaches Binance!)
   - Edge function calling same function via RPC → -71012 "IPv6 not supported"
   
3. Conclusion
   - The http extension CAN reach Binance.US signed endpoints via IPv6
   - The "IPv6 not supported" error is Binance's APPLICATION-LEVEL check, not a network issue
   - Binance checks the connecting IP and rejects IPv6 on signed endpoints
   - There is NO way around this from Supabase (both edge functions and Postgres use IPv6)
   
4. Changes
   - Remove CURLOPT_IPRESOLVE force
   - Keep the function working for when an IPv4 proxy is available
   - The edge function will use simulation fallback when IPv6 is detected
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
  
  RETURN jsonb_build_object(
    'status_code', v_resp.status,
    'content', v_resp.content,
    'error', CASE WHEN v_resp.status >= 200 AND v_resp.status < 300 THEN NULL ELSE v_resp.content END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.binance_http_call(text, text, text, text) TO anon, authenticated;