# Plan de integración: frontend → Edge Functions → Supabase

## Decisión de arquitectura

La aplicación de navegador no accede directamente a PostgreSQL, a la Data API
de Supabase, a RPCs de base de datos ni a Storage. Todo acceso a datos y
archivos pasa por una Edge Function autenticada.

```text
Browser → Supabase Auth (sesión) → service-access Edge Function → PostgreSQL / Storage
```

Supabase Auth es la única excepción: el navegador lo usa para establecer y
renovar la sesión. No constituye acceso a datos de la aplicación. La sesión
entrega el JWT que el navegador presenta a `service-access`.

La Edge Function valida la identidad y la ruta solicitada. PostgreSQL conserva
la autorización de dominio —Cliente, Yacimiento, Taller Móvil, Visita de
servicio y Certificado— como barrera final. RLS sigue siendo defensa en
profundidad, pero no es un permiso para que el navegador consulte la base.

## Estado actual

- `src/lib/services/edge.ts` es el único adaptador de datos del navegador hacia
  `service-access`; las operaciones sin una ruta Edge equivalente fallan de
  forma explícita en modo `supabase`.
- `supabase/functions/service-access/index.ts` enruta la jerarquía, solicitudes,
  visitas, Órdenes de trabajo, borradores, certificados, firmas y sincronización.
- La migración de compuerta revoca la Data API a `anon` y `authenticated`; las
  RPCs de aplicación se ejecutan por la Edge Function con `service_role` e
  identidad de actor validada. RLS sigue protegiendo las operaciones de dominio.
- En modo `supabase`, Auth usa cookies gestionadas por `@supabase/ssr`; el
  navegador no guarda tokens en `localStorage` ni define el rol. `proxy.ts` y
  los layouts verifican el JWT y obtienen el contexto canónico por `GET /context`.
- El modo mock y su cookie `ss_session` se conservan sólo para demo/tests. Sus
  credenciales y el reinicio de datos no se muestran al activar `supabase`.
- Las pantallas aún usan mayormente servicios mock. Sólo las capacidades ya
  expuestas por Edge se adaptan; el Anexo A lista cada contrato pendiente.

## Fase 1 — Hacer obligatorio el gateway de Edge Functions

Objetivo: ninguna solicitud iniciada por el navegador puede llegar a las tablas
o a las RPCs de aplicación sin pasar por `service-access`.

1. Crear un ADR que reemplace la decisión anterior de consultas frontend + RLS
   directas por esta arquitectura Edge-only.
2. Crear una migración que:
   - revoque de `anon` y `authenticated` el acceso a tablas, secuencias y todas
     las funciones `api_*` de aplicación, y permita esas RPCs solamente a
     `service_role`;
   - revoque privilegios predeterminados para que nuevas tablas, funciones y
     secuencias no se expongan accidentalmente;
   - implemente una compuerta `pgrst.db_pre_request`: las llamadas a la Data API
     de aplicación requieren el JWT de `service_role` y un encabezado de actor
     emitidos internamente por la Edge Function; la compuerta valida la Cuenta y
     restablece su identidad para las reglas existentes basadas en `auth.uid()`;
   - conserve RLS y validaciones de dominio en las funciones PostgreSQL.
3. Configurar `service-access` para validar primero el JWT de la Cuenta y luego
   invocar las RPCs con `SUPABASE_SERVICE_ROLE_KEY` y el encabezado interno de
   actor. La clave nunca se expone al navegador. En producción, limitar CORS al
   origen de la aplicación.
4. Añadir pruebas de contrato que demuestren:
   - acceso directo a tablas: rechazado;
   - RPC directa con JWT de `authenticated`: rechazada;
   - misma operación por Edge Function y actor autorizado: aceptada;
   - acceso cruzado entre Clientes o Talleres Móviles: rechazado.
5. Ejecutar los tests de base local, las pruebas del adaptador Edge y una prueba
   manual de red: el navegador solo debe llamar Auth y `service-access`.

La Data API continúa disponible exclusivamente para la Edge Function mediante
su clave de servidor. La compuerta instala la identidad previamente validada de
la Cuenta, por lo que las reglas de autorización existentes en las RPCs siguen
siendo la fuente de verdad.

**Criterio de terminación:** no existe una URL, grant o función de aplicación
que un navegador autenticado pueda invocar directamente para leer o modificar
datos.

## Fase 2 — Sesión de producción

1. Sustituir la cookie mock `ss_session` por la sesión de Supabase Auth siguiendo
   el patrón SSR de Next.js.
2. Tras login, solicitar `GET /context` a través de `service-access`; el rol y
   la navegación derivan de esa respuesta, no de una cookie editable.
3. Actualizar `proxy.ts` y layouts para usar una sesión verificada.
4. Dejar de gestionar tokens manualmente en `localStorage`.
5. Quitar de los caminos de producción el reinicio de demo, credenciales demo y
   selección runtime del mock. Los mocks quedan como fixtures de tests/demo.

**Criterio de terminación:** las protecciones de ruta usan una sesión verificable
y el navegador no contiene una fuente de autoridad sobre roles.

## Fase 3 — Capa de datos orientada a la API Edge

1. Sustituir gradualmente el contrato mock general `Services` por clientes de
   API por capacidad.
2. Para cada capacidad, definir DTOs, esquemas Zod, mapping a modelos de vista,
   query keys, invalidaciones y respuestas de error.
3. Mantener los componentes independientes de Supabase: los componentes llaman
   hooks y adaptadores, nunca `fetch`, PostgREST o Storage directamente.
4. Actualizar este contrato al agregar o cambiar rutas de `service-access`.

## Fase 4 — Primer corte vertical: jerarquía de Yacimiento

Reemplazar primero la parte del mock que ya tiene soporte backend:

1. Login y `GET /context`.
2. Lista de Yacimientos accesibles.
3. Árbol de Yacimiento.
4. Alta y edición de Yacimiento, Planta/locación, Equipo/unidad y Válvula.
5. Historial de Certificados de una Válvula.

Resolver explícitamente el mapping entre la UI histórica de `Empresa` y el
modelo canónico `Cliente`; no introducir `Tarea` como nombre alternativo de
Visita de servicio u Orden de trabajo.

**Criterio de terminación:** estas pantallas funcionan sin mock y cada solicitud
de datos del navegador pasa por `service-access`.

## Fase 5 — Ciclo de servicio

Implementar en este orden:

1. Cliente: Solicitud de servicio y Selección de servicio.
2. Administrador: programación y asignación de Visita de servicio.
3. Taller Móvil: lista, aceptación/rechazo, inicio y finalización de visitas.
4. Ordenes de trabajo por Válvula y su resultado independiente.
5. Estados diferenciados de solicitud, visita, orden, captura y certificado.

## Fase 6 — Captura de Certificado y evidencia

1. Crear y editar Borrador de certificado durante una Visita de servicio abierta.
2. Capturar ensayo, Alcance de mantenimiento, Repuestos y observaciones.
3. Enviar fotos y Firmas digitalizadas por una ruta Edge; no subir a Storage
   desde el navegador.
4. Cerrar visita y mostrar correctamente Certificado pendiente vs. Certificado
   finalizado.
5. Presentar historial y payload inmutable de certificados finalizados.

## Fase 7 — Trabajo offline

Una vez que el flujo online anterior esté funcionando:

1. Guardar el conjunto de trabajo Edge de dos días y las operaciones en
   IndexedDB.
2. Encolar operaciones con UUID permanente, dependencias y estado local.
3. Sincronizar exclusivamente con `POST /visits/:id/sync`.
4. Mostrar acknowledgement, reintentos, conflictos, finalización local y estado
   backend como conceptos distintos.
5. Probar modo avión, reintentos e idempotencia.

## Fase 8 — Dominios restantes

Migrar de a un área delimitada, siempre con rutas Edge, autorización y pruebas:

1. Clientes y Cuentas.
2. Talleres Móviles y Técnicos.
3. Catálogos y configuración.
4. Agenda, dashboards e historial.
5. Backups y funciones de Super administrador.

No activar la fuente Supabase como reemplazo global de mocks hasta que cada ruta
visible en producción tenga una implementación real.

## Primer paquete de implementación

El primer paquete de trabajo combina las tres bases necesarias para el primer
corte vertical:

1. Fase 1: compuerta Edge-only y pruebas de bypass.
2. Fase 2: sesión de producción autenticada.
3. Fase 4: jerarquía de Yacimiento y certificados de Válvula.

Se hará primero el punto 1: bloquear y comprobar los caminos directos a base de
datos antes de conectar más pantallas.

## Anexo A — Inventario obligatorio de capacidades Edge para las pantallas actuales

Este inventario describe el contrato que necesita la interfaz que hoy se
renderiza. No autoriza a construir las capacidades marcadas como **ausentes**;
su propósito es impedir que una pantalla vuelva a conectarse a la Data API, a
una RPC o a Storage desde el navegador mientras se migra por cortes verticales.

**Estados:** **disponible** significa que `service-access` ya tiene la ruta;
**parcial** significa que hay una ruta de backend, pero no tiene todavía el DTO
o el adaptador que la pantalla actual necesita; **ausente** significa que no hay
ruta Edge equivalente. Una ruta disponible tampoco implica que la actual
interfaz mock ya la consuma.

### Sesión e identidad

| Capacidad requerida                                                           | Ruta o mecanismo                                                        | Estado actual                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Iniciar sesión con email y contraseña                                         | **Supabase Auth desde el navegador**, `signInWithPassword`              | **Disponible.** El cliente SSR de Auth escribe la sesión en cookies y, tras autenticar, consulta `GET /context` para obtener la identidad de aplicación. No requiere una ruta Edge de login. |
| Leer, renovar y cerrar la sesión                                              | **Supabase Auth desde el navegador**, cliente SSR y cookies gestionadas | **Disponible.** El cliente `@supabase/ssr` mantiene la sesión en cookies y `proxy.ts` la renueva y verifica.                                                                                 |
| Obtener identidad, rol canónico y Taller Móvil asociado después de autenticar | `GET /context`                                                          | **Disponible.** La función ejecuta `api_context`; el adaptador actual lo usa al hacer login.                                                                                                 |
| Proteger rutas y navegación con una sesión verificable                        | Cliente SSR de Supabase Auth + `GET /context`                           | **Disponible.** `proxy.ts`, layouts y `AuthProvider` verifican Auth y derivan la Cuenta/rol de `GET /context`; `ss_session` sólo queda para mock.                                            |

### Cliente y estructura de activos

`Empresa` es el nombre histórico del mock; en la API el agregado canónico es
**Cliente**. Las pantallas `/admin/clientes/**` necesitan el siguiente contrato
antes de poder abandonar el mock.

| Capacidad requerida                                                                                               | Ruta Edge propuesta                                                                            | Estado actual                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listar Clientes con búsqueda e inclusión opcional de inactivos, con contadores de Yacimientos, Válvulas y Cuentas | `GET /clients?q=&include_inactive=`                                                            | **Ausente.**                                                                                                                                                   |
| Consultar el perfil de un Cliente                                                                                 | `GET /clients/:clientId`                                                                       | **Ausente.**                                                                                                                                                   |
| Crear y actualizar Cliente (razón social, CUIT, contactos, aviso de vencimiento y estado)                         | `POST /clients`, `PATCH /clients/:clientId`                                                    | **Ausente.**                                                                                                                                                   |
| Cargar, reemplazar o quitar logo de Cliente sin acceso browser→Storage                                            | `PUT`/`DELETE /clients/:clientId/logo` (multipart hacia Edge)                                  | **Ausente.**                                                                                                                                                   |
| Listar los Yacimientos accesibles al actor                                                                        | `GET /yacimientos`                                                                             | **Disponible.** No reemplaza aún la lista de Clientes del administrador.                                                                                       |
| Consultar el árbol de un Yacimiento                                                                               | `GET /yacimientos/:yacimientoId/tree`                                                          | **Disponible.** La UI actual solicita el árbol por `empresaId`; falta resolver el mapping Cliente→Yacimiento y el DTO de pantalla.                             |
| Crear y editar Yacimiento                                                                                         | `POST /yacimientos`, `PATCH /yacimientos/:yacimientoId`                                        | **Disponible**, con los campos actuales de backend (`name`, provincia, operadora, contratista). El formulario mock y su modelo aún no coinciden completamente. |
| Crear y editar Planta/locación, Equipo/unidad y Válvula                                                           | `POST /hierarchy`, `PATCH /hierarchy/:assetId`; `PATCH /valves/:valvulaId`                     | **Disponible.** La jerarquía conserva sus comandos de nombre; la edición técnica de Válvula usa la ruta específica y registra una revisión inmutable.          |
| Consultar una Válvula individual, incluidos sus atributos técnicos                                                | `GET /valves/:valvulaId`                                                                       | **Disponible.** Devuelve la Válvula técnica actual y sus revisiones inmutables, con autorización por Yacimiento.                                               |
| Consultar revisiones históricas de una Válvula                                                                    | `GET /valves/:valvulaId`                                                                       | **Disponible.** La respuesta contiene `revisions`, ordenadas de la más reciente a la más antigua.                                                              |
| Eliminar Yacimiento, Planta, Equipo o Válvula con las reglas de integridad del dominio                            | `DELETE /yacimientos/:id`, `DELETE /plants/:id`, `DELETE /equipment/:id`, `DELETE /valves/:id` | **Ausente.**                                                                                                                                                   |
| Historial de Certificados de una Válvula                                                                          | `GET /valves/:valvulaId/certificates`                                                          | **Parcial.** La ruta existe; falta un DTO/mapping estable a la tarjeta de historial que hoy consume `Certificado` mock.                                        |
| Leer Certificado finalizado e inmutable                                                                           | `GET /certificates/:certificateId/finalized`                                                   | **Disponible**, pero ninguna pantalla actual lo conecta todavía.                                                                                               |

### Cuentas, accesos, Talleres Móviles y Técnicos

Estas capacidades corresponden a las pantallas de usuarios de Cliente,
`/admin/talleres` y al cronograma. Las altas de Cuentas deben crear o gestionar
identidades de Supabase Auth sólo dentro de una Edge Function; nunca desde el
navegador con una clave de servidor.

| Capacidad requerida                                                                             | Ruta Edge propuesta                                                                      | Estado actual                                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Listar y consultar Cuentas, filtradas por rol y Cliente                                         | `GET /accounts?role=&client_id=`, `GET /accounts/:accountId`                             | **Ausente.**                                               |
| Crear Cuenta de Cliente, activar/desactivar, actualizar datos y eliminarla                      | `POST /accounts`, `PATCH /accounts/:accountId`, `DELETE /accounts/:accountId`            | **Ausente.**                                               |
| Leer y reemplazar los alcances de acceso de una Cuenta de Cliente (Yacimiento, Planta o Equipo) | `GET /accounts/:accountId/access-scopes`, `PUT /accounts/:accountId/access-scopes`       | **Ausente.**                                               |
| Listar, crear y editar Taller Móvil junto con su Cuenta de tablet                               | `GET /mobile-workshops`, `POST /mobile-workshops`, `PATCH /mobile-workshops/:workshopId` | **Ausente.**                                               |
| Listar, crear y editar Técnicos/Personas                                                        | `GET /technicians`, `POST /technicians`, `PATCH /technicians/:technicianId`              | **Ausente.**                                               |
| Consultar la asignación vigente de un Yacimiento                                                | `GET /yacimientos/:yacimientoId/assignment`                                              | **Disponible**, aunque ninguna pantalla actual lo consume. |

### Catálogos, patrones y planificación de dotación

| Capacidad requerida                                                  | Ruta Edge propuesta                                                                                                                                         | Estado actual |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Listar opciones activas de un catálogo para formularios              | `GET /catalogs/:catalogKey/options`                                                                                                                         | **Ausente.**  |
| Administrar opciones de catálogo, resumen, activación y orden        | `GET /catalogs/:catalogKey`, `GET /catalogs/summary`, `POST /catalogs/:catalogKey/options`, `PATCH /catalog-options/:id`, `PUT /catalogs/:catalogKey/order` | **Ausente.**  |
| Listar, crear y editar Patrones de ensayo                            | `GET /test-standards`, `POST /test-standards`, `PATCH /test-standards/:standardId`                                                                          | **Ausente.**  |
| Consultar nóminas de Técnicos por Taller Móvil y fecha               | `GET /staffing?from=&to=`                                                                                                                                   | **Ausente.**  |
| Reemplazar una nómina y copiar las vacantes desde la semana anterior | `PUT /staffing/:workshopId/:date`, `POST /staffing/copy-previous-week`                                                                                      | **Ausente.**  |

### Operación: transición de la pantalla mock «Tarea»

La pantalla actual mezcla Solicitud de servicio, programación de Visita de
servicio y datos que pertenecen a una Orden de trabajo. No se debe crear una
segunda entidad de backend llamada `Tarea`. Antes de sustituir esas pantallas,
el frontend necesita un DTO de lectura y comandos que traduzcan explícitamente
la UI histórica a las entidades canónicas.

| Capacidad requerida                                                                                                                        | Ruta Edge propuesta o existente                                                                      | Estado actual                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Listar la vista operacional que reemplaza `TareaResumen`, con los filtros y datos de ubicación/taller que usa agenda, cronograma y listado | `GET /operations?from=&to=&status=&workshop_id=&client_id=&q=`                                       | **Ausente.** `GET /requests` y `GET /visits` están disponibles por separado, pero no satisfacen el contrato actual combinado. |
| Consultar el detalle operacional que reemplaza `Tarea`                                                                                     | `GET /operations/:operationId`                                                                       | **Ausente.** `GET /requests/:id` y `GET /visits/:id` existen por separado.                                                    |
| Crear o editar la intención del Cliente como Solicitud de servicio                                                                         | `POST /requests`, `PATCH /requests/:requestId`                                                       | **Disponible.** Tiene DTO, cliente por capacidad y hooks; falta traducir el formulario mock.                                  |
| Programar una Visita y asignar Taller Móvil                                                                                                | `POST /requests/:requestId/schedule`                                                                 | **Disponible.** Tiene DTO, cliente por capacidad y hooks; falta sustituir la edición de `Tarea`.                              |
| Listar Visitas y ejecutar aceptar, rechazar, cancelar, iniciar o completar                                                                 | `GET /visits`, `GET /visits/:visitId`, `POST /visits/:visitId/{accept,reject,cancel,start,complete}` | **Disponible.** Tiene DTO, cliente por capacidad y hooks; aún no hay pantalla de campo integrada.                             |
| Agregar y resolver Orden de trabajo de una Válvula durante una Visita                                                                      | `POST /visits/:visitId/work-orders`, `PATCH /work-orders/:workOrderId`                               | **Disponible.** Tiene DTO y cliente por capacidad; aún no hay pantalla integrada.                                             |
| Adjuntar archivos a una Solicitud/Visita sin browser→Storage                                                                               | `POST /attachments` o una ruta anidada con multipart                                                 | **Ausente.** La actual `subirAdjunto` sólo genera una data URL mock.                                                          |

### Certificados y trabajo offline

| Capacidad requerida                                               | Ruta Edge propuesta o existente                                                              | Estado actual                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Iniciar, leer y actualizar un Borrador de Certificado             | `POST /work-orders/:workOrderId/certificate-draft`, `GET/PATCH /certificates/:certificateId` | **Disponible.** Tiene DTO de sobre y cliente por capacidad; no hay pantalla actual de captura y el payload JSONB sigue opaco hasta definirla. |
| Enviar Firma de una Visita                                        | `POST /visits/:visitId/signatures`                                                           | **Parcial.** La RPC registra una referencia de Storage, pero falta la ruta Edge de carga del archivo que produzca esa referencia.             |
| Cargar fotos/evidencias para certificado o visita                 | Ruta Edge multipart, por ejemplo `POST /visits/:visitId/evidence`                            | **Ausente.**                                                                                                                                  |
| Obtener la ventana de trabajo offline de dos días                 | `GET /offline/working-set`                                                                   | **Disponible** y ya la consume `/taller/sincronizacion` cuando la fuente es Supabase.                                                         |
| Sincronizar lote idempotente de operaciones offline de una Visita | `POST /visits/:visitId/sync`                                                                 | **Disponible.** Tiene DTO, cliente y hook; la pantalla actual sólo actualiza el working set, sin envío ni resolución de conflictos.           |

### Pantallas sin flujo de datos implementado

`/admin`, `/admin/certificados`, `/admin/configuracion/certificado`,
`/admin/backups`, `/superadmin/**`, `/taller`, y las páginas `/portal/**` se
renderizan como «En construcción» o no solicitan datos. No se agrega una ruta
Edge especulativa para ellas. Cuando se implemente cada flujo, su contrato debe
añadirse primero a este anexo y respetar el mismo único camino
navegador → `service-access` → base de datos/Storage.

## Anexo B — Rutas Edge pendientes para que las pantallas actuales funcionen

Esta lista resume las capacidades del Anexo A que todavía no tienen una ruta
Edge plenamente utilizable por las pantallas actuales. **Ausente** indica que
no existe una ruta equivalente; **parcial** indica que existe una ruta o
comando de backend, pero falta el DTO/mapping estable requerido por la UI o el
paso Edge de carga de archivos. No propone implementar ahora esas capacidades.

| Capacidad frontend pendiente                                                       | Ruta o mecanismo requerido                                                                                                                                                                       | Estado                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Listar y consultar Clientes con búsqueda, contadores y opción de incluir inactivos | `GET /clients?q=&include_inactive=`, `GET /clients/:clientId`                                                                                                                                    | **Ausente**                                                    |
| Crear y actualizar Clientes                                                        | `POST /clients`, `PATCH /clients/:clientId`                                                                                                                                                      | **Ausente**                                                    |
| Cargar, reemplazar o quitar el logo de Cliente desde Edge                          | `PUT`/`DELETE /clients/:clientId/logo` (multipart)                                                                                                                                               | **Ausente**                                                    |
| Adaptar el árbol de Yacimiento al contexto de Cliente y al DTO de la pantalla      | `GET /yacimientos/:yacimientoId/tree` y mapping Cliente→Yacimiento                                                                                                                               | **Parcial**                                                    |
| Adaptar formularios de jerarquía a atributos técnicos actuales de Válvula          | `GET/PATCH /valves/:valvulaId`                                                                                                                                                                   | **Disponible en Edge; pendiente sustituir el formulario mock** |
| Consultar una Válvula con sus atributos técnicos y revisiones                      | `GET /valves/:valvulaId`                                                                                                                                                                         | **Disponible en Edge; pendiente conectar la ficha mock**       |
| Eliminar Yacimientos, Plantas, Equipos y Válvulas                                  | `DELETE /yacimientos/:id`, `DELETE /plants/:id`, `DELETE /equipment/:id`, `DELETE /valves/:id`                                                                                                   | **Ausente**                                                    |
| Mapear el historial de Certificados de Válvula al DTO de tarjeta de la UI          | `GET /valves/:valvulaId/certificates`                                                                                                                                                            | **Parcial**                                                    |
| Listar y consultar Cuentas por rol/Cliente                                         | `GET /accounts?role=&client_id=`, `GET /accounts/:accountId`                                                                                                                                     | **Ausente**                                                    |
| Crear, actualizar, activar/desactivar y eliminar Cuentas                           | `POST /accounts`, `PATCH /accounts/:accountId`, `DELETE /accounts/:accountId`                                                                                                                    | **Ausente**                                                    |
| Leer y reemplazar alcances de acceso de Cuenta                                     | `GET /accounts/:accountId/access-scopes`, `PUT /accounts/:accountId/access-scopes`                                                                                                               | **Ausente**                                                    |
| Listar, crear y editar Talleres Móviles y Técnicos                                 | `/mobile-workshops`, `/technicians` (GET/POST/PATCH)                                                                                                                                             | **Ausente**                                                    |
| Consultar y administrar opciones de catálogo                                       | `GET /catalogs/:catalogKey/options`, `GET /catalogs/:catalogKey`, `GET /catalogs/summary`, `POST /catalogs/:catalogKey/options`, `PATCH /catalog-options/:id`, `PUT /catalogs/:catalogKey/order` | **Ausente**                                                    |
| Listar, crear y editar Patrones de ensayo                                          | `GET /test-standards`, `POST /test-standards`, `PATCH /test-standards/:standardId`                                                                                                               | **Ausente**                                                    |
| Consultar y reemplazar nóminas de Técnicos, incluida copia semanal                 | `GET /staffing?from=&to=`, `PUT /staffing/:workshopId/:date`, `POST /staffing/copy-previous-week`                                                                                                | **Ausente**                                                    |
| Obtener lista y detalle operacional combinados que reemplazan `Tarea`              | `GET /operations` con filtros y `GET /operations/:operationId`                                                                                                                                   | **Ausente**                                                    |
| Adaptar Solicitud de servicio y programación de Visita a formularios actuales      | `POST/PATCH /requests`, `POST /requests/:requestId/schedule`                                                                                                                                     | **Parcial**                                                    |
| Adaptar Visitas y sus comandos al flujo de pantalla de campo                       | `GET /visits`, `GET /visits/:visitId` y comandos accept/reject/cancel/start/complete                                                                                                             | **Parcial**                                                    |
| Adaptar Órdenes de trabajo y sus resultados al flujo de Válvula/Visita             | `POST /visits/:visitId/work-orders`, `PATCH /work-orders/:workOrderId`                                                                                                                           | **Parcial**                                                    |
| Adjuntar archivos a Solicitudes o Visitas mediante Edge                            | `POST /attachments` o ruta anidada multipart                                                                                                                                                     | **Ausente**                                                    |
| Cargar por Edge el archivo de firma de una Visita y registrar su referencia        | `POST /visits/:visitId/signatures` más carga multipart a Storage desde Edge                                                                                                                      | **Parcial**                                                    |
| Cargar fotos/evidencias de Certificado o Visita mediante Edge                      | Ruta Edge multipart, por ejemplo `POST /visits/:visitId/evidence`                                                                                                                                | **Ausente**                                                    |
| Adaptar el Borrador de Certificado a una pantalla de captura                       | `POST /work-orders/:workOrderId/certificate-draft`, `GET/PATCH /certificates/:certificateId`                                                                                                     | **Parcial**                                                    |
| Completar la sincronización offline con envío de lote y resolución de conflictos   | `POST /visits/:visitId/sync` y contrato de acknowledgement/conflictos                                                                                                                            | **Parcial**                                                    |
