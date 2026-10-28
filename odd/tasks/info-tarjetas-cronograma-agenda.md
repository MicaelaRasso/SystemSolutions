# Información en las tarjetas del cronograma y de la agenda

## Pedido del usuario

1. **Cronograma** (`/admin/cronograma`): la vista previa de cada tarea muestra Cliente, Locación, Yacimiento, Contacto y Teléfono.
2. **Agenda / calendario de turnos** (`/admin/agenda`): la vista previa de cada tarea muestra el Taller Móvil asignado y la Planta a la que se va. Pedido del cliente.

## Diagnóstico

- El listado de operaciones (`api_operations` → `operation_summary`, migración `20260926184514_operations_canonical_envelope.sql`) no devuelve contacto, teléfono ni planta. `toLegacyTarea` (`src/lib/services/edge.ts:417`) los rellena con vacío y «—».
- Los datos existen en la solicitud (`solicitudes_servicio.metadata->>'contacto'` y `'telefono'`) y en las órdenes de trabajo de la visita (planta/equipo).
- El esquema del front (`operationSummarySchema` en `src/lib/api/contracts.ts`) es estricto: hay que agregar los campos nuevos.

## Decisiones

- Migración aditiva (`create or replace function`), sin tocar datos. **El usuario debe aplicarla en su Supabase.**
- Una visita puede tener órdenes en varias plantas: se muestra la primera y «+N» si hay más.
- Sin planta o sin contacto no se muestra «—» suelto: se omite la línea.
- No se crean ramas ni se hacen commits sin que el usuario lo indique (árbol de trabajo de `main`).

## Tareas

- [x] A1: migración nueva que agrega contacto, teléfono y plantas a `operation_summary` y actualiza lo que dependa de la forma de la respuesta (tests SQL y de las Edge Functions).
- [x] A2: esquema del front, mapeo en `edge.ts` y datos de prueba de los tests.
- [x] A3: tarjeta del cronograma (Cliente, Locación, Yacimiento, Contacto y Teléfono) con prueba.
- [x] A4: tarjeta de la agenda (Taller Móvil y Planta) con prueba.
- [x] A5: verificación (typecheck, lint, test, build, detector).

## Checks

`npm run typecheck`, `npm run lint` (2 errores previos en `visitas-panel.tsx`), `npm test`, `npm run build`. La migración y los tests SQL no se pueden ejecutar sin base de datos local: queda pendiente que el usuario la aplique.

## Progreso

- 2026-10-14: alcance confirmado por el usuario (hacer la migración).
- 2026-10-14 A1: `supabase/migrations/20261014120000_operation_summary_location_contact.sql` (agrega `contacto`, `telefono`, `plantas` a `operation_summary`; plantas distintas por nombre vía órdenes→válvula→equipo→planta, sin N+1). Test SQL ampliado en `supabase/tests/database/operations_read_model_contract.test.sql` (plan 66→74). No ejecutado: no hay base local.
- 2026-10-14 A2: validador de `supabase/functions/service-workflow/index.ts` acepta las 3 claves opcionales (antes exigía exactamente 10 claves); `operationSummarySchema` con campos opcionales; `toLegacyTarea` (exportada) y `convertirOperacionATarea` mapean contacto, teléfono y plantas (`plantasNombres`, «Planta +N»); helpers en `src/lib/services/ubicacion-operacion.ts`. Tests: edge.test.ts, operations.test.ts, service-workflow/index.test.ts.
- 2026-10-14 A3: `tarea-card.tsx` muestra horario+cliente, yacimiento, locación y «contacto · teléfono» (enlace `tel:` fuera del botón); sin línea de equipo ni guiones sueltos. Helpers `src/components/tareas/tarea-info.ts`. Tests: tarea-info.test.ts, tarea-card.test.tsx (renderToStaticMarkup).
- 2026-10-14 A4: `TareaPill` de `agenda.tsx` (exportada) muestra «Taller Móvil: X» o «Sin asignar» y «Planta: X». Tests: agenda.test.tsx. El calendario del portal no se tocó.
- 2026-10-14 A5: typecheck OK; lint solo los 2 errores previos de visitas-panel.tsx; npm test 54 archivos / 438 tests OK; build OK; detector solo marca el borde lateral de color de taller ya existente. Pendiente del usuario: desplegar `service-workflow` y luego aplicar la migración; probar en navegador y contra la base real. `deno` no está instalado: no se corrieron tests Deno (los de la función son vitest y corrieron).
