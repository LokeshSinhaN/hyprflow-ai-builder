import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, sop_text } = await req.json();
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    let sopContext = sop_text || "";
    let contextSource = sopContext ? "frontend" : "none";
    let sopFileName = sopContext ? "Uploaded SOP" : "";

    if (!sopContext) {
      console.warn("No SOP context provided; generating script from user request only.");
      sopContext = "No SOP documents were provided. Generate script based on user request only.";
    }

    const contextSection = sopContext
      ? `\n\n=== COMPLETE SOP WORKFLOW ===\n${sopContext}\n=== END SOP ===\n`
      : "";

    // ENHANCED SYSTEM PROMPT WITH ALL ANTI-CAPTCHA INSTRUCTIONS
    const systemPrompt = `You are an expert web automation engineer specializing in production-ready, CAPTCHA-RESISTANT browser automation.

Generate TWO complete Python automation scripts with UNIVERSAL ANTI-DETECTION capabilities that work for ANY website.

${contextSection ? "CRITICAL: Use the SOP content above as the source of truth for workflow steps." : ""}

================================================================================
MANDATORY ANTI-DETECTION FEATURES (MUST INCLUDE IN ALL SCRIPTS)
================================================================================

These features PREVENT CAPTCHA and bot detection on ALL websites (Google, Wikipedia, portals, e-commerce, social media, etc.)

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
- Parsing downloaded PDF, Excel, or CSV files
- Writing to databases or updating trackers
- Making external API calls outside browser context
- File system operations beyond downloads folder
- Sending emails or SMS
- Complex data transformations or processing

For out-of-browser steps mentioned in SOP, add high-level comments:
"# TODO: Parse the downloaded report.pdf and update master tracker database"

================================================================================
CODE FORMAT AND OUTPUT STRUCTURE
================================================================================

You MUST return your response in this EXACT format with these EXACT delimiters:

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

Generate TWO complete, production-ready Python scripts (Selenium and Playwright) with UNIVERSAL anti-CAPTCHA features.

CRITICAL REQUIREMENTS CHECKLIST:
✓ Include create_stealth_driver() and create_stealth_browser() functions with ALL anti-detection options listed above
✓ Add time.sleep(2-3) delays between ALL major actions (navigation, clicks, form submissions)
✓ Use WebDriverWait with explicit conditions (EC) for ALL element interactions - no bare element finds
✓ Wrap every workflow function in try-except blocks catching specific exceptions
✓ Use finally block in main execution to close browser
✓ Print progress with [STEP X] format using checkmark for success, X for failure
✓ Complete implementation - absolutely ZERO TODOs for in-browser actions
✓ Ready to run after user updates CHROME_DRIVER_PATH and credentials ONLY
✓ Works without CAPTCHA on ALL websites (Google, portals, e-commerce, etc.)
✓ Output raw Python code between delimiters - NO markdown code fences

${contextSection ? "IMPORTANT: Follow the SOP workflow order exactly. Preserve all URLs, selectors, field names, and button labels from the SOP." : ""}

Remember: Output ONLY raw Python code between the === delimiters. No triple backticks, no markdown formatting.

Generate complete, CAPTCHA-resistant scripts now.`;

    console.log("🚀 Calling Gemini with ENHANCED anti-CAPTCHA LCI prompt...");
    console.log(`📊 Context length: ${sopContext.length} characters`);
    console.log(`📁 SOP source: ${contextSource}`);

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: { 
            temperature: 0.3, 
            maxOutputTokens: 16000,
            topP: 0.95,
            topK: 40
          },
        }),
      }
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("❌ Gemini API error:", errorText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again.", code: "RATE_LIMIT" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 400) {
        return new Response(
          JSON.stringify({ 
            error: "Invalid API request. Check Gemini API key.", 
            code: "INVALID_REQUEST", 
            details: errorText 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Gemini API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    let generatedContent = "";

    if (aiData.candidates && aiData.candidates[0]?.content?.parts?.[0]?.text) {
      generatedContent = aiData.candidates[0].content.parts[0].text;
    } else {
      console.error("❌ Unexpected API response structure:", JSON.stringify(aiData, null, 2));
      throw new Error("Unexpected response structure from Gemini API");
    }

    console.log("📝 Generated content preview:", generatedContent.substring(0, 300));

    // ENHANCED MARKDOWN STRIPPING FUNCTION
    const stripCodeFences = (code: string | null): string | null => {
      if (!code) return code;

      let cleaned = code.trim();

      // Remove all variations of code fence markers
      // Handles: ```python, ```py, ``` alone, with any whitespace
      cleaned = cleaned.replace(/^```[a-zA-Z0-9_\-]*\s*\n?/gm, "");
      cleaned = cleaned.replace(/```\s*$/gm, "");
      cleaned = cleaned.replace(/^```\s*$/gm, "");

      // Remove leading/trailing whitespace
      cleaned = cleaned.trim();

      console.log(`🧹 Stripped code fences, length: ${cleaned.length}`);
      return cleaned;
    };

    // EXTRACT BETWEEN MARKERS FUNCTION
    const extractBetweenMarkers = (
      source: string,
      startMarker: string,
      endMarker: string,
    ): string | null => {
      const startIndex = source.indexOf(startMarker);
      if (startIndex === -1) {
        console.log(`⚠️  Start marker not found: ${startMarker}`);
        return null;
      }

      const afterStart = startIndex + startMarker.length;
      const endIndex = source.indexOf(endMarker, afterStart);

      const slice = endIndex === -1
        ? source.slice(afterStart)
        : source.slice(afterStart, endIndex);

      console.log(`✂️  Extracted ${slice.length} chars between markers`);
      return slice.trim();
    };

    // PRIMARY PARSING: Extract using markers
    let pythonSeleniumScript = stripCodeFences(
      extractBetweenMarkers(
        generatedContent,
        "=== PYTHON_SELENIUM_SCRIPT ===",
        "=== END_PYTHON_SELENIUM_SCRIPT ===",
      ),
    );

    let pythonPlaywrightScript = stripCodeFences(
      extractBetweenMarkers(
        generatedContent,
        "=== PYTHON_PLAYWRIGHT_SCRIPT ===",
        "=== END_PYTHON_PLAYWRIGHT_SCRIPT ===",
      ),
    );

    // FALLBACK PARSING: Try code fences if markers failed
    if (!pythonSeleniumScript || !pythonPlaywrightScript) {
      console.warn("⚠️  Primary parsing failed, attempting fallback...");

      const allPythonBlocks = generatedContent.match(/```(?:python|py)?[\s\S]*?```/gi);

      if (allPythonBlocks && allPythonBlocks.length >= 2) {
        console.log(`🔄 Found ${allPythonBlocks.length} code blocks, using first two`);

        pythonSeleniumScript = stripCodeFences(allPythonBlocks[0]);
        pythonPlaywrightScript = stripCodeFences(allPythonBlocks[1]);

        return new Response(JSON.stringify({
          scripts: { 
            python_selenium: pythonSeleniumScript, 
            python_playwright: pythonPlaywrightScript, 
            raw: generatedContent 
          },
          model_used: "gemini-2.5-flash",
          context_used: sopContext.length,
          context_source: contextSource,
          sop_file: sopFileName,
          retrieval_method: "long_context_injection",
          parsing_method: "fallback-code-fences",
          anti_captcha_enabled: true,
          features: [
            "anti-bot-chrome-options",
            "human-like-timing",
            "explicit-waits",
            "comprehensive-error-handling",
            "complete-implementation",
            "markdown-stripped"
          ]
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // LAST RESORT: Return cleaned raw content
      console.warn("⚠️  All parsing failed, returning cleaned raw content");

      const cleanedRaw = stripCodeFences(
        generatedContent
          .replace(/===\s*PYTHON_SELENIUM_SCRIPT\s*===/gi, "")
          .replace(/===\s*END_PYTHON_SELENIUM_SCRIPT\s*===/gi, "")
          .replace(/===\s*PYTHON_PLAYWRIGHT_SCRIPT\s*===/gi, "")
          .replace(/===\s*END_PYTHON_PLAYWRIGHT_SCRIPT\s*===/gi, ""),
      ) ?? generatedContent;

      return new Response(JSON.stringify({
        scripts: { 
          python_selenium: cleanedRaw, 
          python_playwright: null, 
          raw: generatedContent 
        },
        model_used: "gemini-2.5-flash",
        context_used: sopContext.length,
        context_source: contextSource,
        sop_file: sopFileName,
        retrieval_method: "long_context_injection",
        parsing_method: "raw-cleaned",
        warning: "Could not separate scripts - returning cleaned content in Selenium field",
        anti_captcha_enabled: true
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // SUCCESS PATH
    console.log("✅ Successfully parsed both scripts");
    console.log(`📊 Selenium script: ${pythonSeleniumScript?.length || 0} characters`);
    console.log(`📊 Playwright script: ${pythonPlaywrightScript?.length || 0} characters`);
    console.log("🛡️  Anti-CAPTCHA: ENABLED");
    console.log("🧹 Markdown: STRIPPED");

    return new Response(JSON.stringify({
      scripts: {
        python_selenium: pythonSeleniumScript,
        python_playwright: pythonPlaywrightScript,
        raw: generatedContent
      },
      model_used: "gemini-2.5-flash",
      context_used: sopContext.length,
      context_source: contextSource,
      sop_file: sopFileName,
      retrieval_method: "long_context_injection",
      parsing_method: "primary-markers",
      anti_captcha_enabled: true,
      features: [
        "anti-bot-chrome-options",
        "human-like-timing",
        "explicit-waits",
        "comprehensive-error-handling",
        "complete-implementation",
        "markdown-stripped",
        "clean-python-output"
      ]
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error("❌ Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage, stack: error instanceof Error ? error.stack : undefined }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});