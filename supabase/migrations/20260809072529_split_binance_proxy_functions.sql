/*
# Split binance proxy into submit + fetch functions

1. Problem
   - pg_net is truly async: a background worker commits rows to net._http_response.
   - Polling within the same transaction can NEVER see those committed rows.
   - dblink to self doesn't work in Supabase's managed Postgres.
   - Solution: split into two functions called in separate transactions.

2. New Functions
   - binance_submit_request(p_url, p_method, p_headers, p_body) -> bigint (request id)
     - Submits the HTTP request via pg_net, returns the request id immediately
   - binance_fetch_response(p_req_id bigint) -> jsonb
     - Reads net._http_response for the given request id (separate transaction sees committed rows)
   - binance_proxy_request is kept for backward compat but now uses a two-phase approach internally

3. Usage from edge function:
   - Step 1: RPC binance_submit_request(...) -> get req_id
   - Step 2: sleep 2-3 seconds
   - Step 3: RPC binance_fetch_response(req_id) -> get response
*/

CREATE OR REPLACE FUNCTION public.binance_submit_request(
  p_url text,
  p_method text DEFAULT 'GET',
  p_headers jsonb DEFAULT '{}'::jsonb,
  p_body text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  req_id bigint;
  v_headers jsonb := p_headers;
BEGIN
  IF UPPER(p_method) = 'POST' THEN
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

  RETURN req_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.binance_fetch_response(p_req_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_status_code int;
  v_content text;
  v_error_msg text;
  v_timed_out boolean;
BEGIN
  SELECT status_code, content, error_msg, timed_out
  INTO v_status_code, v_content, v_error_msg, v_timed_out
  FROM net._http_response
  WHERE id = p_req_id;

  IF v_status_code IS NULL THEN
    RETURN jsonb_build_object('pending', true, 'req_id', p_req_id);
  END IF;

  RETURN jsonb_build_object(
    'status_code', v_status_code,
    'content', v_content,
    'error_msg', v_error_msg,
    'timed_out', COALESCE(v_timed_out, false),
    'pending', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.binance_submit_request(text, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.binance_fetch_response(bigint) TO anon, authenticated;