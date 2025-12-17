import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeneratePreflightBody {
  message: string;
  sop_text?: string;
  job_id: string;
}

// Lightweight sanitizer to strip noisy attributes from DOM before sending to the LLM.
// We keep structural and semantic identifiers (id/name/class/role/aria-*) and only drop very noisy inline styles.
const sanitizeDomSnippet = (html: string): string => {
  let cleaned = html;

  // Remove script & style blocks entirely
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Keep class/role/aria-* attributes so the LLM can see stable selectors,
  // but drop inline style attributes to reduce token usage.
  cleaned = cleaned.replace(/\sstyle="[^"]*"/gi, "");

  // Collapse repeated whitespace
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  return cleaned.trim();
};

type OutputPlan = {
  intent: "code" | "explain";
  seleniumOnly: boolean;
  requirePlaywright: boolean;
};

const classifyPrompt = (message: string): OutputPlan => {
  const m = (message || "").toLowerCase();

  const hasSelenium = /\bselenium\b/.test(m);
  const hasPlaywright = /\bplaywright\b/.test(m);

  const wantsFix = /\b(fix|debug|resolve|repair|correct|update|patch|refactor)\b/.test(m);
  const wantsExplain =
    /\b(explain|explanation|how does|how do|walk me through|what does|describe|breakdown|step[- ]by[- ]step)\b/.test(m) ||
    /\b(tags?)\b/.test(m) ||
    /\b(selectors?|locators?|xpath|css selector)\b/.test(m);

  const intent: OutputPlan["intent"] = wantsExplain && !wantsFix ? "explain" : "code";
  const seleniumOnly = hasSelenium && !hasPlaywright;
  const requirePlaywright = intent === "code" && !seleniumOnly;

  return { intent, seleniumOnly, requirePlaywright };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, sop_text, job_id } = (await req.json()) as GeneratePreflightBody;

    if (!message || !job_id) {
      return new Response(
        JSON.stringify({ error: "message and job_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    console.log("🚀 generate-script-preflight invoked", { hasSop: !!sop_text, jobId: job_id });

    // Fetch preflight job with DOM HTML
    const jobResp = await fetch(
      `${supabaseUrl}/rest/v1/preflight_jobs?id=eq.${job_id}&select=target_url,dom_html,status,error,cookies_json,target_urls`,
      {
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
        },
      },
    );

    if (!jobResp.ok) {
      const text = await jobResp.text();
      console.error("❌ Failed to fetch preflight job:", jobResp.status, text);
      return new Response(
        JSON.stringify({ error: "Failed to fetch preflight job" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = (await jobResp.json()) as any[];
    if (!rows.length) {
      console.error("❌ Preflight job not found", job_id);
      return new Response(
        JSON.stringify({ error: "Preflight job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const job = rows[0];
    console.log("ℹ️ Preflight job status", job.status);

    const hasCookiesProfile = typeof job.cookies_json === "string" && job.cookies_json.trim().length > 0;
    if (hasCookiesProfile) {
      console.log("🍪 Cookies profile detected for preflight job; instructing LLM to use dynamic cookies injection.");
    }

    if (job.status !== "done") {
      return new Response(
        JSON.stringify({ error: `Preflight job is not complete (status=${job.status})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!job.dom_html) {
      console.error("❌ Preflight job has no DOM HTML");
      return new Response(
        JSON.stringify({ error: "Preflight job has no DOM HTML" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const targetUrl: string = job.target_url ?? "";
    const rawDomHtml: string = job.dom_html as string;

    // Try to interpret dom_html as our new structured JSON { url: { title, interactive_elements, ... } }
    let structuredExtraction: Record<string, any> | null = null;
    try {
      const parsed = JSON.parse(rawDomHtml);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        structuredExtraction = parsed as Record<string, any>;
      }
    } catch (_err) {
      // Not JSON, fall back to legacy raw HTML behaviour below.
    }

    let domContext = "";

    const hasScoredDom = !!structuredExtraction;

    if (structuredExtraction) {
      const maxPages = 5;
      const maxElementsPerPage = 80;
      const entries = Object.entries(structuredExtraction).slice(0, maxPages);

      const parts: string[] = [];

      for (const [url, data] of entries) {
        const page = data as { title?: string; interactive_elements?: any[]; element_count?: number };
        const title = page.title ?? "";
        const elements = Array.isArray(page.interactive_elements) ? page.interactive_elements : [];

        parts.push(`\n\n=== PAGE: ${url} (Title: ${title}) ===`);
        parts.push(`Total interactive elements (SOP-guided + scored): ${page.element_count ?? elements.length}`);
        parts.push("INTERACTIVE ELEMENTS (pre-filtered & scored):");

        for (const el of elements.slice(0, maxElementsPerPage)) {
          const tag = el.tag ?? "";
          const text = (el.text ?? "").toString().slice(0, 160);
          const attrs = el.attributes ?? {};
          const selector = el.suggested_selector ?? "";
          const score = typeof el.score === "number" ? el.score : undefined;
          const matchReasons: string[] = Array.isArray(el.match_reasons)
            ? (el.match_reasons as string[])
            : [];

          const attrBits: string[] = [];
          if (attrs.id) attrBits.push(`id=\"${attrs.id}\"`);
          if (attrs.name) attrBits.push(`name=\"${attrs.name}\"`);
          if (attrs.class) {
            const classVal = Array.isArray(attrs.class) ? attrs.class.join(" ") : attrs.class;
            attrBits.push(`class="${classVal}"`);
          }
          if (attrs.role) attrBits.push(`role=\"${attrs.role}\"`);
          if (attrs.placeholder) attrBits.push(`placeholder=\"${attrs.placeholder}\"`);
          if (attrs["aria-label"]) attrBits.push(`aria-label=\"${attrs["aria-label"]}\"`);
          if (attrs["data-testid"]) attrBits.push(`data-testid=\"${attrs["data-testid"]}\"`);

          const attrStr = attrBits.join(" ");
          let line = `- <${tag}${attrStr ? " " + attrStr : ""}> text=\"${text}\"`;
          if (selector) {
            line += ` -> SUGGESTED SELECTOR: ${selector}`;
          }

          const metaBits: string[] = [];
          if (typeof score === "number") {
            metaBits.push(`score=${score}`);
          }
          if (matchReasons.length) {
            metaBits.push(`matches: ${matchReasons.join("; ")}`);
          }
          if (metaBits.length) {
            line += ` [${metaBits.join(" | ")}]`;
          }

          parts.push(line);
        }
      }

      domContext = parts.join("\n");

      console.log(
        "📄 Structured DOM snapshot loaded",
        JSON.stringify({ pageCount: entries.length, firstUrl: entries[0]?.[0] ?? targetUrl }),
      );
    } else {
      // Legacy mode: dom_html is a raw HTML snapshot for a single page
      const domHtml: string = rawDomHtml;
      const domSnippet = domHtml.length > 60000 ? domHtml.slice(0, 60000) : domHtml;
      const promptDomSnippet = sanitizeDomSnippet(domSnippet);

      console.log(
        "📄 DOM snapshot loaded (legacy mode)",
        JSON.stringify({ url: targetUrl, domLength: domHtml.length, snippetLength: promptDomSnippet.length }),
      );

      domContext = promptDomSnippet
        ? `\n\n=== LIVE PAGE DOM SNAPSHOT ===\n${promptDomSnippet}\n=== END LIVE PAGE DOM SNAPSHOT ===\n`
        : "";
    }

    // --- Build combined context (SOP + DOM) to mirror generate-script-rag ---
    let sopContext = sop_text || "";
    let contextSource = sopContext ? "frontend" : "none";
    let sopFileName = sopContext ? "Uploaded SOP" : "";

    if (!sopContext) {
      console.warn("⚠️ No SOP context provided; generating script from DOM + user request only.");
      sopContext = "No SOP documents were provided. Generate script based on user request and DOM only.";
    }

    const combinedContext = `${sopContext}${domContext}`;

    const contextSection = combinedContext
      ? `\n\n=== COMPLETE WORKFLOW + DOM CONTEXT ===\n${combinedContext}\n=== END CONTEXT ===\n`
      : "";

    const plan = classifyPrompt(message);

    const outputModeNote = `

================================================================================
OUTPUT MODE OVERRIDE (MUST FOLLOW)
================================================================================
Intent: ${plan.intent}
Selenium only: ${plan.seleniumOnly}

- Always output content between the required delimiters.
- If Intent is "explain":
  - Output ONLY a natural-language explanation in the CHAT_EXPLANATION section.
  - The explanation MUST be structured Markdown (headings, bullet points) and MUST NOT include code fences or runnable scripts.
  - Leave BOTH script sections EMPTY.
- If Intent is "code" and Selenium only is true:
  - Output ONLY the Selenium script.
  - Leave the Playwright section EMPTY.
- If Intent is "code" and Selenium only is false:
  - Output BOTH Selenium and Playwright scripts.

COOKIE INJECTION (MANDATORY WHEN COOKIES ARE PROVIDED):
- You MUST implement an inject_cookies(...) helper that takes raw JSON cookie data at runtime (no hard-coded cookie values) and injects it into the browser context reliably.
`;

    const cookiesRuntimeNote = hasCookiesProfile
      ? `\nRUNTIME COOKIES PROFILE (MANDATORY USAGE):\n` +
        `- A validated cookies_json profile for this domain is stored in the backend (Supabase).\n` +
        `- DO NOT inline or hard-code any cookie values from this profile directly into the script.\n` +
        `- Instead, the script MUST load cookies dynamically at runtime from a JSON string (for example, an environment variable like BROWSER_COOKIES_JSON or an injected config value).\n` +
        `- Then, before visiting any target URL, the script MUST parse that JSON and add each cookie to the browser context (Selenium driver or Playwright context) using the provided name, value, domain, and path fields.\n` +
        `- If the JSON is missing or empty at runtime, the script must continue without failing but should log a clear warning.\n`
      : "";

    // ENHANCED SYSTEM PROMPT (copied from generate-script-rag) WITH DOM NOTE
    const systemPrompt = `You are an expert web automation engineer specializing in production-ready, CAPTCHA-RESISTANT browser automation.

Generate automation output according to the OUTPUT MODE OVERRIDE section below.
${outputModeNote}

${contextSection ? "CRITICAL: Use the SOP/DOM content above as the source of truth for workflow steps and selectors. Only use selectors that exist in the provided DOM." : ""}
${hasScoredDom ? "CRITICAL: The DOM elements provided were PRE-FILTERED and SCORED against the SOP text and defensive keywords (cookies, login, etc.). ALWAYS prioritize these pre-validated selectors and attributes over guessing new selectors or generic XPaths. When match_reasons mention cookies or login, you MUST use those elements to unblock the workflow before proceeding." : ""}

COOKIE / CONSENT POPUPS (DEFENSIVE HANDLING):
- Pre-flight DOM capture may already have suppressed primary cookie/consent banners using backend-managed cookies.
- In generated scripts:
  - Only attempt to interact with cookie/consent banners when corresponding elements actually exist in the DOM.
  - Always wrap banner handling in try/except; failure to find a banner MUST NOT break the workflow.
  - Do not hard-code assumptions that a banner will always appear.
  - AFTER clicking a cookie/consent button or container, you MUST wait for the banner container to become invisible using:
    WebDriverWait(driver, TIMEOUT).until(EC.invisibility_of_element_located((By.ID, "THE_BANNER_CONTAINER_ID")))
    (or an equivalent locator when id is not available).
  - Never proceed to the next click on the underlying page until the invisibility wait above has completed, otherwise ElementClickIntercepted errors will occur.
${cookiesRuntimeNote}

================================================================================
MANDATORY ANTI-DETECTION FEATURES (MUST INCLUDE IN ALL SCRIPTS)
================================================================================

These features help AVOID BLOCKING and reduce automation failures on a wide range of websites (search, portals, e-commerce, social media, etc.)

CRITICAL SELECTOR RULES (UNIVERSAL ROBUSTNESS):
- Never guess selectors based on URL parameters; you must find the exact element in the provided DOM structure.
1. NO DIRECT CHILDREN: Never assume an element is a direct child of another.
   - BAD (XPath): //div[@id='results']/a
   - BAD (CSS): #results > a
   - GOOD (CSS): #results a
   - GOOD (XPath): //div[@id='results']//a

2. TRUST STRUCTURE, NOT TEXT:
   - DO NOT filter links by checking if the 'href' string contains the target domain.
   - REASON: Redirect URLs (e.g., 'google.com/url?q=...') will fail such filters.
   - LOGIC: If the element matches the selector (e.g., 'li.result a'), click it regardless of href text.

3. TEXT MATCHING MUST BE ROBUST (NORMALIZE WHITESPACE):
   - The DOM context provides "clean" text (e.g., "Health Library"), but the live site may contain newlines or extra spaces ("Health \n Library").
   - You MUST normalize whitespace when using XPath text matching.
   - STRICTLY FORBIDDEN: //tag[contains(text(), 'Value')] or any XPath that does NOT use normalize-space().
   - REQUIRED PATTERN: //tag[contains(normalize-space(.), 'Value')]
   - Example BAD: //button[contains(text(), 'Submit')]
   - Example GOOD: //button[contains(normalize-space(.), 'Submit')]

4. SELECTOR PRIORITY (ID FIRST, THEN NORMALIZED XPATH):
   - IF an element in the DOM context has an id attribute, you MUST use By.ID("that-id") as the primary locator.
   - ONLY if no id is available, use a robust XPath with normalize-space(.) on the visible text or role.
   - Do NOT invent generic XPaths if the DOM context already provides a concrete id or data-testid.

5. RESILIENT LOCATORS FOR LISTS:
   - Prefer CSS selectors for lists: driver.find_elements(By.CSS_SELECTOR, "ul.search-results li a")
   - Use XPath with normalize-space(.) only for text matching on individual items.

1. ANTI-BOT CHROME OPTIONS (CRITICAL):
   - Add Chrome argument: --disable-blink-features=AutomationControlled
   - Add experimental option excludeSwitches with value ["enable-automation"]
   - Add experimental option useAutomationExtension with value False
   - Execute JavaScript: Object.defineProperty(navigator, 'webdriver', {get: () => undefined})
   - Add custom user agent string: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
   - Add --no-sandbox and --disable-dev-shm-usage for stability
   - Add --start-maximized and --disable-extensions

2. HUMAN-LIKE TIMING (MANDATORY):
   - Add time.sleep(2) to time.sleep(3) after ALL page navigations
   - Add time.sleep(0.5) after typing in ANY input field
   - Add time.sleep(0.5) before clicking ANY button
   - Add time.sleep(3) after form submissions
   - Optional: use random.uniform(2, 4) for more natural randomized delays

3. EXPLICIT WAITS (REQUIRED):
   - Use WebDriverWait with 5 second timeout for ALL element interactions
   - Use EC.presence_of_element_located() for finding elements
   - Use EC.element_to_be_clickable() for buttons before clicking
   - Use EC.url_contains() or EC.title_contains() for page navigation verification
   - NEVER rely only on time.sleep() for waiting on elements

4. COMPREHENSIVE ERROR HANDLING (REQUIRED):
   - Wrap EVERY workflow function in try-except blocks
   - Catch TimeoutException, NoSuchElementException, WebDriverException separately
   - Use finally block to close browser resources
   - Print descriptive error messages with function/step context
   - Log success with checkmark symbols and failures with X symbols

================================================================================
BROWSER-SCOPE IMPLEMENTATION RULES
================================================================================

IMPLEMENT FULLY (In-Browser Actions):
- Navigate to URLs using driver.get() or page.goto()
- Click buttons, links, and any clickable elements
- Type into input fields, textareas
- Select options from dropdowns
- Check/uncheck checkboxes, select radio buttons
- Extract visible text from page elements
- Take screenshots
- Trigger file downloads by clicking download buttons
- Complete login flows with credential entry
- Scroll pages up/down
- Switch between tabs and windows
- Handle alerts, confirms, and prompts

DO NOT IMPLEMENT (Out-of-Browser Actions):
|- Parsing downloaded PDF, Excel, or CSV files
|- Writing to databases or updating trackers
|- Making external API calls outside browser context
|- File system operations beyond downloads folder
|- Sending emails or SMS
|- Complex data transformations or processing
|
|ITERATION & LOOPING RULES (CRITICAL):
|1. HANDLING LISTS: When the SOP or DOM context asks to "process all links" or "repeat for every item":
|   - FIRST: Collect all valid URLs from the elements into a Python list of strings.
|     Example (Selenium):
|       links = driver.find_elements(By.CSS_SELECTOR, "a.result-link")
|       urls = [link.get_attribute("href") for link in links if link.get_attribute("href")]
|   - SECOND: Iterate through the list of URLs (NOT the WebElement objects).
|     Example:
|       for url in urls:
|           driver.get(url)
|           # perform the required steps on the detail page
|   - NEVER iterate over WebElements directly if the loop involves navigation (e.g., clicking into a detail page),
|     because this causes StaleElementReferenceException when the page reloads.
|
|2. GENERALIZATION:
|   - If the DOM context contains specific examples (e.g., "Result 1", "Result 2"), inspect whether they share a common class or structure.
|   - Prefer selectors that target the reusable pattern (for example, class="result-link" or a common container) rather than a single hard-coded id.
|   - Write loops so they work for ALL matching items, not just a single hard-coded example.
|
|For out-of-browser steps mentioned in SOP, add high-level comments:
|"# TODO: Parse the downloaded report.pdf and update master tracker database"
|
|================================================================================
|CODE FORMAT AND OUTPUT STRUCTURE
================================================================================

You MUST return your response in this EXACT format with these EXACT delimiters:

=== CHAT_EXPLANATION ===
[Optional. Structured Markdown explanation only. No code fences. No runnable scripts.]
=== END_CHAT_EXPLANATION ===

=== PYTHON_SELENIUM_SCRIPT ===
[Your complete Selenium script here - NO markdown code fences, just raw Python code]
=== END_PYTHON_SELENIUM_SCRIPT ===

=== PYTHON_PLAYWRIGHT_SCRIPT ===
[Your complete Playwright script here - NO markdown code fences, just raw Python code]
=== END_PYTHON_PLAYWRIGHT_SCRIPT ===

CRITICAL: Do NOT wrap the Python code in triple backticks or any markdown. Output raw Python code only between the delimiters.

================================================================================
REQUIRED CODE ORGANIZATION FOR BOTH SCRIPTS
================================================================================

1. CONFIGURATION SECTION (at top of file):
   - CHROME_DRIVER_PATH variable set to r"C:\\path\\to\\chromedriver.exe"
   - BASE_URL or specific URLs as constants
   - Only add credentials like USERNAME/PASSWORD/EMAIL if the SOP or user request explicitly requires them
   - Do not add placeholder credentials that are not used anywhere in the workflow
   - TIMEOUT constant set to 5
2. STEALTH SETUP FUNCTION (mandatory):
   For Selenium: create_stealth_driver()
   For Playwright: create_stealth_browser()

   This function MUST include:
   - ALL anti-detection options from section 1 above
   - Proper service/browser initialization
   - Return configured driver or browser/page instances

3. WORKFLOW STEP FUNCTIONS:
   - Create ONE function per major workflow step
   - Name functions descriptively: login_to_portal(), search_wikipedia(), download_report()
   - Include docstring referencing SOP step number if available
   - Add type hints: def login(driver: webdriver.Chrome) -> None:
   - Wrap function body in try-except block
   - Print [STEP X] progress messages
   - Return relevant data if needed for next step

4. MAIN EXECUTION BLOCK:
   - Use: if __name__ == "__main__":
   - Initialize driver/browser variable to None
   - Wrap in try-except-finally structure
   - Create driver/browser in try block
   - Call workflow functions in sequence
   - Print final success message
   - Catch exceptions and print error details
   - Close browser in finally block with if driver check

================================================================================
SELENIUM-SPECIFIC REQUIREMENTS
================================================================================

IMPORTS (must include all):
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
import time

CHROME DRIVER SETUP:
- Define constant: CHROME_DRIVER_PATH = r"C:\\path\\to\\chromedriver.exe"
- Create Service: service = Service(executable_path=CHROME_DRIVER_PATH)
- DO NOT use webdriver-manager or any auto-download library
- User must manually download chromedriver and update path

STEALTH FUNCTION STRUCTURE:
def create_stealth_driver():
    service = Service(executable_path=CHROME_DRIVER_PATH)
    options = webdriver.ChromeOptions()
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)
    options.add_argument('--start-maximized')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('user-agent=Mozilla/5.0...')
    driver = webdriver.Chrome(service=service, options=options)
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    return driver

WAIT PATTERN (use for every element):
element = WebDriverWait(driver, 5).until(
    EC.presence_of_element_located((By.ID, "element-id"))
)

================================================================================
PLAYWRIGHT-SPECIFIC REQUIREMENTS
================================================================================

IMPORTS (must include):
from playwright.sync_api import sync_playwright
import time

STEALTH FUNCTION STRUCTURE:
def create_stealth_browser():
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(
        headless=False,
        args=[
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-dev-shm-usage'
        ]
    )
    context = browser.new_context(
        user_agent='Mozilla/5.0...',
        viewport={'width': 1920, 'height': 1080}
    )
    context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
        });
    """)
    page = context.new_page()
    return playwright, browser, context, page

WAIT PATTERN (use for every element):
page.wait_for_selector("#element-id", timeout=15000)
element = page.locator("#element-id")

================================================================================
COMPLETE IMPLEMENTATION STANDARDS
================================================================================

NO PLACEHOLDERS OR TODOS FOR IN-BROWSER ACTIONS:
- Every navigation step fully coded with actual URL
- Every click action fully coded with actual selector
- Every form input fully coded with actual field selection
- Every wait fully coded with WebDriverWait or page.wait_for_selector
- Every error handler fully coded with exception catching
- Code ready to run after user updates CHROME_DRIVER_PATH and credentials ONLY

PROGRESS LOGGING (required pattern):
print("[STEP 1] Starting login process...")
# ... code ...
print("[STEP 1] ✓ Login successful")

Or for errors:
print("[STEP 1] ✗ Login failed: Username field not found")

FALLBACK SELECTORS (when applicable):
try:
    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, "primary-selector"))
    )
except TimeoutException:
    element = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, ".fallback-class"))
    )

FUNCTION EXAMPLE - LOGIN WORKFLOW:
A proper login function includes:
1. Print start message with step number
2. Navigate to login URL
3. Add time.sleep(2) after navigation
4. Wait for username field with WebDriverWait
5. Clear username field
6. Type username with time.sleep(0.5) after
7. Wait for password field with WebDriverWait
8. Clear password field
9. Type password with time.sleep(0.5) after
10. Wait for submit button to be clickable
11. Add time.sleep(0.5) before click
12. Click submit button
13. Add time.sleep(3) after submission
14. Wait for dashboard or next page to load
15. Print success message
16. Wrap all in try-except with error logging

================================================================================
KEY SUCCESS CRITERIA (ALL MANDATORY)
================================================================================

✓ CAPTCHA-RESISTANT: All anti-detection Chrome options included
✓ COMPLETE: Zero TODOs for in-browser workflow actions
✓ PRODUCTION-READY: Runs immediately after path/credential updates
✓ ERROR-HANDLED: Try-except-finally in all functions and main block
✓ WELL-LOGGED: Progress messages with step numbers and success/failure symbols
✓ MAINTAINABLE: Clear function names, docstrings, type hints, comments
✓ UNIVERSAL: Works on ANY website without modification to stealth logic
✓ TIMING: Human-like delays between every major action
✓ WAITS: Explicit WebDriverWait for every element interaction
✓ SELENIUM & PLAYWRIGHT: Both scripts accomplish identical workflow
✓ NO EXTRA PLACEHOLDERS: Do not create unused USERNAME/PASSWORD or other dummy config values
Generate both scripts now following ALL requirements above.`;

    const userPrompt = `${contextSection}

---

**User Request:** ${message}

${plan.intent === "explain"
  ? "Provide an explanation / fix guidance (NO runnable code). Put it ONLY in the CHAT_EXPLANATION section as structured Markdown (headings + bullet points). Leave BOTH script sections empty."
  : plan.seleniumOnly
    ? "Generate ONE complete, production-ready Python script using Selenium only (do NOT generate Playwright)."
    : "Generate TWO complete, production-ready Python scripts (Selenium and Playwright)."}

CRITICAL REQUIREMENTS CHECKLIST:
${plan.intent === "explain"
  ? "✓ Explain clearly and concretely based on the SOP/DOM/code context above\n✓ Use structured Markdown (headings + bullet points)\n✓ Do NOT include code fences or runnable scripts"
  : plan.seleniumOnly
    ? "✓ Include create_stealth_driver() function with ALL anti-detection options listed above (Selenium only)"
    : "✓ Include create_stealth_driver() and create_stealth_browser() functions with ALL anti-detection options listed above"}
✓ For each critical element (username, password, cookie banner button, navigation button, etc.), use a defensive locator pattern:
  - Primary: WebDriverWait with the exact id from the DOM (By.ID is mandatory when id exists).
  - Secondary: in except block, WebDriverWait using name or data-testid from the DOM.
  - Tertiary: in a second except block, WebDriverWait using a robust XPath based on normalize-space(.) of the visible text or role.
✓ TEXT MATCHING: NEVER use //tag[contains(text(), 'Value')]; ALWAYS use //tag[contains(normalize-space(.), 'Value')].
✓ BANNER HANDLING: After clicking a cookie/consent banner button or container, you MUST wait for the banner container to become invisible using EC.invisibility_of_element_located(...) before interacting with underlying elements.
✓ NEVER combine expected_conditions with Python boolean operators. Do NOT write expressions like EC.title_contains(...) or EC.presence_of_element_located(...) inside .until(). Each .until() call must receive a single expected condition; use try/except to express alternatives instead.
✓ Add time.sleep(2-3) delays between ALL major actions (navigation, clicks, form submissions)
✓ Use WebDriverWait with explicit conditions (EC) for ALL element interactions - no bare element finds
✓ Wrap every workflow function in try-except blocks catching specific exceptions
✓ Use finally block in main execution to close browser
✓ Print progress with [STEP X] format using checkmark for success, X for failure
✓ Complete implementation - absolutely ZERO TODOs for in-browser actions
✓ Ready to run after user updates CHROME_DRIVER_PATH and credentials ONLY
✓ Works without CAPTCHA on ALL websites (Google, portals, e-commerce, etc.)
✓ Output raw Python code between delimiters - NO markdown code fences
${hasCookiesProfile ? "✓ Scripts MUST load cookies_json dynamically at runtime (e.g., from a BROWSER_COOKIES_JSON environment variable) and inject them into the browser context before the first navigation, without hard-coding cookie values.\n" : ""}

${contextSection ? "IMPORTANT: Follow the SOP/DOM workflow order exactly. Preserve all URLs, selectors, field names, and button labels from the context." : ""}

${plan.intent === "explain"
  ? "Remember: Output ONLY a Markdown explanation in CHAT_EXPLANATION (no code fences, no scripts) and leave both script sections empty."
  : "Remember: Output ONLY raw Python code between the === delimiters. No triple backticks, no markdown formatting."}

${plan.intent === "explain"
  ? "Answer now."
  : "Generate complete, CAPTCHA-resistant scripts now."}`;

    console.log("🚀 Calling Gemini (preflight) with ENHANCED anti-CAPTCHA LCI prompt...");
    console.log(`📊 Combined context length: ${combinedContext.length} characters`);
    console.log(`📁 SOP source: ${contextSource}`);

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          safetySettings: [
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 16000,
            topP: 0.95,
            topK: 40,
          },
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("❌ Gemini API error (preflight):", errorText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again.", code: "RATE_LIMIT" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResponse.status === 400) {
        return new Response(
          JSON.stringify({
            error: "Invalid API request. Check Gemini API key.",
            code: "INVALID_REQUEST",
            details: errorText,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Gemini API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    let generatedContent = "";

    if (aiData.candidates && aiData.candidates[0]?.content?.parts?.[0]?.text) {
      generatedContent = aiData.candidates[0].content.parts[0].text as string;
    } else {
      console.error("❌ Unexpected API response structure (preflight):", JSON.stringify(aiData, null, 2));
      throw new Error("Unexpected response structure from Gemini API");
    }

    console.log("📝 [Preflight] Generated content preview:", generatedContent.substring(0, 300));

    const stripCodeFences = (code: string | null): string | null => {
      if (!code) return code;

      let cleaned = code.trim();
      cleaned = cleaned.replace(/^```[a-zA-Z0-9_\-]*\s*\n?/gm, "");
      cleaned = cleaned.replace(/```\s*$/gm, "");
      cleaned = cleaned.replace(/^```\s*$/gm, "");

      console.log(`🧹 [Preflight] Stripped code fences, length: ${cleaned.length}`);
      return cleaned.trim();
    };

    const extractBetweenMarkers = (
      source: string,
      startMarker: string,
      endMarker: string,
    ): string | null => {
      const startIndex = source.indexOf(startMarker);
      if (startIndex === -1) {
        console.log(`⚠️  [Preflight] Start marker not found: ${startMarker}`);
        return null;
      }

      const afterStart = startIndex + startMarker.length;
      const endIndex = source.indexOf(endMarker, afterStart);

      const slice = endIndex === -1 ? source.slice(afterStart) : source.slice(afterStart, endIndex);

      console.log(`✂️  [Preflight] Extracted ${slice.length} chars between markers`);
      return slice.trim();
    };

    const stripMarkdownFencesFromText = (text: string | null): string | null => {
      if (!text) return text;
      return text.replace(/```[\s\S]*?```/g, "").trim();
    };

    const stripLeadingCommentMarkers = (text: string): string => {
      return text
        .split("\n")
        .map((line) => line.replace(/^\s*#\s?/, ""))
        .join("\n")
        .trim();
    };

    const chatExplanation = stripMarkdownFencesFromText(
      extractBetweenMarkers(
        generatedContent,
        "=== CHAT_EXPLANATION ===",
        "=== END_CHAT_EXPLANATION ===",
      ),
    );

    let pythonSeleniumScript = stripCodeFences(
      extractBetweenMarkers(
        generatedContent,
        "=== PYTHON_SELENIUM_SCRIPT ===",
        "=== END_PYTHON_SELENIUM_SCRIPT ===",
      ),
    );

    const requirePlaywright = plan.requirePlaywright;

    let pythonPlaywrightScript = stripCodeFences(
      extractBetweenMarkers(
        generatedContent,
        "=== PYTHON_PLAYWRIGHT_SCRIPT ===",
        "=== END_PYTHON_PLAYWRIGHT_SCRIPT ===",
      ),
    );

    // EXPLANATION MODE: never return scripts; return explanation instead
    if (plan.intent === "explain") {
      const fallbackFromSelenium = pythonSeleniumScript ? stripLeadingCommentMarkers(pythonSeleniumScript) : "";
      const explanation = (chatExplanation && chatExplanation.trim()) ? chatExplanation.trim() : fallbackFromSelenium;

      return new Response(
        JSON.stringify({
          explanation,
          scripts: { python_selenium: "", python_playwright: null, raw: generatedContent },
          model_used: "gemini-2.5-flash",
          intent: plan.intent,
          selenium_only: plan.seleniumOnly,
          context_used: combinedContext.length,
          context_source: contextSource,
          sop_file: sopFileName,
          retrieval_method: "preflight_dom_long_context",
          parsing_method: "chat-explanation",
          anti_captcha_enabled: true,
          cookies_profile_present: hasCookiesProfile,
          target_url: targetUrl,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (!requirePlaywright) {
      // Enforce contract: when Selenium-only or explanation mode is active, never return Playwright output.
      pythonPlaywrightScript = null;
    }

    if (!pythonSeleniumScript || (requirePlaywright && !pythonPlaywrightScript)) {
      console.warn("⚠️  [Preflight] Primary parsing failed, attempting fallback...");

      const allPythonBlocks = generatedContent.match(/```(?:python|py)?[\s\S]*?```/gi);

      if (allPythonBlocks && (requirePlaywright ? allPythonBlocks.length >= 2 : allPythonBlocks.length >= 1)) {
        console.log(`🔄 [Preflight] Found ${allPythonBlocks.length} code blocks, using ${requirePlaywright ? "first two" : "first"}`);

        pythonSeleniumScript = stripCodeFences(allPythonBlocks[0]);
        pythonPlaywrightScript = requirePlaywright ? stripCodeFences(allPythonBlocks[1]) : null;

        return new Response(
          JSON.stringify({
            scripts: {
              python_selenium: pythonSeleniumScript,
              python_playwright: pythonPlaywrightScript,
              raw: generatedContent,
            },
            model_used: "gemini-2.5-flash",
            context_used: combinedContext.length,
            context_source: contextSource,
            sop_file: sopFileName,
            retrieval_method: "preflight_dom_long_context",
            parsing_method: requirePlaywright ? "fallback-code-fences" : "fallback-code-fences-selenium-only",
            anti_captcha_enabled: true,
            features: [
              "anti-bot-chrome-options",
              "human-like-timing",
              "explicit-waits",
              "comprehensive-error-handling",
              "complete-implementation",
              "markdown-stripped",
            ],
            target_url: targetUrl,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      console.warn("⚠️  [Preflight] All parsing failed, returning cleaned raw content");

      const cleanedRaw =
        stripCodeFences(
          generatedContent
            .replace(/===\s*PYTHON_SELENIUM_SCRIPT\s*===/gi, "")
            .replace(/===\s*END_PYTHON_SELENIUM_SCRIPT\s*===/gi, "")
            .replace(/===\s*PYTHON_PLAYWRIGHT_SCRIPT\s*===/gi, "")
            .replace(/===\s*END_PYTHON_PLAYWRIGHT_SCRIPT\s*===/gi, ""),
        ) ?? generatedContent;

      return new Response(
        JSON.stringify({
          scripts: {
            python_selenium: cleanedRaw,
            python_playwright: null,
            raw: generatedContent,
          },
          model_used: "gemini-2.5-flash",
          context_used: combinedContext.length,
          context_source: contextSource,
          sop_file: sopFileName,
          retrieval_method: "preflight_dom_long_context",
          parsing_method: "raw-cleaned",
          warning: "Could not separate scripts - returning cleaned content in Selenium field",
          anti_captcha_enabled: true,
          target_url: targetUrl,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    console.log("✅ [Preflight] Successfully parsed output", {
      intent: plan.intent,
      seleniumOnly: plan.seleniumOnly,
      hasPlaywright: !!pythonPlaywrightScript,
      seleniumLength: pythonSeleniumScript?.length || 0,
      playwrightLength: pythonPlaywrightScript?.length || 0,
    });

    return new Response(
      JSON.stringify({
        scripts: {
          python_selenium: pythonSeleniumScript,
          python_playwright: pythonPlaywrightScript,
          raw: generatedContent,
        },
        model_used: "gemini-2.5-flash",
        intent: plan.intent,
        selenium_only: plan.seleniumOnly,
        context_used: combinedContext.length,
        context_source: contextSource,
        sop_file: sopFileName,
        retrieval_method: "preflight_dom_long_context",
        parsing_method: plan.requirePlaywright ? "primary-markers" : "primary-markers-selenium-only",
        anti_captcha_enabled: true,
        cookies_profile_present: hasCookiesProfile,
        features: [
          "anti-bot-chrome-options",
          "human-like-timing",
          "explicit-waits",
          "comprehensive-error-handling",
          "complete-implementation",
          "markdown-stripped",
          "clean-python-output",
        ],
        target_url: targetUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("❌ [Preflight] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage, stack: error instanceof Error ? error.stack : undefined }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
