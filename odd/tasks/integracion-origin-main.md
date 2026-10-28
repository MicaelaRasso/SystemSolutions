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

- [ ] I1: commit del trabajo local pendiente.
- [ ] I2: merge de `origin/main` y resolución de los 7 conflictos.
- [ ] I3: revisión de los archivos fusionados automáticamente que tocan las mismas piezas (`service-workflow/index.ts`, `queries.ts`, `contracts.ts`, `hooks.ts`, `rules.ts`, `firma-pendiente-panel.tsx`).
- [ ] I4: verificación (typecheck, lint, test, build) y commit del merge.

## Progreso

- 2026-10-28: el usuario pidió hacer el merge y asegurar que todo funcione.
