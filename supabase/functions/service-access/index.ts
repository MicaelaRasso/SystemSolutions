import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const errorStatus = (error: { code?: string; message?: string }) => {
  if (error.code === "insufficient_privilege") return 403;
  if (error.code === "PGRST116") return 404;
  if (error.code === "invalid_parameter_value" || error.code === "foreign_key_violation") return 400;
  return 400;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return json({ error: "Authentication required" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { authorization } },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Authentication required" }, 401);

  const url = new URL(request.url);
  const rawSegments = url.pathname.split("/").filter(Boolean);
  // Supabase invokes a function at /functions/v1/<function>/<route>.
  const functionIndex = rawSegments.indexOf("service-access");
  const segments = functionIndex >= 0 ? rawSegments.slice(functionIndex + 1) : rawSegments;
  const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
  let result;
  let error;
  try {
    if (segments.length === 0 || segments[0] === "context") ({ data: result, error } = await supabase.rpc("api_context"));
    else if (segments[0] === "yacimientos" && request.method === "GET" && !segments[1]) ({ data: result, error } = await supabase.rpc("api_yacimientos"));
    else if (segments[0] === "yacimientos" && request.method === "POST" && !segments[1]) ({ data: result, error } = await supabase.rpc("api_create_yacimiento", { asset_name: body.name }));
    else if (segments[0] === "yacimientos" && segments[1] && segments[2] === "tree") ({ data: result, error } = await supabase.rpc("api_yacimiento_tree", { target: segments[1] }));
    else if (segments[0] === "yacimientos" && segments[1] && segments[2] === "assignment" && request.method === "GET") ({ data: result, error } = await supabase.rpc("api_assignment", { target: segments[1] }));
    else if (segments[0] === "hierarchy" && request.method === "POST") ({ data: result, error } = await supabase.rpc("api_create_descendant", { kind: body.kind, parent_id: body.parent_id, asset_name: body.name }));
    else if (segments[0] === "requests" && segments[1] && segments[2] === "accept" && request.method === "POST") ({ data: result, error } = await supabase.rpc("api_accept_request", { request_id: segments[1] }));
    else if (segments[0] === "requests" && request.method === "POST") ({ data: result, error } = await supabase.rpc("api_request_certificate", { target: body.yacimiento_id, provider: body.taller_movil_id }));
    else return json({ error: "Route not found" }, 404);
  } catch (caught) {
    return json({ error: "Invalid request" }, 400);
  }
  if (error) return json({ error: error.message }, errorStatus(error));
  return json(result);
});
