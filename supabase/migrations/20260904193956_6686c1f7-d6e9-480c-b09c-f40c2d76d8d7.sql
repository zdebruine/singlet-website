-- Personal API keys. Only the SHA-256 hash of the secret is stored; the
-- plain key is shown once at creation and never again.
CREATE TABLE public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX api_keys_user_id_idx ON public.api_keys (user_id, created_at DESC);

GRANT SELECT ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their own API keys"
  ON public.api_keys
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies on purpose: the api-keys edge function
-- (service role) is the only writer, so hashing lives in one place.

-- Look a key up by hash. Returns nothing for an unknown hash. Callers decide
-- what expired / revoked means (they get the timestamps back).
CREATE OR REPLACE FUNCTION public.resolve_api_key(_key_hash text)
RETURNS TABLE (key_id uuid, user_id uuid, expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.user_id, k.expires_at, k.revoked_at, k.last_used_at
    FROM public.api_keys k
   WHERE k.key_hash = _key_hash
$$;

-- Record use, at most once every 5 minutes per key (keeps writes cheap).
CREATE OR REPLACE FUNCTION public.touch_api_key(_key_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.api_keys
     SET last_used_at = now()
   WHERE key_hash = _key_hash
     AND revoked_at IS NULL
     AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')
$$;

REVOKE ALL ON FUNCTION public.resolve_api_key(text) FROM public;
REVOKE ALL ON FUNCTION public.touch_api_key(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_api_key(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_api_key(text) TO anon, authenticated, service_role;