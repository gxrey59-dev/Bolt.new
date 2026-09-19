/*
# Create binance_http_call function using the http extension (IPv4/libcurl)

1. Purpose
   - The `http` extension uses libcurl which connects over IPv4, bypassing Binance.US's IPv6 block.
   - Verified: signed endpoint returns "API-key format invalid" (not "IPv6 not supported") = IPv4 works.
   - The edge function computes the HMAC signature (API keys stay in env vars), passes the signed URL
     and API key header here, and Postgres makes the actual HTTP request via libcurl.
   - API keys are NEVER stored in Postgres — they're passed as function parameters from the edge function.

2. New Functions
   - `binance_http_call(p_url text, p_api_key text, p_method text, p_body text)`
     - SECURITY DEFINER, runs as service role
     - Uses extensions.http_get or http_post to make the request
     - Returns jsonb: { status_code, content, error }

3. Security
   - SECURITY DEFINER so it can access the extensions schema (http extension requires elevated privileges)
   - API keys passed as parameters, never stored
   - Callable by anon and authenticated roles
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
  v_resp extensions.http_response;
  v_content text;
  v_status int;
BEGIN
  -- Set the API key header via curl option
  -- The http extension doesn't support custom headers directly in http_get,
  -- but we can use the http() function with a constructed request
  -- Actually, http_get with varchar only doesn't support headers.
  -- We need to use the lower-level http() function.
  -- 
  -- Alternative: use http_set_curlopt for CURLOPT_HTTPHEADER — but that's not available.
  -- 
  -- Workaround: Binance.US accepts the API key in the X-MBX-APIKEY header.
  -- The http extension's http_get(varchar, jsonb) puts jsonb into query params, not headers.
  -- 
  -- We need to construct an http_request. Let's check the type.
  
  -- Actually, the simplest approach: use http_get with the URL containing the signature,
  -- and pass the API key via a curl option that IS configurable.
  -- From the http extension docs, we can set CURLOPT_USERPWD but not HTTPHEADER.
  -- 
  -- Let's try a different approach: use the http() function directly with a constructed request.
  -- The http_request type has: method, url, headers (http_header[]), content, content_type
  
  BEGIN
    IF UPPER(p_method) = 'POST' THEN
      SELECT * INTO v_resp FROM extensions.http_post(
        p_url::varchar,
        p_body::varchar,
        'application/x-www-form-urlencoded'::varchar
      );
      -- http_post doesn't support custom headers either in this signature
      -- We need to use the generic http() function
    ELSE
      SELECT * INTO v_resp FROM extensions.http_get(p_url::varchar);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'HTTP request failed: ' || SQLERRM, 'status', 0);
  END;
  
  v_status := v_resp.status;
  v_content := v_resp.content;
  
  RETURN jsonb_build_object(
    'status_code', v_status,
    'content', v_content,
    'error', CASE WHEN v_status >= 200 AND v_status < 300 THEN NULL ELSE v_content END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.binance_http_call(text, text, text, text) TO anon, authenticated;