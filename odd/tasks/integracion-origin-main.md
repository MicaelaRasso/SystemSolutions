# Integración de `origin/main` con el trabajo local

## Situación

`main` local tenía 8 commits sin subir y 119 archivos sin commitear; `origin/main` traía 9 commits de Micaela (19 y 20 de octubre). Punto en común: `a4ea255`. Una prueba con `git merge-tree` anticipó 7 archivos en conflicto.

## Decisiones

- Se trabaja sobre `main` sin crear ramas (preferencia del usuario). No se hace push: lo decide el usuario.
- Quedan fuera del commit: `package-lock.json` (ya estaba modificado antes), `.atl/` y `.codegraph/`.
- Las migraciones `20261014120000` y `20261014130000` ya están en el remoto con el mismo contenido (salvo líneas en blanco): se usan las del remoto; las copias locales se respaldan fuera del repo.
- Respaldo completo del trabajo previo: `scratchpad/sin-push/cambios-completos.patch` (aplica limpio sobre `a4ea255`).
- En cada conflicto se conservan las dos intenciones.

## Tareas

- [x] I1: commit del trabajo local pendiente. _Commit `312956a`._
- [x] I2: merge de `origin/main` y resolución de los 7 conflictos.
- [x] I3: revisión de los archivos fusionados automáticamente que tocan las mismas piezas (`service-workflow/index.ts`, `queries.ts`, `contracts.ts`, `hooks.ts`, `rules.ts`, `firma-pendiente-panel.tsx`).
- [x] I4: verificación (typecheck, lint, test, build) y commit del merge. _Revisión del orquestador: sin archivos sin resolver ni marcadores, typecheck OK, 60 archivos / 480 tests OK._

## Progreso

- 2026-10-28: el usuario pidió hacer el merge y asegurar que todo funcione.
- 2026-10-28 (I2): conflictos resueltos y en el índice; `git diff --diff-filter=U` vacío, sin marcadores en el árbol.
  - `portal/turnos/page.tsx`: queda `TurnosCliente` (filtros RF-35, pendientes/histórico). `clientes/turnos-portal.tsx` de Micaela (agrupa por Solicitud) queda en el repo sin usar: **decisión pendiente** sobre si sumar la agrupación por Solicitud.
  - `superadmin/administradores-panel.tsx`: botones con el formato nuestro + «Eliminar cuenta» de Micaela (con `window.confirm`).
  - `talleres/talleres-panel.tsx`: funciones de Micaela (eliminar cuenta, cambio de email verificado, switch deshabilitado sin cuenta) + nuestros `min-w-0`/`break-words` y colores de 44px.
  - `talleres/visitas-panel.tsx`: flujo de Micaela (Paso 1 firma del Cliente opcional, Paso 2 firma del Técnico) + nuestros resúmenes (`conResumenGuardado` ahora envuelve el contexto que ya incluye `signatures`), `SelectNativo` para el Técnico y botones de ancho completo en celular. Sin reformatear el archivo entero.
  - `tareas/tarea-detalle.tsx`: alcance por visita y `VisitaSeguimientoForm` de Micaela + `pointer-coarse:h-11` y `useMotivo` nuestros.
  - `tareas/tarea-form.tsx` y `ubicacion-cascade.tsx`: se suman `permitirCrear` y `disabled={!!operation}`; con `disabled` no se ofrece «+ Agregar …» ni se montan los diálogos de alta.
- 2026-10-28 (I3): el validador de `/operations` sigue aceptando `contacto`, `telefono` y `plantas` opcionales; ninguna migración del 19/10 redefine `operation_summary` (solo `api_visit`, que agrega `signatures`). `rules.ts`, `queries.ts`, `contracts.ts`, `hooks.ts` y `firma-pendiente-panel.tsx` combinan los dos lados sin choque.
- 2026-10-28 (I4, verificación): `npm run typecheck` sin errores; `npm test` 60 archivos / 480 tests OK; `npm run build` OK; `npm run lint` 4 errores `react-hooks/set-state-in-effect`: los 2 conocidos de `visitas-panel.tsx` y 2 que vienen de `origin/main` (`setup-password-form.tsx:21`, de `bd7754d`, y el `useEffect` de firma del Cliente en `visitas-panel.tsx`, de `73ac56a`). Tests SQL y Deno no se corrieron (sin base local ni `deno`).
