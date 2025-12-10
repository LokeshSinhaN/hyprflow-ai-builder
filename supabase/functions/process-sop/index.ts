// supabase/functions/process-sop/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1/lib/pdf-parse.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Processing SOP PDF in auth-free dev mode (no DB writes)...");

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    // Parse form data
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      throw new Error("No file provided");
    }

    console.log(`Processing file: ${file.name} (${file.size} bytes)`);

    // Extract text from PDF
    const arrayBuffer = await file.arrayBuffer();
    const doc = await pdf(arrayBuffer);
    const rawText = doc.text;

    if (!rawText || rawText.trim().length === 0) {
      throw new Error("No text could be extracted from the PDF");
    }

    // Clean and normalize the text
    const cleanedText = rawText
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    console.log(`Extracted ${cleanedText.length} characters from ${doc.numPages} pages`);

    // Try to detect Target URLs section from the SOP template
    const extractTargetUrlsFromText = (text: string): string[] => {
      const lines = text.split("\n");
      const headingIndex = lines.findIndex((line) => /target urls?/i.test(line));

      if (headingIndex === -1) {
        console.log("No 'Target URLs' heading found.");
        return [];
      }

      const urlRegex = /https?:\/\/[^\s)>"']+/gi;
      const urls = new Set<string>();
      
      // Look at lines after the heading
      for (let i = headingIndex + 1; i < lines.length; i++) {
        let line = lines[i].trim();

        // FIX: If the line is empty, just skip it. Do NOT break.
        if (!line) continue;

        // Stop if we hit an obvious NEW section heading
        const isHeading = /^[A-Z][A-Za-z0-9\s]{0,60}:?$/.test(line);
        const looksLikeUrl = /https?:\/\//i.test(line);

        if (isHeading && !looksLikeUrl) {
            // We hit a new section, stop looking.
            break;
        }

        // FIX: Check for split URLs (PDF wrapping artifacts)
        // If the next line is a short fragment (e.g., "524", "html"), merge it.
        if (i + 1 < lines.length) {
           const nextLine = lines[i+1].trim();
           // Regex matches short alphanumeric strings that might be URL tails
           const isFragment = /^[a-zA-Z0-9\-_./]{1,15}$/.test(nextLine);
           
           if (isFragment && looksLikeUrl) {
              // Merge the lines
              line += nextLine;
              // Skip the next line in the loop since we just consumed it
              i++; 
           }
        }

        const matches = line.match(urlRegex);
        if (matches) {
          for (const match of matches) {
            const normalized = match.trim();
            // Remove trailing punctuation that might get caught
            const cleanUrl = normalized.replace(/[.,;]$/, "");
            if (cleanUrl) {
              urls.add(cleanUrl);
            }
          }
        }
      }

      const result = Array.from(urls);
      console.log(`Detected ${result.length} target URL(s) from SOP text`);
      return result;
    };

    const targetUrls = extractTargetUrlsFromText(cleanedText);

    // OPTIONAL: Generate structured summary using Gemini API
    let sopSummary: string | null = null;

    if (geminiApiKey && cleanedText.length > 5000) {
      console.log("Generating structured summary with Gemini 2.5 Flash (auth-free)...");

      try {
        const summaryPrompt = `Analyze this Standard Operating Procedure (SOP) and extract a structured summary.\n\n` +
          `Focus on:\n` +
          `1. Workflow steps in exact sequential order with step numbers.\n` +
          `2. URLs/websites mentioned.\n` +
          `3. UI elements (buttons, fields, selectors).\n` +
          `4. Input/output data.\n` +
          `5. Wait conditions.\n` +
          `6. Error handling.\n\n` +
          `Preserve technical details like selectors, field names, and specific values.\n\n` +
          `SOP Content:\n${cleanedText.substring(0, 100000)}`;

        const summaryResponse = await fetch(
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
                      text: summaryPrompt,
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 8000,
              },
            }),
          },
        );

        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          if (summaryData.candidates && summaryData.candidates[0]?.content?.parts?.[0]?.text) {
            sopSummary = summaryData.candidates[0].content.parts[0].text as string;
            console.log(`Generated summary: ${sopSummary.length} characters`);
          } else {
            console.warn("Unexpected response structure from Gemini API");
          }
        } else {
          const errorText = await summaryResponse.text();
          console.warn(`Failed to generate summary: ${summaryResponse.status} - ${errorText}`);
        }
      } catch (summaryError) {
        console.error("Error generating summary:", summaryError);
      }
    }

    console.log("✅ Successfully processed SOP (stateless)");

    return new Response(
      JSON.stringify({
        success: true,
        sopId: crypto.randomUUID(),
        title: file.name,
        pages: doc.numPages,
        contentLength: cleanedText.length,
        summaryLength: sopSummary?.length || 0,
        fullContent: cleanedText,
        summary: sopSummary,
        targetUrls,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error) {
    console.error("Error processing SOP:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});