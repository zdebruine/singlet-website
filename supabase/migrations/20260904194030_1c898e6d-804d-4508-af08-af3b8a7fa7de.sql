-- The catalog API only needs validity; the owner is resolved server-side by
-- the edge functions (service role) when a request has to be charged.
DROP FUNCTION IF EXISTS public.resolve_api_key(text);

CREATE OR REPLACE FUNCTION public.resolve_api_key(_key_hash text)
RETURNS TABLE (key_id uuid, expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.expires_at, k.revoked_at, k.last_used_at
    FROM public.api_keys k
   WHERE k.key_hash = _key_hash
$$;

REVOKE ALL ON FUNCTION public.resolve_api_key(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_api_key(text) TO anon, authenticated, service_role;