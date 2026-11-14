-- 20260925210914 quiso cerrar el EXECUTE por defecto de las funciones nuevas con
-- `alter default privileges ... in schema public revoke execute ... from public`, pero
-- en PostgreSQL los privilegios por defecto de un esquema solo se suman a los globales:
-- no pueden quitar el EXECUTE que el global le da a PUBLIC. Cada función nueva del
-- dueño de las migraciones quedaba ejecutable por anon y authenticated salvo que la
-- migración la revocara a mano (test: edge_gateway_boundary, aserciones 14 y 15).
--
-- Se cierra el default global de `postgres`. Las funciones nuevas siguen recibiendo
-- EXECUTE para service_role por el default del esquema public; las que deban
-- exponerse a authenticated lo otorgan explícitamente, como hasta ahora.
alter default privileges for role postgres revoke execute on functions from public;

-- Funciones ya creadas que quedaron con EXECUTE para PUBLIC. Ninguna se llama desde
-- anon ni authenticated: son funciones de trigger (el trigger no exige EXECUTE al
-- dispararse) y el control de rol del panel de auditoría, que solo se invoca desde
-- RPC security definer o con service_role.
revoke execute on function
  public.bump_offline_sync_version(),
  public.prevent_certificate_image_mutation(),
  public.require_uploaded_certificate_image(),
  public.prevent_closed_certificate_mutation(),
  public.prevent_audit_mutation(),
  public.audit_business_change(),
  public.api_audit_require_admin(),
  public.prevent_certificate_template_mutation(),
  public.enforce_visit_signature_order(),
  public.enforce_visit_signatures_before_completion()
from public, anon, authenticated;
