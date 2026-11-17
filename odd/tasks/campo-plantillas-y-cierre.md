# Válvulas en campo, cierre de visitas y plantillas por tarea

## Objetivo

Implementar los pendientes pedidos para el martes 2026-11-17 (ver mensaje de pendientes y
`correcciones.md`): agregar válvulas desde el campo, confirmación al completar la visita,
plantilla de certificado por tarea, quitar la «Válvula 1» automática, visitas con fin estimado y
cierre automático al final del día y firma de cualquier técnico.

## Decisiones del usuario (2026-11-16)

- **(a) Válvula nueva en campo:** mismos datos que usa el admin al crear válvulas. No se crean
  equipos. La válvula queda definitiva, como si la hubiera creado el admin. Puede ser de otro
  yacimiento del mismo cliente si el taller tiene acceso. Funciona sin conexión.
- **(c) Plantillas:**
  - La plantilla se elige en la **solicitud (tarea)** y todas sus visitas la heredan.
  - Desde la tarea se puede crear una plantilla nueva **copiando una existente** y editándola.
  - La plantilla queda relacionada al cliente que la creó, pero se puede elegir para cualquier
    cliente.
  - Al crear una tarea se preselecciona la **última plantilla usada por ese cliente**. Si el
    cliente nunca usó una, se preselecciona la estándar.
  - Editar una plantilla genera una versión nueva. Los certificados emitidos no cambian.
  - El certificado es A4 con las secciones una debajo de otra, en el orden de la plantilla, sin
    diseño particular. Todo integrado, sin sección de «datos adicionales». Solo tiene que entrar
    en las páginas.
  - Tipos de campo: alcanzan los actuales (texto, área de texto, número, fecha, select,
    multiselect y casilla).
  - Hay que validar los valores por tipo en la UI y en las edge functions.
- **(d) Válvula 1:** se saca. El backend rechaza la tarea sobre un equipo sin válvulas, y el
  formulario avisa y ofrece cargarlas.
- **(e) Duración de la visita** (corregida por la usuaria el 2026-11-17):
  - La visita tiene inicio y **fin estimado** obligatorio al programar, reprogramar, reasignar o
    crear un seguimiento. El formulario propone inicio + 1 h («Hora de fin estimada») y se puede
    cambiar; el fin tiene que ser posterior al inicio, el mismo día (hora de Argentina).
  - El equipo queda reservado entre el inicio y el fin estimado (ADR 0008): el mismo equipo admite
    varias visitas el mismo día si los horarios no se superponen.
  - El fin estimado **no cierra** la visita: la completa el técnico, aunque se pase de ese horario.
  - **Un Taller Móvil es una sola cuadrilla:** tiene una sola visita en curso a la vez. No puede
    iniciar otra hasta completar la que está en curso (en línea falla con un mensaje claro; sin
    conexión, el inicio llega como conflicto para el admin).
  - Red de seguridad: a las 23:59 (hora de Argentina) del día en que el técnico la inició, un job
    (`pg_cron`) pasa la visita que sigue en curso a un **estado nuevo, «Requiere finalización»**.
    Las firmas que falten quedan pendientes. El equipo y el taller quedan libres.
  - Las operaciones offline que lleguen después del cierre pasan a conflicto para el admin.
  - Una visita que no se inició no se cierra sola.

  > Nota (2026-11-17): la primera versión de (e) («la visita no tiene hora de fin; reserva el
  > equipo hasta las 23:59») impedía dos visitas del mismo equipo el mismo día. La usuaria la
  > corrigió por el modelo de arriba. Las migraciones no se habían aplicado y se reescribieron en
  > el lugar (ver la nota de la Etapa 3).
- **(f) Firma:** puede firmar cualquier técnico, incluido un reemplazante.
- **(g) 403 al Cliente:** queda **pendiente** de decisión (y el `PATCH requests/:id`). No se toca.

## Alcance y restricciones

- SQL solo en migraciones nuevas, partiendo de la última definición de cada función.
- `supabase db push` remoto, deploy de funciones y publicación: decide la usuaria.
- Sin commits ni ramas salvo pedido explícito.
- Test primero cuando haya runner: vitest, pgTAP (`supabase/tests/database/`) e `index.test.ts`
  de cada edge function.

## Tareas

Prioridad: P0 se pide para el martes, P1 se pide para el martes pero es grande, P2 menores.

### Etapa 1: rápidas, bajo riesgo

- [x] B1 (P0): confirmación en «Completar visita» (`visitas-panel.tsx:~1637`) con
  `ConfirmDialog`. Helper `completarVisita()` en `e2e/support/taller.ts`, que reemplaza los 9
  clics: `taller.ts:294`, `offline.ts:69`, `01…:113` y `05…:49,67,75,94,101,143`.
  *(confirmación con `ConfirmDialog` y helper `completarVisita()`; vitest/lint/typecheck ok, e2e sin ejecutar.)*
- [x] F1 (P0): migración que redefine sin la validación de nómina estas cuatro RPC:
  `api_submit_visit_signature`, `api_offline_submit_signature`, `api_update_certificate_draft` y
  `api_certificate_validation`. `api_technician_name_is_member` deja de usarse. Agregar un caso
  pgTAP con un nombre fuera de la nómina. Sacar el `test.fail` D4 de `05…spec.ts:103`. Ajustar el
  comentario de `src/components/talleres/tecnicos.ts:11` y el ADR 0010.
  *(migración 20261116100000; pgTAP y e2e sin ejecutar (sin Docker).)*
- [x] D1 (P0): migración `api_admin_create_service_request` sin el bloque de `20261112000001:66-91`,
  más un error claro si un equipo seleccionado no tiene válvulas. Revisar los fixtures de
  `service_request_visit_fixes.test.sql` y `visits_administration.test.sql`.
  *(migración 20261116100100; pgTAP sin ejecutar.)*
- [x] D2 (P0): en `tarea-form.tsx`, si `equipo.valvulas.length === 0`, mostrar el aviso con un
  acceso a cargar válvulas y bloquear el envío. Traducir el error nuevo en `errores.ts`.
  *(aviso y bloqueo en `tarea-form.tsx`; error traducido.)*
- [x] M1 (P2): borrar `src/components/clientes/certificados-portal.tsx`, que no se usa.
  *(archivo borrado; sin referencias.)*

### Etapa 2: agregar válvula en campo

- [x] A1 (P0): operación offline nueva `add_work_order` en tres lugares: la cola (`sync.ts`), el
  RPC de lote (último en `20261006122725…:569-613`) y el manejo de conflictos. Reusa la lógica de
  `api_add_work_order`.
  *(#83: migración 20261116110000 (`api_add_work_order_with_id`, lote y conflictos); vitest ok,
  pgTAP `field_add_work_order.test.sql` sin ejecutar (sin Docker).)*
- [x] A2 (P0): RPC `api_technician_create_valvula` con UUID generado en el cliente y alta
  idempotente. Crea la válvula, su revisión y la orden de trabajo en una sola transacción. Exige
  que la visita esté `en_curso` y asignada, y que el taller tenga acceso al yacimiento. Agregar el
  tipo offline `create_valve` y la ruta en `service-workflow` y `routeOwner`.
  *(#91: migración 20261116110500, ruta `POST visits/:id/valves`; vitest de edge y cliente ok,
  pgTAP `field_create_valve.test.sql` sin ejecutar.)*
- [x] A3 (P0): en el panel del taller, botón «Agregar válvula» con dos opciones:
  - **Buscador** sobre el catálogo de válvulas del cliente. Hay que verificar que el working set
    offline lo incluya y, si no, sumarlo.
  - **Formulario de alta** con los mismos campos que el admin, reusando su esquema Zod. La válvula
    se agrega en forma optimista a la visita.
  *(el working set solo traía el yacimiento de la visita: se sumó `client_yacimientos`;
  `agregar-valvula.tsx` con pestañas «Del catálogo» y «Nueva válvula» (`CamposValvula` compartido
  con el admin); alta optimista desde la cola. Sin prueba en navegador.)*
- [x] A4: e2e de agregar una válvula existente y una nueva, con y sin conexión.
  *(`e2e/flujos/10-valvulas-en-campo.spec.ts` y helpers en `e2e/support/taller.ts`; escritos sin
  ejecutar, sin Playwright ni Supabase local.)*

### Etapa 3: fin estimado de la visita y cierre automático

> **Corrección (2026-11-17).** Lo que sigue describe la primera versión (sin hora de fin, reserva
> hasta las 23:59 con `visit_window`), que la usuaria descartó. Estado final: `ends_at` sigue
> obligatorio y la reserva vuelve a ser `[starts_at, ends_at)`; `visit_window` y
> `visit_schedule_range` ya no existen; programar, reasignar, reprogramar y reabrir conservan sus
> definiciones anteriores; iniciar registra `started_at` sin tocar la reserva y exige que el taller
> no tenga otra visita en curso (`require_taller_without_visit_in_progress`). La migración
> `20261116120100` se reescribió como `20261116120100_visit_estimated_end_and_started_at.sql` y se
> corrigieron en el lugar `20261116121000` (`visit_start_day_end`), `20261116122000` (corrección
> con fin, reserva de válvulas agregadas) y `20261116123000` (fin estimado del seguimiento en el
> cierre administrativo). Front: campo «Hora de fin estimada» (+1 h) en tarea, programar solicitud,
> seguimiento, cierre administrativo y corrección de conflictos; portal y turnos con inicio–fin;
> panel del taller bloquea el inicio con otra visita en curso. pgTAP nuevo `visit_estimated_end`
> (reemplaza `visit_without_end_time`). Ver ADR 0024.

- [x] E1: migración de modelo de datos:
  - `visitas_servicio.ends_at` pasa a ser nullable.
  - Nuevo valor `requiere_finalizacion` en `estado_visita`.
  - Columna `started_at`, si todavía no existe.
  - Función auxiliar `visit_window(inicio)` que devuelve `[inicio, fin del día AR)`. Redefinir con
    esa función todos los lugares que arman `tstzrange(starts_at, ends_at)`:
    - `api_schedule_visit`
    - `api_add_work_order`
    - reabrir
    - reprogramar
    - reasignar
    - `…_with_visit`
    - `20261005160000`
    - `20261112000003`
  - Al iniciar la visita, recalcular la ventana desde `started_at`.
  - Las lecturas por rango usan el inicio o `coalesce`.

  *(#94: migraciones `20261116120000` (valor del enum, sola) y `20261116120100` (ends_at nullable,
  `started_at`, CHECK con nombre, `visit_window()`/`visit_schedule_range()`, 13 funciones redefinidas
  y reserva del día para las visitas pendientes existentes); pgTAP nuevo `visit_without_end_time` y
  adaptados `service_workflow`, `service_request_visit_fixes`, `visits_administration`,
  `follow_up_visits`, `replacement_catalog_visit_freeze`, `field_add_work_order`,
  `field_create_valve`. pgTAP sin ejecutar (sin Docker).)*
- [x] E2: job `pg_cron` a las 23:59 AR que pasa las visitas `en_curso` de días anteriores (o de
  hoy al cierre) a `requiere_finalizacion`, libera `visita_equipos` y deja auditoría. Si
  `pg_cron` no está disponible en producción, lo habilita la usuaria.
  *(#95: migración `20261116121000` (`close_expired_visits()`, `audit_visit_transition` con
  `visita_requiere_finalizacion`, `schedule_close_expired_visits()` que programa el job solo si
  pg_cron ya está habilitado); pgTAP `visit_auto_close`, e2e `11-cierre-automatico.spec.ts`; paso
  manual en `correcciones.md` y ADR 0024. pgTAP y e2e sin ejecutar.)*
- [x] E3: RPC de lote y `offline-sync`. Una operación sobre una visita en `requiere_finalizacion`
  genera un conflicto para el admin. Panel de conflictos: soportar el caso nuevo y quitar la
  edición de fin.
  *(#96: migración `20261116122000` (lote y lote del PD en conflicto con motivo propio, claim
  admite el estado, el admin puede aceptar salvo firmas, corrección sin fin); `offline-sync` sin
  `ends_at`; `sync.ts` reconoce el motivo; panel de conflictos con etiquetas y sin fin. vitest,
  typecheck y lint ok; pgTAP `late_offline_operations` y e2e `12-…` sin ejecutar.)*
- [x] E4: completar una visita en `requiere_finalizacion`, según lo decidido en «Decisiones
  cerradas»:
  - El técnico firma desde el panel.
  - El Cliente firma desde el portal.
  - El admin la cierra con motivo; las válvulas sin evaluar van a una visita de seguimiento.
  - Los borradores incompletos no se emiten.
  *(#97: migración `20261116123000`; ruta `POST visits/:id/close-administrator`; panel del taller,
  detalle de tarea y portal. Firmas en línea; con la firma faltante la visita lista se completa
  sola. vitest, typecheck y lint ok; pgTAP `visit_requiring_finalization_close` y e2e sin
  ejecutar.)*
- [x] E5: front.
  - Sacar el cálculo de +1 h en `queries.ts:162-184`, `tareas-list.tsx:403-408` y
    `visita-seguimiento-form.tsx:12-20`.
  - Contratos: `ends_at` pasa a ser opcional.
  - Agenda, cronograma y portal (`visitas-cliente.ts:95-112`, `visita-cliente-item.tsx`,
    `turnos-cliente.tsx`) muestran solo la hora de inicio.
  - Badge y filtro del estado nuevo.
  - Mensaje del `23P01`: «el equipo tiene otra visita ese día».

  *(#94: sin +1 h en `queries.ts`, `tareas-list.tsx` y `visita-seguimiento-form.tsx`; contratos sin
  `endsAt` en las entradas y `ends_at` nullable en el resumen; portal y turnos solo con hora de
  inicio; `requiere_finalizacion` en tipos, etiqueta, badge, color, filtro y edge
  (`OPERATION_STATUSES`); etiqueta «Hora de inicio» en el formulario. vitest, typecheck y lint ok;
  sin prueba en navegador. El panel del taller y los conflictos quedan para #96/#97.)*
- [x] E6: adaptar los tests. pgTAP: `service_workflow`, `service_request_visit_fixes` (S8b),
  `visits_administration`, `follow_up_visits`, `post_meeting_fixes` y `operations_read_model`.
  Vitest: transporte, errores, visitas-cliente, queries y contratos. Agregar un e2e de vencimiento.
  *(#94/#95: vitest de transporte, errores, visitas-cliente, queries, contratos y clientes de API
  actualizados (762 ok); pgTAP adaptados (`post_meeting_fixes` y `operations_read_model` no
  necesitaron cambios) y nuevos `visit_without_end_time` y `visit_auto_close`; e2e de vencimiento
  `11-cierre-automatico.spec.ts`. pgTAP y e2e sin ejecutar.)*

### Etapa 4: plantilla por tarea

- [ ] C1: migración de modelo de datos:
  - `plantillas_certificado` pasa a ser «plantilla» (identidad) más «versión». Se agrega
    `plantilla_id` (raíz), `nombre` y `cliente_origen_id`. Cada edición es una versión nueva de la
    misma plantilla.
  - La plantilla estándar es la actual activa.
  - Se reemplaza «una sola activa global» por «una versión vigente por plantilla».
  - Se agrega `solicitudes_servicio.plantilla_version_id` (FK, nullable, con fallback a la
    estándar).
  - Actualizar el ADR 0017.
- [ ] C2: RPC y edge functions.
  - Create, update y schedule de la solicitud aceptan la plantilla.
  - `api_certificate_capture_catalogs_for_version` y la creación del borrador usan la plantilla
    de la solicitud.
  - Nueva ruta «plantilla sugerida para el cliente» que devuelve la última usada o la estándar.
  - Crear una plantilla copiando otra.
  - Agregar pruebas pgTAP.
- [ ] C3: validación de valores por tipo (número, fecha, opción de select o multiselect válida,
  booleano) en tres lugares: `api_validate_custom_certificate_fields`, la edge
  `certificate-field` y `offline/completion.ts`. Hay que tolerar certificados históricos.
- [ ] C4: admin.
  - Formulario de tarea: selector de plantilla con la sugerida preseleccionada y la acción
    «Nueva plantilla a partir de…», que abre el editor en un diálogo.
  - Editor: nombre, cliente de origen, secciones elegibles en lugar de texto libre y vista previa.
  - Listado de plantillas.
- [ ] C5: panel del taller y offline.
  - La plantilla queda fijada por visita y viaja en el working set.
  - `visitas-panel.tsx:1858-1878` usa la plantilla de la solicitud en lugar de la activa.
- [ ] C6: vista e impresión. `certificado-documento.tsx` y `certificado-vista.ts` se arman a
  partir del snapshot de la plantilla: secciones en orden y campos por tipo, con paginación A4.
  Se mantienen fijos el encabezado (logos y N°), las firmas y el pie legal. Los certificados
  viejos se siguen viendo bien. Actualizar los tests de vista e impresión.

## Decisiones cerradas (2026-11-16)

- **Visita en «Requiere finalización»** (afecta a E4):
  - El técnico puede cargar desde el panel su firma faltante y la del cliente presencial.
  - El Cliente puede firmar desde el portal, como hoy.
  - El admin puede cerrarla con un motivo. Las válvulas sin evaluar van a una visita de
    seguimiento (ADR 0023).
  - Los borradores incompletos no se emiten: quedan para que el admin resuelva.
- **Partes fijas del certificado** (afecta a C6), que no son campos de la plantilla:
  - El encabezado con logos y N°.
  - Los datos de ubicación y de la válvula.
  - Ensayos y repuestos, que son columnas propias.
  - Las firmas y el pie legal.

  Todo lo demás se arma según la plantilla, en su orden.

## Pendiente

- (g) 403 al Cliente que crea solicitudes y si el Cliente puede seguir editando
  (`PATCH requests/:id`). No se implementa hasta que se decida.

## Orden de ejecución

1. Etapa 1 (B1, F1, D1, D2, M1) y etapa 2 (A1 a A4), que se piden para el martes 2026-11-17.
2. Etapa 3 (E1 a E6) y después etapa 4 (C1 a C6). Son de varios días cada una; se avisó que
   quedan después del martes.

Al terminar cada tarea: marcarla `[x]` con una nota de verificación en cursiva, y marcar también
el ítem que corresponda en `planning.md`. Antes de cerrar una etapa: `typecheck`, `lint`, `test` y
`build`, más pgTAP y e2e si se tocó la base o las edge functions, y una prueba en el navegador
(también en ancho de celular).
