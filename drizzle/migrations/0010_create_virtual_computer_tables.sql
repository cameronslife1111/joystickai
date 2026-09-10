-- Virtual Computer (Browser Use cloud) support tables.

-- One reusable cloud browser profile per user, so logins persist between tasks.
CREATE TABLE public.vc_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider_profile_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT ON public.vc_profiles TO authenticated;
GRANT ALL ON public.vc_profiles TO service_role;
ALTER TABLE public.vc_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vc_profiles owner read" ON public.vc_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER vc_profiles_touch BEFORE UPDATE ON public.vc_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Encrypted per-site credentials. Values are AES-GCM encrypted server-side and
-- are never selectable by the app; only server code (service role) reads them.
CREATE TABLE public.vc_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  domain text NOT NULL,
  alias text NOT NULL,
  label text,
  cipher text NOT NULL,
  one_time boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain, alias)
);
GRANT ALL ON public.vc_secrets TO service_role;
ALTER TABLE public.vc_secrets ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER vc_secrets_touch BEFORE UPDATE ON public.vc_secrets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- One virtual-computer task run.
CREATE TABLE public.vc_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  step_index integer,
  thread_id uuid REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  task text NOT NULL,
  start_url text,
  allowed_domains text[] NOT NULL DEFAULT '{}',
  provider_run_id text,
  session_id text,
  browser_id text,
  live_view_url text,
  status text NOT NULL DEFAULT 'starting',
  phase_text text,
  result text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  cost_usd numeric,
  secret_request jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT (now() + interval '8 minutes'),
  poll_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vc_runs TO authenticated;
GRANT ALL ON public.vc_runs TO service_role;
ALTER TABLE public.vc_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vc_runs owner read" ON public.vc_runs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER vc_runs_touch BEFORE UPDATE ON public.vc_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX vc_runs_active_idx ON public.vc_runs (status, updated_at);
CREATE INDEX vc_runs_user_idx ON public.vc_runs (user_id, created_at DESC);