
REVOKE ALL ON FUNCTION public.register_deliverer(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_deliverer_role(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_deliverer(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_deliverer_role(uuid, boolean) TO authenticated;
