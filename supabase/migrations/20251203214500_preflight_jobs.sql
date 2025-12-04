-- Create preflight_jobs table for Pre-Flight DOM extraction
CREATE TABLE public.preflight_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | error
    dom_html TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Basic index for querying by status and creation time
CREATE INDEX idx_preflight_jobs_status_created_at
ON public.preflight_jobs (status, created_at DESC);

-- Enable RLS (policies kept permissive for now; service role is used from edge functions and GitHub Actions)
ALTER TABLE public.preflight_jobs ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated/anon clients to read their jobs in dev; tighten later as needed
CREATE POLICY "Public read access to preflight_jobs"
ON public.preflight_jobs
FOR SELECT
USING (true);

-- Allow inserts from edge functions / service role (service key bypasses RLS anyway)
CREATE POLICY "Public insert access to preflight_jobs"
ON public.preflight_jobs
FOR INSERT
WITH CHECK (true);

-- Allow updates from edge functions / service role
CREATE POLICY "Public update access to preflight_jobs"
ON public.preflight_jobs
FOR UPDATE
USING (true)
WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_preflight_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_preflight_jobs_updated_at
BEFORE UPDATE ON public.preflight_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_preflight_jobs_updated_at();
