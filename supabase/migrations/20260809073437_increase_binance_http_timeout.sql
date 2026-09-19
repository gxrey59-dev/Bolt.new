/*
# Increase timeout for binance_http_call

1. Problem
   - Forcing IPv4 causes connection timeout (1002ms) to api.binance.us:443
   - The default timeout for the http extension is too short
   - Need to increase CURLOPT_TIMEOUT

2. Changes
   - Set CURLOPT_TIMEOUT to 15 seconds
   - Set CURLOPT_CONNECTTIMEOUT to 10 seconds
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
  -- Force IPv4 only and set generous timeouts
  PERFORM extensions.http_set_curlopt('CURLOPT_IPRESOLVE', '1');
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
  PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '10');
  
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