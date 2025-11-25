// supabase/functions/start-selenium-job/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script } = await req.json();

    if (!script || typeof script !== "string") {
      throw new Error("Missing 'script' in request body");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const githubToken = Deno.env.get("GITHUB_PAT");
    const githubRepo = Deno.env.get("GITHUB_REPO"); // e.g. "your-username/your-repo"

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
    }
    if (!githubToken || !githubRepo) {
      throw new Error("GITHUB_PAT or GITHUB_REPO is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1) Insert a new automation job row
    const { data, error } = await supabase
      .from("automation_jobs")
      .insert({ script })
      .select("id")
      .single();

    if (error) {
      console.error("Error inserting automation_jobs row:", error);
      throw error;
    }

    const jobId: string = data.id;

    // 2) Trigger GitHub Actions via repository_dispatch
    const ghResponse = await fetch(
      `https://api.github.com/repos/${githubRepo}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "supabase-start-selenium-job",
        },
        body: JSON.stringify({
          event_type: "run-selenium",
          client_payload: { job_id: jobId },
        }),
      },
    );

    if (!ghResponse.ok) {
      const body = await ghResponse.text();
      console.error("GitHub dispatch failed:", ghResponse.status, body);
      throw new Error(`GitHub dispatch failed: ${ghResponse.status} - ${body}`);
    }

    return new Response(
      JSON.stringify({ jobId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    console.error("Error in start-selenium-job:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
