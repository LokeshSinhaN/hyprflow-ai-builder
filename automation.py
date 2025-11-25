import os
import sys
from datetime import datetime
from supabase import create_client, Client
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def update_job(job_id: str, **fields):
    supabase.table("automation_jobs").update(fields).eq("id", job_id).execute()

def upload_screenshot(job_id: str, path: str) -> str:
    bucket = "automation-screenshots"
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
        driver = webdriver.Chrome(ChromeDriverManager().install(), options=options)

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