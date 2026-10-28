begin;

-- Capture an optional Cliente signature during the active visit before the
-- Técnico signs. The Cliente can also sign after the visit from its own account.
-- The typed name does not assert authority or change the Yacimiento owner.
create or replace function public.enforce_visit_signature_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parte = 'cliente'
     and array_length(regexp_split_to_array(btrim(new.nombre_firmante), '\s+'), 1) < 2 then
    raise exception using errcode = 'check_violation',
      message = 'A Cliente signature requires first and last name';
  end if;

  if new.parte = 'cliente'
     and new.capture_method = 'pwa_cliente_presencial'
     and exists (
       select 1 from public.firmas_visita signature
       where signature.visita_id = new.visita_id
         and signature.parte = 'tecnico'
     ) then
    raise exception using errcode = 'check_violation',
      message = 'An in-person Cliente signature must be captured before the Técnico signature';
  end if;

  return new;
end;
$$;

drop trigger if exists firmas_visita_enforce_signature_order on public.firmas_visita;
create trigger firmas_visita_enforce_signature_order
before insert on public.firmas_visita
for each row execute function public.enforce_visit_signature_order();

create or replace function public.enforce_visit_signatures_before_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado = 'en_curso' and new.estado = 'completada' then
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

drop trigger if exists visitas_servicio_signatures_before_completion on public.visitas_servicio;
create trigger visitas_servicio_signatures_before_completion
before update of estado on public.visitas_servicio
for each row execute function public.enforce_visit_signatures_before_completion();

-- The field client needs signature status and the captured name to resume a
-- visit safely after a refresh. Keep the signature image private in Storage.
create or replace function public.api_visit(visit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id;
  select rol into account_role from public.cuentas where id = auth.uid();
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if account_role not in ('administrador_regular', 'super_administrador')
    and not public.can_access_yacimiento(visit_row.yacimiento_id)
    and not exists (
      select 1 from public.taller_cuentas
      where cuenta_id = auth.uid() and taller_movil_id = visit_row.taller_movil_id
    ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;
  return jsonb_build_object(
    'visit', to_jsonb(visit_row) || jsonb_build_object(
      'signatures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'parte', signature.parte,
          'nombre_firmante', signature.nombre_firmante,
          'captured_at', signature.captured_at,
          'capture_method', signature.capture_method
        ) order by signature.captured_at, signature.parte)
        from public.firmas_visita signature
        where signature.visita_id = visit_id
      ), '[]'::jsonb)
    ),
    'work_orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', work_order.id, 'valvula_id', work_order.valvula_id)
        order by work_order.created_at)
      from public.ordenes_trabajo work_order
      where work_order.visita_id = visit_id
    ), '[]'::jsonb)
  );
end;
$$;

commit;
