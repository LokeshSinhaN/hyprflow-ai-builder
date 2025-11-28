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
    const workerUrl = Deno.env.get("SELENIUM_WORKER_URL"); // e.g. "https://your-service.onrender.com" (no trailing slash)
    const workerToken = Deno.env.get("WORKER_AUTH_TOKEN");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
    }
    if (!workerUrl || !workerToken) {
      throw new Error("SELENIUM_WORKER_URL or WORKER_AUTH_TOKEN is not configured");
    }

    // Normalize worker URL: strip any trailing slashes so we can safely append paths
    const normalizedWorkerUrl = workerUrl.replace(/\/+$/, "");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1) Insert automation job
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

    // 2) Call Render worker to start job (fire-and-forget so the edge function
    // does not block on Render's response, which can be slow on cold start).
    fetch(`${normalizedWorkerUrl}/jobs/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ jobId }),
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const body = await resp.text();
          console.error("Worker call failed:", resp.status, body);
        }
      })
      .catch((err) => {
        console.error("Error calling selenium worker:", err);
      });

    // Immediately return jobId; frontend will poll automation_jobs for status.
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