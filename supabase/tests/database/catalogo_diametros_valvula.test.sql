begin;

select plan(4);

-- La ficha de la válvula y el certificado leen las mismas listas: tienen que venir cargadas.
select ok(
  (select count(*) from public.catalogo_opciones where lista = 'diamEntrada' and activo) > 0,
  'la lista Ø Entrada tiene medidas activas'
);
select ok(
  (select count(*) from public.catalogo_opciones where lista = 'diamSalida' and activo) > 0,
  'la lista Ø Salida tiene medidas activas'
);
select ok(
  exists (select 1 from public.catalogo_opciones where lista = 'diamEntrada' and valor = '3/8"BSP'),
  'Ø Entrada incluye las medidas del modelo del cliente'
);
select ok(
  exists (select 1 from public.catalogo_opciones where lista = 'diamSalida' and valor = '3/8"BSP'),
  'Ø Salida incluye las medidas del modelo del cliente'
);

select * from finish();
rollback;
