-- ── profiles ────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── ai_search_usage ─────────────────────────────────────────────────────────
-- One row per (subject, UTC day, kind). subject is 'user:<uuid>' or 'anon:<hash>'.
CREATE TABLE public.ai_search_usage (
  subject text NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  kind text NOT NULL DEFAULT 'search' CHECK (kind IN ('search', 'explain')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 0,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, day, kind)
);
CREATE INDEX ai_search_usage_user_day_idx ON public.ai_search_usage (user_id, day) WHERE user_id IS NOT NULL;
CREATE INDEX ai_search_usage_day_idx ON public.ai_search_usage (day);
GRANT SELECT ON public.ai_search_usage TO authenticated;
GRANT ALL ON public.ai_search_usage TO service_role;
ALTER TABLE public.ai_search_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_search_usage_select_own" ON public.ai_search_usage FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Atomic "take one from today's budget". Returns the state after the call.
CREATE OR REPLACE FUNCTION public.consume_ai_search(_subject text, _user_id uuid, _kind text, _limit integer)
RETURNS TABLE(allowed boolean, used integer, "limit" integer, resets_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'utc')::date;
  _count integer;
BEGIN
  IF _kind NOT IN ('search', 'explain') THEN
    RAISE EXCEPTION 'invalid kind %', _kind;
  END IF;
  INSERT INTO public.ai_search_usage AS u (subject, day, kind, user_id, count)
  VALUES (_subject, _today, _kind, _user_id, 1)
  ON CONFLICT (subject, day, kind) DO UPDATE
    SET count = u.count + 1,
        last_at = now(),
        user_id = COALESCE(u.user_id, EXCLUDED.user_id)
    WHERE u.count < _limit
  RETURNING u.count INTO _count;

  IF _count IS NULL THEN
    SELECT u.count INTO _count FROM public.ai_search_usage u
     WHERE u.subject = _subject AND u.day = _today AND u.kind = _kind;
    RETURN QUERY SELECT false, COALESCE(_count, _limit), _limit, ((_today + 1)::timestamp AT TIME ZONE 'utc');
  ELSE
    RETURN QUERY SELECT true, _count, _limit, ((_today + 1)::timestamp AT TIME ZONE 'utc');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_search(text, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_ai_search(text, uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_search(text, uuid, text, integer) TO service_role;

-- Read-only peek for the signed-in usage counter (own rows only, no increment).
CREATE OR REPLACE FUNCTION public.my_ai_usage_today()
RETURNS TABLE(kind text, used integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT kind, count FROM public.ai_search_usage
   WHERE user_id = auth.uid() AND day = (now() AT TIME ZONE 'utc')::date;
$$;
GRANT EXECUTE ON FUNCTION public.my_ai_usage_today() TO authenticated;

-- ── explanations (backend-only cache) ───────────────────────────────────────
CREATE TABLE public.explanations (
  cache_key text PRIMARY KEY,
  query_norm text NOT NULL,
  gse_id text NOT NULL,
  explanation text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX explanations_gse_idx ON public.explanations (gse_id);
GRANT ALL ON public.explanations TO service_role;
ALTER TABLE public.explanations ENABLE ROW LEVEL SECURITY;
