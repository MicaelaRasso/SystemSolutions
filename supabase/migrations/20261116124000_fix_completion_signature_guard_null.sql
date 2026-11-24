begin;

-- Corrige 20261116123000: si `app.admin_close_visit_id` nunca se fijó en la sesión,
-- `current_setting(..., true)` devuelve NULL, la condición del trigger queda NULL y la firma del
-- Técnico dejaba de exigirse al completar una visita en «Requiere finalización».
-- Base: 20261116123000.
create or replace function public.enforce_visit_signatures_before_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado in ('en_curso', 'requiere_finalizacion') and new.estado = 'completada'
     and not (
       old.estado = 'requiere_finalizacion'
       and coalesce(current_setting('app.admin_close_visit_id', true), '') = new.id::text
     ) then
    if not exists (
      select 1 from public.firmas_visita signature
      where signature.visita_id = new.id and signature.parte = 'tecnico'
    ) then
      raise exception using errcode = 'check_violation',
        message = 'A Técnico signature is required to complete a visit';
    end if;
  end if;
  return new;
end;
$$;

commit;
