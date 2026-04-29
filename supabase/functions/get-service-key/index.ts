const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
      SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
