# Plan de implementación — Front end

**Proyecto:** System Solutions · Sistema de gestión de calibración de válvulas de seguridad
**Base documental:** DRF v1.1 (Magne Studios) · Certificado modelo SYS (con anotaciones) · Referencias de listas desplegables
**Alcance de este plan:** solo interfaces. No hay base de datos ni backend todavía: todo funciona contra datos simulados (mocks) detrás de una capa de servicios que después se reemplaza por Supabase + Edge Functions sin tocar las pantallas.

---

## 1. Stack

| Capa | Elección | Motivo |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Definido en el DRF. Una sola app para admin, portal cliente y campo. |
| Estilos | **Tailwind CSS** + **shadcn/ui** | Definido en el DRF. shadcn da tablas, diálogos, formularios y calendario accesibles y editables en el repo. |
| Formularios | **React Hook Form + Zod** | Los esquemas Zod se reutilizan para validar en Edge Functions (Deno) más adelante. |
| Datos en cliente | **TanStack Query** | Misma API para mocks hoy y Supabase mañana; cache y reintentos. |
| Offline (campo) | **Serwist** (service worker / PWA) + **Dexie** (IndexedDB) | Carga de certificados sin conexión y cola de sincronización. |
| Firma | **signature_pad** | Captura de firma en tablet (técnico y cliente). |
| Fechas | **date-fns** con locale `es` | Calendarios, vigencias, ventana de 24 h. |
| Íconos | **lucide-react** | Viene con shadcn. |
| Backend futuro | **Supabase** (Postgres + Auth + Storage + RLS) y **Edge Functions** | Se conecta en una etapa posterior (ver §8). |

Convención de nombres: entidades de dominio en español, tal como el DRF (`Tarea`, `Certificado`, `Yacimiento`, `Valvula`…); código técnico (hooks, utils, componentes genéricos) en inglés.

---

## 2. Principio de arquitectura: capa de servicios intercambiable

Las pantallas **nunca** leen mocks ni Supabase directamente. Todo pasa por interfaces de repositorio:

```
src/
  lib/
    domain/          # Tipos TS + esquemas Zod (fuente única del modelo)
    services/
      contracts/     # Interfaces: ClientesRepo, TareasRepo, CertificadosRepo, AuthService…
      mock/          # Implementación con datos semilla (persistidos en localStorage)
      supabase/      # (vacío por ahora) implementación real futura
      index.ts       # Elige implementación según NEXT_PUBLIC_DATA_SOURCE=mock|supabase
    hooks/           # useTareas(), useCertificado(id)… (TanStack Query sobre los repos)
```

- Los mocks simulan latencia (200–600 ms) y errores configurables para diseñar estados de carga y error reales.
- Los mocks respetan las reglas de negocio que después hará el backend (filtrado por cliente, numeración, firma), para que el front ya se comporte como el sistema final.
- Cambiar a Supabase = implementar `services/supabase/*` con las mismas interfaces.

---

## 3. Estructura de rutas

Una carpeta por rol, cada una con su layout y su guardia de rol (en mock: cookie de sesión simulada leída por `src/proxy.ts`, el antiguo `middleware.ts` en Next 16). En la implementación se usaron carpetas planas (`app/admin`, `app/taller`…) en lugar de route groups, porque el prefijo de URL ya separa los roles.

```
app/
  (public)/
    login/                          Login único (RF-01, RE-02)
  (superadmin)/superadmin/
    administradores/                Alta/baja de Administradores (RF-02)
    backups/                        Backup filtrable por fecha (RF-37)
  (admin)/admin/
    page.tsx                        Dashboard con métricas (RF-34)
    agenda/                         Calendario mensual de tareas (RF-10, RF-11, RF-12)
    cronograma/                     Grilla semanal: taller por columna, día por fila + nómina (RF-38, RF-39)
    tareas/                         Listado, nueva, [id] detalle/edición (RF-13 a RF-16)
    clientes/                       Listado, nuevo, [id] (RF-06, RF-07)
      [id]/estructura/              Árbol yacimiento → planta → equipo → válvula (RF-08)
      [id]/usuarios/                Usuarios de la empresa + accesos asignados (RF-03)
    certificados/                   Histórico con filtros (RF-33, CA-08)
      [id]/                         Vista del certificado, auditoría, descarga (RF-29)
    talleres/                       Cuentas de taller móvil (RF-04) y personal
    catalogos/                      Listas desplegables, patrones, alcance/repuestos, condiciones del servicio
    configuracion/certificado/      Campos configurables del certificado (RF-44, P-10)
    backups/                        Backup masivo (RF-46)
  (taller)/taller/
    page.tsx                        Mis tareas del día / semana (RF-17)
    tareas/[id]/                    Detalle de tarea + certificados cargados
    certificados/nuevo/             Asistente de carga (RF-18 a RF-25, RF-40)
    certificados/[localId]/         Edición / corrección 24 h (RF-41)
    sincronizacion/                 Cola de pendientes y estado de sync (RNF-07)
  (cliente)/portal/
    page.tsx                        Calendario mensual tipo almanaque (RF-35, RF-39)
    turnos/                         Pendientes e histórico
    certificados/                   Vigentes con búsqueda y filtros (RF-45)
    certificados/[id]/              Previsualización / descarga (RF-28)
    empresa/                        Datos y carga de logo (RF-07)
```

El Súper Administrador también puede entrar a todo `/admin`.

---

## 4. Modelo de dominio (tipos TS)

Define la forma de los datos que después serán tablas en Supabase. Vive en `lib/domain/`.

| Grupo | Tipos |
|---|---|
| Cuentas | `Usuario { id, email, nombre, rol: 'superadmin'\|'admin'\|'taller'\|'cliente', empresaId?, tallerId?, activo }` |
| Clientes | `Empresa { id, razonSocial, contacto, telefono, email, logoUrl, avisoVencimiento: boolean, … }` · `AccesoCliente { usuarioId, yacimientoId?, plantaId?, equipoId? }` |
| Estructura | `Yacimiento { provincia, nombre, empresaId }` · `Planta` (locación) · `Equipo` · `Valvula { tag, marca, nroSerie, modelo, tipo, servicio, pv, diamEntrada, diamSalida, rosca, … }` |
| Talleres | `Taller { id, nombre, usuarioId }` · `Persona { id, nombre, apellido, dni }` · `NominaJornada { tallerId, fecha, personaIds[] }` |
| Tareas | `Tarea { id, nroSolicitud, empresaId, yacimientoId, plantaId, equipoId, tallerId?, contacto, telefono, fechaSolicitud, fechaEjecucion, horario, tipo, detalle, condiciones[], adjuntos[], estado }` |
| Certificados | `Certificado` (ver §6) · `FotoCertificado` · `Firma { nombre, apellido, dni, imagen, fecha }` · `CorreccionCertificado { usuarioId, fecha, cambios[] }` |
| Catálogos | `OpcionCatalogo { lista, valor, orden, activo }` · `Patron { nombre, nroSerie, vencimiento }` · `CampoCertificado { clave, etiqueta, seccion, tipo, obligatorio, visible }` |
| Sync (local) | `CertificadoLocal { localId: uuid, estadoSync: 'borrador'\|'pendiente'\|'sincronizando'\|'sincronizado'\|'error', intentos, ultimoError }` |

**Valor especial "dato no disponible"** (RN-07): los campos obligatorios de texto aceptan `{ tipo: 'valor', valor } | { tipo: 'NO_APLICA' } | { tipo: 'DATO_NO_ENCONTRADO' }`. Esto se modela desde el principio para que el PDF y la validación lo traten igual en todos lados.

**Estados derivados** (funciones puras en `lib/domain/rules.ts`, testeadas):
- `vigencia(cert)` → vigente / por vencer (≤ 30 días) / vencido (fecha ejecución + 1 año).
- `estadoFirma(cert)` → sin firmas / firma técnico / firmado completo.
- `puedeDescargar(cert, rol)` → admin siempre; cliente solo si firmado y vigente (RN-04, RN-05, RN-06).
- `puedeCorregir(cert, usuario, ahora)` → emisor y dentro de 24 h (RN-14).

---

## 5. Componentes compartidos

| Componente | Uso |
|---|---|
| `AppShell` (sidebar + topbar por rol) | Todos los layouts autenticados. Responsive: sidebar colapsable en tablet. |
| `DataTable` (TanStack Table + shadcn) | Listados con orden, paginación, filtros por columna. |
| `FilterBar` | Filtros de cliente → yacimiento → planta → equipo → válvula encadenados. |
| `CascadeSelect` | Selects dependientes de la jerarquía (tareas, filtros, accesos). |
| `MonthCalendar` | Almanaque mensual (agenda admin y portal cliente). |
| `WeekScheduleGrid` | Cronograma: talleres en columnas, días en filas. |
| `SignaturePad` | Firma + nombre, apellido, DNI. |
| `PhotoCapture` | Cámara / galería, compresión en el cliente, guardado offline. |
| `UnavailableField` | Input con opción "NO APLICA" / "DATO NO ENCONTRADO". |
| `CheckGroup` | Casillas de alcance y repuestos + "Otros" con texto libre. |
| `CertificadoView` | Render del certificado con el diseño del modelo SYS (ver §6). |
| `StatusBadge`, `EmptyState`, `ConfirmDialog`, `FileUpload`, `SyncIndicator` | Utilitarios. |

---

## 6. El certificado

### 6.1 Secciones (según certificado modelo SYS)

| Sección | Campos | Origen |
|---|---|---|
| Cabecera | Logo SYS, título, **logo cliente**, Certificado #, PD/RTO, Fecha ejecución, Orden de trabajo | # asignado al sincronizar; logo precargado |
| 1.0 Ubicación | Provincia, Yacimiento, Operadora, Contratista, Locación, Equipo | Precargado desde la tarea; el técnico confirma (RF-20) |
| 1.1 Válvula | Precinto, Servicio, TAG, Marca, # Serie, Modelo, Tipo (desplegable: Pilotada/Convencional), PV (variable de proceso), Ø Ent./# (desplegable 1), Ø Sal./# (desplegable 2), Rosca (desplegable 3), P. operación (kg/cm²), T° operación (°C) | Ficha de la válvula; serie/modelo se relevan en campo y actualizan la ficha (RF-08, RF-21) |
| 1.2 Foto válvula desarmada | 1–2 fotos | Campo |
| 1.3 Mantenimiento | **Alcance** (11 casillas) · **Repuestos** (11 casillas + Otros con renglones) | Catálogo editable |
| 1.4 Foto válvula armada para ensayos | 1 foto | Campo |
| 1.5 Ensayos | SP inicial, SP apertura, Presión de cierre (valor + unidad, desplegable 4), Patrón utilizado (desplegable 5) con su vencimiento, Ejecutó | Patrón y vencimiento desde catálogo de patrones |
| 1.6 Foto válvula armada con chapa y precinto | 1 foto | Campo |
| 1.7 Observaciones | Texto libre | Campo |
| — Nómina interviniente | Personas del taller en esa jornada | Cronograma (RN-15, CA-13) |
| 1.8 Aprobación | Firma Por System Solutions · Firma Por Cliente | Tablet |
| Pie | Leyendas legales fijas | Constante |

### 6.2 Decisión de render

- `CertificadoView` es un componente React que reproduce el diseño del modelo (hoja A4, secciones con título y línea, campos con fondo celeste).
- Se usa para: **preview en el formulario de campo**, **vista en admin** y **vista en portal cliente**.
- Con estado sin firma, muestra la marca de agua **"REQUIERE FIRMA"** y el botón de descarga queda deshabilitado para el rol Cliente.
- En esta etapa la "descarga" es impresión del componente con CSS `@media print`. La generación real del PDF (y el nombre normalizado RN-16) queda para la Edge Function; el front ya muestra el nombre de archivo calculado con una función `nombreArchivoCertificado()` provisional (P-08).
- Las secciones se construyen a partir de la configuración `CampoCertificado[]` para soportar RF-44 (agregar/quitar campos).

### 6.3 Listas desplegables (semilla de catálogos)

Cargadas desde `SYS_Certificado Modelo_Referencias.pdf`, editables en `/admin/catalogos`:
1. Ø Ent./# — 56 opciones (3/8"BSP, 1/2"#150 … 1 1/2"#1500)
2. Ø Sal./# — 55 opciones
3. Rosca — NPT, N/A
4. Unidad de medida — Kg/Cm2, psi, BAR, mmH2O, Otro
5. Patrón utilizado — 9 patrones (Keller LEO 1/2, Wika, Fluke 717, Keller Druck), **con vencimiento editable anualmente**
6. Tipo — Pilotada, Convencional

Corregir en la semilla la errata `4 1/2"300` → `4 1/2"#300` (confirmar con el cliente).

---

## 7. Fases de implementación

Cada fase termina con algo navegable y revisable por el cliente.

### Fase 0 — Base del proyecto
- [x] `create-next-app` con TypeScript, Tailwind, ESLint, `src/`, App Router. *(Next.js 16.3, React 19.2, Tailwind 4)*
- [x] shadcn/ui inicializado; tema con colores de System Solutions (azul del logo) y tipografía. *(preset radix-nova, sidebar azul marino, Geist)*
- [x] Prettier, alias `@/`, Vitest para reglas de dominio. *(`npm test`, `npm run typecheck`, `npm run format`)*
- [x] `lib/domain`: tipos de todas las entidades + esquemas Zod de los formularios de fases 1–2 (el resto se agrega en cada fase).
- [x] `lib/services`: contratos + implementación mock con datos semilla realistas (2–3 empresas, yacimientos de Neuquén, 3 talleres, ~40 válvulas, ~60 certificados en distintos estados). *(persistido en localStorage, latencia simulada; los repos de tareas/cronograma se suman en su fase)*
- [x] Reglas de dominio (`vigencia`, `puedeDescargar`, `puedeCorregir`, validación RN-07) con tests. *(+ numeración, nomenclatura y alcance del cliente RN-09)*

### Fase 1 — Autenticación y layouts (M1)
- [x] Pantalla de login (branding SYS) con usuarios semilla por rol.
- [x] Sesión mock en cookie + `proxy.ts` que redirige según rol. *(en Next 16 `middleware` pasó a llamarse `proxy`)*
- [x] `AppShell` con menú por rol, responsive (desktop / tablet / celular). *(secciones de fases futuras con marcador "Disponible en la fase N")*
- [x] Página 403 y "sesión expirada".

### Fase 2 — Clientes y estructura (M2)
- [x] Listado de empresas cliente con búsqueda. *(+ filtro de inactivos, conteo de yacimientos/válvulas/usuarios, indicador de aviso)*
- [x] Alta/edición de empresa: datos, logo (preview), casilla "Requiere envío de advertencia de vencimiento". *(CUIT único; cliente inactivo bloquea el login de sus usuarios)*
- [x] Editor de estructura en árbol: yacimientos → plantas → equipos → válvulas (CRUD en cada nivel, ficha de válvula con historial de certificados). *(búsqueda por nombre/TAG/serie, selección en la URL `?sel=valvula:ID`, no se elimina un nivel con hijos ni una válvula con certificados — RN-03)*
- [x] Usuarios de la empresa y asignación de accesos por yacimiento/planta/equipo. *(marcar un nivel incluye lo de abajo; aviso si el usuario queda sin accesos)*

> **Verificado (fases 0–2):** `npm run typecheck`, `npm run lint`, `npm test` (17 tests de reglas) y `npm run build` sin errores. Recorrido end-to-end en navegador: login por rol y `?next=`, sesión expirada, 403, alta de cliente con validaciones, estructura completa de punta a punta, usuarios con accesos, edición de datos, logout y vista mobile.

### Fase 3 — Catálogos, talleres y personal
- [x] Catálogos: listas desplegables, alcance, repuestos, condiciones del servicio (P-11), con orden y activar/desactivar. *(alta y edición en línea, sin duplicados, filtro en listas largas; no se borran opciones para no romper certificados emitidos)*
- [x] Patrones con vencimiento y alerta visual si están vencidos. *(también "por vencer" a 30 días, botón "Sumar un año" para la renovación anual)*
- [x] Talleres móviles (cuenta asociada) y padrón de personas (nombre, apellido, DNI). *(color por taller para agenda/cronograma; desactivar el taller deshabilita su cuenta; DNI único)*

### Fase 4 — Agenda, tareas y cronograma (M3)
- [x] Alta/edición de tarea con `CascadeSelect`, condiciones, adjunto, taller opcional; nro de solicitud automático (mock). *(también tipo, horario, OT y PD/RTO; cancelar/reabrir; el estado se ajusta solo al asignar o quitar el taller)*
- [x] Listado de tareas con filtros por estado / taller / cliente / fecha. *(vistas Próximas / Pasadas / Todas, búsqueda por N° de solicitud o locación, acceso rápido a las sin asignar)*
- [x] Agenda mensual: cada tarea con horario, cliente, locación, color por taller; clic → panel de detalle (RF-12). *(filtro por taller, canceladas ocultas por defecto, "+" por día para crear con fecha precargada; en celular, puntos por día y lista del día elegido. `MonthCalendar` queda genérico para el portal)*
- [x] Cronograma semanal: grilla talleres × días, tareas en celdas, reasignación (arrastrar o menú), asignación de nómina por jornada. *(columna "Sin asignar"; arrastrar cambia taller y día; una persona no puede estar en dos talleres el mismo día; aviso "Sin nómina" si el taller tiene tareas; copiar la nómina de la semana anterior)*

> **Verificado (fases 3–4):** typecheck, lint, 21 tests y build sin errores. Recorrido en navegador de 18 pasos (catálogos, patrones, talleres, personal, tareas, agenda, cronograma con arrastrar y soltar, mobile) sin errores de consola.

### Fase 5 — App de campo y certificado (M4 + M5) — **la más crítica**
- [ ] Layout táctil para tablet (botones grandes, navegación simple).
- [ ] "Mis tareas" del taller, con indicador online/offline.
- [ ] Asistente de carga por pasos, uno por sección del certificado, con datos precargados para confirmar.
- [ ] `UnavailableField` en campos obligatorios; validación que bloquea el cierre (CA-03, CA-10).
- [ ] Fotos por sección con compresión.
- [ ] Firmas del técnico y del representante del cliente.
- [ ] Varios certificados por tarea (una válvula = un certificado).
- [ ] Preview `CertificadoView` antes de cerrar.
- [ ] `CertificadoView` en admin y portal con marca "REQUIERE FIRMA".
- [ ] Corrección dentro de 24 h con contador visible y registro de cambios (mock).

### Fase 6 — Offline y sincronización
- [ ] PWA con Serwist: manifest, instalación en tablet, cache de rutas `/taller/*` y catálogos.
- [ ] Dexie: certificados, fotos (blobs) y firmas guardados localmente con `localId` (uuid).
- [ ] Cola de salida: al volver la conexión, sincroniza sola; reintentos con backoff; pantalla `/taller/sincronizacion`.
- [ ] Sync mock que imita el backend: idempotente por `localId` y asigna número correlativo (para probar CA-02 y CA-11 con dos pestañas).
- [ ] Prueba manual: modo avión en DevTools, carga completa, reconexión.

### Fase 7 — Portal del cliente (M7)
- [ ] Calendario mensual tipo almanaque con los turnos de la empresa.
- [ ] Turnos pendientes e histórico.
- [ ] Certificados vigentes con búsqueda por nro de equipo, tag, fecha, locación (RF-45); vencidos ocultos (RN-06).
- [ ] Vista del certificado con fotos; descarga solo si está firmado.
- [ ] Perfil de empresa y carga de logo.

### Fase 8 — Panel admin, histórico y backups (M7 + M8)
- [ ] Dashboard: certificados generados, servicios completados en el período, próximos vencimientos, tareas sin taller asignado.
- [ ] Histórico de certificados con filtros cliente/yacimiento/planta/válvula, estado de firma y vigencia.
- [ ] Detalle del certificado con auditoría de correcciones y descarga siempre habilitada.
- [ ] Configuración de campos del certificado (RF-44).
- [ ] Pantallas de backup (Súper Admin: por fecha; Admin: masivo) con descarga simulada.
- [ ] Súper Admin: gestión de administradores.

### Fase 9 — Pulido
- [ ] Revisión responsive en desktop, tablet Android de gama media y celular (RNF-06).
- [ ] Estados vacíos, de carga y de error en todas las pantallas.
- [ ] Accesibilidad básica (foco, contraste, labels).
- [ ] Recorrido guiado de los criterios de aceptación CA-01 a CA-15 con datos mock.

---

## 8. Puntos de conexión futuros (Supabase + Edge Functions)

Para que la conexión posterior sea directa, cada operación del front ya queda identificada con su destino:

| Operación en el front | Destino futuro |
|---|---|
| Login, sesión, rol | Supabase Auth (+ rol en `app_metadata`) |
| CRUD de clientes, estructura, catálogos, tareas, cronograma | Consultas directas a Postgres con RLS |
| Filtrado de datos por cliente (RN-09, RNF-01) | Políticas RLS (el front no confía en su propio filtro) |
| Alta de usuarios (admin, taller, cliente) | Edge Function `crear-usuario` (usa service role) |
| Nro de solicitud | Secuencia / trigger en Postgres |
| Sincronización de certificados | Edge Function `sync-certificado`: idempotente por `localId`, asigna nro correlativo en transacción, sube fotos/firmas a Storage |
| Generación de PDF + nombre normalizado | Edge Function `generar-certificado-pdf` (disparada por el sync y por correcciones) |
| Descarga de PDF | URL firmada de Storage emitida solo si `puedeDescargar` |
| Corrección 24 h + auditoría | Edge Function `corregir-certificado` |
| Aviso de vencimiento 30 días | Edge Function `avisos-vencimiento` programada (cron), email desde systemsrl.com.ar |
| Backups | Edge Function `backup` (export filtrado por fecha) |
| Logos, fotos, adjuntos | Supabase Storage (buckets por tipo) |

---

## 9. Definiciones pendientes que afectan al front

| Tema | Impacto | Supuesto mientras tanto |
|---|---|---|
| **Operadora vs Contratista vs Cliente**: el certificado tiene ambas y el logo sale de la contratista | Modelo `Empresa`, accesos del portal, logo del certificado | Cliente del sistema = contratista; operadora como dato del yacimiento |
| **Formato del nro de certificado**: el modelo usa `26-02-0014`, el DRF dice correlativo simple | Visualización y filtros | Se muestra `AA-MM-NNNN` con el correlativo global al final |
| **PD/RTO y Orden de trabajo** no figuran en el DRF | Campos de tarea y certificado | Se incluyen como campos de la tarea, editables en campo |
| P-02 Campos por empresa cliente | Formulario de empresa | Nombre, CUIT, contacto, teléfono, email, dirección |
| P-08 Nomenclatura del PDF | `nombreArchivoCertificado()` | `{TAG}_{EQUIPO}_{LOCACION}_{NRO}.pdf` |
| P-09 Carga de nómina por taller | Cronograma | Selección de personas por taller y jornada en la grilla semanal |
| P-10 Campos configurables | Pantalla de configuración | Mostrar/ocultar y obligatorio sí/no por campo; solo Admin |
| P-11 Condiciones del servicio | Formulario de tarea | Catálogo editable: válvulas en altura, requiere hidrogrúa, requiere andamio, permiso de trabajo |
| P-12 Corrección visible en PDF | `CertificadoView` | Mostrar "Rev. N" en la cabecera si hubo correcciones |
| Logo y colores de System Solutions en alta resolución | Branding | Recrear a partir del certificado modelo |

---

## 10. Fuera de alcance de este plan

- Base de datos, RLS, Edge Functions y envío real de correos.
- Generación real de PDF en servidor.
- Migración desde el sistema anterior (RE-03).
- Solicitud de turnos por parte del cliente (RF-36, prevista para marzo 2027).
- Facturación (P-07).
