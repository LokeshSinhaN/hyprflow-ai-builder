import os
import json
import time
import traceback

from urllib.parse import urljoin

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JOB_ID = os.environ["PREFLIGHT_JOB_ID"]


def update_job(payload: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/preflight_jobs?id=eq.{JOB_ID}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    resp = requests.patch(url, headers=headers, data=json.dumps(payload, default=str))
    resp.raise_for_status()


def fetch_job() -> dict:
    """Fetch the preflight job row so we can read target_urls and cookies_json."""
    url = f"{SUPABASE_URL}/rest/v1/preflight_jobs?id=eq.{JOB_ID}&select=target_url,target_urls,cookies_json"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        raise RuntimeError(f"preflight_jobs row not found for id={JOB_ID}")
    return rows[0]


def get_optimized_elements(html_content: str, base_url: str):
    """Return only interactive / important elements with suggested selectors.

    This dramatically shrinks what we store and send to the LLM compared to raw page_source.
    """
    soup = BeautifulSoup(html_content, "lxml")
    interactive_elements = []

    tags_of_interest = ["button", "input", "select", "textarea", "a", "form"]
    attrs_of_interest = ["id", "data-testid", "role", "name", "aria-label", "placeholder"]

    for element in soup.find_all():
        if element.name in ["script", "style", "noscript", "svg", "path"]:
            continue

        is_interesting = element.name in tags_of_interest
        if not is_interesting:
            for attr in attrs_of_interest:
                if element.has_attr(attr):
                    is_interesting = True
                    break

        if not is_interesting and element.has_attr("class"):
            classes = element.get("class", [])
            if any("btn" in c or "button" in c for c in classes):
                is_interesting = True

        if not is_interesting:
            continue

        # Normalize anchor hrefs to absolute URLs so downstream consumers/LLM
        # never have to guess or join relative paths.
        if element.name == "a" and element.has_attr("href"):
            try:
                raw_href = element["href"]
                absolute_href = urljoin(base_url, raw_href)
                element.attrs["href"] = absolute_href
            except Exception:
                # Best-effort normalization; if urljoin fails we keep the original value.
                pass

        el_data = {
            "tag": element.name,
            "text": element.get_text(" ", strip=True)[:100],
            "attributes": {k: v for k, v in element.attrs.items() if k != "style"},
        }

        selector = None
        if element.has_attr("id"):
            selector = f"#{element['id']}"
        elif element.has_attr("name"):
            selector = f"[name='{element['name']}']"
        elif element.has_attr("data-testid"):
            selector = f"[data-testid='{element['data-testid']}']"
        elif element.name == "button" and el_data["text"]:
            clean_text = el_data["text"].replace("'", "")
            selector = f"//button[contains(text(), '{clean_text}')]"

        el_data["suggested_selector"] = selector
        interactive_elements.append(el_data)

    return interactive_elements


def main() -> None:
    try:
        print("[Preflight] Starting structured DOM extraction")
        update_job({"status": "running", "error": None})

        job = fetch_job()
        raw_target_urls = job.get("target_urls")
        primary_url = job.get("target_url")
        cookies_raw = job.get("cookies_json")

        target_urls = []
        if isinstance(raw_target_urls, str) and raw_target_urls:
            try:
                parsed = json.loads(raw_target_urls)
                if isinstance(parsed, list):
                    target_urls = [str(u) for u in parsed if str(u).strip()]
            except Exception:
                # Fallback to primary_url below
                pass

        if not target_urls and primary_url:
            target_urls = [str(primary_url)]

        if not target_urls:
            raise RuntimeError("No target URLs found for preflight job")

        try:
            cookies = json.loads(cookies_raw) if isinstance(cookies_raw, str) and cookies_raw else []
        except Exception:
            print("[Preflight] Warning: could not parse cookies_json; proceeding without cookies")
            cookies = []

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)

        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(60)

        extraction_results: dict[str, dict] = {}

        try:
            # If we have cookies, visit the base domain once and inject them
            if cookies and target_urls:
                first_url = target_urls[0]
                base = "/".join(first_url.split("/")[:3])  # scheme + host
                try:
                    driver.get(base)
                except Exception:
                    # Best-effort; we mainly need a domain context for cookies
                    pass

                for cookie in cookies:
                    name = cookie.get("name") if isinstance(cookie, dict) else None
                    if not name:
                        continue
                    cookie_dict = {
                        "name": name,
                        "value": cookie.get("value"),
                        "domain": cookie.get("domain"),
                        "path": cookie.get("path", "/"),
                    }
                    try:
                        driver.add_cookie(cookie_dict)
                    except Exception as e:  # noqa: PERF203
                        print(f"[Preflight] Warning: failed to add cookie {name}: {e}")

            for url in target_urls:
                print(f"[Preflight] Visiting {url}")
                driver.get(url)
                time.sleep(5)

                html = driver.page_source
                title = driver.title
                # Use the resolved current_url as base for href normalization
                elements = get_optimized_elements(html, driver.current_url)

                extraction_results[url] = {
                    "title": title,
                    "interactive_elements": elements,
                    "element_count": len(elements),
                }
        finally:
            driver.quit()

        update_job(
            {
                "status": "done",
                "dom_html": json.dumps(extraction_results),
                "error": None,
            }
        )
        print("[Preflight] Structured DOM extraction completed successfully")

    except Exception as exc:  # pylint: disable=broad-except
        print("[Preflight] Error during DOM extraction:")
        traceback.print_exc()
        try:
            update_job(
                {
                    "status": "error",
                    "error": "".join(traceback.format_exception(exc))[:8000],
                }
            )
        except Exception:
            # If we can't update Supabase, just swallow to avoid masking the root cause
            pass
        raise


if __name__ == "__main__":
    main()
