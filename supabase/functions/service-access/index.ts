import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const errorStatus = (error: { code?: string; message?: string }) => {
  if (error.code === "insufficient_privilege") return 403;
  if (error.code === "PGRST116") return 404;
  if (error.code === "P0002") return 404;
  if (error.code === "23P01" || error.code === "check_violation") return 409;
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
    else if (segments[0] === "yacimientos" && request.method === "POST" && !segments[1]) ({ data: result, error } = await supabase.rpc("api_create_yacimiento", {
      asset_name: body.name,
      asset_provincia: body.provincia,
      asset_operadora: body.operadora,
      asset_contratista: body.contratista,
    }));
    else if (segments[0] === "yacimientos" && request.method === "PATCH" && segments[1] && !segments[2]) ({ data: result, error } = await supabase.rpc("api_update_yacimiento", {
      target: segments[1],
      asset_name: body.name,
      asset_provincia: body.provincia,
      asset_operadora: body.operadora,
      asset_contratista: body.contratista,
    }));
    else if (segments[0] === "yacimientos" && segments[1] && segments[2] === "tree" && request.method === "GET") ({ data: result, error } = await supabase.rpc("api_yacimiento_tree", { target: segments[1] }));
    else if (segments[0] === "yacimientos" && segments[1] && segments[2] === "assignment" && request.method === "GET") ({ data: result, error } = await supabase.rpc("api_assignment", { target: segments[1] }));
    else if (segments[0] === "hierarchy" && request.method === "POST") ({ data: result, error } = await supabase.rpc("api_create_descendant", { kind: body.kind, parent_id: body.parent_id, asset_name: body.name }));
    else if (segments[0] === "hierarchy" && request.method === "PATCH" && segments[1]) ({ data: result, error } = await supabase.rpc("api_update_descendant", { kind: body.kind, target: segments[1], asset_name: body.name }));
    else if (segments[0] === "requests" && request.method === "POST" && segments[1] && segments[2] === "schedule") ({ data: result, error } = await supabase.rpc("api_schedule_visit", { request_id: segments[1], provider_id: body.taller_movil_id, visit_starts_at: body.starts_at, visit_ends_at: body.ends_at }));
    else if (segments[0] === "requests" && request.method === "GET" && !segments[1]) ({ data: result, error } = await supabase.rpc("api_service_requests"));
    else if (segments[0] === "requests" && request.method === "GET" && segments[1]) ({ data: result, error } = await supabase.rpc("api_service_request", { request_id: segments[1] }));
    else if (segments[0] === "requests" && request.method === "POST" && !segments[1]) ({ data: result, error } = await supabase.rpc("api_create_service_request", { target_yacimiento: body.yacimiento_id, selections: body.selections }));
    else if (segments[0] === "requests" && request.method === "PATCH" && segments[1]) ({ data: result, error } = await supabase.rpc("api_update_service_request", { request_id: segments[1], selections: body.selections }));
    else if (segments[0] === "visits" && request.method === "GET" && !segments[1]) ({ data: result, error } = await supabase.rpc("api_visits"));
    else if (segments[0] === "visits" && request.method === "GET" && segments[1] && !segments[2]) ({ data: result, error } = await supabase.rpc("api_visit", { visit_id: segments[1] }));
    else if (segments[0] === "visits" && request.method === "POST" && segments[1] && segments[2] === "accept") ({ data: result, error } = await supabase.rpc("api_accept_visit", { visit_id: segments[1] }));
    else if (segments[0] === "visits" && request.method === "POST" && segments[1] && segments[2] === "reject") ({ data: result, error } = await supabase.rpc("api_reject_visit", { visit_id: segments[1] }));
    else if (segments[0] === "visits" && request.method === "POST" && segments[1] && segments[2] === "cancel") ({ data: result, error } = await supabase.rpc("api_cancel_visit", { visit_id: segments[1] }));
    else if (segments[0] === "visits" && request.method === "POST" && segments[1] && segments[2] === "start") ({ data: result, error } = await supabase.rpc("api_start_visit", { visit_id: segments[1] }));
    else if (segments[0] === "visits" && request.method === "POST" && segments[1] && segments[2] === "complete") ({ data: result, error } = await supabase.rpc("api_complete_visit", { visit_id: segments[1] }));
    else if (segments[0] === "visits" && request.method === "POST" && segments[1] && segments[2] === "work-orders") ({ data: result, error } = await supabase.rpc("api_add_work_order", { visit_id: segments[1], target_valvula: body.valvula_id }));
    else if (segments[0] === "work-orders" && request.method === "PATCH" && segments[1]) ({ data: result, error } = await supabase.rpc("api_update_work_order", { work_order_id: segments[1], outcome: body.outcome, not_evaluated_reason: body.not_evaluated_reason }));
    else if (segments[0] === "work-orders" && request.method === "POST" && segments[1] && segments[2] === "certificate-draft") ({ data: result, error } = await supabase.rpc("api_start_certificate_draft", { work_order_id: segments[1] }));
    else if (segments[0] === "certificates" && request.method === "GET" && segments[1] && !segments[2]) ({ data: result, error } = await supabase.rpc("api_certificate_draft", { certificate_id: segments[1] }));
    else if (segments[0] === "certificates" && request.method === "PATCH" && segments[1]) ({ data: result, error } = await supabase.rpc("api_update_certificate_draft", { certificate_id: segments[1], payload: body }));
    else if (segments[0] === "certificates" && request.method === "GET" && segments[1] && segments[2] === "finalized") ({ data: result, error } = await supabase.rpc("api_finalized_certificate", { certificate_id: segments[1] }));
    else if (segments[0] === "valves" && request.method === "GET" && segments[1] && segments[2] === "certificates") ({ data: result, error } = await supabase.rpc("api_valvula_certificates", { target_valvula: segments[1] }));
    else if (segments[0] === "visits" && request.method === "POST" && segments[1] && segments[2] === "signatures") ({ data: result, error } = await supabase.rpc("api_submit_visit_signature", { target_visit: segments[1], signing_party: body.party, signer_name: body.signer_name, bucket_name: body.bucket, asset_path: body.object_path }));
    else return json({ error: "Route not found" }, 404);
  } catch (caught) {
    return json({ error: "Invalid request" }, 400);
  }
  if (error) return json({ error: error.message }, errorStatus(error));
  return json(result);
});
