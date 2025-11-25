import os
import sys
from datetime import datetime
from supabase import create_client, Client
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service  # <--- Added Import
from selenium.common.exceptions import WebDriverException
from webdriver_manager.chrome import ChromeDriverManager

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# Bucket used to store automation screenshots. Can be overridden via env.
BUCKET_NAME = os.getenv("SUPABASE_SCREENSHOT_BUCKET", "automation-screenshots")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def update_job(job_id: str, **fields):
    supabase.table("automation_jobs").update(fields).eq("id", job_id).execute()

def upload_screenshot(job_id: str, path: str) -> str:
    bucket = BUCKET_NAME
    storage_path = f"{job_id}/{os.path.basename(path)}"
    with open(path, "rb") as f:
        supabase.storage.from_(bucket).upload(storage_path, f, {"upsert": "true"})
    public_url = supabase.storage.from_(bucket).get_public_url(storage_path)
    update_job(job_id, latest_screenshot_url=public_url)
    return public_url

def main(job_id: str):
    # 1) Fetch script from Supabase (already has user config values injected)
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
        # Use the Service class to pass the executable path
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)

        # Helper exposed to the user script for structured logging
        def log(msg: str):
            print(msg, flush=True)

        # Helper exposed to the user script so it can push screenshots mid-run.
        # Returns the public URL that the frontend can display.
        def capture_screenshot(label: str | None = None) -> str:
            safe_label = label.replace(" ", "-") if label else "step"
            filename = f"{job_id}-{safe_label}-{datetime.utcnow().isoformat()}.png"
            driver.save_screenshot(filename)
            return upload_screenshot(job_id, filename)

        # Execute the generated script as if it were run as __main__ so that
        # "if __name__ == '__main__':" blocks are executed in the cloud run.
        exec_globals = {
            "driver": driver,
            "log": log,
            "capture_screenshot": capture_screenshot,
            "webdriver": webdriver,
            "WebDriverException": WebDriverException,
            "__name__": "__main__",
        }
        exec(script, exec_globals, {})

        # Always capture a final screenshot so the UI has at least one frame
        # from the end of the run, even if the script never calls
        # capture_screenshot() itself.
        capture_screenshot("final")

        update_job(job_id, status="completed", error_message=None)
    except Exception as e:
        # Bubble errors back to the UI via automation_jobs.error_message
        update_job(job_id, status="failed", error_message=str(e))
        raise
    finally:
        if driver:
            driver.quit()

if __name__ == "__main__":
    jid = sys.argv[1]
    main(jid)
