begin;

create index if not exists visitas_servicio_starts_at_idx
  on public.visitas_servicio(starts_at);

create index if not exists visitas_servicio_estado_starts_at_idx
  on public.visitas_servicio(estado, starts_at);

create index if not exists visitas_servicio_yacimiento_id_starts_at_idx
  on public.visitas_servicio(yacimiento_id, starts_at);

commit;
