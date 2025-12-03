import os
import json
import time
import traceback

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JOB_ID = os.environ["PREFLIGHT_JOB_ID"]
TARGET_URL = os.environ["PREFLIGHT_URL"]


def update_job(payload: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/preflight_jobs?id=eq.{JOB_ID}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    resp = requests.patch(url, headers=headers, data=json.dumps(payload))
    resp.raise_for_status()


def main() -> None:
    try:
        print(f"[Preflight] Starting DOM extraction for {TARGET_URL}")
        update_job({"status": "running", "error": None})

        options = Options()
        # Run headless but still as close to real browser as possible
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1920,1080")

        # Basic anti-automation flags to reduce detection
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)

        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(60)

        try:
            driver.get(TARGET_URL)
            # Give the page some time to fully render dynamic content
            time.sleep(5)

            html = driver.page_source
        finally:
            driver.quit()

        # Optionally, you could add more structured extraction here later.
        update_job({
            "status": "done",
            "dom_html": html,
            "error": None,
        })
        print("[Preflight] DOM extraction completed successfully")

    except Exception as exc:  # pylint: disable=broad-except
        print("[Preflight] Error during DOM extraction:")
        traceback.print_exc()
        try:
            update_job({
                "status": "error",
                "error": "".join(traceback.format_exception(exc))[:8000],
            })
        except Exception:
            # If we can't update Supabase, just swallow to avoid masking the root cause
            pass
        raise


if __name__ == "__main__":
    main()
