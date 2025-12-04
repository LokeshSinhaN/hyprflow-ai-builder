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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as GeneratePreflightBody;
    const { message, sop_text, job_id } = body;

    if (!message || !job_id) {
      return new Response(
        JSON.stringify({ error: "message and job_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    // Fetch preflight job with DOM HTML
    const jobResp = await fetch(
      `${SUPABASE_URL}/rest/v1/preflight_jobs?id=eq.${job_id}&select=target_url,dom_html,status,error`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );

    if (!jobResp.ok) {
      const text = await jobResp.text();
      console.error("Failed to fetch preflight job:", jobResp.status, text);
      return new Response(
        JSON.stringify({ error: "Failed to fetch preflight job" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = (await jobResp.json()) as any[];
    if (!rows.length) {
      return new Response(
        JSON.stringify({ error: "Preflight job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const job = rows[0];
    if (job.status !== "done") {
      return new Response(
        JSON.stringify({ error: `Preflight job is not complete (status=${job.status})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!job.dom_html) {
      return new Response(
        JSON.stringify({ error: "Preflight job has no DOM HTML" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const targetUrl: string = job.target_url ?? "";
    const domHtml: string = job.dom_html as string;

    const truncatedDom = domHtml.length > 60000 ? domHtml.slice(0, 60000) : domHtml;

    const sopContext = sop_text && sop_text.trim().length > 0
      ? `\n\n=== SOP CONTEXT ===\n${sop_text}\n=== END SOP CONTEXT ===\n`
      : "";

    const systemPrompt = `You are an expert Selenium automation engineer.\n\n` +
      `Your task is to generate a complete, production-ready Python Selenium script for browser automation. ` +
      `You are given the REAL HTML of the target page so you must use ONLY selectors (ids, names, classes, text) that actually exist in this HTML. ` +
      `Do NOT invent element ids or classes. Prefer stable, unique IDs, then names, then well-scoped CSS selectors.\n\n` +
      `The generated script must:\n` +
      `- Include all necessary imports and a main() entry point.\n` +
      `- Use webdriver.Chrome() and WebDriverWait for reliable interactions.\n` +
      `- Navigate to the target URL and perform the workflow described by the user and SOP.\n` +
      `- Contain clear comments explaining each major step.\n` +
      `- Be runnable locally without external services beyond Selenium and Chrome.\n` +
      `Return ONLY raw Python code (no markdown, no explanations).`;

    const prompt = `TARGET URL: ${targetUrl || "(unknown)"}\n\n` +
      `USER REQUEST:\n${message}\n\n` +
      sopContext +
      `\n\n=== PAGE HTML (TRUNCATED) ===\n` +
      `${truncatedDom}\n` +
      `=== END PAGE HTML ===`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8000,
          },
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Gemini API error (preflight):", aiResponse.status, errorText);
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Gemini rate limit exceeded. Please try again.", code: "RATE_LIMIT" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Gemini API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();

    let generatedContent = "";
    if (aiData.candidates && aiData.candidates[0]?.content?.parts?.[0]?.text) {
      generatedContent = aiData.candidates[0].content.parts[0].text as string;
    } else {
      console.error("Unexpected Gemini response structure (preflight):", JSON.stringify(aiData, null, 2));
      throw new Error("Unexpected response structure from Gemini API");
    }

    const stripCodeFences = (code: string): string => {
      let cleaned = code.trim();
      cleaned = cleaned.replace(/^```[a-zA-Z0-9_\-]*\s*\n?/gm, "");
      cleaned = cleaned.replace(/```\s*$/gm, "");
      cleaned = cleaned.replace(/^```\s*$/gm, "");
      return cleaned.trim();
    };

    const pythonScript = stripCodeFences(generatedContent);

    return new Response(
      JSON.stringify({
        scripts: {
          python_selenium: pythonScript,
          raw: generatedContent,
        },
        model_used: "gemini-2.5-flash",
        source: "preflight-dom",
        target_url: targetUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in generate-script-preflight function:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
