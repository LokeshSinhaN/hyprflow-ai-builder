import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateJobBody {
  target_url?: string;
  job_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as CreateJobBody;
    const { target_url, job_id } = body;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    // Helper to call Supabase REST with service role
    const supabaseFetch = async (path: string, init: RequestInit = {}) => {
      const url = `${SUPABASE_URL}${path}`;
      const headers: Record<string, string> = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(init.headers as Record<string, string> ?? {}),
      };
      return await fetch(url, { ...init, headers });
    };

    // CREATE JOB MODE
    if (target_url && !job_id && req.method === "POST") {
      const cleanedUrl = target_url.trim();
      if (!cleanedUrl.startsWith("http://") && !cleanedUrl.startsWith("https://")) {
        return new Response(
          JSON.stringify({ error: "target_url must start with http:// or https://" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Insert job row
      const insertResp = await supabaseFetch("/rest/v1/preflight_jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ target_url: cleanedUrl, status: "pending" }),
      });

      if (!insertResp.ok) {
        const text = await insertResp.text();
        console.error("Error inserting preflight_job:", insertResp.status, text);
        return new Response(
          JSON.stringify({ error: "Failed to create preflight job" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const [job] = (await insertResp.json()) as any[];

      // Dispatch GitHub Actions workflow
      // Support either GITHUB_TOKEN or an existing GITHUB_PAT env var
      const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? Deno.env.get("GITHUB_PAT");
      const GITHUB_REPO = Deno.env.get("GITHUB_REPO"); // e.g. "org/repo"
      const GITHUB_WORKFLOW = Deno.env.get("GITHUB_PREFLIGHT_WORKFLOW") ?? "preflight-dom.yml";
      // Default to the pre-flight-approach branch since the workflow lives there
      const GITHUB_REF = Deno.env.get("GITHUB_REF") ?? "pre-flight-approach";

      if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.warn("GitHub credentials not configured; preflight job will not run.");
      } else {
        const [owner, repo] = GITHUB_REPO.split("/");
        const ghResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${GITHUB_TOKEN}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ref: GITHUB_REF,
              inputs: {
                url: cleanedUrl,
                job_id: job.id,
              },
            }),
          },
        );

        if (!ghResp.ok) {
          const text = await ghResp.text();
          console.error("Failed to dispatch GitHub workflow:", ghResp.status, text);
          // We still return the job so the caller can inspect status, but mark it as error
          await supabaseFetch(`/rest/v1/preflight_jobs?id=eq.${job.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "error", error: `GitHub dispatch failed: ${ghResp.status}` }),
          });

          return new Response(
            JSON.stringify({ error: "Failed to dispatch GitHub workflow", job }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      return new Response(
        JSON.stringify({ job }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // STATUS QUERY MODE
    if (job_id && !target_url && req.method === "POST") {
      const id = job_id.trim();
      const statusResp = await supabaseFetch(`/rest/v1/preflight_jobs?id=eq.${id}&select=*`);
      if (!statusResp.ok) {
        const text = await statusResp.text();
        console.error("Error fetching preflight_job:", statusResp.status, text);
        return new Response(
          JSON.stringify({ error: "Failed to fetch preflight job" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const rows = (await statusResp.json()) as any[];
      if (!rows.length) {
        return new Response(
          JSON.stringify({ error: "Preflight job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const job = rows[0];
      // For security, avoid returning the full dom_html here; only metadata
      const { dom_html, ...rest } = job;
      const hasDom = typeof dom_html === "string" && dom_html.length > 0;

      return new Response(
        JSON.stringify({ job: { ...rest, has_dom_html: hasDom } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid request payload" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in preflight-job function:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
