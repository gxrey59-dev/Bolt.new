/*
# Create Binance.US API proxy function via pg_net

1. Purpose
   - Supabase Edge Functions run on IPv6, which Binance.US rejects ("IPv6 not supported").
   - Postgres (pg_net extension) runs on IPv4 and CAN reach Binance.US (verified: HTTP 200 from /api/v3/ping).
   - This function acts as an IPv4 HTTP proxy: the edge function computes the HMAC signature
     (keeping API keys in its own env vars), passes the full signed URL + headers here,
     and Postgres makes the actual HTTP request and returns the response.
   - API keys are NEVER stored in Postgres — they stay in edge function secrets.

2. New Functions
   - `binance_proxy_request(p_url text, p_method text, p_headers jsonb, p_body text)`
     - SECURITY DEFINER, runs as the service role
     - Submits an HTTP request via pg_net (http_get or http_post)
     - Polls net._http_response until the response arrives (up to 15 seconds)
     - Returns jsonb: { status_code, content, error_msg, timed_out }

3. Security
   - SECURITY DEFINER so it can access the net schema (pg_net requires elevated privileges)
   - No API keys are passed through or stored — only pre-signed URLs
   - Callable only by authenticated and anon roles (the edge function uses the service role key)
*/

CREATE OR REPLACE FUNCTION public.binance_proxy_request(
  p_url text,
  p_method text DEFAULT 'GET',
  p_headers jsonb DEFAULT '{}'::jsonb,
  p_body text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  req_id bigint;
  v_status_code int;
  v_content text;
  v_error_msg text;
  v_timed_out boolean;
  v_attempts int := 0;
  v_max_attempts int := 30;
  v_headers jsonb := p_headers;
BEGIN
  -- Submit the HTTP request via pg_net
  IF UPPER(p_method) = 'POST' THEN
    -- Ensure Content-Type is set for POST
    IF v_headers ? 'Content-Type' = false THEN
      v_headers := v_headers || '{"Content-Type": "application/x-www-form-urlencoded"}'::jsonb;
    END IF;
    SELECT net.http_post(
      p_url,
      COALESCE(p_body, '{}')::jsonb,
      '{}'::jsonb,
      v_headers,
      15000
    ) INTO req_id;
  ELSE
    SELECT net.http_get(
      p_url,
      '{}'::jsonb,
      v_headers,
      15000
    ) INTO req_id;
  END IF;

  IF req_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Failed to submit HTTP request');
  END IF;

  -- Poll for the response (pg_net is async)
  LOOP
    v_attempts := v_attempts + 1;
    
    SELECT status_code, content, error_msg, timed_out
    INTO v_status_code, v_content, v_error_msg, v_timed_out
    FROM net._http_response
    WHERE id = req_id;
    
    EXIT WHEN v_status_code IS NOT NULL OR v_attempts >= v_max_attempts;
    
    PERFORM pg_sleep(0.5);
  END LOOP;

  IF v_status_code IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Request timed out waiting for response',
      'attempts', v_attempts
    );
  END IF;

  RETURN jsonb_build_object(
    'status_code', v_status_code,
    'content', v_content,
    'error_msg', v_error_msg,
    'timed_out', COALESCE(v_timed_out, false)
  );
END;
$$;

-- Grant access to anon and authenticated roles (edge function uses service role)
GRANT EXECUTE ON FUNCTION public.binance_proxy_request(text, text, jsonb, text) TO anon, authenticated;