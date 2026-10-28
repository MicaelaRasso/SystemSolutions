# Nombres en las visitas del taller

## Problema

En `/taller` las tarjetas muestran identificadores internos: «Yacimiento 7b9ea6fd-…» en Visitas Pendientes y «Visita e067c00d-…» con «ID de visita» en Visitas Programadas (`src/components/talleres/visitas-panel.tsx:313`). La lista `GET /visits` solo trae IDs.

## Decisiones

- Obtener los nombres de `GET /operations`, que el rol taller ya puede consultar para sus propias visitas (cliente, yacimiento, plantas, contacto y teléfono, tras la migración `20261014120000`, ya aplicada por el usuario).
- Pendientes: «Cliente · Yacimiento · Planta», fecha y hora, cantidad de órdenes de trabajo, y debajo contacto y teléfono.
- Programadas: el mismo encabezado en lugar de «Visita <id>»; el ID deja de mostrarse.
- Sin conexión o sin dato: nunca se muestra un UUID. Respaldo: «Visita del <fecha> <hora>».
- No se crean ramas ni se hacen commits sin que el usuario lo indique.

## Tareas

- [x] T1: helper puro que arma el título y las líneas de cada visita a partir de la operación (con respaldo sin UUID), con pruebas. *`visita-titulo.ts` + `.test.ts` (11 pruebas, RED→GREEN).*
- [x] T2: `visitas-panel.tsx` consulta las operaciones al actualizar la agenda y usa el helper en pendientes y programadas. *Además `sincronizacion-panel.tsx`; carga en `resumenes-visitas.ts`.*
- [x] T3: verificación (typecheck, lint, test, build). *Sin verificación visual en navegador (pendiente del usuario).*

## Progreso

- 2026-10-14: alcance confirmado por el usuario.
- 2026-10-14: implementado (sin commit). Archivos: `src/components/talleres/visita-titulo.ts`, `visita-titulo.test.ts`, `resumenes-visitas.ts` (nuevos); `visitas-panel.tsx`, `sincronizacion-panel.tsx` (editados).
  - `GET /operations` con `status=programada,aceptada,en_curso`, hasta 3 páginas de 100, de mejor esfuerzo (un fallo no muestra error).
  - Sin conexión: el resumen (cliente, yacimiento, plantas, contacto, teléfono) se guarda dentro de `context.operation_summary` de la visita en IndexedDB, sin cambiar el esquema ni la versión del store. Si no hay resumen, rótulo «Visita del dd/mm/aaaa hh:mm».
  - Se quitó el «ID de visita» visible; el id queda en `data-visit-id`. El teléfono es un enlace `tel:` con `pointer-coarse:min-h-11`.
  - Verificación: typecheck OK; test 464/464; build OK; lint con solo los 2 errores previos `react-hooks/set-state-in-effect` en `visitas-panel.tsx` (líneas 431 y 809, antes 391 y 769); detect.mjs sin hallazgos.
  - Pendiente fuera de alcance: `workOrderName` cae al id de válvula/orden si el working set no trae `valvula.nombre`; el «Borrador de certificado · {id}» muestra el id del borrador.
