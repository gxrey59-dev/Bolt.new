REVOKE EXECUTE ON FUNCTION public.is_app_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_app_operator() TO authenticated, service_role;