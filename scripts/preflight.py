import os
import json
import time
import traceback
import re
import difflib

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

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


def _norm_ws(s: str) -> str:
    return " ".join((s or "").split())


def _safe_xpath_literal(value: str) -> str:
    """Return a safe XPath string literal for any input (handles both quote types)."""
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'

    # concat('foo', "'", 'bar')
    parts = value.split("'")
    out: list[str] = []
    for idx, part in enumerate(parts):
        if part:
            out.append(f"'{part}'")
        if idx != len(parts) - 1:
            out.append('"\'"')
    return "concat(" + ", ".join(out) + ")"


def _looks_like_css_id(id_value: str) -> bool:
    # Keep it strict; CSS escaping is tricky and we want stability.
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_\-:.]*", id_value or ""))


def _css_quote(value: str) -> str:
    """Return a safe double-quoted CSS string literal using JSON escaping rules."""
    return json.dumps(value or "")


def _fuzzy_token_match(needle: str, haystack: str) -> bool:
    """Tightly-constrained fuzzy match to catch partial label overlaps (e.g., register ~ registration)."""
    needle = _norm_ws((needle or "").lower())
    haystack = _norm_ws((haystack or "").lower())
    if not needle or not haystack:
        return False

    if needle in haystack:
        return True

    # Compare against individual tokens to keep it constrained.
    # We avoid fuzzy-matching across the whole blob to reduce false positives.
    hay_tokens = [t for t in re.split(r"[^a-z0-9]+", haystack) if t]
    if len(needle) < 4:
        return False

    for tok in hay_tokens:
        if tok.startswith(needle) or needle.startswith(tok):
            if min(len(tok), len(needle)) >= 4:
                return True

        ratio = difflib.SequenceMatcher(a=needle, b=tok).ratio()
        if ratio >= 0.86 and abs(len(tok) - len(needle)) <= 4:
            return True

    return False


def _fuzzy_phrase_match(phrase: str, blob: str) -> bool:
    phrase = _norm_ws((phrase or "").lower())
    blob = _norm_ws((blob or "").lower())
    if not phrase or not blob:
        return False
    if phrase in blob:
        return True

    phrase_tokens = [t for t in re.split(r"[^a-z0-9]+", phrase) if len(t) >= 3]
    blob_tokens = set([t for t in re.split(r"[^a-z0-9]+", blob) if len(t) >= 3])
    if len(phrase_tokens) < 2:
        return _fuzzy_token_match(phrase, blob)

    hits = sum(1 for t in phrase_tokens if t in blob_tokens)
    overlap = hits / max(len(phrase_tokens), 1)

    # Constrained: require at least 2 token hits and high overlap.
    return hits >= 2 and overlap >= 0.7


def _is_visible_and_unique(driver: webdriver.Chrome, by: str, value: str) -> bool:
    try:
        if by == "id":
            els = driver.find_elements(By.ID, value)
        elif by == "css":
            els = driver.find_elements(By.CSS_SELECTOR, value)
        elif by == "xpath":
            els = driver.find_elements(By.XPATH, value)
        else:
            return False
    except Exception:
        return False

    if len(els) != 1:
        return False

    try:
        return bool(els[0].is_displayed())
    except Exception:
        return False


def _collect_visible_interactive_elements(
    driver: webdriver.Chrome,
    sop_phrases: list[str],
    sop_keywords: list[str],
    defensive_keywords: list[str],
    *,
    min_score: int = 25,
    max_results: int = 40,
) -> list[dict]:
    """Collect visible, interactive elements from the LIVE DOM and prune by SOP semantics.

    This runs a lightweight scoring pass **in the browser** and returns only the highest-signal
    candidates to reduce "attention dilution" and token usage downstream.
    """

    js = r"""
    const sopPhrases = Array.isArray(arguments[0]) ? arguments[0] : [];
    const sopKeywords = Array.isArray(arguments[1]) ? arguments[1] : [];
    const defensive = Array.isArray(arguments[2]) ? arguments[2] : [];
    const minScore = (typeof arguments[3] === 'number') ? arguments[3] : 25;
    const maxResults = (typeof arguments[4] === 'number') ? arguments[4] : 40;

    const normWs = (s) => (s || "").replace(/\s+/g, " ").trim();
    const lower = (s) => normWs(String(s || '')).toLowerCase();

    const getCombinedText = (el) => {
      const tag = (el.tagName || '').toLowerCase();
      const text = normWs(el.innerText || el.textContent || '');
      const value = (tag === 'input' || tag === 'textarea') ? (el.value || '') : '';
      const placeholder = el.getAttribute('placeholder') || '';
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      return lower(`${text} ${value} ${placeholder} ${aria} ${title}`);
    };

    const calculateSemanticScore = (el) => {
      let score = 0;
      const tag = (el.tagName || '').toLowerCase();
      const role = lower(el.getAttribute('role') || '');
      const combined = getCombinedText(el);

      // Structural base
      if (['button','input','select','textarea'].includes(tag)) score += 20;
      if (tag === 'a' && el.href) score += 15;
      if (role) score += 5;

      // SOP exact phrases (+50 each hit, capped)
      let phraseHits = 0;
      for (const p of sopPhrases.slice(0, 10)) {
        const pl = lower(p);
        if (pl && combined.includes(pl)) {
          phraseHits += 1;
          score += 50;
          if (phraseHits >= 2) break;
        }
      }

      // SOP keywords (+15 per hit, capped)
      let kwHits = 0;
      for (const k of sopKeywords.slice(0, 30)) {
        const kl = lower(k);
        if (kl && combined.includes(kl)) {
          kwHits += 1;
          score += 15;
          if (kwHits >= 4) break;
        }
      }

      // Defensive unblockers (+10 per hit, capped)
      let defHits = 0;
      for (const d of defensive) {
        const dl = lower(d);
        if (dl && combined.includes(dl)) {
          defHits += 1;
          score += 10;
          if (defHits >= 3) break;
        }
      }

      // Context boost: inside form/fieldset/section (+10)
      if (el.closest('form, fieldset, section')) score += 10;

      return score;
    };

    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      const rect = el.getBoundingClientRect();
      if (!rect) return false;
      if (rect.width < 1 || rect.height < 1) return false;
      return true;
    };

    const isInteractive = (el) => {
      const tag = (el.tagName || '').toLowerCase();
      if (['button','a','input','select','textarea'].includes(tag)) return true;
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (['button','link','textbox','combobox','checkbox','radio','menuitem','tab'].includes(role)) return true;
      if (el.hasAttribute('onclick')) return true;
      // tabindex>=0 often indicates keyboard-focusable control.
      if (typeof el.tabIndex === 'number' && el.tabIndex >= 0) return true;
      return false;
    };

    const attrNames = [
      'id','name','type','value','role','placeholder','title','alt',
      'data-testid','data-test','data-qa','aria-label','aria-labelledby'
    ];

    const getLabelText = (el) => {
      const id = el.getAttribute('id');
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl) return normWs(lbl.innerText || lbl.textContent);
      }
      const parentLabel = el.closest('label');
      if (parentLabel) return normWs(parentLabel.innerText || parentLabel.textContent);
      return '';
    };

    const getFormContext = (el) => {
      const form = el.closest('form');
      if (!form) return null;
      return {
        id: form.getAttribute('id') || '',
        name: form.getAttribute('name') || '',
        aria_label: form.getAttribute('aria-label') || '',
        data_testid: form.getAttribute('data-testid') || '',
      };
    };

    const getSectionContext = (el) => {
      // fieldset/legend are common for grouped form controls
      const fieldset = el.closest('fieldset');
      let legendText = '';
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend) legendText = normWs(legend.innerText || legend.textContent);
      }

      // nearest section-ish container with aria-label often maps to UI groups
      const labeledContainer = el.closest('[aria-label], section');
      const containerLabel = labeledContainer ? (labeledContainer.getAttribute('aria-label') || '') : '';

      return {
        fieldset_legend: legendText,
        container_aria_label: containerLabel,
      };
    };

    const candidates = new Set();
    const addAll = (nodeList) => {
      for (const el of nodeList) candidates.add(el);
    };

    addAll(document.querySelectorAll('button, a, input, select, textarea'));
    addAll(document.querySelectorAll('[role]'));
    addAll(document.querySelectorAll('[onclick], [tabindex]'));

    const out = [];
    for (const el of candidates) {
      if (!isInteractive(el)) continue;
      if (!isVisible(el)) continue;

      const tag = (el.tagName || '').toLowerCase();

      // Avoid hidden input controls.
      if (tag === 'input') {
        const t = (el.getAttribute('type') || '').toLowerCase();
        if (t === 'hidden') continue;
      }

      const score = calculateSemanticScore(el);
      if (score < minScore) continue;

      const attrs = {};
      for (const name of attrNames) {
        const v = el.getAttribute(name);
        if (v) attrs[name] = v;
      }

      // Normalize href to absolute (el.href is absolute when present)
      if (tag === 'a' && el.href) attrs['href'] = el.href;

      const text = normWs(el.innerText || el.textContent || '');
      const labelText = getLabelText(el);
      const formContext = getFormContext(el);
      const sectionContext = getSectionContext(el);

      out.push({
        tag,
        text,
        label_text: labelText,
        score,
        attributes: attrs,
        form_context: formContext,
        section_context: sectionContext,
      });
    }

    out.sort((a, b) => (b.score || 0) - (a.score || 0));
    return out.slice(0, maxResults);
    """

    raw = driver.execute_script(js, sop_phrases, sop_keywords, defensive_keywords, int(min_score), int(max_results))
    return raw if isinstance(raw, list) else []


def _generate_selector_candidates(el: dict) -> list[dict]:
    """Generate multiple robust selectors per element (CSS + XPath + parent/context-based).

    Returns items shaped like: {"by": "id"|"css"|"xpath", "value": "...", "stability": int, "reason": str}
    """

    tag = (el.get("tag") or "").lower()
    text = _norm_ws(el.get("text") or "")
    label_text = _norm_ws(el.get("label_text") or "")
    attrs = el.get("attributes") if isinstance(el.get("attributes"), dict) else {}
    form_ctx = el.get("form_context") if isinstance(el.get("form_context"), dict) else None
    section_ctx = el.get("section_context") if isinstance(el.get("section_context"), dict) else None

    out: list[dict] = []

    el_id = str(attrs.get("id") or "").strip()
    data_testid = str(attrs.get("data-testid") or "").strip()
    aria_label = str(attrs.get("aria-label") or "").strip()
    name = str(attrs.get("name") or "").strip()
    placeholder = str(attrs.get("placeholder") or "").strip()
    role = str(attrs.get("role") or "").strip()

    # --- Highest stability ---
    if el_id:
        out.append({"by": "id", "value": el_id, "stability": 100, "reason": "id"})
        if _looks_like_css_id(el_id):
            out.append({"by": "css", "value": f"#{el_id}", "stability": 98, "reason": "css#id"})
        out.append({"by": "xpath", "value": f"//*[@id={_safe_xpath_literal(el_id)}]", "stability": 96, "reason": "xpath@id"})

    if data_testid:
        out.append({
            "by": "css",
            "value": f"[data-testid={_css_quote(data_testid)}]",
            "stability": 95,
            "reason": "data-testid",
        })
        out.append({
            "by": "xpath",
            "value": f"//*[@data-testid={_safe_xpath_literal(data_testid)}]",
            "stability": 94,
            "reason": "xpath@data-testid",
        })

    if aria_label:
        out.append({
            "by": "css",
            "value": f"{tag}[aria-label={_css_quote(aria_label)}]" if tag else f"[aria-label={_css_quote(aria_label)}]",
            "stability": 90,
            "reason": "aria-label",
        })
        if tag:
            out.append({
                "by": "xpath",
                "value": f"//{tag}[@aria-label={_safe_xpath_literal(aria_label)}]",
                "stability": 89,
                "reason": "xpath@aria-label",
            })
        else:
            out.append({
                "by": "xpath",
                "value": f"//*[@aria-label={_safe_xpath_literal(aria_label)}]",
                "stability": 89,
                "reason": "xpath@aria-label",
            })

    if tag == "input" and name:
        out.append({"by": "css", "value": f"input[name={_css_quote(name)}]", "stability": 88, "reason": "input@name"})
        out.append({"by": "xpath", "value": f"//input[@name={_safe_xpath_literal(name)}]", "stability": 87, "reason": "xpath input@name"})

    if tag in ("input", "textarea") and placeholder:
        out.append({"by": "css", "value": f"{tag}[placeholder={_css_quote(placeholder)}]", "stability": 83, "reason": "placeholder"})
        out.append({"by": "xpath", "value": f"//{tag}[@placeholder={_safe_xpath_literal(placeholder)}]", "stability": 82, "reason": "xpath@placeholder"})

    # --- Text-based ---
    text_candidate = text or label_text
    text_candidate = text_candidate[:80]
    if text_candidate and tag in ("button", "a", "label", "div", "span"):
        lit = _safe_xpath_literal(text_candidate)
        out.append({
            "by": "xpath",
            "value": f"//{tag}[contains(normalize-space(.), {lit})]",
            "stability": 70,
            "reason": "xpath text contains",
        })

    if role and text_candidate and tag not in ("input", "select", "textarea"):
        lit = _safe_xpath_literal(text_candidate)
        out.append({
            "by": "xpath",
            "value": f"//{tag}[@role={_safe_xpath_literal(role)} and contains(normalize-space(.), {lit})]",
            "stability": 68,
            "reason": "xpath role+text",
        })

    # --- Context-based: form/fieldset boosts ---
    if form_ctx and isinstance(form_ctx, dict):
        form_id = _norm_ws(form_ctx.get("id") or "")
        form_testid = _norm_ws(form_ctx.get("data_testid") or "")
        if form_id:
            if tag == "input" and name:
                out.append({
                    "by": "xpath",
                    "value": f"//form[@id={_safe_xpath_literal(form_id)}]//input[@name={_safe_xpath_literal(name)}]",
                    "stability": 84,
                    "reason": "form@id + input@name",
                })
            if text_candidate and tag in ("button", "a"):
                lit = _safe_xpath_literal(text_candidate)
                out.append({
                    "by": "xpath",
                    "value": f"//form[@id={_safe_xpath_literal(form_id)}]//{tag}[contains(normalize-space(.), {lit})]",
                    "stability": 78,
                    "reason": "form@id + text",
                })

        if form_testid:
            out.append({
                "by": "xpath",
                "value": f"//*[@data-testid={_safe_xpath_literal(form_testid)}]//{tag}",
                "stability": 76,
                "reason": "form-like container data-testid",
            })

    if section_ctx and isinstance(section_ctx, dict):
        container_label = _norm_ws(section_ctx.get("container_aria_label") or "")
        if container_label and text_candidate and tag in ("button", "a"):
            lit = _safe_xpath_literal(text_candidate)
            out.append({
                "by": "xpath",
                "value": f"//*[@aria-label={_safe_xpath_literal(container_label)}]//{tag}[contains(normalize-space(.), {lit})]",
                "stability": 74,
                "reason": "section aria-label + text",
            })

    # De-dupe while preserving order (stability already indicates sort intent).
    seen: set[tuple[str, str]] = set()
    uniq: list[dict] = []
    for s in out:
        key = (s.get("by"), s.get("value"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(s)

    # Sort by stability descending.
    uniq.sort(key=lambda x: x.get("stability", 0), reverse=True)
    return uniq


def get_optimized_elements(driver: webdriver.Chrome, sop_text: str | None = None):
    """Return a SOP-guided set of visible, interactive elements with validated selector fallbacks.

    Changes vs legacy implementation:
    - Collect from LIVE DOM via Selenium JS (so we can filter *visible* and *interactive* elements).
    - Keep only elements that match SOP keywords/quoted phrases (with constrained fuzzy matching).
    - Generate *multiple* selector candidates and validate them against the live DOM, dropping stale/non-unique.
    - Boost elements inside SOP-related forms/sections.
    """

    interactive_elements: list[dict] = []

    sop_data = extract_sop_targets(sop_text) if sop_text else {"keywords": set(), "phrases": []}
    sop_keywords: set[str] = set([kw.lower() for kw in sop_data.get("keywords", set()) if kw])
    sop_phrases: list[str] = [p.lower() for p in sop_data.get("phrases", []) if p]

    has_sop_targets = bool(sop_keywords or sop_phrases)

    # Programmatic DOM tree pruning: only return top-scored candidates from the browser.
    raw_elements = _collect_visible_interactive_elements(
        driver,
        sop_phrases,
        list(sop_keywords),
        DEFENSIVE_KEYWORDS,
        min_score=25,
        max_results=40,
    )

    for el in raw_elements:
        tag = (el.get("tag") or "").lower()
        text = _norm_ws(el.get("text") or "")
        label_text = _norm_ws(el.get("label_text") or "")
        attrs = el.get("attributes") if isinstance(el.get("attributes"), dict) else {}
        form_ctx = el.get("form_context") if isinstance(el.get("form_context"), dict) else None
        section_ctx = el.get("section_context") if isinstance(el.get("section_context"), dict) else None

        # Build a constrained blob focused on user-visible / semantic attributes.
        blob_parts: list[str] = [text, label_text]
        for k in ["id", "name", "data-testid", "aria-label", "placeholder", "title", "alt", "value", "href", "role"]:
            v = attrs.get(k)
            if v:
                blob_parts.append(str(v))

        if form_ctx:
            for k in ["id", "name", "aria_label", "data_testid"]:
                v = form_ctx.get(k)
                if v:
                    blob_parts.append(str(v))

        if section_ctx:
            for k in ["fieldset_legend", "container_aria_label"]:
                v = section_ctx.get(k)
                if v:
                    blob_parts.append(str(v))

        blob = _norm_ws(" ".join(blob_parts))
        lower_blob = blob.lower()

        # Start from browser-computed semantic score (already SOP-guided + pruned).
        score = int(el.get("score") or 0) or 5
        match_reasons: list[str] = ["VISIBLE_INTERACTIVE"]

        # SOP phrase matching (exact + fuzzy)
        phrase_hit = None
        for phrase in sop_phrases:
            if phrase and phrase in lower_blob:
                phrase_hit = phrase
                score += 60
                match_reasons.append("SOP_EXACT_PHRASE")
                break

        if not phrase_hit:
            for phrase in sop_phrases:
                if phrase and _fuzzy_phrase_match(phrase, lower_blob):
                    score += 35
                    match_reasons.append("SOP_FUZZY_PHRASE")
                    break

        # SOP keyword matching (exact + constrained fuzzy)
        sop_hits: list[str] = []
        for kw in list(sop_keywords)[:30]:
            if kw in lower_blob or _fuzzy_token_match(kw, lower_blob):
                sop_hits.append(kw)
        if sop_hits:
            capped = sop_hits[:5]
            score += 12 * min(len(capped), 5)
            match_reasons.append("SOP_KEYWORDS")

        # Defensive matches: keep blockers even when SOP is very narrow.
        defensive_hits: list[str] = []
        for kw in DEFENSIVE_KEYWORDS:
            if kw in lower_blob:
                defensive_hits.append(kw)
        if defensive_hits:
            score += 15 * len(set(defensive_hits))
            match_reasons.append("DEFENSIVE")

        # Boost elements inside related forms/sections if those contexts match SOP.
        context_blob = ""
        if form_ctx:
            context_blob += " " + _norm_ws(" ".join([str(v) for v in form_ctx.values() if v]))
        if section_ctx:
            context_blob += " " + _norm_ws(" ".join([str(v) for v in section_ctx.values() if v]))
        context_blob = context_blob.strip().lower()

        if context_blob and has_sop_targets:
            if any(p and (p in context_blob or _fuzzy_phrase_match(p, context_blob)) for p in sop_phrases[:10]) or any(
                kw and (kw in context_blob or _fuzzy_token_match(kw, context_blob)) for kw in list(sop_keywords)[:20]
            ):
                score += 18
                match_reasons.append("CONTEXT_BOOST")

        # HARD FILTER: when SOP exists, keep only SOP-matching or defensive-matching elements.
        if has_sop_targets:
            sop_matched = any(r.startswith("SOP_") for r in match_reasons)
            defensive_matched = "DEFENSIVE" in match_reasons
            if not sop_matched and not defensive_matched:
                continue

        # Generate selector candidates and validate against LIVE DOM.
        candidates = _generate_selector_candidates(el)
        validated: list[dict] = []
        for c in candidates:
            by = c.get("by")
            val = c.get("value")
            if not by or not val:
                continue
            if _is_visible_and_unique(driver, by, val):
                validated.append(c)

        # If none validate, drop: we don't want stale/non-unique selectors in context.
        if not validated:
            continue

        # Suggested selector for backwards compatibility in downstream rendering.
        best = validated[0]
        suggested_selector = None
        if best.get("by") == "id":
            # For UI readability, keep legacy #id form.
            suggested_selector = f"#{best.get('value')}"
        else:
            suggested_selector = str(best.get("value"))

        el_data: dict = {
            "tag": tag,
            "text": text[:160],
            "attributes": attrs,
            "score": score,
            "selectors": [{"by": s["by"], "value": s["value"], "stability": s.get("stability", 0), "reason": s.get("reason", "")} for s in validated[:8]],
            "suggested_selector": suggested_selector,
            "match_reasons": match_reasons,
            "form_context": form_ctx,
            "section_context": section_ctx,
        }

        interactive_elements.append(el_data)

    interactive_elements.sort(
        key=lambda e: (
            any(isinstance(r, str) and r.startswith("SOP_") for r in e.get("match_reasons", [])),
            e.get("score", 0),
            max([s.get("stability", 0) for s in (e.get("selectors") or [])] or [0]),
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

                title = driver.title
                # Collect only visible, interactive elements and validate selector fallbacks against the LIVE DOM.
                elements = get_optimized_elements(driver, sop_text)

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
