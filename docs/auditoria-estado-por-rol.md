# Auditoría del sistema por rol de usuario

**Proyecto:** System Solutions  
**Fecha de auditoría:** 2026-09-29  
**Alcance:** aplicación Next.js, adaptadores de API, Supabase Edge Functions, PostgreSQL, Storage, autenticación, autorización, operación offline y documentación de dominio.

## 1. Dictamen ejecutivo

El sistema tiene una base funcional sólida para el flujo operativo principal:

`Cliente solicita servicio → Administrador agenda → Taller Móvil ejecuta → Cliente firma → se finaliza el certificado`.

La arquitectura actual está razonablemente separada en cuatro capas:

- **Frontend:** Next.js 16, React, rutas protegidas por `src/proxy.ts`, componentes por rol y adaptadores en `src/lib/api/`.
- **API:** Supabase Edge Functions como gateway de datos: `identity-admin`, `asset-access`, `service-workflow`, `audit-log`, `certificate-field`, `offline-sync`, `backup-export` y `email-delivery`.
- **Backend:** funciones SQL de negocio, validaciones de propiedad/asignación, transiciones de estado, RLS y triggers de auditoría.
- **Base de datos:** PostgreSQL con migraciones incrementales para cuentas, clientes, talleres, activos, solicitudes, visitas, órdenes, certificados, firmas, sincronización y auditoría.

El producto no está completamente cerrado como solución funcional de extremo a extremo. Las mayores brechas se concentran en:

1. pantallas todavía marcadas como `EnConstruccion` o placeholders;
2. captura detallada de certificados y evidencia técnica;
3. descarga/renderizado de certificados;
4. auditoría operativa avanzada y exportación desde UI;
5. gestión de adjuntos de solicitudes;
6. enforcement de subcuentas y alcances de clientes;
7. UX offline/PWA y resolución de conflictos;
8. algunas incompatibilidades entre la UI administrativa y las autorizaciones reales del backend.

## 2. Criterio de clasificación

- **Completamente implementada:** existe una ruta usable, el adaptador/API está conectado, la lógica de negocio está protegida y la persistencia necesaria está disponible.
- **Parcial / incompleta:** existe parte significativa del flujo, pero hay campos, estados, permisos, pantallas o integraciones faltantes.
- **No implementada:** existe un placeholder, un botón sin conexión, un endpoint ausente o una operación explícitamente rechazada.
- **Diseñada pero pendiente de integración:** el esquema o backend existe, pero todavía no está expuesto correctamente en la interfaz o no cubre todo el contrato esperado.

## 3. Evidencia técnica global

### Rutas y autorización

`src/proxy.ts` y los layouts protegidos implementan el primer nivel de autorización:

| Rol de negocio | Enum persistido | Rutas principales |
|---|---|---|
| Super Administrador | `super_administrador` | `/superadmin/*`, además de acceso administrativo global |
| Administrador | `administrador_regular` | `/admin/*` excepto funciones exclusivas de superadmin |
| Taller Móvil | `taller_movil` | `/taller/*` |
| Cliente / Empresa | `cliente` | `/portal/*` |

La autorización efectiva no depende solamente del frontend. Las funciones SQL verifican rol, propiedad, asignación de taller, estado de visita y relación con cliente/yacimiento.

### Edge Functions

La capa API no expone una aplicación CRUD directa desde el navegador. El frontend usa `src/lib/services/edge.ts` y `src/lib/api/` para consumir:

- `identity-admin`: cuentas, administradores, talleres, técnicos, personal, catálogos y patrones.
- `asset-access`: clientes, yacimientos, plantas, equipos, válvulas, estructura e historial.
- `service-workflow`: solicitudes, visitas, órdenes, agenda, operaciones, métricas y adjuntos.
- `audit-log`: consulta paginada y filtrada del Registro de auditoría, detalle de eventos y exportación JSON/CSV para Super administrador.
- `certificate-field`: borradores, certificados, firmas, historial y consultas del portal.
- `offline-sync`: working set, reclamo de visita, medios y sincronización idempotente.
- `backup-export`: exportaciones manuales de respaldo.

### Verificaciones ejecutadas

- `npm run typecheck`: **pasa**.
- `npm run lint`: **pasa**.
- `npm test`: **pasa**: 21 archivos y 184 pruebas.
- `npm run build`: **pasa**; se generan 28 rutas.
- `supabase status`: **no ejecutable en este entorno** porque el daemon de Docker no estaba disponible; por ello no se pudieron ejecutar `supabase db lint --local` ni `supabase test db --local`.

La auditoría no modifica código, migraciones ni los cambios locales preexistentes del árbol de trabajo.

---

# 👤 Rol: Super Administrador

## Modelo de acceso

El Super Administrador tiene el nivel de cuenta más alto. Puede acceder a funciones administrativas globales y a `/superadmin/*`. El frontend lo identifica como `superadmin` y lo transforma al enum `super_administrador` mediante la capa de autenticación. Las funciones administrativas aceptan este rol junto con `administrador_regular` cuando la operación es común; las operaciones de cuentas administrativas, exportación de auditoría y backups son exclusivas del superadmin.

## 📍 Ruta Frontend: `/superadmin/administradores`

### ❌ Funcionalidades no implementadas / incompletas

* **Gestión de administradores:**
  * **Frontend:** la ruta renderiza `EnConstruccion`; no existe listado, alta, edición, desactivación ni recuperación de cuentas.
  * **API:** existen contratos y funciones de identidad relacionadas con cuentas, pero no hay flujo de pantalla conectado para administrar administradores desde esta ruta.
  * **Backend:** `identity-admin` y las funciones de cuentas contemplan operaciones administrativas y controles de rol activo; falta completar el caso de uso integral desde la UI.
  * **Base de Datos:** `cuentas` soporta `rol`, `activo` y auditoría de cambios. No falta una tabla principal, pero sí cerrar la política de ciclo de vida y seguridad de cuentas, relacionada también con el issue abierto #10.

* **Invitación, recuperación y seguridad de cuenta:**
  * **Frontend:** no hay UI completa para invitaciones, rotación, bloqueo, recuperación ni gestión de sesiones.
  * **API:** no se observa un contrato de invitación/recuperación administrativa completo dentro del gateway de negocio.
  * **Backend:** la autenticación usa Supabase Auth y `src/lib/auth/server.ts`; las decisiones sensibles no deben depender de `user_metadata` editable.
  * **Base de Datos:** `cuentas` registra la identidad de aplicación, pero el alcance de sesiones, revocación y políticas de expiración sigue siendo una decisión pendiente (#10).

## 📍 Ruta Frontend: `/superadmin/backups`

### ✅ Funcionalidades completamente implementadas

* **Exportación manual de respaldo:**
  * **Frontend:** `ManualBackupPanel` permite seleccionar alcance `complete` o `date_range`, fechas y descargar el archivo generado.
  * **API:** `POST /backups` pertenece a `backup-export`; valida el request y devuelve un ZIP inmediato con metadatos.
  * **Backend:** el flujo verifica rol superadmin, genera manifiesto, checksum, conteos y advertencias/límites. La implementación coincide con ADR-0014 y con los issues cerrados #35, #36, #37 y #38.
  * **Base de Datos:** `registros_generacion_backup` almacena metadatos de ejecución, alcance, resultado y advertencias. No se persiste el archivo como retención permanente.

### ⚠️ Funcionalidades parcialmente implementadas

* **Retención, restauración y cifrado de respaldos:**
  * **Frontend:** no hay listado histórico, botón de restaurar ni configuración de retención.
  * **API:** el endpoint genera y entrega el export bajo demanda; no existe API de restore ni de descarga posterior de archivos retenidos.
  * **Backend:** ADR-0014 define expresamente backup manual inmediato, sin retención ni restore automático y sin cifrado de archivo en esta versión.
  * **Base de Datos:** solo se registra la generación en `registros_generacion_backup`; no existe repositorio de archivos de backup ni historial recuperable.

## 📍 Ruta Frontend: `/admin/auditoria`

### ✅ Funcionalidades implementadas

* **Consulta global de auditoría:**
  * **Frontend:** `AuditLog` presenta recepción del servidor, actor, acción, objetivo y resultado; permite filtrar por fechas, actor, acción, entidad, resultado, Cliente, Yacimiento, Visita y Certificado, paginar y expandir el detalle.
  * **API:** `audit-log` expone la consulta paginada, detalle de evento y exportación JSON/CSV para Super administrador.
  * **Backend:** `registros_auditoria` es append-only y los triggers registran operaciones sobre solicitudes, órdenes, certificados, cuentas, talleres, personas, catálogos, patrones, transiciones de visita y operaciones sensibles rechazadas.
  * **Base de Datos:** `api_audit_events` aplica alcance por rol y filtros; `api_audit_event` aplica autorización al detalle; `api_audit_export` restringe exportación al Super administrador.

* **Exportación de auditoría:**
  * **Frontend:** los controles JSON/CSV aparecen solo para Super administrador y conservan los filtros activos.
  * **API:** `audit-log` delega a `api_audit_export`, que limita la operación al Super administrador.
  * **Backend:** se valida el rol privilegiado y se arma una exportación con los eventos disponibles.
  * **Base de Datos:** utiliza `registros_auditoria`; también registra quién exportó y qué filtros aplicó.

## 📍 Rutas `/admin/*` compartidas con Administrador

### ✅ Acceso heredado

* **Acceso administrativo global:**
  * **Frontend:** el Super Administrador puede entrar a las rutas administrativas comunes protegidas para `superadmin` y `admin`.
  * **API:** los handlers de `identity-admin`, `asset-access` y `service-workflow` admiten el rol equivalente de administrador.
  * **Backend:** las funciones SQL usan helpers como `api_require_admin()` y diferencian el superadmin cuando la operación es exclusiva.
  * **Base de Datos:** el rol `super_administrador` mantiene privilegios globales sobre clientes, yacimientos, operaciones, certificados y configuración.

---

# 👤 Rol: Administrador

## Modelo de acceso

El Administrador regular tiene acceso operacional global: clientes, activos, agenda, talleres, solicitudes, visitas, órdenes, certificados, catálogos y auditoría. El frontend lo identifica como `admin`, que se mapea a `administrador_regular`. Comparte gran parte del gateway con el superadmin, pero no debe administrar cuentas de administradores ni backups exclusivos.

## 📍 Ruta Frontend: `/admin`

### ⚠️ Funcionalidades parcialmente implementadas

* **Dashboard y métricas:**
  * **Frontend:** `AdminDashboard` está integrado, muestra cinco tarjetas y permite introducir fechas.
  * **API:** `GET /dashboard/metrics` se resuelve mediante `service-workflow`.
  * **Backend:** existe lógica de métricas operacionales y autorización administrativa; todavía hay diferencias de semántica en rangos de fechas y el trabajo está identificado en el issue abierto #42.
  * **Base de Datos:** las métricas consultan solicitudes, visitas, órdenes y certificados; no se requiere una tabla de métricas dedicada.

## 📍 Ruta Frontend: `/admin/clientes`

### ✅ Funcionalidades completamente implementadas

* **Listado y mantenimiento de clientes:**
  * **Frontend:** `ClientesList`, formularios de creación/edición y detalle consumen `src/lib/api/admin.ts`.
  * **API:** `asset-access` expone operaciones de clientes y el contrato valida respuestas en los adaptadores.
  * **Backend:** se valida rol administrativo, unicidad y estado activo; la lógica permite gestionar información empresarial y logo.
  * **Base de Datos:** `clientes` contiene identidad empresarial, datos de contacto, estado activo, `logo_bucket` y `logo_path`; la auditoría registra cambios.

* **Usuarios y alcances de un cliente:**
  * **Frontend:** `/admin/clientes/[id]/usuarios` usa `UsuariosCliente` para crear, editar, desactivar cuentas y asignar scopes.
  * **API:** las operaciones pertenecen a `identity-admin` y exponen CRUD de cuentas de cliente y sus accesos.
  * **Backend:** existe validación administrativa para administrar `cliente_cuentas` y `cliente_accesos`.
  * **Base de Datos:** las migraciones agregan `cliente_cuentas` y `cliente_accesos`, relacionadas con `clientes`, `cuentas`, yacimientos y posiblemente plantas/equipos según el scope.

### ⚠️ Funcionalidades parcialmente implementadas

* **Enforcement efectivo de subcuentas y scopes:**
  * **Frontend:** la UI permite seleccionar scopes, pero esto no garantiza por sí solo que las consultas posteriores queden restringidas.
  * **API:** los endpoints reciben la identidad autenticada y consultan por cliente/yacimiento.
  * **Backend:** `can_access_yacimiento()` concede a un cliente acceso cuando `y.cliente_cuenta_id = auth.uid()`, pero no incorpora claramente `cliente_cuentas`/`cliente_accesos`. Por ello la administración de scopes puede no tener efecto real en el acceso operativo.
  * **Base de Datos:** las tablas de subcuentas y accesos existen, pero falta alinear funciones de autorización, políticas y pruebas con el modelo de múltiples cuentas. Además, `CONTEXT.md` todavía describe al Cliente como una cuenta exacta, por lo que hay una decisión de dominio pendiente.

* **Logo empresarial:**
  * **Frontend:** existe uploader y almacenamiento del logo desde administración.
  * **API:** hay soporte de Storage y referencias `logo_bucket`/`logo_path`.
  * **Backend:** se generan referencias o URLs firmadas según el flujo.
  * **Base de Datos:** los campos de logo existen; en `toEmpresa` de `src/lib/api/admin.ts` se omite `logoUrl: dto.logo_url`, por lo que el dato puede persistir pero no reflejarse correctamente en el modelo de UI.

## 📍 Ruta Frontend: `/admin/clientes/[id]/estructura`

### ✅ Funcionalidades completamente implementadas

* **Consulta y edición básica de estructura:**
  * **Frontend:** `EstructuraEditor`, `NodoDetalle`, `ValvulaFicha` y sus diálogos permiten navegar cliente → yacimiento → planta/localización → equipo → válvula.
  * **API:** `asset-access` expone consultas y actualizaciones de nodos, válvulas e historial.
  * **Backend:** se aplican accesos administrativos, relaciones padre-hijo y controles de consistencia.
  * **Base de Datos:** participan `yacimientos`, `plantas_locaciones`, `equipos_unidades`, `valvulas`, `historial_relaciones` y `valvula_revisiones`.

* **Historial de válvulas y revisiones:**
  * **Frontend:** `ValvulaFicha` puede consultar la ficha y revisiones.
  * **API:** el acceso de historial está disponible por `asset-access`.
  * **Backend:** `valvula_revisiones` es append-only para conservar trazabilidad.
  * **Base de Datos:** el modelo separa el estado vigente de las revisiones históricas, compatible con ADR-0003.

### ⚠️ Funcionalidades parcialmente implementadas

* **Datos técnicos completos de válvula:**
  * **Frontend:** se capturan o muestran campos como `precinto`, `servicio`, `pv`, `presionOperacion`, `temperaturaOperacion`, `notas` y `descripcion`.
  * **API:** `toValveUpdateInput` en `src/lib/api/admin.ts` solo envía un subconjunto; los campos visibles no tienen un contrato completo de ida y vuelta.
  * **Backend:** las funciones de actualización no reciben o persisten todos los campos que la UI presenta. `Contratista` queda forzado a “No informado”.
  * **Base de Datos:** faltan columnas, parámetros o migración coherente para todo el modelo técnico. La información presentada por la UI puede perderse.

* **Eliminación de nodos:**
  * **Frontend:** los controles de eliminación están deshabilitados o no disponibles.
  * **API:** no existe un endpoint de delete general para yacimientos y descendientes.
  * **Backend:** la arquitectura evita eliminación destructiva sin una política de ciclo de vida definida.
  * **Base de Datos:** no hay estrategia completa de soft delete/cascada para la jerarquía; la capacidad está explícitamente marcada como no disponible en `integration.md`.

## 📍 Ruta Frontend: `/admin/clientes/[id]/usuarios`

### ⚠️ Funcionalidades parcialmente implementadas

* **Administración de usuarios del cliente:**
  * **Frontend:** `UsuariosCliente` está conectado a formularios y operaciones CRUD.
  * **API:** `identity-admin` recibe altas, actualizaciones, activación y scopes.
  * **Backend:** se protege con `api_require_admin()` y verifica relación con el cliente.
  * **Base de Datos:** usa `cuentas`, `cliente_cuentas` y `cliente_accesos`; falta que `can_access_yacimiento()` y consultas equivalentes utilicen esos registros consistentemente.

## 📍 Ruta Frontend: `/admin/talleres`

### ✅ Funcionalidades completamente implementadas

* **Mantenimiento de talleres móviles:**
  * **Frontend:** `TalleresAdmin` y `TalleresPanel` permiten listar, crear y editar talleres.
  * **API:** `identity-admin` expone operaciones de talleres.
  * **Backend:** se validan rol administrativo, estado y datos básicos del taller.
  * **Base de Datos:** `talleres_moviles` y `taller_cuentas` almacenan la unidad operativa y sus cuentas relacionadas.

* **Mantenimiento de personal y técnicos:**
  * **Frontend:** `PersonalPanel` administra personas y jornadas.
  * **API:** las operaciones están conectadas a `identity-admin`.
  * **Backend:** se controlan datos básicos, disponibilidad y relaciones operativas.
  * **Base de Datos:** `personas` y `nominas_jornada` persisten identidad y jornada.

### ⚠️ Funcionalidades parcialmente implementadas

* **Membresía formal de técnico en taller:**
  * **Frontend:** el personal se administra, pero la UX no completa una relación explícita técnico-taller para todos los casos.
  * **API:** existen comprobaciones de pertenencia en operaciones de firma y trabajo.
  * **Backend:** la firma del técnico debe pertenecer al taller asignado; la implementación endurecida valida esa condición.
  * **Base de Datos:** la relación operativa existe de forma indirecta mediante cuentas/asignaciones, pero debe verificarse que el modelo cubra todas las membresías y bajas sin ambigüedad.

## 📍 Ruta Frontend: `/admin/catalogos`

### ✅ Funcionalidades completamente implementadas

* **Catálogos y patrones de ensayo:**
  * **Frontend:** `CatalogosAdmin`, `ListasEditor` y `PatronesEditor` permiten administrar opciones y patrones.
  * **API:** `identity-admin` ofrece CRUD y reordenamiento.
  * **Backend:** las operaciones están protegidas para administradores y se auditan.
  * **Base de Datos:** `catalogo_opciones` y `patrones_ensayo` almacenan valores versionables y ordenables.

### ⚠️ Funcionalidades con decisión de producto pendiente

* **Catálogo de repuestos en runtime:**
  * **Frontend:** no existe una gestión operacional completa del catálogo de repuestos.
  * **API:** no hay un endpoint definitivo de mantenimiento de repuestos como catálogo obligatorio.
  * **Backend:** ADR-0012 define que los repuestos se capturan/versionan dentro del contexto de ejecución, sin catálogo runtime en el MVP.
  * **Base de Datos:** el certificado conserva datos de mantenimiento/repuestos, pero no existe un catálogo normalizado que deba administrarse desde esta pantalla.

## 📍 Ruta Frontend: `/admin/agenda`

### ✅ Funcionalidades completamente implementadas

* **Agenda y consulta de operaciones:**
  * **Frontend:** `Agenda` consulta `GET /operations`, muestra calendario y filtros.
  * **API:** `service-workflow` expone operaciones de solicitudes, visitas, órdenes y estados.
  * **Backend:** los datos se filtran según estado, fecha y acceso administrativo.
  * **Base de Datos:** consulta `solicitudes_servicio`, `visitas_servicio`, `asignaciones_servicio` y `ordenes_trabajo`.

### ⚠️ Funcionalidades parcialmente implementadas

* **Conversión de tarea legacy a operación formal:**
  * **Frontend:** algunos registros heredados tipo `Tarea` rellenan planta/equipo con valores vacíos o “—”.
  * **API:** `src/lib/services/edge.ts` conserva un seam de compatibilidad para tareas antiguas.
  * **Backend:** el flujo moderno usa solicitud → visita → orden; la ruta legacy no representa toda la estructura.
  * **Base de Datos:** faltan datos relacionales cuando la tarea histórica no tiene yacimiento/equipo completo.

## 📍 Ruta Frontend: `/admin/cronograma`

### ⚠️ Funcionalidades parcialmente implementadas

* **Programación y reasignación de visitas:**
  * **Frontend:** `Cronograma` permite drag/drop, agenda y asignación de taller.
  * **API:** `service-workflow` expone programación y reasignación.
  * **Backend:** `api_schedule_visit()` restringe la programación a administradores; las visitas conservan estado y taller asignado.
  * **Base de Datos:** `visitas_servicio`, `asignaciones_servicio` y los estados de solicitud soportan el flujo.

* **Desasignación de visita:**
  * **Frontend:** la UI intenta representar “Sin asignar”.
  * **API:** `reasignarVisita` rechaza `undefined`, por lo que la desasignación no está correctamente soportada.
  * **Backend:** no se debe asumir que quitar el taller equivale a una reasignación válida sin validar estado y trazabilidad.
  * **Base de Datos:** `asignaciones_servicio` puede conservar historial, pero falta un contrato explícito para quitar la asignación activa.

## 📍 Ruta Frontend: `/admin/tareas`

### ✅ Funcionalidades completamente implementadas

* **Listado y seguimiento de solicitudes/visitas:**
  * **Frontend:** la ruta lista y filtra tareas/operaciones y enlaza al detalle.
  * **API:** `service-workflow` expone solicitudes, agenda, visitas y órdenes.
  * **Backend:** se aplican transiciones de negocio definidas en ADR-0007 y ADR-0008.
  * **Base de Datos:** `solicitudes_servicio`, `visitas_servicio`, `asignaciones_servicio` y `ordenes_trabajo` forman el núcleo operativo.

### ⚠️ Funcionalidades parcialmente implementadas

* **Crear solicitud desde `/admin/tareas/nueva`:**
  * **Frontend:** `TareaForm` captura contacto, teléfono, tipo, detalle, condiciones, PD, RTO y adjuntos; luego `guardarSolicitudYVisita()` solo envía yacimiento, selección de equipo y programación.
  * **API:** el contrato de creación acepta la solicitud/visita, pero no recibe todos los campos visuales del formulario.
  * **Backend:** se crean solicitud y visita, pero los campos extra del formulario pueden ignorarse.
  * **Base de Datos:** existen tablas para la solicitud y visita, pero no hay relación persistida completa para adjuntos de la solicitud.

* **Adjuntos de solicitud:**
  * **Frontend:** el control está presente, pero `subirAdjunto()` lanza explícitamente “Los adjuntos de solicitudes no están disponibles…”.
  * **API:** existe `POST /attachments` en `service-workflow` para otros casos, pero no hay flujo completo de adjunto de solicitud.
  * **Backend:** no existe el caso de negocio completo que conecte el archivo, el autor y la solicitud.
  * **Base de Datos:** no hay una tabla/relación definitiva para adjuntos de solicitudes; Storage no sustituye el vínculo de dominio.

* **Cancelación administrativa:**
  * **Frontend:** el detalle administrativo ofrece acción de cancelar.
  * **API:** la llamada usa el endpoint de cancelación disponible.
  * **Backend:** `api_cancel_visit()` solo permite al Cliente propietario cancelar antes del día de ejecución; el Administrador no está autorizado en esa función.
  * **Base de Datos:** el estado puede ser persistido, pero la matriz de permisos y el botón no están alineados. El issue #39 también identifica la necesidad de auditar transiciones de visita.

* **Campos específicos de solicitud/visita:**
  * **Frontend:** el formulario incluye más información de negocio que la que efectivamente se envía.
  * **API:** el request está incompleto respecto de la UI.
  * **Backend:** no todos los datos se validan ni se propagan a visita/orden.
  * **Base de Datos:** las tablas principales existen, pero hay pérdida de información funcional entre formulario y persistencia.

## 📍 Ruta Frontend: `/admin/tareas/[id]`

### ✅ Funcionalidades completamente implementadas

* **Detalle operativo, orden y resultado básico:**
  * **Frontend:** el detalle permite consultar estado, visita, equipos, orden de trabajo y resultado.
  * **API:** usa operaciones de `service-workflow` y `certificate-field`.
  * **Backend:** `api_add_work_order()` exige taller asignado, visita `en_curso`, mismo cliente y acceso activo; también aplica exclusión de equipo en visitas simultáneas.
  * **Base de Datos:** participan `ordenes_trabajo`, `visitas_servicio`, `visita_equipos`, `equipos_unidades` y certificados.

### ⚠️ Funcionalidades parcialmente implementadas

* **Editor de certificado desde administración:**
  * **Frontend:** el editor funciona principalmente como JSON opaco; no existe formulario completo de campos técnicos, mantenimiento, repuestos, mediciones y evidencias.
  * **API:** `certificate-field` soporta borrador, lectura y finalización según estado.
  * **Backend:** se respetan borrador, pendiente y finalizado; un certificado finalizado es inmutable y requiere una corrección como nuevo certificado según ADR-0005.
  * **Base de Datos:** `certificados` contiene `datos_tecnicos`, `instantanea`, `estado_captura`, `estado`, `finalized_at`, `vigencia_hasta`, reemplazos y evidencia, pero la UI no cubre todos los campos.

## 📍 Ruta Frontend: `/admin/certificados`

### ⚠️ Funcionalidades parcialmente implementadas

* **Historial de certificados:**
  * **Frontend:** `CertificateHistory` permite búsqueda simple por texto.
  * **API:** `certificate-field` devuelve certificados pendientes y finalizados, con historial por válvula.
  * **Backend:** la lógica distingue borrador, pendiente y finalizado; el número global se asigna al finalizar mediante `contador_certificados`.
  * **Base de Datos:** `certificados`, `valvula_revisiones`, `contador_certificados` y relaciones de imágenes soportan el historial.

* **Detalle de certificado:**
  * **Frontend:** `/admin/certificados/[id]` muestra JSON crudo, conteo de historial y eventos relacionados; no hay renderer documental equivalente al formato del certificado.
  * **API:** existe `GET /admin/certificates/:id/download` mediante `api_admin_certificate_export`, pero el adaptador administrativo solo consume lectura/listado y no conecta la descarga.
  * **Backend:** el export administrativo existe y puede devolver el documento/JSON requerido.
  * **Base de Datos:** la instantánea final e imágenes están persistidas; el problema es principalmente de integración y presentación.

* **Descarga de certificado:**
  * **Frontend:** falta botón/flujo funcional de descarga.
  * **API:** endpoint disponible, pero no integrado en `src/lib/api/admin.ts`.
  * **Backend:** exportación existente.
  * **Base de Datos:** no falta una entidad adicional; se usa el certificado final y sus referencias.

## 📍 Ruta Frontend: `/admin/configuracion/certificado`

### ❌ Funcionalidades no implementadas / incompletas

* **Configuración de plantilla y campos de certificado:**
  * **Frontend:** la ruta renderiza `EnConstruccion`.
  * **API:** no hay flujo de configuración conectado desde esta pantalla.
  * **Backend:** la configuración de certificado todavía no es un caso de uso completo del gateway.
  * **Base de Datos:** existen catálogos y patrones, pero no una configuración de plantilla/versionado completamente operable desde UI.

## 📍 Ruta Frontend: `/admin/backups`

### ✅/❌ Acceso controlado

* **Restricción de backups:**
  * **Frontend:** la ruta comprueba superadmin y redirige a `/superadmin/backups`; un administrador regular no debe acceder.
  * **API:** `backup-export` mantiene la protección exclusiva de superadmin.
  * **Backend:** el rol administrativo regular no satisface la autorización.
  * **Base de Datos:** `registros_generacion_backup` solo registra ejecuciones autorizadas.

---

# 👤 Rol: Taller Móvil

## Modelo de acceso

El Taller Móvil representa la unidad de trabajo de campo. Puede ver y ejecutar visitas asignadas a su taller, crear órdenes sobre equipos autorizados, completar el trabajo, firmar como técnico y sincronizar información offline. No tiene acceso global a clientes ni a administración.

## 📍 Ruta Frontend: `/taller`

### ✅ Funcionalidades completamente implementadas

* **Consulta de visitas asignadas:**
  * **Frontend:** `VisitasPanel` consulta las visitas del taller autenticado y ofrece estados básicos de trabajo.
  * **API:** `service-workflow` entrega visitas/operaciones filtradas por el taller y `offline-sync` entrega el working set.
  * **Backend:** se comprueba asignación de taller, cuenta activa y alcance sobre cliente/yacimiento.
  * **Base de Datos:** `visitas_servicio`, `asignaciones_servicio`, `talleres_moviles`, `taller_cuentas` y relaciones de cliente/yacimiento sostienen el acceso.

* **Órdenes de trabajo de equipos:**
  * **Frontend:** la UI permite trabajar sobre equipos asociados y registrar resultados.
  * **API:** `api_add_work_order()` y los adaptadores de operaciones exponen alta/actualización.
  * **Backend:** solo el taller asignado puede crear órdenes; la visita debe estar `en_curso`, el equipo debe pertenecer al mismo cliente y se bloquean visitas simultáneas incompatibles.
  * **Base de Datos:** `ordenes_trabajo`, `visita_equipos`, `equipos_unidades` y estados de visita implementan la regla de exclusividad de ADR-0008.

* **Captura de firma técnica:**
  * **Frontend:** `VisitasPanel` permite capturar firma del técnico y completar local/online.
  * **API:** `certificate-field` recibe la firma; `offline-sync` puede transportar la operación y el medio.
  * **Backend:** se valida que el firmante sea técnico del taller asignado; la firma técnica es requisito para completar la visita.
  * **Base de Datos:** `firmas_visita` registra tipo de firma, identidad y referencia del archivo; Storage usa `certificate-signatures`.

* **Sincronización offline básica:**
  * **Frontend:** `src/lib/offline/sync.ts` usa IndexedDB y el coordinador offline; se pueden guardar operaciones, resultados, firmas y fotos localmente.
  * **API:** `offline-sync` implementa working set, claim, media upload y sincronización idempotente.
  * **Backend:** `operaciones_sync`, `conflictos_sync`, acknowledgements y claves idempotentes permiten reintentos y detección de conflictos.
  * **Base de Datos:** `dispositivos_visita`, `operaciones_sync`, `conflictos_sync`, `visitas_sync_ack` y `sync_version` soportan el protocolo de ADR-0009.

### ⚠️ Funcionalidades parcialmente implementadas

* **Flujo completo de estados de visita:**
  * **Frontend:** no existen rutas completas para `/taller/tareas/[id]`, ni controles terminados de aceptar/rechazar/iniciar; la UI se concentra en el panel.
  * **API:** existen endpoints para asignación, transición y rechazo.
  * **Backend:** el rechazo del taller devuelve la visita a estado `programada` y elimina el taller asignado; las transiciones relevantes tienen validaciones, pero el issue #39 mantiene pendiente una auditoría operacional completa.
  * **Base de Datos:** `visitas_servicio` y triggers soportan estados, pero deben mantenerse alineados con todos los estados mostrados en UI.

* **Certificado de campo completo:**
  * **Frontend:** faltan las rutas previstas `/taller/certificados/nuevo` y `/taller/certificados/[localId]`; el editor actual no cubre todos los campos técnicos.
  * **API:** `api_start_certificate_draft`, `certificate-field` y finalización están disponibles.
  * **Backend:** solo se puede iniciar borrador con orden evaluada y visita `en_curso`; completar cierra borradores a `pendiente`, y la firma del cliente permite finalizar.
  * **Base de Datos:** `certificados` soporta borrador/pendiente/finalizado, snapshot, vigencia y reemplazo, pero la captura de datos no está completamente expuesta al técnico.

* **Carga de fotos/evidencias:**
  * **Frontend:** existe captura local de fotos, pero algunas operaciones offline se crean sin `certificate_id` local y pueden quedar sin asociación correcta.
  * **API:** `offline-sync` y Storage permiten transportar medios; el contrato de `service-workflow` también tiene soporte de attachments en otros escenarios.
  * **Backend:** el backend distingue referencia de medio y asociación de certificado, pero no todos los flujos garantizan que una foto quede vinculada al certificado correcto.
  * **Base de Datos:** `imagenes_certificado` y `certificado_imagenes` existen; buckets `attachments` y `certificate-evidence` existen, pero la asociación offline requiere endurecimiento.

* **PWA y operación sin conexión real:**
  * **Frontend:** hay IndexedDB, pero no se encontró manifest/service worker completo ni una experiencia PWA instalada.
  * **API:** la sincronización existe y es idempotente.
  * **Backend:** el protocolo contempla conflictos y reintentos.
  * **Base de Datos:** las tablas de sync existen; la limitación es principalmente de shell PWA, coordinación de medios y UX.

## 📍 Ruta Frontend: `/taller/sincronizacion`

### ✅ Funcionalidades completamente implementadas

* **Visibilidad de sincronización:**
  * **Frontend:** `SincronizacionPanel` muestra pendientes, fallos, conflictos y permite reintentar.
  * **API:** `offline-sync` expone estado y reintentos.
  * **Backend:** procesa operaciones idempotentes, registra errores y evita duplicados.
  * **Base de Datos:** `operaciones_sync`, `conflictos_sync`, `sync_version` y acknowledgements conservan el estado.

### ⚠️ Funcionalidades parcialmente implementadas

* **Resolución de conflictos:**
  * **Frontend:** el taller puede observar/reintentar, pero no dispone de una herramienta rica para resolver conflictos campo por campo.
  * **API:** el backend detecta y expone conflictos.
  * **Backend:** la resolución sigue reglas de idempotencia/versión; no hay workflow administrativo completo para decisiones manuales.
  * **Base de Datos:** `conflictos_sync` guarda el conflicto, pero no existe una entidad de resolución/auditoría de decisión suficientemente completa.

* **Consistencia entre paneles de sync:**
  * **Frontend:** un coordinador de la pantalla de sincronización omite el mapeo `visit_acknowledgement`, aunque el panel principal sí lo maneja.
  * **API:** el tipo de operación existe.
  * **Backend:** puede procesar acknowledgement.
  * **Base de Datos:** `visitas_sync_ack` soporta el registro, pero la UI secundaria no lo representa completamente.

## 📍 Rutas planificadas no materializadas: `/taller/tareas/[id]`, `/taller/certificados/nuevo`, `/taller/certificados/[localId]`

### ❌ Funcionalidades no implementadas / incompletas

Estas rutas aparecen en el plan de integración, pero no están entregadas como pantallas completas. El backend tiene piezas reutilizables, por lo que el faltante principal es la experiencia y la integración de captura.

---

# 👤 Rol: Cliente / Empresa

## Modelo de acceso

El Cliente representa la empresa dueña de los activos y solicitante del servicio. El frontend lo identifica como `cliente` y lo protege mediante `/portal/*`. El acceso de datos debe limitarse al cliente propietario, sus yacimientos y, si se mantiene el modelo de subcuentas, a los scopes explícitamente asignados.

## 📍 Ruta Frontend: `/portal`

### ❌ Funcionalidades no implementadas / incompletas

* **Dashboard del cliente:**
  * **Frontend:** la pantalla es un placeholder/calendario básico; no presenta un dashboard operativo completo de solicitudes, visitas, certificados vigentes y vencidos.
  * **API:** existen endpoints de operaciones y certificados, pero no existe un endpoint de dashboard de cliente integrado.
  * **Backend:** `can_access_yacimiento()` aplica la propiedad de cliente y taller; falta una capa completa de agregación para el portal.
  * **Base de Datos:** las entidades requeridas existen, pero no hay una vista/consulta consolidada de portal.

## 📍 Ruta Frontend: `/portal/turnos`

### ❌ Funcionalidades no implementadas / incompletas

* **Turnos y visitas del cliente:**
  * **Frontend:** la pantalla es un placeholder; no hay calendario funcional, detalle de turno, solicitud de cambio o cancelación coherente.
  * **API:** existen operaciones de visitas y cancelación, pero no un contrato de portal completo conectado a esta ruta.
  * **Backend:** `api_cancel_visit()` permite cancelar al cliente propietario antes del día de ejecución; el resto de transiciones es administrativo/taller.
  * **Base de Datos:** `solicitudes_servicio`, `visitas_servicio` y `asignaciones_servicio` soportan la información.

## 📍 Ruta Frontend: `/portal/certificados`

### ✅ Funcionalidades completamente implementadas

* **Listado de certificados y pendientes de firma:**
  * **Frontend:** `CertificadosPortal` y `FirmaPendientePanel` consultan el árbol de activos, certificados pendientes e historial.
  * **API:** `certificate-field` expone pendientes, certificados finalizados e historial por válvula.
  * **Backend:** solo se devuelven certificados relacionados con el cliente autorizado; una firma de cliente elegible puede disparar finalización.
  * **Base de Datos:** `certificados`, `firmas_visita`, `valvula_revisiones`, `contador_certificados` y snapshots soportan el flujo.

* **Firma del cliente:**
  * **Frontend:** el cliente puede cargar una imagen de firma desde el panel pendiente.
  * **API:** la firma se envía a `certificate-field`; Storage utiliza `certificate-signatures`.
  * **Backend:** `api_submit_visit_signature()` valida que el cliente sea el propietario de la visita/certificado; la segunda firma habilita `api_finalize_visit_certificates`.
  * **Base de Datos:** `firmas_visita` conserva ambas firmas y `certificados` se actualiza a finalizado con número global, snapshot y vigencia.

* **Historial de certificado por válvula:**
  * **Frontend:** el portal puede mostrar la lista histórica devuelta por la API.
  * **API:** `api_valvula_certificates()` devuelve pendientes y certificados finalizados, marcando el actual.
  * **Backend:** el historial se conserva y no se sobrescribe el certificado finalizado.
  * **Base de Datos:** `certificados` y `valvula_revisiones` implementan el historial inmutable.

### ⚠️ Funcionalidades parcialmente implementadas

* **Descarga y detalle documental:**
  * **Frontend:** no hay búsqueda/filtros completos, vista detallada rica, descarga, renderer de PDF ni visualización integral de fotos/evidencias.
  * **API:** `api_finalized_certificate()` devuelve referencias de Storage sin resolver necesariamente URLs firmadas para todos los medios.
  * **Backend:** la finalización y los datos inmutables están implementados, pero el contrato de entrega de medios no está cerrado.
  * **Base de Datos:** `imagenes_certificado`, `certificado_imagenes` y buckets existen; faltan resolver de manera homogénea las referencias para consumo web.

* **Vigencia y certificados históricos:**
  * **Frontend:** el portal muestra historiales y estados; puede mostrar certificados expirados junto con el resto.
  * **API:** `api_valvula_certificates()` devuelve historial completo y marca el actual.
  * **Backend:** `vigencia_hasta` se calcula a un año calendario; ADR-0011 define que no hay notificaciones de vencimiento.
  * **Base de Datos:** `vigencia_hasta`, `finalized_at` y reemplazos están persistidos. La política de ocultar o destacar expirados en la UI necesita definición final.

* **Escalabilidad del portal:**
  * **Frontend:** el componente realiza múltiples consultas para árbol/historial y puede degradar con muchos activos.
  * **API:** los endpoints funcionales existen, pero falta un agregado de portal optimizado.
  * **Backend:** las consultas respetan acceso, aunque convendría consolidar lectura de certificados y activos.
  * **Base de Datos:** las tablas y relaciones están normalizadas; deben revisarse índices y consultas una vez disponible el entorno local de Supabase.

## 📍 Ruta Frontend: `/portal/empresa`

### ❌ Funcionalidades no implementadas / incompletas

* **Perfil y configuración de empresa:**
  * **Frontend:** la ruta es un placeholder; no permite editar datos empresariales, contactos o logo.
  * **API:** no existe un flujo de autoservicio de perfil de cliente conectado a la ruta.
  * **Backend:** `asset-access` y las funciones de administración permiten que un admin gestione clientes, pero el cliente no tiene una API equivalente de autoservicio claramente cerrada.
  * **Base de Datos:** `clientes` ya contiene datos de empresa, estado y logo; falta exponerlos con autorización de propietario y auditoría adecuada.

* **Gestión de subusuarios desde el portal:**
  * **Frontend:** no existe pantalla para invitar o administrar usuarios del cliente.
  * **API:** el CRUD existe principalmente bajo `identity-admin` para administración interna.
  * **Backend:** falta definir si el cliente principal puede administrar subcuentas y con qué restricciones.
  * **Base de Datos:** `cliente_cuentas` y `cliente_accesos` permiten el modelo, pero el dominio base aún habla de un único login.

---

# 4. Matriz resumida por rol

| Rol | Operación principal | Estado global | Brechas críticas |
|---|---|---|---|
| Super Administrador | Gobierno de cuentas, auditoría global y backups | Parcialmente operativo | Gestión de administradores en construcción; auditoría/export UI incompleta; decisiones de seguridad de cuenta |
| Administrador | Gestión de clientes, activos, agenda, talleres, operaciones y certificados | Operativo con brechas de integración | Dashboard, certificados, adjuntos, campos técnicos, cancelación, desasignación y configuración |
| Taller Móvil | Ejecución de visitas, órdenes, firmas y sync offline | Núcleo operativo usable | Captura completa de certificado, PWA, medios offline, estados UX y resolución de conflictos |
| Cliente / Empresa | Consulta y firma de certificados | Firma e historial funcionales | Dashboard, turnos, perfil, descarga/documentos, medios y scopes efectivos |

# 5. Hallazgos transversales prioritarios

## P0 — Seguridad y consistencia de autorización

1. Alinear `cliente_cuentas`/`cliente_accesos` con `can_access_yacimiento()` y consultas equivalentes. Actualmente existe riesgo de que el scope configurado por un administrador no restrinja efectivamente todas las lecturas.
2. Corregir la discrepancia entre la cancelación visible para el administrador y `api_cancel_visit()`, que solo autoriza al cliente propietario.
3. Mantener la autorización final en Edge Functions/SQL, no solo en `src/proxy.ts` o layouts.
4. Completar la política de cuentas, invitaciones, revocación de sesiones y recuperación (#10).

## P1 — Integridad de datos

1. Definir el contrato final de datos técnicos de válvula y agregar los campos que la UI ya captura (`precinto`, `servicio`, `pv`, presiones, temperatura, notas y descripción) o eliminarlos de la UI.
2. Evitar que `TareaForm` presente datos que `guardarSolicitudYVisita()` descarta.
3. Crear una relación formal para adjuntos de solicitudes.
4. Asegurar asociación de fotos offline a un certificado/local id antes de permitir sincronización final.

## P1 — Cierre del flujo de certificados

1. Implementar las rutas de captura previstas para Taller Móvil.
2. Reemplazar el editor JSON por un formulario de dominio con validación.
3. Conectar descarga/exportación administrativa y del portal.
4. Definir resolver de URLs firmadas para firmas, fotos y evidencias.
5. Definir cómo se presenta el historial y la vigencia de certificados.

## P2 — Operabilidad y UX

1. Completar `/admin/dashboard`, `/admin/configuracion/certificado`, `/superadmin/administradores`, `/portal`, `/portal/turnos` y `/portal/empresa`.
2. Completar filtros y exportaciones de auditoría; incorporar el issue #40.
3. Implementar el modelo de auditoría de transiciones de visita del issue #39.
4. Añadir resolución administrativa de conflictos offline.
5. Corregir el flujo de desasignación del cronograma.
6. Ejecutar `supabase db lint --local` y `supabase test db --local` cuando Docker/Supabase local esté disponible.

# 6. Conclusión

La base técnica es consistente y el camino operativo principal está implementado hasta la firma y finalización de certificados. El sistema puede considerarse **operativo para un MVP controlado**, especialmente en administración de activos, planificación, ejecución de visitas, firmas y backups manuales.

No debe considerarse todavía una entrega funcional completa para producción multi-cliente sin resolver: enforcement de scopes, captura técnica completa, adjuntos, descarga de certificados, UX de cliente, experiencia PWA/offline y auditoría avanzada. La diferencia entre el estado del backend y el de las interfaces es el principal factor de riesgo: varias capacidades ya existen en PostgreSQL/Edge Functions, pero todavía no están expuestas de forma íntegra y coherente en las rutas Frontend.
