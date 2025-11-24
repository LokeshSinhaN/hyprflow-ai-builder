// supabase/functions/generate-script-rag/index.ts
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Utility to remove markdown-style code fences (```python ... ```)
const stripCodeFences = (code: string | null): string | null => {
  if (!code) return code;
  let cleaned = code.trim();

  // If it starts with ```... remove the first line
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split(/\r?\n/);
    lines.shift();
    cleaned = lines.join("\n");
  }

  // If it ends with a ``` line, remove the last line
  const lines = cleaned.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
    lines.pop();
    cleaned = lines.join("\n");
  }

  return cleaned.trim();
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth-free dev mode: SOP context is passed directly from the frontend.
    const { message, sop_text } = await req.json();
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    let sopContext = sop_text || "";
    const contextSource = sopContext ? "frontend" : "none";
    const sopFileName = sopContext ? "Uploaded SOP" : "";

    // To keep latency reasonable, cap the amount of SOP text we send to the model.
    const MAX_SOP_CHARS = 40000;
    if (sopContext.length > MAX_SOP_CHARS) {
      console.warn(`Truncating SOP context from ${sopContext.length} to ${MAX_SOP_CHARS} characters`);
      sopContext = sopContext.slice(0, MAX_SOP_CHARS);
    }

    if (!sopContext) {
      console.warn("No SOP context provided; generating script from user request only.");
      sopContext = "No SOP documents were provided. Generate script based on user request only.";
    }

    // Construct enhanced system prompt with COMPLETE SOP context
    const contextSection = sopContext
      ? `\n\n=== COMPLETE SOP WORKFLOW ===
${sopContext}
=== END SOP ===\n`
      : "";

    const systemPrompt = `You are an expert web automation engineer specializing in browser-based RPA.
Generate TWO clear and well-structured Python automation scripts that implement only the in-browser steps of the SOP or user workflow.

${contextSection ? "CRITICAL: Use the SOP content above as the source of truth for the browser steps." : ""}

BROWSER-SCOPE REQUIREMENTS:
- Implement only actions that happen inside the browser: navigation, clicks, typing, selecting options, reading visible text, taking screenshots, and triggering downloads/prints from the UI.
- Do NOT write code that parses or reads downloaded files (PDF/Excel/CSV), writes to the local filesystem, updates trackers/databases, calls external APIs, or performs other non-browser business logic.
- When the SOP describes out-of-browser work (for example: "parse the PDF and update the master tracker"), represent that work only as high-level comments such as "# TODO: parse downloaded PDF and update tracker" without implementing it.
- Preserve important technical details from the SOP that affect browser behavior: URLs, form fields, button labels, selectors, wait conditions, and explicit timings.

Return your response in this EXACT format (do not deviate):

IMPORTANT: DO NOT use Markdown-style triple-backtick code fences (no fenced "python" blocks). Return only plain Python code between the markers.

=== PYTHON_SELENIUM_SCRIPT ===
[Complete Python script using Selenium WebDriver]
=== END_PYTHON_SELENIUM_SCRIPT ===

=== PYTHON_PLAYWRIGHT_SCRIPT ===
[Complete Python script using Playwright]
=== END_PYTHON_PLAYWRIGHT_SCRIPT ===

GENERAL CODE STYLE FOR BOTH SCRIPTS:
- Organize the code into small functions, one per major browser step (e.g. login, open_remittance_page, click_clearinghouse_connection_tab, open_target_file_link).
- At the top of each function, add a short comment explaining what the step does and, if applicable, which SOP step it corresponds to.
- Include a small configuration section (constants) for base URLs, credentials/placeholders, and any reused selectors.
- Do NOT read configuration from environment variables (no os.getenv, no os.environ). Instead, declare plain Python constants with clear placeholder values, e.g. INSTAGRAM_USERNAME = "your_instagram_username".
- Use clear variable names and avoid deeply nested logic where possible.

PYTHON SELENIUM SCRIPT SPECIFICS:
- Use Selenium WebDriver with Chrome (or a generic driver configuration).
- Use explicit waits via WebDriverWait and expected_conditions instead of time.sleep().
- Catch common Selenium exceptions where appropriate and log a helpful message.
- Ensure the browser is closed in a finally block.

PYTHON PLAYWRIGHT SCRIPT SPECIFICS:
- Use the synchronous API: from playwright.sync_api import sync_playwright.
- Use Playwright's built-in waiting (page.wait_for_load_state, page.wait_for_selector, locator-based waits) instead of time.sleep().
- Ensure browser and context are closed in a finally block.

IMPORTANT: Both scripts should accomplish the same browser workflow (up to the point where any out-of-browser work would begin), but using different libraries (Selenium vs Playwright).`;

    const userPrompt = `${contextSection}
---

**User Request:** ${message}

Generate both Python Selenium and Python Playwright scripts that cover only the in-browser steps of this workflow.
Ignore or leave TODO-style comments for any steps that require parsing downloaded files, updating trackers, or other non-browser work.${contextSection ? " Follow the order of browser steps as they appear in the SOP above." : ""}`;

    console.log("Calling Gemini 2.5 Flash with full SOP context...");
    console.log(`Context length: ${sopContext.length} characters`);

    // Direct Gemini API call
    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${systemPrompt}\n\n${userPrompt}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            // 4000 tokens is usually enough for two full scripts and is faster than 6000/16000
            maxOutputTokens: 16000,
          },
        }),
      }
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Gemini API error:", errorText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded. Please try again in a moment.",
            code: "RATE_LIMIT",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (aiResponse.status === 400) {
        return new Response(
          JSON.stringify({
            error: "Invalid API request. Please check your Gemini API key.",
            code: "INVALID_REQUEST",
            details: errorText,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Gemini API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();

    // Extract content from Gemini API response structure
    let generatedContent = "";
    if (aiData.candidates && aiData.candidates[0]?.content?.parts?.[0]?.text) {
      generatedContent = aiData.candidates[0].content.parts[0].text;
    } else {
      console.error("Unexpected Gemini API response structure:", JSON.stringify(aiData, null, 2));
      throw new Error("Unexpected response structure from Gemini API");
    }

    console.log("Raw generated content preview:", generatedContent.substring(0, 300));

    // Parse the generated scripts with updated delimiters
    const pythonSeleniumMatch = generatedContent.match(/=== PYTHON_SELENIUM_SCRIPT ===\s*\n([\s\S]*?)\n=== END_PYTHON_SELENIUM_SCRIPT ===/);
    const pythonPlaywrightMatch = generatedContent.match(/=== PYTHON_PLAYWRIGHT_SCRIPT ===\s*\n([\s\S]*?)\n=== END_PYTHON_PLAYWRIGHT_SCRIPT ===/);

    let pythonSeleniumScript = pythonSeleniumMatch ? pythonSeleniumMatch[1].trim() : null;
    let pythonPlaywrightScript = pythonPlaywrightMatch ? pythonPlaywrightMatch[1].trim() : null;

    // Clean up any stray markdown code fences the model might have added
    pythonSeleniumScript = stripCodeFences(pythonSeleniumScript);
    pythonPlaywrightScript = stripCodeFences(pythonPlaywrightScript);

    let haveSelenium = !!pythonSeleniumScript;
    let havePlaywright = !!pythonPlaywrightScript;

    if (!haveSelenium || !havePlaywright) {
      console.error("Failed to parse one or both scripts from AI response using primary delimiters");
      console.error("Generated content (first 1000 chars):", generatedContent.substring(0, 1000));
      
      // Try alternative parsing: look for ```python ... ``` style blocks
      const fencedMatch = generatedContent.match(/```python[\s\S]*?```/gi);
      if (fencedMatch && fencedMatch.length >= 1) {
        console.log("Using fenced code block parsing fallback");
        if (!haveSelenium) {
          pythonSeleniumScript = stripCodeFences(fencedMatch[0]);
          haveSelenium = !!pythonSeleniumScript;
        }
        if (!havePlaywright && fencedMatch.length >= 2) {
          pythonPlaywrightScript = stripCodeFences(fencedMatch[1]);
          havePlaywright = !!pythonPlaywrightScript;
        }
      }

      // Final fallback: if we still have neither script, strip fences from the whole content
      if (!haveSelenium && !havePlaywright) {
        console.warn("Falling back to stripCodeFences on entire generated content");
        const cleaned = stripCodeFences(generatedContent) ?? generatedContent;
        pythonSeleniumScript = cleaned;
        haveSelenium = true;
      }
    }

    // At this point we guarantee at least a Selenium script; Playwright may be null
    if (!pythonSeleniumScript) {
      throw new Error("Unable to extract a Python Selenium script from model output.");
    }

    console.log("✅ Successfully generated Python scripts using Long Context Injection");
    console.log(`   - Python Selenium script: ${pythonSeleniumScript.length} characters`);
    if (pythonPlaywrightScript) {
      console.log(`   - Python Playwright script: ${pythonPlaywrightScript.length} characters`);
    } else {
      console.log("   - Python Playwright script: not available (generation or parsing truncated)");
    }
    console.log(`   - Context source: ${contextSource}`);
    console.log(`   - SOP file: ${sopFileName || "none"}`);

    return new Response(
      JSON.stringify({
        scripts: {
          python_selenium: pythonSeleniumScript,
          python_playwright: pythonPlaywrightScript,
          raw: generatedContent,
        },
        model_used: "gemini-2.5-flash",
        context_used: sopContext.length,
        context_source: contextSource,
        sop_file: sopFileName,
        retrieval_method: "long_context_injection",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    console.error("Error in generate-script:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
