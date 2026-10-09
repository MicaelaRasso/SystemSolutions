# Pantallas faltantes (portal del cliente y vista del certificado)

## Objetivo

Construir las pantallas que faltan respecto del DRF v1.1, siguiendo la estética actual de la app (impeccable, modo Operate, extensión del mundo visual existente):

- Vista del certificado fiel al modelo SYS, imprimible a PDF, con la leyenda "REQUIERE FIRMA" cuando falten firmas (RF-27, RF-28, RF-29, RN-04, RN-05, CA-05, RNF-09).
- `/portal`: calendario mensual del cliente (RF-35, RF-39, CA-15).
- `/portal/turnos`: turnos pendientes e histórico (RF-35).

## Restricciones

- Solo front end. Se usan los hooks y endpoints que ya existen; no se agregan migraciones ni Edge Functions. Si falta un dato del backend, se documenta como pendiente.
- PDF: vista HTML optimizada para impresión (`@media print`, tamaño A4) usando el diálogo del navegador. No se agrega ninguna dependencia nueva. El nombre del archivo sale de `nombreArchivoCertificado()` (RN-16, supuesto hasta P-08).
- El Cliente no descarga ni imprime si faltan firmas; el Admin siempre puede.
- Ancho de celular sin scroll horizontal.

## Tareas

- [x] T1: vista del certificado (componente y rutas de Admin y portal) con impresión y "REQUIERE FIRMA". Ruta: delegada (2 o más archivos no triviales). Commit `c5ff5c8`.
- [x] T2: `/portal`, calendario mensual. Ruta: delegada. Commit `3d3de59`.
- [x] T3: `/portal/turnos`, pendientes e histórico. Ruta: delegada. Commit `6e8c628`.
- [x] T4: verificación (typecheck, lint, test, build y detector de impeccable) y actualización de `planning.md`. Commit del documento y `planning.md` (ver Progreso).

## Checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `node C:/Users/gabri/.claude/skills/impeccable/scripts/detect.mjs --json <archivos cambiados>`.

## Progreso

- 2026-10-09: `PRODUCT.md` confirmado por el usuario. Rama `feat/pantallas-faltantes`.
- 2026-10-09 T1 (`c5ff5c8`): `CertificadoDocumento` (presentacional, A4) + `armarCertificadoVista` (mapeo puro) + `CertificadoVisor` (impresión con `window.print()`, copia en portal a `<body>` y `document.title` = nombre RN-16) + contenedores `CertificadoAdmin` y `CertificadoCliente`. Regla `permisoImpresionCertificado` en `rules.ts`. Nueva ruta `/portal/certificados/[id]?valvula=` y listado `CertificadosCliente` con acción "Ver certificado" (vencidos no se abren). Evidencia: RED→GREEN en `rules.test.ts` (6), `certificado-vista.test.ts` (11), `certificado-documento.test.tsx` (3), `certificado-cliente.test.tsx` (4) y `admin/certificados/[id]/page.test.tsx` (actualizado). typecheck OK, test 339/339, build OK, lint con 2 errores preexistentes en `visitas-panel.tsx` (fuera de alcance). Gaps de backend: el backend no devuelve URLs firmadas de fotos ni firmas (solo bucket/object_path), por eso se muestra "Foto registrada; la vista previa no está disponible"; la nómina del taller no viaja en el certificado ("—").
- 2026-10-09 T2 (`3d3de59`): `/portal` = `CalendarioCliente` sobre `useVisitasCliente` (`GET /visits` + árboles de yacimientos). Se eligió `/visits` y no `/operations` porque `api_operations` solo devuelve visitas a la cuenta principal del cliente (`s.cliente_cuenta_id = auth.uid()`), mientras `api_visits` usa `can_access_yacimiento` para todo usuario cliente. `MonthCalendar` suma `etiquetas`, `vistaMovil="agenda"` y `onDiaSeleccionado` (la agenda admin no cambia). Evidencia: RED→GREEN en `visitas-cliente.test.ts` (5); `calendario-cliente.test.tsx` (2) agregado después de la implementación. Limitación: `/visits` no trae nombre del taller (se muestra "Asignado" / "A confirmar") ni número de solicitud.
- 2026-10-09 T3 (`6e8c628`): `/portal/turnos` = `TurnosCliente`, pestañas Pendientes/Histórico con cantidades, filtros yacimiento → planta/locación y desde/hasta, tabla en escritorio y tarjetas en celular, sin botón de solicitud (RF-36). Evidencia: RED→GREEN en `turnos-cliente.test.tsx` (3).
- 2026-10-09 T4: typecheck OK; test 40 archivos / 349 tests OK; build OK (rutas `/portal`, `/portal/turnos`, `/portal/certificados/[id]`); lint: 2 errores preexistentes en `src/components/talleres/visitas-panel.tsx` (`react-hooks/set-state-in-effect`, reproducidos en la base); detector de impeccable `[]`. Sin capturas en navegador: las rutas exigen sesión de Supabase y no hay autorización para usar credenciales o un backend remoto. `planning.md` actualizado (fase 5 y fase 7).
- Pendientes de backend: URL firmadas para fotos, firmas y logo del cliente en `certificates/:id/finalized` y `certificates/:id/download`; nómina del taller en el certificado; nombre del taller en `GET /visits` para el cliente. `src/components/clientes/certificados-portal.tsx` quedó sin uso (reemplazado por `src/components/portal/certificados-cliente.tsx`; fuera de las superficies autorizadas para borrarlo).

## Siguiente paso

Revisar en navegador (escritorio y celular) con sesión real de cliente y de administrador, incluida la impresión a PDF; decidir el borrado de `certificados-portal.tsx`.
