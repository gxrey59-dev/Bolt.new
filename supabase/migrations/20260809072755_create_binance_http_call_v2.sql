/*
# Create binance_http_call function using http extension with custom headers

1. Purpose
   - The `http` extension uses libcurl (IPv4), bypassing Binance.US's IPv6 block.
   - Verified: signed endpoint returns "API-key format invalid" (not "IPv6 not supported") = IPv4 works.
   - This function constructs an http_request with the X-MBX-APIKEY header and calls extensions.http().
   - The edge function computes the HMAC signature (API keys stay in env vars), passes the signed URL
     and API key here, and Postgres makes the actual HTTP request via libcurl over IPv4.

2. New Functions
   - `binance_http_call(p_url text, p_api_key text, p_method text, p_body text)`
     - SECURITY DEFINER, runs as service role
     - Constructs an http_request with custom headers and calls extensions.http()
     - Returns jsonb: { status_code, content, error }

3. Security
   - SECURITY DEFINER so it can access the extensions schema
   - API keys passed as parameters, never stored in the database
   - Callable by anon and authenticated roles
*/

-- Drop old version first (different signature: had p_api_key as 2nd param)
DROP FUNCTION IF EXISTS public.binance_http_call(text, text, text, text);

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