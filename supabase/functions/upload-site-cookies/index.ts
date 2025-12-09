import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UploadCookiesBody {
  domain?: string; // optional plain domain, e.g. "www.mayoclinic.org"
  site_url?: string; // optional full URL; we will extract hostname
  cookies_json: string | unknown; // raw EditThisCookie JSON string or parsed object/array
  label?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    const body = (await req.json().catch(() => ({}))) as UploadCookiesBody;
    let { domain, site_url, cookies_json, label } = body;

    // 1. Normalize domain from site_url or domain field
    let normalizedDomain = "";

    if (site_url) {
      try {
        const url = new URL(site_url);
        normalizedDomain = url.hostname.toLowerCase();
      } catch (_err) {
        return new Response(
          JSON.stringify({ error: "Invalid site_url provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (domain) {
      normalizedDomain = domain.trim().toLowerCase();
    }

    if (!normalizedDomain) {
      return new Response(
        JSON.stringify({ error: "Either domain or site_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Normalize cookies_json to a valid JSON string representing an array
    let cookiesString = "";

    if (typeof cookies_json === "string") {
      const trimmed = cookies_json.trim();
      if (!trimmed) {
        return new Response(
          JSON.stringify({ error: "cookies_json string is empty" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return new Response(
            JSON.stringify({ error: "cookies_json must be a JSON array" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        cookiesString = JSON.stringify(parsed);
      } catch (_err) {
        return new Response(
          JSON.stringify({ error: "cookies_json must be valid JSON" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (cookies_json && typeof cookies_json === "object") {
      if (!Array.isArray(cookies_json)) {
        return new Response(
          JSON.stringify({ error: "cookies_json object must be an array" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      cookiesString = JSON.stringify(cookies_json);
    } else {
      return new Response(
        JSON.stringify({ error: "cookies_json is required and must be a JSON array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseFetch = async (path: string, init: RequestInit = {}) => {
      const url = `${SUPABASE_URL}${path}`;
      const headers: Record<string, string> = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(init.headers as Record<string, string> ?? {}),
      };
      return await fetch(url, { ...init, headers });
    };

    // 3. Upsert cookie profile for this domain (simple approach: delete existing then insert)
    const deleteResp = await supabaseFetch(`/rest/v1/site_cookies?domain=eq.${normalizedDomain}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (!deleteResp.ok) {
      console.warn("[upload-site-cookies] Failed to delete existing rows", deleteResp.status);
    }

    const insertResp = await supabaseFetch("/rest/v1/site_cookies", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        domain: normalizedDomain,
        label: label ?? normalizedDomain,
        cookies_json: cookiesString,
      }),
    });

    if (!insertResp.ok) {
      const text = await insertResp.text();
      console.error("[upload-site-cookies] Insert failed:", insertResp.status, text);
      return new Response(
        JSON.stringify({ error: "Failed to store site cookies" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const [row] = (await insertResp.json()) as any[];

    return new Response(
      JSON.stringify({
        success: true,
        domain: row.domain,
        label: row.label,
        id: row.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in upload-site-cookies function:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
