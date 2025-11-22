import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_DOMAIN = "hyprtask.com";

interface ValidateEmailRequest {
  email: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email }: ValidateEmailRequest = await req.json();

    console.log(`Validating email domain for: ${email}`);

    const emailDomain = email.split("@")[1]?.toLowerCase();
    const isValid = emailDomain === ALLOWED_DOMAIN;

    console.log(`Email domain ${emailDomain} is ${isValid ? "valid" : "invalid"}`);

    return new Response(
      JSON.stringify({ 
        valid: isValid,
        message: isValid 
          ? "Email domain is valid" 
          : `Only @${ALLOWED_DOMAIN} email addresses are allowed`
      }),
      {
        status: isValid ? 200 : 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error validating email domain:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
