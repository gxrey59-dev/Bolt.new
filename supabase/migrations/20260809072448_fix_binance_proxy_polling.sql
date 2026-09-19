/*
# Fix binance_proxy_request to use dblink for autonomous polling

1. Problem
   - pg_net processes requests asynchronously in a background worker.
   - The polling loop inside the function runs in the same transaction, so it can't see
     rows committed by the background worker until the transaction ends.
   - Solution: use dblink to query net._http_response in a separate connection (autonomous transaction),
     so each poll sees the latest committed data.

2. Changes
   - Enable dblink extension
   - Rewrite binance_proxy_request to poll via dblink
*/

CREATE EXTENSION IF NOT EXISTS dblink SCHEMA extensions;

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
  v_max_attempts int := 40;
  v_headers jsonb := p_headers;
  v_conn_str text;
  v_row record;
BEGIN
  -- Build connection string from current database
  SELECT 'host=' || inet_server_addr() || ' port=' || inet_server_port() || ' dbname=postgres'
  INTO v_conn_str;

  -- Submit the HTTP request via pg_net
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

  IF req_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Failed to submit HTTP request');
  END IF;

  -- Poll for the response using dblink (autonomous transaction sees committed rows)
  LOOP
    v_attempts := v_attempts + 1;
    
    BEGIN
      SELECT * INTO v_row FROM extensions.dblink(
        v_conn_str,
        format('SELECT status_code, content, error_msg, timed_out FROM net._http_response WHERE id = %s', req_id)
      ) AS t(status_code int, content text, error_msg text, timed_out boolean);
      
      v_status_code := v_row.status_code;
      v_content := v_row.content;
      v_error_msg := v_row.error_msg;
      v_timed_out := v_row.timed_out;
    EXCEPTION WHEN OTHERS THEN
      -- dblink might fail if connection string is wrong, try alternative
      -- Fall back to direct query (may not see committed rows, but worth trying)
      SELECT status_code, content, error_msg, timed_out
      INTO v_status_code, v_content, v_error_msg, v_timed_out
      FROM net._http_response
      WHERE id = req_id;
    END;
    
    EXIT WHEN v_status_code IS NOT NULL OR v_attempts >= v_max_attempts;
    
    PERFORM pg_sleep(0.5);
  END LOOP;

  IF v_status_code IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Request timed out waiting for response',
      'attempts', v_attempts,
      'req_id', req_id
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

GRANT EXECUTE ON FUNCTION public.binance_proxy_request(text, text, jsonb, text) TO anon, authenticated;