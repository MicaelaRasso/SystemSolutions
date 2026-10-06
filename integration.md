# Integración vigente: frontend → Edge Functions → Supabase

## Decisión de arquitectura y seam implementado

La aplicación de navegador sólo integra directamente Supabase Auth para crear,
renovar y cerrar la sesión. No accede directamente a PostgreSQL, a la Data API,
a RPCs de base de datos ni a Storage. Todo acceso de aplicación pasa por un
adaptador de capacidad y una Edge Function autenticada.

```text
Browser
  ├── Supabase Auth (sólo sesión)
  └── adaptadores nombrados de capacidad
        └── registro de funciones → Edge Function propietaria
              └── PostgreSQL / Storage
```

Los componentes consumen `edgeApi.identity`, `edgeApi.hierarchy`,
`edgeApi.yacimientos`, `edgeApi.valves`, `edgeApi.serviceWorkflow`,
`edgeApi.serviceRequests`, `edgeApi.visits`, `edgeApi.workOrders`,
`edgeApi.certificates`, `edgeApi.signatures`, `edgeApi.offline` y
`edgeApi.operations`. Estos módulos
son el seam del navegador: validan DTOs y mapean respuestas, pero no conocen la
URL ni la función que posee una ruta.

`EdgeTransport` mantiene el registro de funciones y agrega el JWT de Auth, la
publishable key, el correlation ID y los encabezados de contenido. Cada
adaptador se dirige directamente a su función propietaria; no existe un
fallback monolítico.

Las cinco funciones propietarias comparten el runtime privado de
`supabase/functions/_shared`: autenticación, actor, cliente de base con
`service_role`, HTTP/CORS, errores, validación, metadatos y correlation IDs.
Estos módulos no son capacidades del navegador. PostgreSQL conserva la
autorización de dominio como barrera final.

## Estado actual

- `src/lib/api/index.ts` registra adaptadores nombrados; los componentes no
  llaman `fetch`, PostgREST, RPCs ni Storage.
- `src/lib/services/edge-transport.ts` mantiene el registro de las cinco
  funciones propietarias. Las variables `NEXT_PUBLIC_*_URL` permiten apuntar
  cada capacidad a su función directa; si faltan, se construyen las URLs
  propietarias desde `NEXT_PUBLIC_SUPABASE_URL`.
- Las funciones propietarias ya tienen entrypoints y usan el runtime privado
  compartido. La propiedad de las rutas y su estado se detallan en la tabla
  siguiente; que exista un entrypoint no significa que todas las capacidades de
  su dominio estén implementadas.
- Auth usa cookies gestionadas por `@supabase/ssr`; el navegador no guarda
  tokens en `localStorage` ni define el rol. `proxy.ts` y los layouts verifican
  el JWT y obtienen el contexto canónico por `GET /context`.
- La aplicación usa Supabase Auth y las capacidades Edge en todos los entornos;
  no existe un modo de datos simulado.

### APIs administrativas conectadas

El adaptador `services.edge` conecta las pantallas administrativas con sus
funciones propietarias. La correspondencia está documentada en los comentarios de
`src/lib/api/admin.ts` y `src/lib/services/edge.ts`:

| Pantalla frontend | Adaptador | Edge Function | Backend canónico |
| --- | --- | --- | --- |
| Clientes y logo | `admin.clients` | `asset-access` | `clientes` + Auth + Storage |
| Usuarios y alcances | `admin.accounts` | `identity-admin` | `cuentas`, `cliente_cuentas`, `cliente_accesos` |
| Talleres y técnicos | `admin.workshops`, `admin.people` | `identity-admin` | `talleres_moviles`, `taller_cuentas`, `personas` |
| Catálogos y patrones | `admin.catalogs`, `admin.standards` | `identity-admin` | `catalogo_opciones`, `patrones_ensayo` |
| Cronograma | `admin.staffing` | `identity-admin` | `nominas_jornada` |
| Tareas, agenda y detalle | `operations` | `service-workflow` | lectura canónica de Solicitudes, Visitas y Ordenes |
| Adjuntos | `services.tareas.subirAdjunto` (compatibilidad UI) | `service-workflow` | Storage `attachments`; no pertenece a `edgeApi.operations` |

La UI histórica sigue llamando `Tarea` por compatibilidad visual, pero el
backend no crea una entidad con ese nombre: los comandos crean o actualizan la
Solicitud de servicio y, cuando corresponde, la Visita de servicio.

### Propiedad de rutas y funciones

| Rutas implementadas | Función propietaria directa | Adaptador de navegador | Estado y límite |
| --- | --- | --- | --- |
| `GET /context` | `identity-admin` | `identity` | Disponible. El contexto canónico de Cuenta/rol proviene de la función. |
| `GET/POST /yacimientos`, `PATCH /yacimientos/:id`, lecturas de árbol/asignación y `POST/PATCH /hierarchy` | `asset-access` | `hierarchy`, `yacimientos` | Disponible para las operaciones existentes; no incluye ciclo de vida de Cliente ni eliminación. |
| `GET/PATCH /valves/:id` | `asset-access` | `hierarchy`, `valves` | Disponible para detalle, atributos técnicos y revisión inmutable. |
| `GET /requests`, `GET /requests/:id`, `POST /requests`, `PATCH /requests/:id`, `POST /requests/:id/schedule` | `service-workflow` | `serviceWorkflow`, `serviceRequests` | Lecturas y mutaciones de Solicitudes de servicio; programar crea o actualiza la Visita canónica. |
| `GET /visits`, `GET /visits/:id` y comandos `POST /visits/:id/{accept,reject,cancel,start,complete}` | `service-workflow` | `serviceWorkflow`, `visits` | Contrato canónico de Visita de servicio y sus transiciones. |
| `POST /visits/:id/work-orders`, `PATCH /work-orders/:id` | `service-workflow` | `serviceWorkflow`, `workOrders` | Mutaciones de Orden de trabajo; sólo la Orden individual puede registrar su resultado. |
| `GET /operations`, `GET /operations/:visitId` | `service-workflow` | `operations` | **Disponible; sólo lectura.** Usa el id de la Visita y envelopes canónicos; `Tarea` es compatibilidad de UI y no una entidad backend. |
| `POST /attachments` | `service-workflow` | `services.tareas.subirAdjunto` (compatibilidad) | Carga Edge de adjuntos genéricos; no pertenece a `edgeApi.operations`. |
| `GET /valves/:id/certificates`, `GET/PATCH /certificates/:id`, `GET /certificates/:id/finalized`, `POST /work-orders/:id/certificate-draft` | `certificate-field` | `certificates` | Disponible según el DTO implementado; no implica una pantalla de captura completa. |
| `POST /visits/:id/signatures` | `certificate-field` | `certificates`, `signatures` | Parcial: registra la referencia y los datos de la firma; no carga bytes de media. |
| `GET/POST /offline/working-set`, `POST /visits/:id/sync` | `offline-sync` | `offline` | El POST registra la versión de catálogo descargada por dispositivo; el GET sigue disponible por compatibilidad. El lote conserva acknowledgements y conflictos. |
| `POST /backups` | `backup-export` | `backups` | Disponible sólo para el Súper Administrador. Genera una descarga ZIP inmediata completa o por rango inclusivo, con manifest, checksums, advertencias de media y metadata de generación; nunca retiene el archivo. |

Las URLs directas se pueden configurar con `NEXT_PUBLIC_IDENTITY_ADMIN_URL`,
`NEXT_PUBLIC_ASSET_ACCESS_URL`, `NEXT_PUBLIC_SERVICE_WORKFLOW_URL`,
`NEXT_PUBLIC_CERTIFICATE_FIELD_URL`, `NEXT_PUBLIC_OFFLINE_SYNC_URL` y
`NEXT_PUBLIC_BACKUP_EXPORT_URL`. Si una
falta, el frontend apunta a la función propietaria estándar del proyecto. No
existe una URL alternativa de `service-access`.

### Contrato canónico de Visita de servicio

La entidad canónica del ciclo operativo es `Visita de servicio`, no `Tarea` ni
`Operation`. Una Visita pertenece a exactamente un Yacimiento y a una
`Solicitud de servicio`; la relación es uno a uno en el backend. La respuesta
de lectura tiene este sobre estable:

```json
{
  "visit": {
    "id": "<visita-id>",
    "solicitud_id": "<solicitud-id>",
    "yacimiento_id": "<yacimiento-id>",
    "taller_movil_id": "<taller-id-or-null>",
    "starts_at": "<ISO-8601>",
    "ends_at": "<ISO-8601>",
    "estado": "solicitada | programada | aceptada | en_curso | completada | cancelada"
  },
  "work_orders": [
    {
      "id": "<orden-id>",
      "visita_id": "<visita-id>",
      "valvula_id": "<valvula-id>",
      "estado": "pendiente | evaluada | no_evaluada"
    }
  ]
}
```

Los campos de auditoría y las marcas de aceptación, rechazo o cancelación
pueden acompañar a `visit`; no cambian su identidad. Las mutaciones de esta
superficie son explícitas:

| Superficie | Mutación | Resultado canónico |
| --- | --- | --- |
| Solicitud | `POST /requests`, `PATCH /requests/:id` | Crea o reemplaza la Selección de servicio mientras la Solicitud sigue editable. |
| Solicitud → Visita | `POST /requests/:id/schedule` | Un Administrador programa o reasigna la Visita en estado `programada`. |
| Visita | `POST /visits/:id/accept` | El Taller Móvil asignado pasa `programada` a `aceptada`. |
| Visita | `POST /visits/:id/reject` | El rechazo devuelve la Visita a `programada` y permite reasignarla. |
| Visita | `POST /visits/:id/start` | El Taller Móvil asignado pasa `aceptada` a `en_curso`. |
| Visita | `POST /visits/:id/complete` | El Taller Móvil asignado pasa `en_curso` a `completada`; la finalización de Certificados es independiente. |
| Visita | `POST /visits/:id/cancel` | El Cliente propietario cancela antes del día de ejecución. |
| Orden | `POST /visits/:id/work-orders` | Agrega una Válvula a una Visita `en_curso`, respetando Cliente y acceso del Taller Móvil. |
| Orden | `PATCH /work-orders/:id` | Registra `evaluada` o `no_evaluada`; esta última exige una razón. |

`GET /operations` y `GET /operations/:visitId` sólo leen el contrato canónico
orientado a Visitas. La colección contiene Visitas, no Solicitudes sin
programar; el detalle se busca por el id de la Visita y puede incluir la
Solicitud relacionada y el detalle de sus Ordenes. `Tarea` sólo conserva el
nombre de compatibilidad de la UI. Ninguna mutación de Solicitud, Visita u
Orden se realiza a través de `/operations`.

### Capacidades no disponibles

Estas capacidades tienen un owner previsto, pero no una implementación usable.
No deben sustituirse por llamadas directas del navegador ni marcarse como
completadas:

| Capacidad                                                           | Owner previsto                       | Estado actual                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Eliminación de Yacimientos, Plantas, Equipos y Válvulas             | `asset-access`                       | **No disponible.** La política de borrado/archivo e historial no está resuelta.                       |
| Bytes de firmas, fotos, evidencia y logos                           | `certificate-field` / `asset-access` | **No disponible.** Sólo existe registro de referencia para una firma; no existe carga multipart Edge. |

### Decisiones abiertas

Siguen bloqueando las capacidades anteriores y no se resuelven por agregar un
adaptador:

1. **Alcance de Cuenta:** el contexto define un login por Cliente, mientras el
   inventario propone múltiples Cuentas de Cliente con alcances.
2. **Eliminación de activos:** falta definir borrado lógico/archivo, reglas de
   integridad y comportamiento ante Solicitudes, Visitas, Certificados e
   historial preservado.
3. **Contrato de media:** faltan owner, secciones, MIME/tamaño, nombres,
   idempotencia, reemplazo y reglas posteriores al cierre del Certificado.

## Fase 1 — Compuerta Edge-only (implementada)

Objetivo: ninguna solicitud iniciada por el navegador puede llegar a las tablas
o a las RPCs de aplicación sin pasar por una Edge Function propietaria.

1. Se creó un ADR que reemplaza la decisión anterior de consultas frontend +
   RLS directas por esta arquitectura Edge-only.
2. Se creó una migración que:
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
3. Se configuraron las funciones propietarias para validar primero el JWT de la
     Cuenta y luego invocar las RPCs con `SUPABASE_SECRET_KEY` y el
   encabezado interno de actor. La clave nunca se expone al navegador. En
   producción, limitar CORS al origen de la aplicación.
4. Se añadieron pruebas de contrato que demuestran:
   - acceso directo a tablas: rechazado;
   - RPC directa con JWT de `authenticated`: rechazada;
   - misma operación por la función propietaria y actor autorizado: aceptada;
   - acceso cruzado entre Clientes o Talleres Móviles: rechazado.
5. Se ejecutaron los tests locales y las pruebas del transporte; el navegador
   sólo llama Auth y las funciones del registro.

La Data API continúa disponible exclusivamente para la Edge Function mediante
su clave de servidor. La compuerta instala la identidad previamente validada de
la Cuenta, por lo que las reglas de autorización existentes en las RPCs siguen
siendo la fuente de verdad.

**Criterio de terminación:** no existe una URL, grant o función de aplicación
que un navegador autenticado pueda invocar directamente para leer o modificar
datos fuera del registro de Edge. Las rutas legacy y el fallback fueron
eliminados.

## Fase 2 — Sesión de producción (implementada)

1. La sesión de producción usa Supabase Auth SSR y cookies gestionadas.
2. Tras login, `GET /context` se solicita mediante el adaptador `identity`; el
   rol y la navegación derivan de esa respuesta, no de una cookie editable.
3. `proxy.ts` y los layouts usan una sesión verificable.
4. El navegador no gestiona tokens en `localStorage`.

**Criterio de terminación:** las protecciones de ruta usan una sesión verificable
y el navegador no contiene una fuente de autoridad sobre roles.

## Fase 3 — Capa de datos orientada a la API Edge (seam implementado)

1. Los adaptadores nombrados sustituyen el contrato general `Services`; los
   módulos disponibles se enumeran al inicio de este documento.
2. Los módulos implementados definen DTOs, esquemas Zod, mapping a modelos de
   vista, query keys, invalidaciones y respuestas de error.
3. Mantener los componentes independientes de Supabase: los componentes llaman
   hooks y adaptadores, nunca `fetch`, PostgREST o Storage directamente.
4. Actualizar este contrato al agregar o cambiar rutas y su función propietaria;
   no agregar una capacidad bloqueada como si fuera una ruta disponible.

## Fase 4 — Primer corte vertical: jerarquía de Yacimiento (implementada)

El corte vertical conectado a `asset-access` cubre:

1. Login y `GET /context`.
2. Lista de Yacimientos accesibles.
3. Árbol de Yacimiento.
4. Alta y edición de Yacimiento, Planta/locación, Equipo/unidad y Válvula.
5. Historial de Certificados de una Válvula.

Resolver explícitamente el mapping entre la UI histórica de `Empresa` y el
modelo canónico `Cliente`; no introducir `Tarea` como nombre alternativo de
Visita de servicio u Orden de trabajo.

**Criterio de terminación:** estas pantallas usan los contratos de `asset-access`
directamente, incluida la edición técnica de Válvulas y el historial de
Certificados.

## Fase 5 — Ciclo de servicio (implementada)

El flujo conectado a `service-workflow` cubre:

1. Cliente: Solicitud de servicio y Selección de servicio.
2. Administrador: programación y asignación de Visita de servicio.
3. Taller Móvil: lista, aceptación/rechazo, inicio y finalización de visitas.
4. Ordenes de trabajo por Válvula y su resultado independiente.
5. Estados diferenciados de Solicitud, Visita, Orden y Borrador de Certificado.

## Fase 6 — Contrato de captura del Certificado

Una Orden de trabajo evaluada puede iniciar un Borrador de certificado. Al
crearlo, el backend fija `plantilla_version_id`, `plantilla_version` y
`plantilla_snapshot` con los campos de la versión activa. Una versión nueva no
altera los borradores existentes ni los certificados cerrados. El navegador
lee la plantilla y los catálogos mediante `GET /certificate-capture/catalogs`,
y lee/guarda el borrador mediante `GET/PATCH /certificates/:id`.

El payload de `PATCH` usa estas secciones; `plantilla_version` y
`plantilla_snapshot` son propiedad del backend y no se aceptan en el cambio:

```json
{
  "fecha_ejecucion": "2026-10-05",
  "tecnico_ejecutor": "Nombre Apellido",
  "datos_tecnicos": {
    "valvula": {},
    "ensayos": {
      "sp_inicial": { "valor": 12.5, "unidad": "bar" },
      "sp_apertura": { "valor": 13, "unidad": "bar" },
      "presion_cierre": { "valor": 11, "unidad": "bar" },
      "patron": { "id": "<uuid>", "label": "Patrón mostrado" }
    }
  },
  "campos_personalizados": {},
  "alcance_mantenimiento": [{ "id": "<uuid>", "label": "Acción mostrada" }],
  "repuestos": {
    "catalog_version": "<uuid-de-version-de-repuestos>",
    "items": [{ "id": "<uuid>", "label": "Repuesto mostrado" }],
    "otros": null
  },
  "evidencia_fotografica": {
    "desarmada": null,
    "ensamblada_prueba": null,
    "placa_precinto": null
  },
  "observaciones": null
}
```

Cada definición de `plantilla_snapshot.campos` tiene `clave`, `etiqueta`,
`seccion`, `orden`, `tipo`, `obligatorio` y `opciones` opcionales con `id` y
`label`. Los valores personalizados se indexan por `clave`. Las opciones nuevas
guardan su ID estable y la etiqueta mostrada; los borradores anteriores con
cadenas simples siguen siendo legibles. El backend rechaza secciones y campos
personalizados no admitidos. La validación de cierre exige fecha, Técnico,
resultados y unidades de ensayo, patrón y los campos obligatorios de la
plantilla. Los Certificados cerrados conservan estos valores sin permitir su
edición.

### Versión de Repuestos fijada por Visita

Las altas, ediciones, cambios de orden y desactivaciones de `repuestos`
publican una nueva versión inmutable con las opciones activas y sus etiquetas.
`GET /certificate-capture/catalogs` devuelve `replacement_catalog_version`
(UUID) y `replacement_parts` (lista ordenada de `{id,label}`). Esta versión es
independiente de `plantilla_version`.

Para preparar trabajo offline, el Taller Móvil llama
`POST /offline/working-set` con `{ "device_id": "<uuid>" }`. La respuesta
incluye `certificate_catalogs` por Visita y registra qué versión descargó ese
dispositivo. La antigua ruta `GET /offline/working-set` sigue disponible para
compatibilidad, pero no registra una versión de dispositivo para inicio offline.

Al iniciar una Visita, `POST /visits/:id/start` acepta
`{ "device_id": "<uuid>", "replacement_catalog_version_id": "<uuid>" }`.
El backend exige que la versión coincida con la última descargada por ese
dispositivo para esa Visita, y la fija en la Visita. Para iniciar offline, el
lote de `POST /visits/:id/sync` incluye primero una operación `start_visit` con
ese mismo payload y dependencias posteriores; se sincroniza antes de solicitar
un working set nuevo. Una edición posterior del catálogo no sustituye la
versión fijada. Los borradores nuevos toman ese UUID en
`repuestos.catalog_version`, y el backend rechaza opciones ajenas a la
instantánea. Los certificados previos mantienen sus versiones y etiquetas
heredadas. El inicio con cuerpo vacío sigue fijando la versión activa actual
para clientes antiguos conectados.

## Fase 7 — Trabajo offline (implementada)

La implementación actual:

1. Guarda el conjunto de trabajo Edge y las operaciones en IndexedDB.
2. Encola operaciones con UUID permanente, dependencias y estado local.
3. Sincroniza exclusivamente con `POST /visits/:id/sync`.
4. Persiste acknowledgements y reduce los payloads ya confirmados a recibos.
5. Reintenta fallos de red y permite reintento manual al recuperar conexión.
6. Conserva payload, error y estado de los conflictos para su presentación.

No implementa resolución automática, merge, reemplazo por último escritor ni
un endpoint de resolución: el conflicto queda durable para revisión posterior.

## Fase 8 — Dominios restantes

Las pantallas que todavía no tienen flujo completo conservan su contrato
explícitamente no disponible. No se agrega una ruta Edge especulativa; cada
capacidad nueva debe declarar primero su owner, DTO, autorización y pruebas.

El alcance restante incluye:

1. Media de firmas, fotos, evidencia y logos.
2. Cierre/finalización de Certificados y generación de PDF.
3. Eliminación o archivo de activos.
4. Backups, Super administrador y los flujos de portal aún no conectados.

La aplicación usa Supabase como única fuente de datos; una ruta sin contrato
real debe permanecer explícitamente no disponible.

## Primer paquete de implementación (completado)

El primer paquete de trabajo combina las tres bases necesarias para el primer
corte vertical:

1. Fase 1: compuerta Edge-only y pruebas de bypass.
2. Fase 2: sesión de producción autenticada.
3. Fase 4: jerarquía de Yacimiento y certificados de Válvula.

El paquete fue integrado y verificado localmente; no implica despliegue en
Supabase.

## Anexo A — Inventario obligatorio de capacidades Edge para las pantallas actuales

Este inventario describe el contrato que necesita la interfaz que hoy se
renderiza. No autoriza a construir las capacidades marcadas como **ausentes**;
su propósito es impedir que una pantalla vuelva a conectarse a la Data API, a
una RPC o a Storage desde el navegador mientras se migra por cortes verticales.

**Estados:** **disponible** significa que una función propietaria ya tiene la
ruta; **parcial** significa
que hay una ruta de backend, pero no tiene todavía el DTO, el adaptador o la
carga de media que la pantalla actual necesita; **ausente** significa que no
hay ruta Edge equivalente. Una ruta disponible tampoco implica que cada
pantalla la consuma todavía. La propiedad directa está en la tabla
**Propiedad de rutas y funciones**.

### Sesión e identidad

| Capacidad requerida                                                           | Ruta o mecanismo                                                        | Estado actual                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Iniciar sesión con email y contraseña                                         | **Supabase Auth desde el navegador**, `signInWithPassword`              | **Disponible.** El cliente SSR de Auth escribe la sesión en cookies y, tras autenticar, consulta `GET /context` para obtener la identidad de aplicación. No requiere una ruta Edge de login. |
| Leer, renovar y cerrar la sesión                                              | **Supabase Auth desde el navegador**, cliente SSR y cookies gestionadas | **Disponible.** El cliente `@supabase/ssr` mantiene la sesión en cookies y `proxy.ts` la renueva y verifica.                                                                                 |
| Obtener identidad, rol canónico y Taller Móvil asociado después de autenticar | `identity-admin: GET /context`                                          | **Disponible.** La función ejecuta `api_context`; el adaptador actual lo usa al hacer login.                                                                                              |
| Proteger rutas y navegación con una sesión verificable                        | Cliente SSR de Supabase Auth + `GET /context`                           | **Disponible.** `proxy.ts`, layouts y `AuthProvider` verifican Auth y derivan la Cuenta/rol de `GET /context`.                                                                            |

### Cliente y estructura de activos

`Empresa` es el nombre histórico de la interfaz; en la API el agregado
canónico es **Cliente**. El contrato administrativo ya está disponible y
`services.edge` lo consume mediante `asset-access`.

| Capacidad requerida                                                                                               | Ruta Edge propuesta                                                                            | Estado actual                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Listar Clientes con búsqueda e inclusión opcional de inactivos, con contadores de Yacimientos, Válvulas y Cuentas | `GET /clients?q=&include_inactive=`                                                            | **Disponible.**                                                                                                                                                                |
| Consultar el perfil de un Cliente                                                                                 | `GET /clients/:clientId`                                                                       | **Disponible.**                                                                                                                                                                |
| Crear y actualizar Cliente (razón social, CUIT, contactos, aviso de vencimiento y estado)                         | `POST /clients`, `PATCH /clients/:clientId`                                                    | **Disponible.**                                                                                                                                                                |
| Cargar, reemplazar o quitar logo de Cliente sin acceso browser→Storage                                            | `PUT`/`DELETE /clients/:clientId/logo` (multipart hacia Edge)                                  | **Disponible.**                                                                                                            |
| Listar los Yacimientos accesibles al actor                                                                        | `GET /yacimientos`                                                                             | **Disponible.** No reemplaza aún la lista de Clientes del administrador.                                                                                                       |
| Consultar el árbol de un Yacimiento                                                                               | `GET /yacimientos/:yacimientoId/tree`                                                          | **Disponible.** La UI actual solicita el árbol por `empresaId`; falta resolver el mapping Cliente→Yacimiento y el DTO de pantalla.                                             |
| Crear y editar Yacimiento                                                                                         | `POST /yacimientos`, `PATCH /yacimientos/:yacimientoId`                                        | **Disponible**, con los campos actuales de backend (`name`, provincia, operadora, contratista).                                   |
| Crear y editar Planta/locación, Equipo/unidad y Válvula                                                           | `POST /hierarchy`, `PATCH /hierarchy/:assetId`; `PATCH /valves/:valvulaId`                     | **Disponible.** La Edge Function `PATCH /valves/:valvulaId` fue **creada**; la jerarquía conserva sus comandos de nombre y la edición técnica registra una revisión inmutable. |
| Consultar una Válvula individual, incluidos sus atributos técnicos                                                | `GET /valves/:valvulaId`                                                                       | **Disponible.** La Edge Function fue **creada**; devuelve la Válvula técnica actual y sus revisiones inmutables, con autorización por Yacimiento.                              |
| Consultar revisiones históricas de una Válvula                                                                    | `GET /valves/:valvulaId`                                                                       | **Disponible.** La Edge Function fue **creada**; la respuesta contiene `revisions`, ordenadas de la más reciente a la más antigua.                                             |
| Eliminar Yacimiento, Planta, Equipo o Válvula con las reglas de integridad del dominio                            | `DELETE /yacimientos/:id`, `DELETE /plants/:id`, `DELETE /equipment/:id`, `DELETE /valves/:id` | **Ausente.**                                                                                                                                                                   |
| Historial de Certificados de una Válvula                                                                          | `GET /valves/:valvulaId/certificates`                                                          | **Disponible.** La pantalla consume el adaptador `certificate-field` y el DTO de historial.                                                        |
| Leer Certificado finalizado e inmutable                                                                           | `GET /certificates/:certificateId/finalized`                                                   | **Disponible**, pero ninguna pantalla actual lo conecta todavía.                                                                                                               |

### Cuentas, accesos, Talleres Móviles y Técnicos

Estas capacidades corresponden a las pantallas de usuarios de Cliente,
`/admin/talleres` y al cronograma. Las altas de Cuentas deben crear o gestionar
identidades de Supabase Auth sólo dentro de una Edge Function; nunca desde el
navegador con una clave de servidor.

| Capacidad requerida                                                                             | Ruta Edge propuesta                                                                      | Estado actual                                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Listar y consultar Cuentas, filtradas por rol y Cliente                                         | `GET /accounts?role=&client_id=`, `GET /accounts/:accountId`                             | **Disponible para el listado por Cliente.**                 |
| Crear Cuenta de Cliente, activar/desactivar, actualizar datos y eliminarla                      | `POST /accounts`, `PATCH /accounts/:accountId`, `DELETE /accounts/:accountId`            | **Disponible.**                                               |
| Leer y reemplazar los alcances de acceso de una Cuenta de Cliente (Yacimiento, Planta o Equipo) | `GET /accounts/:accountId/access-scopes`, `PUT /accounts/:accountId/access-scopes`       | **Disponible.**                                               |
| Listar, crear y editar Taller Móvil junto con su Cuenta de tablet                               | `GET /mobile-workshops`, `POST /mobile-workshops`, `PATCH /mobile-workshops/:workshopId` | **Disponible.**                                               |
| Listar, crear y editar Técnicos/Personas                                                        | `GET /technicians`, `POST /technicians`, `PATCH /technicians/:technicianId`              | **Disponible.**                                               |
| Consultar la asignación vigente de un Yacimiento                                                | `GET /yacimientos/:yacimientoId/assignment`                                              | **Disponible**, aunque ninguna pantalla actual lo consume. |

### Catálogos, patrones y planificación de dotación

| Capacidad requerida                                                  | Ruta Edge propuesta                                                                                                                                         | Estado actual |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Listar opciones activas de un catálogo para formularios              | `GET /catalogs/:catalogKey/options`                                                                                                                         | **Disponible.**  |
| Administrar opciones de catálogo, resumen, activación y orden        | `GET /catalogs/:catalogKey`, `GET /catalogs/summary`, `POST /catalogs/:catalogKey/options`, `PATCH /catalog-options/:id`, `PUT /catalogs/:catalogKey/order` | **Disponible.**  |
| Listar, crear y editar Patrones de ensayo                            | `GET /test-standards`, `POST /test-standards`, `PATCH /test-standards/:standardId`                                                                          | **Disponible.**  |
| Consultar nóminas de Técnicos por Taller Móvil y fecha               | `GET /staffing?from=&to=`                                                                                                                                   | **Disponible.**  |
| Reemplazar una nómina y copiar las vacantes desde la semana anterior | `PUT /staffing/:workshopId/:date`, `POST /staffing/copy-previous-week`                                                                                      | **Disponible.**  |

### Operación: transición de la pantalla histórica «Tarea»

La pantalla actual conserva `Tarea` como compatibilidad visual, pero el backend
usa las entidades canónicas Solicitud de servicio, Visita de servicio y Orden
de trabajo. El frontend debe consumir el envelope canónico de Visita y enviar
las mutaciones a la superficie de la entidad correspondiente.

| Capacidad requerida                                                                                                                        | Ruta Edge propuesta o existente                                                                      | Estado actual                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Listar la vista operacional compatible con `TareaResumen`, con los filtros y datos de ubicación/taller que usa agenda, cronograma y listado | `GET /operations?from=&to=&status=&workshop_id=&client_id=&q=`                                       | **Disponible para lectura.** Devuelve el contrato canónico de Visitas. |
| Consultar el detalle operacional compatible con `Tarea`                                                                                     | `GET /operations/:visitId`                                                                       | **Disponible para lectura.** El id es el de la Visita y la respuesta usa envelopes canónicos. |
| Crear o editar la intención del Cliente como Solicitud de servicio                                                                         | `POST /requests`, `PATCH /requests/:requestId`                                                       | **Disponible.** El formulario usa el DTO y el adaptador de `service-workflow`.                                                |
| Programar una Visita y asignar Taller Móvil                                                                                                | `POST /requests/:requestId/schedule`                                                                 | **Disponible.** La edición usa la Visita canónica y su owner directo.                                                          |
| Listar Visitas y ejecutar aceptar, rechazar, cancelar, iniciar o completar                                                                 | `GET /visits`, `GET /visits/:visitId`, `POST /visits/:visitId/{accept,reject,cancel,start,complete}` | **Disponible.** El detalle operacional expone las transiciones del contrato de Visita.                                        |
| Agregar y resolver Orden de trabajo de una Válvula durante una Visita                                                                      | `POST /visits/:visitId/work-orders`, `PATCH /work-orders/:workOrderId`                               | **Disponible.** El detalle permite registrar resultado y exige razón para `no_evaluada`.                                      |
| Adjuntar archivos a una Solicitud/Visita sin browser→Storage                                                                               | `POST /attachments` o una ruta anidada con multipart                                                 | **Disponible** para el adjunto genérico de la pantalla operacional.                                                          |

### Certificados y trabajo offline

| Capacidad requerida                                               | Ruta Edge propuesta o existente                                                              | Estado actual                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Iniciar, leer y guardar un Borrador de Certificado                | `POST /work-orders/:workOrderId/certificate-draft`, `GET/PATCH /certificates/:certificateId` | **Disponible.** Sólo se implementa el plumbing de inicio/lectura/guardado; el payload JSONB permanece opaco. |
| Enviar Firma de una Visita                                        | `POST /visits/:visitId/signatures`                                                           | **Parcial.** La RPC registra una referencia de Storage, pero falta la ruta Edge de carga del archivo que produzca esa referencia.             |
| Cargar fotos/evidencias para certificado o visita                 | Ruta Edge multipart, por ejemplo `POST /visits/:visitId/evidence`                            | **Ausente.**                                                                                                                                  |
| Obtener la ventana de trabajo offline de dos días                 | `POST /offline/working-set` con `device_id`; `GET` heredado                                | **Disponible.** El POST devuelve el catálogo por Visita y registra la descarga del dispositivo.                                               |
| Sincronizar lote idempotente de operaciones offline de una Visita | `POST /visits/:visitId/sync`                                                                 | **Disponible.** La UI envía lotes, persiste acknowledgements, reintenta y conserva conflictos sin resolverlos.                                  |

### Pantallas sin flujo de datos implementado

`/admin/configuracion/certificado`, `/admin/backups`, `/superadmin/**`, la
captura detallada de `/taller` y las páginas `/portal/**` todavía no tienen un
flujo completo. La pantalla `/taller/sincronizacion` sí consume `offline-sync`.
No se agrega una ruta Edge especulativa para las capacidades restantes. Cuando
se implemente cada flujo, su contrato debe añadirse primero a este anexo y
respetar el mismo único camino
navegador → función propietaria → base de datos/Storage.

## Anexo B — Inventario histórico de capacidades

Esta lista conserva el inventario original usado durante la migración. No es la
fuente de estado actual: para eso prevalecen las tablas anteriores y el código
de los adaptadores. Las filas ya conectadas se conservan como trazabilidad; las
capacidades realmente fuera de alcance están resumidas en la sección de Fase 8.
Las filas de Clientes, Cuentas, Talleres, Catálogos, Staffing, Operaciones y
Adjuntos fueron implementadas por `20260926173929_admin_application_apis.sql` y
`20260926181950_operation_read_model.sql`;
para el estado vigente prevalecen la tabla de APIs administrativas de arriba y
los comentarios de los adaptadores. **Ausente** indica que
no existe una ruta equivalente; **parcial** indica que existe una ruta o
comando de backend, pero falta el DTO/mapping estable requerido por la UI o el
paso Edge de carga de archivos. No propone implementar ahora esas capacidades.

| Capacidad frontend del inventario original                                     | Ruta o mecanismo requerido                                                                                                                                                                       | Estado histórico                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Listar y consultar Clientes con búsqueda, contadores y opción de incluir inactivos | `GET /clients?q=&include_inactive=`, `GET /clients/:clientId`                                                                                                                                    | **Ausente**                                                      |
| Crear y actualizar Clientes                                                        | `POST /clients`, `PATCH /clients/:clientId`                                                                                                                                                      | **Ausente**                                                      |
| Cargar, reemplazar o quitar el logo de Cliente desde Edge                          | `PUT`/`DELETE /clients/:clientId/logo` (multipart)                                                                                                                                               | **Ausente**                                                      |
| Adaptar el árbol de Yacimiento al contexto de Cliente y al DTO de la pantalla      | `GET /yacimientos/:yacimientoId/tree` y mapping Cliente→Yacimiento                                                                                                                               | **Parcial**                                                      |
| Adaptar formularios de jerarquía a atributos técnicos actuales de Válvula          | `GET/PATCH /valves/:valvulaId`                                                                                                                                                                   | **Implementado** |
| Consultar una Válvula con sus atributos técnicos y revisiones                      | `GET /valves/:valvulaId`                                                                                                                                                                         | **Implementado**       |
| Eliminar Yacimientos, Plantas, Equipos y Válvulas                                  | `DELETE /yacimientos/:id`, `DELETE /plants/:id`, `DELETE /equipment/:id`, `DELETE /valves/:id`                                                                                                   | **Ausente**                                                      |
| Mapear el historial de Certificados de Válvula al DTO de tarjeta de la UI          | `GET /valves/:valvulaId/certificates`                                                                                                                                                            | **Parcial**                                                      |
| Listar y consultar Cuentas por rol/Cliente                                         | `GET /accounts?role=&client_id=`, `GET /accounts/:accountId`                                                                                                                                     | **Ausente**                                                      |
| Crear, actualizar, activar/desactivar y eliminar Cuentas                           | `POST /accounts`, `PATCH /accounts/:accountId`, `DELETE /accounts/:accountId`                                                                                                                    | **Ausente**                                                      |
| Leer y reemplazar alcances de acceso de Cuenta                                     | `GET /accounts/:accountId/access-scopes`, `PUT /accounts/:accountId/access-scopes`                                                                                                               | **Ausente**                                                      |
| Listar, crear y editar Talleres Móviles y Técnicos                                 | `/mobile-workshops`, `/technicians` (GET/POST/PATCH)                                                                                                                                             | **Ausente**                                                      |
| Consultar y administrar opciones de catálogo                                       | `GET /catalogs/:catalogKey/options`, `GET /catalogs/:catalogKey`, `GET /catalogs/summary`, `POST /catalogs/:catalogKey/options`, `PATCH /catalog-options/:id`, `PUT /catalogs/:catalogKey/order` | **Ausente**                                                      |
| Listar, crear y editar Patrones de ensayo                                          | `GET /test-standards`, `POST /test-standards`, `PATCH /test-standards/:standardId`                                                                                                               | **Ausente**                                                      |
| Consultar y reemplazar nóminas de Técnicos, incluida copia semanal                 | `GET /staffing?from=&to=`, `PUT /staffing/:workshopId/:date`, `POST /staffing/copy-previous-week`                                                                                                | **Ausente**                                                      |
| Obtener lista y detalle operacional compatibles con `Tarea`                       | `GET /operations` con filtros y `GET /operations/:visitId`                                                                                                                                         | **Disponible para lectura; sólo GET.** El id de detalle es el de la Visita y las mutaciones van por Solicitudes, Visitas y Ordenes. |
| Adaptar Solicitud de servicio y programación de Visita a formularios actuales      | `POST/PATCH /requests`, `POST /requests/:requestId/schedule`                                                                                                                                     | **Parcial**                                                      |
| Adaptar Visitas y sus comandos al flujo de pantalla de campo                       | `GET /visits`, `GET /visits/:visitId` y comandos accept/reject/cancel/start/complete                                                                                                             | **Parcial**                                                      |
| Adaptar Órdenes de trabajo y sus resultados al flujo de Válvula/Visita             | `POST /visits/:visitId/work-orders`, `PATCH /work-orders/:workOrderId`                                                                                                                           | **Parcial**                                                      |
| Adjuntar archivos a Solicitudes o Visitas mediante Edge                            | `POST /attachments` o ruta anidada multipart                                                                                                                                                     | **Disponible**; el adaptador canónico de operaciones sigue siendo sólo lectura |
| Cargar por Edge el archivo de firma de una Visita y registrar su referencia        | `POST /visits/:visitId/signatures` más carga multipart a Storage desde Edge                                                                                                                      | **Parcial**                                                      |
| Cargar fotos/evidencias de Certificado o Visita mediante Edge                      | Ruta Edge multipart, por ejemplo `POST /visits/:visitId/evidence`                                                                                                                                | **Ausente**                                                      |
| Iniciar, leer y guardar el Borrador de Certificado                                 | `POST /work-orders/:workOrderId/certificate-draft`, `GET/PATCH /certificates/:certificateId`                                                                                                     | **Implementado; payload opaco**                                  |
| Sincronizar lotes offline y conservar conflictos                                   | `POST /visits/:visitId/sync` y contrato de acknowledgement/conflictos                                                                                                                            | **Implementado; sin resolución automática**                      |
