// supabase/functions/generate-script-rag/index.ts
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
    // Auth-free dev mode: SOP context is passed directly from the frontend.
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

    // Construct enhanced system prompt with COMPLETE SOP context
    const contextSection = sopContext
      ? `\n\n=== COMPLETE SOP WORKFLOW ===
${sopContext}
=== END SOP ===\n`
      : "";

    const systemPrompt = `You are an expert automation engineer specializing in web automation and RPA. Generate TWO complete, production-ready Python automation scripts based on the provided SOP workflow.

${contextSection ? "CRITICAL INSTRUCTIONS:" : ""}
${contextSection ? "- A COMPLETE SOP workflow is provided above. You MUST follow ALL steps in the EXACT order they appear." : ""}
${contextSection ? "- Map each SOP step to corresponding automation code with comments referencing step numbers." : ""}
${contextSection ? "- Preserve all technical details: URLs, selectors, field names, data values, wait times." : ""}
${contextSection ? "- If the SOP mentions specific timing or delays, implement them exactly." : ""}

Return your response in this EXACT format (do not deviate):

=== PYTHON_SELENIUM_SCRIPT ===
[Complete Python script using Selenium WebDriver]
=== END_PYTHON_SELENIUM_SCRIPT ===

=== PYTHON_PLAYWRIGHT_SCRIPT ===
[Complete Python script using Playwright]
=== END_PYTHON_PLAYWRIGHT_SCRIPT ===

REQUIREMENTS FOR BOTH SCRIPTS:
1. **Complete and executable** - include all necessary imports, setup, and teardown
2. **Robust error handling** - try/except blocks, proper logging, graceful failures
3. **Explicit waits** - use WebDriverWait/playwright waits instead of time.sleep()
4. **Clear structure** - organize code into functions for each major step
5. **Production-ready** - add configuration, environment variables, and comments
6. **Sequential flow** - ${contextSection ? "Follow SOP steps in exact order with numbered comments (# Step 1, # Step 2, etc.)" : "Implement logical automation steps"}

PYTHON SELENIUM SCRIPT SPECIFICS:
- Use Python with Selenium WebDriver
- Import: from selenium import webdriver, from selenium.webdriver.common.by import By
- Import: from selenium.webdriver.support.ui import WebDriverWait
- Import: from selenium.webdriver.support import expected_conditions as EC
- Use explicit waits: WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "element_id")))
- Proper exception handling with specific Selenium exceptions
- Use ChromeDriver or compatible driver
- Close browser in finally block
- Example structure:
  \`\`\`python
  from selenium import webdriver
  from selenium.webdriver.common.by import By
  from selenium.webdriver.support.ui import WebDriverWait
  from selenium.webdriver.support import expected_conditions as EC
  import logging
  
  def main():
      driver = None
      try:
          driver = webdriver.Chrome()
          # automation code here
      except Exception as e:
          logging.error(f"Error: {e}")
      finally:
          if driver:
              driver.quit()
  
  if __name__ == "__main__":
      main()
  \`\`\`

PYTHON PLAYWRIGHT SCRIPT SPECIFICS:
- Use Python with Playwright library
- Import: from playwright.sync_api import sync_playwright
- Use synchronous API (sync_playwright) for simpler code
- Use built-in waits: page.wait_for_selector(), page.wait_for_load_state()
- Proper error handling with try/except
- Close browser and context properly
- Example structure:
  \`\`\`python
  from playwright.sync_api import sync_playwright
  import logging
  
  def main():
      with sync_playwright() as p:
          browser = None
          try:
              browser = p.chromium.launch(headless=False)
              context = browser.new_context()
              page = context.new_page()
              # automation code here
          except Exception as e:
              logging.error(f"Error: {e}")
          finally:
              if browser:
                  browser.close()
  
  if __name__ == "__main__":
      main()
  \`\`\`

IMPORTANT: Both scripts should accomplish the same automation task but using different libraries (Selenium vs Playwright).`;

    const userPrompt = `${contextSection}
---

**User Request:** ${message}

Generate both Python Selenium and Python Playwright automation scripts that fulfill this request${contextSection ? " while strictly following the SOP workflow provided above" : ""}.`;

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
            temperature: 0.3,
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

    const pythonSeleniumScript = pythonSeleniumMatch ? pythonSeleniumMatch[1].trim() : null;
    const pythonPlaywrightScript = pythonPlaywrightMatch ? pythonPlaywrightMatch[1].trim() : null;

    if (!pythonSeleniumScript || !pythonPlaywrightScript) {
      console.error("Failed to parse scripts from AI response");
      console.error("Generated content:", generatedContent.substring(0, 1000));
      
      // Try alternative parsing if primary fails
      const altSeleniumMatch = generatedContent.match(/``````/);
      const allPythonBlocks = generatedContent.match(/``````/g);
      
      if (allPythonBlocks && allPythonBlocks.length >= 2) {
        console.log("Using alternative parsing method with code blocks");
        const selenium = allPythonBlocks[0].replace(/``````\s*$/, '').trim();
        const playwright = allPythonBlocks[1].replace(/``````\s*$/, '').trim();
        
        return new Response(
          JSON.stringify({
            scripts: {
              python_selenium: selenium,
              python_playwright: playwright,
              raw: generatedContent,
            },
            model_used: "gemini-2.5-flash",
            context_used: sopContext.length,
            context_source: contextSource,
            sop_file: sopFileName,
            retrieval_method: "long_context_injection",
            parsing_method: "alternative",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      // Return raw content if parsing fails
      return new Response(
        JSON.stringify({
          scripts: {
            python_selenium: generatedContent,
            python_playwright: null,
            raw: generatedContent,
          },
          model_used: "gemini-2.5-flash",
          context_used: sopContext.length,
          context_source: contextSource,
          sop_file: sopFileName,
          retrieval_method: "long_context_injection",
          warning: "Failed to parse scripts - returning raw content",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log("✅ Successfully generated both Python scripts using Long Context Injection");
    console.log(`   - Python Selenium script: ${pythonSeleniumScript.length} characters`);
    console.log(`   - Python Playwright script: ${pythonPlaywrightScript.length} characters`);
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
