import os
import json
import time
import traceback
import re

from urllib.parse import urljoin

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from bs4 import BeautifulSoup

# Basic English stopwords for SOP keyword extraction
STOPWORDS: set[str] = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "onto",
    "your",
    "you",
    "are",
    "was",
    "were",
    "will",
    "shall",
    "should",
    "have",
    "has",
    "had",
    "not",
    "but",
    "all",
    "any",
    "each",
    "every",
    "such",
    "may",
    "might",
    "can",
    "could",
    "must",
    "then",
    "than",
    "when",
    "where",
    "what",
    "which",
    "while",
    "before",
    "after",
    "during",
    "within",
    "including",
}

# Defensive keywords for blockers like cookie banners and logins
DEFENSIVE_KEYWORDS: list[str] = [
    "cookie",
    "cookies",
    "accept",
    "agree",
    "consent",
    "privacy",
    "continue",
    "ok",
    "got it",
    "close",
    "dismiss",
    "login",
    "log in",
    "sign in",
    "sign-in",
    "signin",
    "password",
    "username",
]

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


def extract_sop_targets(sop_text: str) -> dict:
    """Extract explicit targets from SOP.

    Returns a dict with 'keywords' (set) and 'phrases' (list).
    """
    if not sop_text:
        return {"keywords": set(), "phrases": []}

    # 1. Extract exact quoted text (e.g., "Submit Order") - HIGHEST PRIORITY
    phrases = re.findall(r'["\'](.*?)["\']', sop_text)

    # 2. Extract Capitalized Words (heuristics for UI labels)
    cap_words = re.findall(r'\b[A-Z][a-z]+\b', sop_text)

    # 3. Standard tokenization for fallback
    cleaned = []
    for ch in sop_text.lower():
        cleaned.append(ch if ch.isalnum() or ch.isspace() else " ")
    tokens = [t for t in "".join(cleaned).split() if len(t) >= 3]

    keywords = {t for t in tokens if t not in STOPWORDS}

    # Add capitalized words to keywords for broader matching
    for w in cap_words:
        keywords.add(w.lower())

    return {"keywords": keywords, "phrases": phrases}


def wait_for_sop_keywords_on_page(driver: webdriver.Chrome, sop_keywords: set[str], timeout: int = 20) -> None:
    """Block until at least one SOP keyword appears in the live page text, or timeout.

    This makes the pre-flight capture "context aware" so that slowly-rendered forms
    (e.g., Height/Weight/Calculate widgets) get a chance to appear before we snapshot.
    """
    if not sop_keywords:
        return

    important = [kw.strip().lower() for kw in sop_keywords if kw.strip()]
    if not important:
        return

    # Limit to a reasonable number of high-signal keywords
    important = important[:15]

    deadline = time.time() + timeout
    last_hit: list[str] | None = None

    while time.time() < deadline:
        try:
            page_text = driver.page_source.lower()
        except Exception as exc:  # pragma: no cover - extremely rare in practice
            print(f"[Preflight] Warning: failed to read page_source while waiting for SOP keywords: {exc}")
            break

        hits = [kw for kw in important if kw in page_text]
        if hits:
            last_hit = hits
            print(
                "[Preflight] SOP keywords visible on page:",
                ", ".join(sorted(set(hits))),
            )
            return

        time.sleep(1.0)

    if last_hit:
        print(
            "[Preflight] SOP keywords previously detected but disappeared before timeout; proceeding anyway.",
        )
    else:
        print("[Preflight] Warning: SOP keywords not detected before timeout; proceeding anyway.")


def get_optimized_elements(html_content: str, base_url: str, sop_text: str | None = None):
    """Return a small, SOP-guided set of interactive / important elements with scores.

    Each element is scored based on:
      - base score for being interactive,
      - matches against SOP-derived keywords and phrases,
      - matches against defensive keywords (cookies, login, etc.).

    Only elements above a minimum score are kept, then sorted and truncated to top-N.
    """
    soup = BeautifulSoup(html_content, "lxml")
    interactive_elements: list[dict] = []

    tags_of_interest = ["button", "input", "select", "textarea", "a", "form"]
    attrs_of_interest = ["id", "data-testid", "role", "name", "aria-label", "placeholder"]

    # UPDATED: Parse SOP targets using the new function
    sop_data = extract_sop_targets(sop_text) if sop_text else {"keywords": set(), "phrases": []}
    sop_keywords: set[str] = sop_data["keywords"]
    sop_phrases = [p.lower() for p in sop_data["phrases"]]

    for element in soup.find_all():
        if element.name in ["script", "style", "noscript", "svg", "path"]:
            continue

        is_interactive_tag = element.name in tags_of_interest
        is_interesting = is_interactive_tag
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

        text = element.get_text(" ", strip=True)
        attrs = {k: v for k, v in element.attrs.items() if k != "style"}

        # Discard completely empty elements early
        if not text and not attrs:
            continue

        display_text = text[:160]

        # IMPROVEMENT: search blob now includes title, alt, value, placeholder, etc.
        lower_blob_parts = [display_text.lower()]
        for attr_name in [
            "id",
            "name",
            "data-testid",
            "aria-label",
            "placeholder",
            "title",
            "alt",
            "value",
        ]:
            val = attrs.get(attr_name)
            if val:
                try:
                    lower_blob_parts.append(str(val).lower())
                except Exception:
                    continue
        lower_blob = " ".join(lower_blob_parts)

        # SCORING UPGRADE
        score = 0
        match_reasons: list[str] = []

        if is_interactive_tag:
            score += 5
            match_reasons.append("Interactive")

        # 1. Exact Phrase Match (HUGE BOOST)
        for phrase in sop_phrases:
            if phrase and phrase in lower_blob:
                score += 50  # massive boost ensures it survives truncation
                match_reasons.append(f"SOP EXACT MATCH: '{phrase}'")
                break

        # 2. Keyword Match
        sop_hits: list[str] = []
        for kw in sop_keywords:
            if kw in lower_blob:
                sop_hits.append(kw)
        if sop_hits:
            capped = sop_hits[:3]
            score += 10 * min(len(capped), 3)
            match_reasons.append(f"SOP Keywords: {','.join(capped)}")

        # 3. Defensive keyword matches (cookies, login, etc.)
        defensive_hits: list[str] = []
        for kw in DEFENSIVE_KEYWORDS:
            if kw in lower_blob:
                defensive_hits.append(kw)
        if defensive_hits:
            score += 15 * len(defensive_hits)
            match_reasons.append(f"Defensive match: {', '.join(sorted(set(defensive_hits)))}")

        # Drop elements that are effectively noise
        if score < 5:
            continue

        # SELECTOR GENERATION UPGRADE
        selector = None

        # 1. ID is still King
        if element.has_attr("id"):
            selector = f"#{element['id']}"

        # 2. Robust Text/Attribute XPaths
        if not selector:
            clean_text = display_text.replace("'", "").strip()

            # Button or Link with text
            if (element.name in ("button", "a")) and clean_text:
                selector = f"//{element.name}[contains(normalize-space(), '{clean_text}') ]"

            # Input with Placeholder
            elif element.name == "input" and attrs.get("placeholder"):
                selector = f"//input[@placeholder='{attrs['placeholder']}']"

            # Input with Name
            elif element.name == "input" and attrs.get("name"):
                selector = f"//input[@name='{attrs['name']}']"

            # Submit Input with Value
            elif element.name == "input" and attrs.get("type") == "submit" and attrs.get("value"):
                selector = f"//input[@value='{attrs['value']}']"

            # Div/Span acting as button
            elif attrs.get("role") == "button" and clean_text:
                selector = f"//{element.name}[@role='button' and contains(normalize-space(), '{clean_text}') ]"

        el_data: dict = {
            "tag": element.name,
            "text": display_text,
            "attributes": attrs,
            "score": score,
            "suggested_selector": selector,
            "match_reasons": match_reasons,
        }

        interactive_elements.append(el_data)

    # Sort by SOP relevance first, then score, and truncate to top-N to avoid context pollution
    interactive_elements.sort(
        key=lambda e: (
            any(isinstance(r, str) and r.startswith("SOP ") for r in e.get("match_reasons", [])),
            e.get("score", 0),
        ),
        reverse=True,
    )
    MAX_ELEMENTS = 50
    return interactive_elements[:MAX_ELEMENTS]


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

        # Optional: SOP content can be provided via environment for smarter filtering
        sop_text = os.environ.get("PREFLIGHT_SOP_TEXT", "")
        sop_targets_main = extract_sop_targets(sop_text) if sop_text else {"keywords": set(), "phrases": []}
        # For smart waits, treat both keywords and phrases as signals
        sop_keywords_main: set[str] = set(sop_targets_main["keywords"])
        sop_keywords_main.update(p.lower() for p in sop_targets_main["phrases"] if p)

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
                # Base wait for initial load
                time.sleep(2)
                # Smart wait: give SOP-relevant widgets (e.g., Height/Weight/Calculate) time to appear
                try:
                    wait_for_sop_keywords_on_page(driver, sop_keywords_main, timeout=20)
                except TimeoutException:
                    # Fallback: we already log inside wait_for_sop_keywords_on_page
                    pass

                html = driver.page_source
                title = driver.title
                # Use the resolved current_url as base for href normalization and SOP-guided scoring
                elements = get_optimized_elements(html, driver.current_url, sop_text)

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
