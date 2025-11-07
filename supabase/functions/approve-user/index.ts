import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ApproveUserRequest {
  userId: string;
  approved: boolean;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    console.log("Checking user authentication and admin status");

    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error("Authentication error:", userError);
      throw new Error("Unauthorized");
    }

    console.log(`User ${user.id} is authenticated`);

    // Check if user is admin using RPC
    const { data: isAdmin, error: roleError } = await supabaseClient
      .rpc("is_admin", { _user_id: user.id });

    if (roleError) {
      console.error("Error checking admin role:", roleError);
      throw new Error("Error checking permissions");
    }

    if (!isAdmin) {
      console.log(`User ${user.id} is not an admin`);
      throw new Error("Insufficient permissions");
    }

    console.log(`User ${user.id} has admin permissions`);

    const { userId, approved }: ApproveUserRequest = await req.json();

    console.log(`${approved ? "Approving" : "Rejecting"} user ${userId}`);

    // Update user approval status
    const { error: updateError } = await supabaseClient
      .from("profiles")
      .update({
        approved,
        approved_at: new Date().toISOString(),
        approved_by: user.id,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating profile:", updateError);
      throw updateError;
    }

    console.log(`Successfully ${approved ? "approved" : "rejected"} user ${userId}`);

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in approve-user function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: error.message === "Unauthorized" || error.message === "Insufficient permissions" ? 403 : 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
