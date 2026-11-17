# Correcciones de noviembre 2026: solicitudes, visitas y certificados del taller

Entre el 12 y el 14 de noviembre de 2026 se corrigieron los errores que el cliente informó al crear consultas y turnos (Solicitudes y Visitas de servicio) y al generar certificados desde el Taller Móvil. Después se recorrió la app completa, con todos los roles y botones, y se corrigió lo que apareció. Este documento resume qué cambió, qué falta publicar y qué hay que probar.

**Todo está sin commitear y sin ramas.** El detalle tarea por tarea, con la evidencia de cada una, está en [`odd/tasks/fix-solicitudes-visitas.md`](odd/tasks/fix-solicitudes-visitas.md).

## Estado en una tabla

| Qué | Estado |
|-----|--------|
| Tests unitarios (`npm test`) | 713/713 |
| e2e, flujos 00 a 09 (`npm run test:e2e`) | 100/100, con la base limpia y con el dataset cargado |
| Tests SQL (`supabase test db`) | 677/677 en 35 archivos (antes fallaban 17 archivos) |
| `typecheck`, `lint`, `build` | Pasan |
| Producción | Tiene aplicadas las migraciones hasta `20261113000003` |
| Pendiente de publicar | Migraciones `20261114000001` a `20261114000008`, **todas** las Edge Functions y el front |

## Primer paso: levantar el entorno local

1. Abrir Docker Desktop.
2. Levantar Supabase local y aplicar las migraciones (ver `supabase/README.md`).
3. Cargar el dataset de prueba con `npm run datos:demo`. Es **solo local**: el script se niega a correr si la URL no es local.
4. Levantar la app contra la base local con `npm run demo:app`, que la sirve en http://localhost:3100.
5. Seguir la guía [`docs/guia-pruebas-demo.md`](docs/guia-pruebas-demo.md).

Cuentas de prueba, todas con contraseña `demo1234`:
- `super@local.test`
- `admin@local.test`
- `taller@local.test`
- `cliente@local.test`
- `qa.taller.sur@local.test`
- `qa.cliente.valle@local.test`

> **Ojo con la CLI de Supabase.** La versión 3.x apunta **a la base local por defecto**. Para producción hay que pasar `--remote` (no `--linked`). Si hay otro proyecto de Supabase corriendo en el puerto 54322, la CLI se conecta a esa base.

## Qué cambió, por área

### 1. Solicitudes y visitas (admin)

| Problema | Corrección | Dónde |
|----------|------------|-------|
| «Programar otra visita» daba 404 siempre | Se registró la ruta `follow-up-visits` | `supabase/functions/_shared/route.ts` |
| Editar una tarea nunca guardaba (la fecha llegaba como timestamp) | Se normaliza a `YYYY-MM-DD` en hora argentina | `tarea-sheet.tsx`, `schemas.ts` |
| No se podía crear una solicitud para un cliente invitado sin activar | Se aceptan las cuentas pendientes; las deshabilitadas se siguen rechazando | `20261112000001` |
| Crear una tarea eran 3 llamadas sueltas: si fallaba la programación, quedaba una solicitud huérfana o duplicada | Una sola RPC transaccional | `20261112000002`, `queries.ts` |
| Errores de Postgres crudos y en inglés | Traducción centralizada al español | `src/lib/domain/errores.ts` |
| Reabrir una visita aceptada y cancelada daba 409 | Se limpia `accepted_at` y se recalcula el estado de la solicitud | `20261112000003` |
| Cancelar una visita cancelaba toda la solicitud | La solicitud se cancela solo si no le queda ninguna visita viva | `20261112000003` |
| Cambiar la fecha de una visita sin taller se ignoraba | Nueva ruta `POST visits/:id/reschedule` | `20261112000004`, `queries.ts` |
| Desasignar o reasignar dejaba la solicitud en `pendiente` aunque hubiera una visita completada | Se usa la misma regla que al cancelar | `20261114000002` |
| Formulario de seguimiento: bucle de renders, válvulas ya tomadas, zona horaria | Corregido | `visita-seguimiento-form.tsx` |
| Borrar el horario no lo borraba | Se envía `null` explícito | `tarea-form.tsx` |

La regla única para el estado de la solicitud después de cualquier cambio en sus visitas es `refresh_service_request_state`.

### 2. Taller Móvil y certificados

| Problema | Corrección | Dónde |
|----------|------------|-------|
| La foto del Parte Diario «no se cargaba»: el aviso salía al fondo de la tarjeta y el servidor rechazaba fotos HEIC o de más de 10 MB | La imagen se comprime y se pasa a JPEG en el navegador; estado, miniaturas y «Ver» dentro de la sección del PD; botones separados «Sacar foto» y «Elegir de la galería» | `src/lib/media/`, `visitas-panel.tsx` |
| Fotos de evidencia sin aviso; guardar el borrador después de recargar borraba la evidencia | Estado por sección; se conserva la evidencia guardada | `certificate-capture-form.tsx`, `sync.ts` |
| «La firma de la visita ya fue registrada…» bloqueaba la sincronización, y «Completar visita» no terminaba ni avisaba | Una firma ya registrada cuenta como éxito, tanto en el front como en el servidor; el botón muestra el progreso y el error | `sync.ts`, `visitas-panel.tsx`, `20261114000001` |
| Los cambios fallidos no decían por qué | Se lista cada error y hay un botón «Reintentar sincronización» | `visitas-panel.tsx` |
| `/taller/sincronizacion` no subía fotos ni firmas | Coordinador compartido | `src/lib/offline/coordinador-edge.ts` |
| Las visitas de hoy cuyo horario ya pasó desaparecían de la agenda | El conjunto de trabajo incluye todo el día de hoy | `20261114000003` |
| Una visita completada sin conexión volvía a mostrar «Iniciar visita» | Corregido | `src/components/talleres/estado-visita.ts` |
| La hora salía en 12 h («04:00:00» en vez de 16:00) | Formato único: 24 h, hora argentina | `src/lib/format.ts` (`fmtFechaHoraArgentina`) |
| El certificado no mostraba firmas ni fotos | URLs firmadas de Storage | `certificate-field/index.ts` |
| El logo del cliente nunca llegaba al certificado | Se toma de `logo_bucket`/`logo_path`, con backfill de los ya emitidos | `20261114000005` |

### 3. Cliente, portal y rendimiento

- **Estructura de clientes nuevos:** no se podía cargar la estructura (yacimientos y equipos) de un cliente que todavía no activó su cuenta. Corregido en `20261114000004`.
- **Descripción del equipo:** el campo se perdía sin avisar porque no existe esa columna. Se sacó del formulario.
- **Consultas del portal de certificados:** hacía una consulta por válvula. Ahora hay un único lote, `POST certificates/valve-histories`: bajó de 30 a 5 peticiones y la carga quedó en la mitad del tiempo.
- **Lote duplicado:** con varios yacimientos, el portal pedía el lote dos veces. Ya no.
- **Logo en local:** no cargaba porque la URL firmada salía con el host interno `kong:8000`. Se corrige con `src/lib/storage-url.ts`.
- **Certificados vencidos:** el cliente ya no los puede descargar (RN-06). Corregido en `20261113000003`.

### Logo oficial de System Solutions

- **Origen:** el logo provisorio, hecho con texto, se reemplazó por el oficial. El archivo fuente está en `Contexto/Logo Largo System Solutions.docx.pdf`.
- **Versiones en `public/brand/`:** a color, letra blanca, con fondo blanco y con fondo azul.
- **Componente `Logo`** (`src/components/brand/logo.tsx`), según la variante:

  | Variante | Qué muestra | Dónde se usa |
  |----------|-------------|--------------|
  | `auto` (por defecto) | Versión a color; en modo oscuro, la de letra blanca | Uso general |
  | `color` | Siempre la versión a color | Certificado, que se imprime sobre blanco |
  | `light` | Siempre la de letra blanca | Barra lateral y panel del login |

- **Íconos:** el favicon y los íconos de la app instalable (`public/icons/`) se generaron a partir de la versión con fondo azul.
- **Probar:** el login, la barra lateral (también colapsada), el certificado impreso y el ícono al instalar la app en el celular.

### 4. Seguridad y auditoría (salieron de los tests SQL)

- **Permisos de funciones:** las funciones nuevas de `public` quedaban ejecutables por `anon` y `authenticated`. `20261114000006` cierra el permiso por defecto. **Desde ahora, cada función nueva necesita su `grant` explícito.**
- **Auditoría de cuentas:** los cambios de `cuentas.activo` no se auditaban. Corregido en `20261114000007`.
- **Cierre de visita:** `visita_completada` perdía la hora del dispositivo. Corregido en `20261114000008`.

## Qué probar a mano

Con el dataset cargado, siguiendo los escenarios QA-01 a QA-12 de la guía. Probar también a 390 px.

**Admin**
- [ ] Nueva tarea con taller y fecha: crea la solicitud y la visita juntas.
- [ ] Nueva tarea con un horario que se pisa con otra del mismo equipo: error en español y **ninguna** solicitud nueva.
- [ ] Nueva tarea sin taller: aparece en «sin visita» con el nombre del yacimiento y la fecha precargada.
- [ ] Editar una tarea cambiando solo el detalle: guarda.
- [ ] Cambiar la fecha de una visita con taller y de una sin taller: se mueve en la agenda.
- [ ] Borrar el horario de una tarea: queda vacío.
- [ ] Cancelar y reabrir una visita, también una que ya estaba aceptada.
- [ ] «Programar otra visita» desde una visita no terminada (QA-11).
- [ ] Desasignar y reasignar una visita aceptada en una solicitud con otra visita completada: los seguimientos siguen funcionando.
- [ ] Alta de un cliente nuevo y carga de su estructura sin que active la cuenta.
- [ ] Conflictos de sincronización de firma: se cierran con «Rechazar» (no hay «Aceptar»).

**Taller** (`taller@local.test`)
- [ ] La visita de hoy (QA-05) aparece en la agenda aunque su horario ya haya pasado, y la hora se ve en formato 24 h.
- [ ] Iniciar la visita, guardar el PD y adjuntar una foto: estado, miniatura y contador dentro de la sección. Recargar: «Foto 1» con «Ver».
- [ ] En un celular: «Elegir de la galería» abre la galería y «Sacar foto» abre la cámara. En un iPhone, una foto HEIC sube sin error.
- [ ] Fotos de evidencia del certificado: miniatura y «Adjuntada». Recargar y guardar el borrador: la evidencia sigue ahí.
- [ ] Firmas y «Completar visita»: muestra «Completando visita…» y el resultado debajo del botón.
- [ ] Repetir «Completar visita» después de un fallo (con la firma ya subida): completa sin error.
- [ ] Sin conexión: capturar, firmar y completar. Al reconectar, no deben quedar «cambios fallidos».

**Cliente** (`cliente@local.test`)
- [ ] `/portal/turnos` y el calendario muestran las visitas.
- [ ] `/portal/certificados` carga rápido con muchas válvulas.
- [ ] El certificado finalizado (QA-08 o QA-09) muestra el logo, las firmas, las fotos y la foto del PD.
- [ ] Firma pendiente (QA-07): firmar desde el portal.
- [ ] Certificado vencido (QA-12): no se puede descargar.
- [ ] `/portal/empresa` muestra el logo.

## Publicar en producción

**Antes del push hay que decidir dos cosas:**
- **`20261114000005`:** completa el logo en certificados **ya finalizados**. Para eso desactiva por un momento el trigger de inmutabilidad, solo para los certificados sin logo cuyo logo se puede probar que existía al emitirlos. Si no se quiere tocar documentos cerrados, hay que quitar ese backfill antes de publicar.
- **`20261114000006`:** cambia los privilegios por defecto de forma global. Hay que tenerlo en cuenta en cada migración futura.

```powershell
npx supabase db dump --remote -f backup-esquema.sql
npx supabase db dump --remote --data-only -f backup-datos.sql
npx supabase db push --remote --dry-run   # solo deben aparecer 20261114000001 a 20261114000008
npx supabase db push --remote
npx supabase functions deploy             # todas: cambió _shared/route.ts
```

**Fin estimado, una visita en curso por taller y cierre automático (#94, #95, ADR 0024).**
Migraciones `20261116120000` (estado nuevo `requiere_finalizacion`, va sola),
`20261116120100_visit_estimated_end_and_started_at` (`started_at`, estado nuevo en la restricción y
regla de una visita en curso por taller) y `20261116121000` (cierre automático). La visita lleva
inicio y **fin estimado** obligatorio (el formulario propone inicio + 1 h, «Hora de fin estimada»):
el equipo queda reservado en ese horario, así que el mismo equipo admite varias visitas el mismo
día si no se superponen. El fin estimado no cierra la visita; la completa el técnico. Un Taller
Móvil tiene **una sola visita en curso a la vez**: iniciar otra falla («El taller ya tiene otra
visita en curso. Completá esa visita antes de iniciar esta…») y el panel no ofrece el botón; sin conexión, ese inicio llega como conflicto para el Administrador, que
lo acepta cuando la otra ya no está en curso. No se tocan las reservas existentes ni hay `NOTICE`.
Para el cierre automático hace falta **pg_cron**, que la migración no activa:

1. Supabase → Database → Extensions → habilitar `pg_cron`.
2. En el SQL Editor: `select public.schedule_close_expired_visits();` (programa el job
   `cerrar-visitas-vencidas` a las 02:59 UTC = 23:59 AR; se puede repetir sin duplicarlo).
3. Verificar: `select jobname, schedule, command from cron.job;`.

Sin pg_cron las visitas en curso no se cierran solas, pero todo lo demás funciona. Se puede correr a
mano con `select public.close_expired_visits();`.

Después hay que publicar el front. Orden obligatorio: **base → funciones → front**. El front nuevo llama a rutas nuevas, pero si el front sale antes que las funciones, el portal sigue funcionando con una consulta por válvula.

## Pendientes y decisiones de producto

| Tema | Estado |
|------|--------|
| «Válvula 1» automática | **Decidido (14/11): se saca.** Un equipo sin válvulas no debe generar una válvula sola; hay que avisar en la UI. Está en `api_admin_create_service_request`, cuya última definición es `20261112000001` |
| Duración de la visita | **Decidido (e), corregido el 17/11 (#94–#97):** inicio y fin estimado obligatorios (propuesta: +1 h); el equipo se reserva en ese horario y admite otras visitas el mismo día sin superposición; el fin estimado no cierra la visita; un taller tiene una sola visita en curso; a las 23:59 AR un job de pg_cron pasa las visitas en curso a «Requiere finalización» (ADR 0024). Falta habilitar pg_cron en producción (ver «Publicar en producción») |
| D4: técnico fuera de la nómina | **Decidido: puede firmar cualquier técnico.** Hay que quitar la validación contra la nómina del día (`api_technician_name_is_member`) y el `test.fail` de D4 |
| N4 / RF-36: el cliente crea solicitudes | **Decidido: solo el admin crea solicitudes.** Hay que bloquear la creación por API para el rol Cliente y quitar el `test.fail` de N4 |
| Logo borrado | Si un cliente borra su logo, los certificados ya emitidos dejan de mostrarlo. Reemplazarlo no causa el problema |
| `certificados-portal.tsx` | Componente sin uso que conserva el N+1 viejo. Se puede borrar |

## Para trabajar en el repo

- **vitest y la letra de unidad:** desde Git Bash, vitest falla por la mayúscula o minúscula de la unidad (`C:` contra `c:`). Correrlo desde PowerShell.
- **e2e y `role="status"`:** los helpers buscan `getByRole("status").first()` para el estado de la visita. Los mensajes nuevos de la tarjeta usan `aria-live` **sin** `role="status"`.
- **Migraciones aplicadas:** las migraciones ya aplicadas en producción no se editan. Cualquier cambio va en un archivo nuevo, con `create or replace` sobre la última definición y `grant execute ... to service_role`.
- **Rutas nuevas:** toda ruta nueva de una Edge Function se registra en `_shared/route.ts` (`routeOwner`) **y** en el handler de la función.
