import os
import sys
from datetime import datetime
from supabase import create_client, Client
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service  # <--- Added Import
from webdriver_manager.chrome import ChromeDriverManager

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# Bucket used to store automation screenshots. Can be overridden via env.
BUCKET_NAME = os.getenv("SUPABASE_SCREENSHOT_BUCKET", "automation-screenshots")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def update_job(job_id: str, **fields):
    supabase.table("automation_jobs").update(fields).eq("id", job_id).execute()

def ensure_bucket(bucket: str) -> None:
    """Ensure the given storage bucket exists.

    In GitHub Actions we may be pointed at a fresh Supabase project where the
    expected bucket was never created. This makes the script resilient by
    creating the bucket on first use.
    """
    try:
        buckets = supabase.storage.list_buckets()
    except Exception:
        # If listing fails for some reason, just return and let upload surface
        # a more useful error rather than hiding it here.
        return

    def _bucket_name(b):
        # Handles both dicts and objects returned by storage3.
        return getattr(b, "name", b.get("name") if isinstance(b, dict) else None)

    if not any(_bucket_name(b) == bucket for b in buckets):
        # Create as public so get_public_url works without signed URLs.
        supabase.storage.create_bucket(bucket, public=True)

def upload_screenshot(job_id: str, path: str) -> str:
    bucket = BUCKET_NAME
    ensure_bucket(bucket)
    storage_path = f"{job_id}/{os.path.basename(path)}"
    with open(path, "rb") as f:
        supabase.storage.from_(bucket).upload(storage_path, f, {"upsert": "true"})
    public_url = supabase.storage.from_(bucket).get_public_url(storage_path)
    update_job(job_id, latest_screenshot_url=public_url)
    return public_url

def main(job_id: str):
    # 1) Fetch script from Supabase
    res = supabase.table("automation_jobs").select("script").eq("id", job_id).single().execute()
    script = res.data["script"]

    # 2) Mark job as running
    update_job(job_id, status="running")

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")

    driver = None
    try:
        # --- FIXED BLOCK START ---
        # Use the Service class to pass the executable path
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
        # --- FIXED BLOCK END ---

        # Provide driver + helper log to the script's namespace
        def log(msg: str):
            print(msg, flush=True)

        exec_globals = {"driver": driver, "log": log}
        exec(script, exec_globals, {})

        # Optional: always capture at least one screenshot
        screenshot_name = f"{job_id}-{datetime.utcnow().isoformat()}.png"
        driver.save_screenshot(screenshot_name)
        upload_screenshot(job_id, screenshot_name)

        update_job(job_id, status="completed", error_message=None)
    except Exception as e:
        update_job(job_id, status="failed", error_message=str(e))
        raise
    finally:
        if driver:
            driver.quit()

if __name__ == "__main__":
    jid = sys.argv[1]
    main(jid)
