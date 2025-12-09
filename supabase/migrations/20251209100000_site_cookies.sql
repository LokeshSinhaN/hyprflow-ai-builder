-- Cookie vault per site/domain for pre-flight DOM capture
CREATE TABLE public.site_cookies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL, -- normalized hostname, e.g. "www.mayoclinic.org"
    label TEXT,
    cookies_json TEXT NOT NULL, -- raw EditThisCookie JSON array
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_cookies_domain
ON public.site_cookies (domain);

-- For now, keep RLS permissive (we will tighten later).
ALTER TABLE public.site_cookies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to site_cookies"
ON public.site_cookies
FOR SELECT
USING (true);

CREATE POLICY "Public insert access to site_cookies"
ON public.site_cookies
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Public update access to site_cookies"
ON public.site_cookies
FOR UPDATE
USING (true)
WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_site_cookies_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_site_cookies_updated_at
BEFORE UPDATE ON public.site_cookies
FOR EACH ROW
EXECUTE FUNCTION public.update_site_cookies_updated_at();
