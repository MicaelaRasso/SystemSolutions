-- The technician PWA permits a manually entered signer name when the visit
-- has no active technicians in its scheduled day's roster. Keep the backend
-- validation aligned with that capture flow while retaining roster checks
-- whenever the visit has assigned technicians.
create or replace function public.api_technician_name_is_member(
  target_visit uuid,
  signer_name text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.visitas_servicio v
    where v.id = target_visit
      and (
        not exists (
          select 1
          from public.nominas_jornada n
          cross join lateral unnest(coalesce(n.persona_ids, '{}'::uuid[])) selected(persona_id)
          join public.personas p on p.id = selected.persona_id and p.activo
          where n.taller_movil_id = v.taller_movil_id
            and n.fecha = v.starts_at::date
        )
        or exists (
          select 1
          from public.nominas_jornada n
          cross join lateral unnest(coalesce(n.persona_ids, '{}'::uuid[])) selected(persona_id)
          join public.personas p on p.id = selected.persona_id and p.activo
          where n.taller_movil_id = v.taller_movil_id
            and n.fecha = v.starts_at::date
            and lower(regexp_replace(btrim(signer_name), '[[:space:]]+', ' ', 'g')) in (
              lower(regexp_replace(btrim(p.nombre || ' ' || p.apellido), '[[:space:]]+', ' ', 'g')),
              lower(regexp_replace(btrim(p.apellido || ' ' || p.nombre), '[[:space:]]+', ' ', 'g'))
            )
        )
      )
  );
$$;
