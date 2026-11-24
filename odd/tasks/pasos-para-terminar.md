# Pasos para terminar: válvulas en campo, firma y cierre de visitas

Issues implementados: #84, #86, #88, #89 (Etapa 1), #83, #91 (Etapa 2), #94, #95, #96, #97
(Etapa 3). La Etapa 4 (plantillas: #85, #87, #90, #92, #93) quedó afuera a propósito.

**Estado:** todo sin commitear. Pasan `typecheck`, `lint`, `npm test` (803) y `build`.
**No se corrió nada de SQL ni e2e** (no había Docker): hay que hacerlo antes de publicar.

Migraciones nuevas (9):

| Archivo | Issue |
|---------|-------|
| `20261116100000_signature_any_technician` | #86 |
| `20261116100100_request_requires_valves` | #88 |
| `20261116110000_field_add_work_order` | #83 |
| `20261116110500_technician_create_valvula` | #91 |
| `20261116120000_estado_visita_requiere_finalizacion` | #94 (va sola: agrega valor al enum) |
| `20261116120100_visit_estimated_end_and_started_at` | #94 (corregida el 17/11: fin estimado) |
| `20261116121000_close_expired_visits` | #95 |
| `20261116122000_late_offline_operations_conflict` | #96 |
| `20261116123000_close_visit_requiring_finalization` | #97 |

## 1. Probar en local

1. Abrir Docker Desktop (con la integración WSL activada si se trabaja desde WSL).
2. Levantar Supabase y aplicar todas las migraciones desde cero:
   ```powershell
   npx supabase start
   npx supabase db reset        # aplica todas las migraciones; revisar que no falle ninguna
   ```
   Si falla una migración, anotar el archivo y el error: es lo primero a corregir.
3. Tests SQL (pgTAP):
   ```powershell
   npx supabase test db
   ```
   Archivos nuevos o modificados a mirar si fallan: `field_add_work_order`, `field_create_valve`,
   `visit_estimated_end`, `visit_auto_close`, `late_offline_operations`,
   `visit_requiring_finalization_close`, `service_workflow`, `service_request_visit_fixes`,
   `visits_administration`, `follow_up_visits`, `replacement_catalog_visit_freeze`.
4. Tests unitarios y chequeos (ya pasaban, repetir por las dudas):
   ```powershell
   npm install
   npm run typecheck; npm run lint; npm test; npm run build
   ```
5. e2e (Playwright):
   ```powershell
   npx playwright install       # solo la primera vez
   npm run test:e2e
   ```
   Flujos nuevos: `10-valvulas-en-campo`, `11-cierre-automatico`, `12-finalizacion-visita-vencida`.
   Modificados: `01`, `05` (confirmación al completar y firma de cualquier técnico) y `06` (fin
   estimado: dos visitas del mismo equipo el mismo día sin superponerse; superpuestas, error).
   **Ojo:** un taller tiene una sola visita en curso a la vez. Las pruebas comparten el taller
   sembrado: `visitaAceptada()` y el `global-setup` cierran antes (como el job de las 23:59) las
   visitas que hayan quedado en curso (`liberarTallerSemilla()` en `e2e/support/datos.ts`). Si un
   flujo falla con «El taller ya tiene otra visita en curso», revisar que no quede una abierta.
6. Probar a mano con `npm run datos:demo` y `npm run demo:app` (http://localhost:3100), en
   escritorio y en ancho de celular:
   - **Taller:** «Completar visita» pide confirmación; «Agregar válvula» (buscar una existente y dar
     de alta una nueva), con y sin conexión; firmar con un técnico que no está en la nómina.
   - **Admin:** crear tarea sobre un equipo sin válvulas (avisa y bloquea); «Hora de fin
     estimada» (propone +1 h, se puede cambiar, tiene que ser posterior al inicio); dos tareas del
     mismo equipo el mismo día en horarios distintos (se puede) y superpuestos (error «El equipo ya
     tiene otra visita en ese horario»); panel de conflictos (etiquetas en español, con fin
     estimado en la corrección).
   - **Una visita en curso por taller:** iniciar una visita, y en otra del mismo taller ver que el
     botón «Iniciar» está bloqueado con el aviso de completar la que está en curso.
   - **Cierre automático:** en el SQL Editor local correr `select public.close_expired_visits();`
     con una visita en curso de ayer; debe pasar a «Requiere finalización». Después: firmar desde
     el taller, firmar el Cliente desde el portal, y probar el cierre administrativo desde la tarea.

### Regresiones encontradas en la verificación local (17/11) y su corrección

- **Cierre de visita sin confirmación (e2e 05 D2/D3/F1).** El cierre sí llegaba al servidor
  (`/complete` 200, visita `completada`), pero el aviso «Visita completada…» vivía dentro de la
  tarjeta: al refrescar la agenda, la visita completada sale del working set y la tarjeta (con el
  aviso) desaparecía. Antes no se notaba porque el botón cerraba sin diálogo; con la confirmación
  nueva el diálogo espera al refresco. Corrección: el panel guarda el aviso del último cierre y lo
  muestra arriba de «Visitas Programadas» cuando la tarjeta ya no está
  (`avisoDeCierreSinTarjeta` en `estado-visita.ts`, con test). Lo mismo para «cerrar como no
  terminada» (antes el aviso se pisaba sobre un componente desmontado) y la firma de una visita
  vencida que la completa.
- **e2e 06 «equipo nuevo sin taller»:** el botón quedaba deshabilitado por la decisión (d) del
  cliente (no hay tarea sobre un equipo sin válvulas). La prueba ahora verifica el aviso y el
  bloqueo, carga una válvula con «Cargar válvulas» y espera a que cierre el diálogo antes de
  completar el formulario.
- **e2e 04 visita de seguimiento:** el formulario tiene ahora dos horas (inicio y fin estimado);
  el selector usa las etiquetas y verifica que el fin propuesto sea inicio + 1 h.
- **e2e 07 «Iniciar Visita» bloqueado tras cerrar otra (bug real, una visita a la vez):** los
  refrescos del panel sincronizaban la misma visita en paralelo y uno pisaba el recibo del otro
  (fotos ya registradas quedaban «fallida»); se reenviaban tras el cierre, el servidor rechazaba el
  lote (409 «Only an active visit can be claimed») y la visita seguía local con `en_curso`,
  bloqueando la siguiente. Corrección: `sync` se encola por visita entre coordinadores y el cierre
  en línea marca la visita `completada` en el dispositivo (`markVisitCompletedOnServer`, tests en
  `sync.test.ts`).
- **e2e 10 «Agregar válvula» sin conexión no cerraba el diálogo (bug real):** TanStack Query pausa
  las mutaciones sin red (`networkMode: "online"` por defecto), así que el encolado local nunca
  corría. `useServiceMutation` acepta `sinConexion` (`networkMode: "always"`) y las dos mutaciones
  de `agregar-valvula.tsx` lo usan (test en `queries.test.ts`).
- **e2e 12 visita vencida (bugs reales; el spec estaba escrito sin ejecutar):** (1) el cliente
  frenaba todo lo que dependía del inicio en conflicto, y el Administrador solo veía «Inicio de la
  visita»: ahora un conflicto por vencimiento libera a sus dependientes, que llegan al servidor y
  quedan también en conflicto (`dependenciaResuelta` en `sync.ts`, tests). (2) «Cerrar con motivo»
  cerraba bien, pero la sección se desmontaba al invalidar y los callbacks de `mutate` no corrían
  (sin aviso ni salto a la visita de seguimiento): usa `mutateAsync` (`cierre-visita-vencida.tsx`).

## 2. Publicar en producción

Orden obligatorio: **base → Edge Functions → front**.

1. Backup:
   ```powershell
   npx supabase db dump --remote -f backup-esquema.sql
   npx supabase db dump --remote --data-only -f backup-datos.sql
   ```
2. Ver qué se va a aplicar:
   ```powershell
   npx supabase db push --remote --dry-run
   ```
   Tienen que aparecer las 9 migraciones `20261116…` (y las `20261114000001` a `…008` si todavía
   no se habían publicado; ver `correcciones.md`).
3. Aplicar:
   ```powershell
   npx supabase db push --remote
   ```
   La `20261116120100` ya no toca las reservas existentes ni emite `NOTICE` (las visitas
   existentes conservan su inicio y fin). Antes de publicar, conviene revisar si algún taller tiene
   hoy más de una visita `en_curso` (quedan como están; la regla nueva solo rige al iniciar):
   `select taller_movil_id, count(*) from visitas_servicio where estado = 'en_curso' group by 1 having count(*) > 1;`
4. Edge Functions (cambiaron `_shared/route.ts`, `service-workflow`, `offline-sync` y
   `certificate-field`, así que se publican todas):
   ```powershell
   npx supabase functions deploy
   ```
5. Front: publicar en Vercel como siempre.

> La CLI 3.x apunta a la base local por defecto: para producción siempre `--remote`.

## 3. Activar pg_cron (cierre automático a las 23:59)

La migración **no** activa la extensión. Sin esto las visitas en curso nunca se cierran solas.

1. Supabase (proyecto de producción) → **Database → Extensions** → buscar `pg_cron` → habilitar.
2. En el **SQL Editor**:
   ```sql
   select public.schedule_close_expired_visits();
   ```
   Programa el job `cerrar-visitas-vencidas` a las 02:59 UTC (= 23:59 en Argentina). Se puede
   repetir sin duplicarlo.
3. Verificar:
   ```sql
   select jobname, schedule, command from cron.job;
   ```
4. Al día siguiente, revisar que corrió:
   ```sql
   select status, start_time, return_message
   from cron.job_run_details order by start_time desc limit 5;
   ```
5. Si hace falta cerrar a mano: `select public.close_expired_visits();`

## 4. Cerrar el trabajo

1. Revisar el diff (`git status`, `git diff`) y commitear en una rama.
2. Cerrar los issues #83, #84, #86, #88, #89, #91, #94, #95, #96 y #97 una vez probados en
   producción.
3. Opcional: `visitas-panel.tsx` y los archivos de `e2e/` no pasan Prettier (ya no pasaban antes).
   Formatearlos en un commit aparte para que el diff no se mezcle.

## 5. Decisiones pendientes para el cliente

- **Borradores incompletos** que quedan después del cierre administrativo: hoy quedan como
  borrador y nadie los puede editar. ¿Cómo se resuelven?
- **Job de las 23:59:** si la visita ya está lista (con firmas y todo), ¿la completa directamente
  en vez de pasarla a «Requiere finalización»?
- **Firmas sobre una visita vencida** se hacen solo con conexión; sin conexión van a conflicto.
- **Agregar válvula** a una visita que no está en curso: la existente devuelve 409 y la nueva 403.
  ¿Unificar?
- **Fin estimado:** el «mismo día» del fin se exige en el front (los campos son horas de una misma
  fecha); la base solo exige `ends_at > starts_at`. ¿Validarlo también en la base?
