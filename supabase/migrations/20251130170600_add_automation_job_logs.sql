-- Add logs column to automation_jobs to store execution logs from the
-- Selenium runner (Python Docker / Cloud Run service).

ALTER TABLE public.automation_jobs
ADD COLUMN IF NOT EXISTS logs TEXT;
