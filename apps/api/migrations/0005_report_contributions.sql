CREATE TABLE public.report_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX report_contributors_expiry_idx ON public.report_contributors(expires_at);

CREATE TABLE public.report_contributions (
  report_id uuid PRIMARY KEY REFERENCES public.reports(id) ON DELETE CASCADE,
  contributor_id uuid REFERENCES public.report_contributors(id) ON DELETE SET NULL,
  network_hash text,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > observed_at)
);
CREATE INDEX report_contributions_actor_idx ON public.report_contributions(contributor_id);
CREATE INDEX report_contributions_network_idx ON public.report_contributions(network_hash);

CREATE TABLE public.report_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX report_rate_limits_expiry_idx ON public.report_rate_limits(expires_at);
