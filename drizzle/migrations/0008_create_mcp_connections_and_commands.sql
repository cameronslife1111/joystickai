CREATE TABLE public.mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  pairing_code text,
  pairing_expires_at timestamptz,
  token_hash text,
  server_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE UNIQUE INDEX mcp_connections_pairing_code_idx ON public.mcp_connections (pairing_code) WHERE pairing_code IS NOT NULL;
CREATE UNIQUE INDEX mcp_connections_token_hash_idx ON public.mcp_connections (token_hash) WHERE token_hash IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_connections TO authenticated;
GRANT ALL ON public.mcp_connections TO service_role;

ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own mcp_connections select" ON public.mcp_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mcp_connections insert" ON public.mcp_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mcp_connections update" ON public.mcp_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mcp_connections delete" ON public.mcp_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER mcp_connections_touch BEFORE UPDATE ON public.mcp_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.mcp_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX mcp_commands_queue_idx ON public.mcp_commands (connection_id, status, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_commands TO authenticated;
GRANT ALL ON public.mcp_commands TO service_role;

ALTER TABLE public.mcp_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own mcp_commands select" ON public.mcp_commands FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mcp_commands insert" ON public.mcp_commands FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mcp_commands update" ON public.mcp_commands FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mcp_commands delete" ON public.mcp_commands FOR DELETE TO authenticated USING (auth.uid() = user_id);
