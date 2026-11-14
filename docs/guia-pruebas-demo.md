# Guía de pruebas con datos de demo

Dataset ficticio para recorrer **todos** los flujos de la app (Administrador, Superadministrador,
Taller Móvil y Cliente) y para mostrárselos al cliente. Sirve al desarrollador para probar a mano y
como guion de la demo.

> **Solo base LOCAL.** El cargador nunca se usa contra la base remota ni la de producción
> (decisión del 2026-11-13). Se niega a correr si la URL de Supabase no es
> `http://127.0.0.1:<puerto>` o `http://localhost:<puerto>`, o si el contenedor de base no es un
> `supabase_db_*` local. No lee `.env` ni `.env.local`. La prueba que lo garantiza está en
> `scripts/datos-demo/destino.test.ts`.

## 1. Preparar y cargar

| Paso | Comando                                                                                                                                            | Qué hace                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Stack local de Supabase levantado (por defecto, el de verificación: API `http://127.0.0.1:55321`, contenedor `supabase_db_system-solutions-verif`) | Base, Auth, Storage y Edge Functions locales.                                                                                                  |
| 2    | `npm run datos:demo`                                                                                                                               | Carga el dataset. Tarda unos 20 s la primera vez; después, 3 s.                                                                                |
| 3    | `npm run demo:app`                                                                                                                                 | Compila y sirve la app en **http://localhost:3100** apuntando al stack local. `E2E_SKIP_BUILD=1 npm run demo:app` reutiliza el build anterior. |

- No uses `npm run dev` para esta demo: con el `.env.local` de siempre apunta a la base remota.
- Otro stack local: definí `E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`,
  `E2E_SERVICE_ROLE_JWT` y `E2E_DB_CONTAINER` (las mismas variables que los E2E). La URL tiene que
  seguir siendo local.
- **Idempotente:** correrlo otra vez no crea nada nuevo; cada escenario se reconoce por el tag de su
  primera Válvula (`QA-PSV-01A`, `QA-PSV-02A`, …) y se deja como está.
- **Volver al estado inicial** (después de probar, o al otro día): `supabase db reset` en el
  proyecto local y `npm run datos:demo` otra vez. Las fechas son relativas al día de la carga
  («hoy», «mañana», «dentro de 3 días»): al día siguiente, las visitas de «hoy» quedan en el pasado.
- Si una carga se corta a la mitad, el escenario queda incompleto y no se rehace: hacé el reset.
- Convive con los E2E: usa la misma semilla (`e2e/support/semilla.ts`), así que una corrida E2E
  posterior no choca con estos datos. La suite E2E completa pasa también sobre una base con el
  dataset (los dos defectos que lo impedían se corrigieron en P8; ver sección 5). Para la suite
  E2E de referencia, igual conviene hacer el reset primero. La plantilla de certificado activa queda en la versión
  `e2e-sin-d1-…` de esa semilla.

## 2. Cuentas

Contraseña de todas: **`demo1234`**.

| Rol                                       | Email                         | Qué ve                                                        |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| Superadministrador                        | `super@local.test`            | Todo, más administradores y backups.                          |
| Administrador                             | `admin@local.test`            | Tareas, agenda, cronograma, certificados, clientes, talleres. |
| Taller Móvil «Taller Norte»               | `taller@local.test`           | Visitas de hoy (Técnicos: Tomas Tecnico y Laura Lopez).       |
| Taller Móvil «QA Taller Sur»              | `qa.taller.sur@local.test`    | Visitas futuras (Técnicos: Martín Ríos y Julia Paz).          |
| Cliente «Petrolera Ficticia SA»           | `cliente@local.test`          | Portal con casi todos los escenarios.                         |
| Cliente «QA Gas del Valle SRL» (con logo) | `qa.cliente.valle@local.test` | Portal con un certificado finalizado.                         |

`super`, `admin`, `taller` y `cliente` son las cuentas de la semilla E2E. `QA Gas del Valle SRL` y
`QA Taller Sur` se crean por la app (invitación); el cargador les fija la contraseña de demo y
confirma el correo con la API de Auth del stack local.

## 3. Qué carga

**Estructura.** Petrolera Ficticia SA: yacimiento **QA Loma Alta** (Neuquén) con las plantas
**QA Planta Compresora Norte** y **QA Batería 3**. QA Gas del Valle SRL: yacimiento **QA Valle
Medio** (Río Negro) con **QA Planta de Tratamiento**. Cada escenario tiene su equipo `QA-K-<nn>` y
sus Válvulas `QA-PSV-<nn>A`, `QA-PSV-<nn>B`, con ficha técnica completa (pilotadas y
convencionales; Farris, Crosby, Consolidated, Anderson Greenwood). Nómina de ambos talleres desde
ayer hasta dentro de una semana.

**Escenarios.** El N° de solicitud es el que queda en una base recién reseteada.

| Escenario | N°  | Estado                                                                                                                  | Taller y fecha                                             | Para probar                                 |
| --------- | --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| QA-01     | 1   | Solicitud del Cliente, **sin visita**                                                                                   | —                                                          | Programarla desde Tareas.                   |
| QA-02     | 2   | Tarea con fecha (mañana 10:00), **sin Taller**                                                                          | —                                                          | Asignarle Taller.                           |
| QA-03     | 3   | **Programada**, pendiente de aceptación                                                                                 | Taller Norte, hoy 16:00                                    | Aceptar en el Taller; reasignar o cancelar. |
| QA-04     | 4   | **Programada** futura, con orden de trabajo `OT-QA-0004`                                                                | QA Taller Sur, +3 días                                     | Agenda y cronograma futuros.                |
| QA-05     | 5   | **Aceptada**, lista para iniciar                                                                                        | Taller Norte, hoy 11:00                                    | Recorrido completo de campo.                |
| QA-06     | 6   | **En curso**: PD `PD6006`, Válvula A con borrador a medias, Válvula B sin empezar                                       | Taller Norte, hoy 09:00                                    | Continuar un borrador y cerrar la visita.   |
| QA-07     | 7   | **Completada**, certificados **pendientes de firma del Cliente** (PD `PD7007` con foto)                                 | Taller Norte, hoy 08:00                                    | Firma diferida desde el portal.             |
| QA-08     | 8   | **Completada y finalizada** (PD `PD8008` con foto, fotos, ambas firmas)                                                 | Taller Norte, hoy 07:00                                    | Ver y descargar certificados.               |
| QA-09     | 9   | **Completada y finalizada** para el Cliente con logo (PD `PD9009`)                                                      | QA Taller Sur, hoy 10:00                                   | Portal del segundo Cliente.                 |
| QA-10     | 10  | Visita **cancelada** por el Administrador                                                                               | QA Taller Sur, +2 días                                     | «Reactivar tarea».                          |
| QA-11     | 11  | **Completada** con la Válvula B **no evaluada** + **visita de seguimiento** programada                                  | Taller Norte hoy 12:00; seguimiento QA Taller Sur, +5 días | Seguimiento de lo pendiente.                |
| QA-12     | 12  | **Finalizada** con ejecución histórica: Válvula A **vencida** (-400 días), Válvula B **por vencer** (vence en ~15 días) | Taller Norte, hoy 06:00                                    | RN-06: vencimiento y descarga.              |

## 4. Recorrido por rol

Marcá cada casilla al probarlo. «Esperado» es lo que tiene que pasar.

### Administrador (`admin@local.test`)

- [ ] **Tareas** (`/admin/tareas`): arriba, «Solicitudes de servicio sin visita programada» muestra
      N° 1 (QA-01) y N° 2 (QA-02); abajo, 11 tareas con estados Completada, En curso, Aceptada,
      Programada y Cancelada. Probar las pestañas Próximas / Pasadas / Todas y los filtros por Estado,
      Taller y Cliente.
- [ ] **Programar QA-01:** en la fila de N° 1 elegir fecha, hora y «Elegir Taller Móvil» → Taller
      Norte → **Programar visita**. Esperado: pasa a la tabla como Programada y aparece en la agenda.
- [ ] **QA-02:** igual que QA-01, eligiendo QA Taller Sur. Esperado: Programada para mañana.
- [ ] **QA-03:** abrir la tarea N° 3 y cambiar taller u horario con motivo. Esperado: el cambio queda
      en la tarea y en Auditoría.
- [ ] **QA-10:** abrir N° 10 (dice «La Visita de servicio ya no admite cambios») → **Reactivar
      tarea**. Esperado: la visita vuelve a Programada con QA Taller Sur.
- [ ] **QA-11:** abrir N° 11. Esperado: Válvula `QA-PSV-11B` no evaluada («Sin acceso: falta
      andamio en el equipo») y la visita de seguimiento con QA Taller Sur.
- [ ] **Nueva tarea:** **Nueva tarea** → Cliente Petrolera Ficticia SA → QA Loma Alta → planta →
      equipo `QA-K-05` (o cualquiera) → **Crear tarea**.
- [ ] **Agenda** y **Cronograma:** hoy con las visitas de Taller Norte (06:00 a 16:00) y QA Taller
      Sur (10:00); los días +2, +3 y +5 con las de QA Taller Sur.
- [ ] **Certificados** (`/admin/certificados`): finalizados de QA-08, QA-09, QA-11 y QA-12 y los
      pendientes de QA-07. **Ver certificado** de `QA-PSV-08A`: datos, ensayos, patrón, fotos, Parte
      Diario y ambas firmas.
- [ ] **Clientes:** QA Gas del Valle SRL con logo. Entrar a **Estructura** y ver yacimiento, planta,
      equipo y válvula; editar la ficha de una Válvula.
- [ ] **Talleres y personal:** pestaña «Talleres móviles» con QA Taller Sur y Taller Norte; pestaña
      «Personal» con Martín Ríos, Julia Paz, Tomas Tecnico y Laura Lopez. En **Cronograma**, la nómina
      de cada taller desde ayer hasta dentro de una semana.
- [ ] **Auditoría:** las altas, aceptaciones, firmas y cierres del cargador figuran con la cuenta
      que los hizo (admin, taller o cliente).

### Superadministrador (`super@local.test`)

- [ ] Todo lo del Administrador, más **Administradores** y **Backups** (`/superadmin`).

### Taller Norte (`taller@local.test`, en ancho de celular también)

- [ ] **Mis tareas** (`/taller`): en «Visitas Pendientes», QA-03 con **Aceptar**; en «Visitas
      Programadas», N° 5 y N° 6. **Aceptar** QA-03. Esperado: pasa a Programadas.
- [ ] **QA-05, recorrido completo:** **Abrir visita** → **Reservar en este dispositivo** →
      **Iniciar Visita de servicio** → Parte Diario: número (alfanumérico) → **Guardar número PD** →
      foto del PD → en cada Válvula **Evaluada** → **Iniciar Borrador de certificado** → completar
      fecha, técnico, datos técnicos, ensayos, mantenimiento y 3 fotos → **Guardar Borrador de
      certificado** → firma del Cliente (nombre y apellido + trazo → **Registrar firma del Cliente**) →
      firma del Técnico → **Completar visita**. Esperado: «Visita completada»; los certificados quedan
      finalizados y el Cliente los ve en su portal.
- [ ] **QA-06, continuar un borrador:** **Abrir visita** → **Reservar en este dispositivo**.
      Esperado: «Reservada localmente», PD `PD6006`, `QA-PSV-06A` evaluada con el borrador cargado
      (fecha, técnico, ficha y una foto). Completar lo que falta, evaluar `QA-PSV-06B` y cerrar.
- [ ] **Sin red:** reservar QA-05 o QA-06, cortar la conexión y seguir; al volver la conexión,
      **Sincronización** sube lo pendiente.
- [ ] **Firma diferida:** en una visita, **No hay representante** → firma del Técnico → **Completar
      visita**. Esperado: certificados pendientes de firma del Cliente.

### QA Taller Sur (`qa.taller.sur@local.test`)

- [ ] «Visitas Pendientes» con la visita de QA-04 (+3 días) y la de seguimiento de QA-11 (+5 días).
      **Aceptar** una. Esperado: queda aceptada; aparece en «Visitas Programadas» recién cuando falten
      dos días o menos.
- [ ] No ve las visitas de Taller Norte.

### Cliente Petrolera Ficticia SA (`cliente@local.test`)

- [ ] **Calendario** (`/portal`): hoy con 7 visitas (completadas, en curso, aceptada, programada);
      los días +3 y +5 con las de QA Taller Sur. «Mostrar canceladas» muestra QA-10.
- [ ] **Certificados** → «Visitas que esperan firma del Cliente»: la visita de QA-07. Nombre y
      apellido + foto de la firma → **Subir firma**. Esperado: `QA-PSV-07A` y `07B` pasan de «Pendiente
      de firma» a «Vigente» con número.
- [ ] **Historial de certificados:** `QA-PSV-08A/B` vigentes, `QA-PSV-11A` vigente, `QA-PSV-12B`
      vigente con vencimiento cercano y **`QA-PSV-12A` «Vencido»**, sin botón **Ver** (RN-06). Filtrar
      por Parte Diario (`PD8008`) o por tag.
- [ ] **Ver** un certificado vigente → **Descargar PDF** (diálogo de impresión, «Guardar como PDF»).
- [ ] **Turnos** y **Mi empresa:** datos del Cliente; solo sus yacimientos.
- [ ] QA-01 es una solicitud que este Cliente hizo por la API (el portal no tiene botón para eso;
      ver N4 / RF-36): el Administrador la ve en «Solicitudes de servicio sin visita programada».

### Cliente QA Gas del Valle SRL (`qa.cliente.valle@local.test`)

- [ ] **Mi empresa:** razón social y logo.
- [ ] **Certificados:** solo `QA-PSV-09A` (PD `PD9009`), vigente; no ve nada de Petrolera.
- [ ] **Ver** → certificado con firmas de Martín Ríos y Lucía Ferreyra, fotos y Parte Diario.

## 5. Defectos conocidos que se ven con estos datos

Los cuatro defectos que dejó ver el dataset se corrigieron en P8 (2026-11-13):

- **Logo del Cliente en el certificado:** la finalización tomaba el logo de `logo_imagen_id`, que
  nada escribe. Desde `20261114000005` lo toma de `logo_bucket`/`logo_path` (donde lo guarda la
  subida). La misma migración completa los certificados ya finalizados cuyo logo actual ya existía
  al finalizarse. Para verlo: el certificado de QA-09 (Cliente QA Gas del Valle SRL). Hay que
  volver a cargar el dataset (reset + `npm run datos:demo`) o aplicar la migración sobre la base.
- **Logo en Clientes y Mi empresa en el stack local:** la URL firmada con el host interno
  `http://kong:8000` ahora se sirve desde `NEXT_PUBLIC_SUPABASE_URL` en todas las pantallas
  (`src/lib/storage-url.ts`, también para los adjuntos). En producción la URL es https y no cambia.
- **`/portal/certificados` pedía el historial en lote dos veces** con más de un yacimiento: el lote
  se arma recién cuando cargaron todos los árboles.
- **Hora de las visitas de la tarde:** QA-03 (16:00) aparecía como «04:00:00» en «Visitas
  Pendientes». Las fechas con hora se muestran en hora argentina, 24 h y sin segundos
  (`fmtFechaHoraArgentina`, `src/lib/format.ts`).

Queda como limitación conocida (no se ve con el dataset): si el Cliente **quita** su logo, la
función `asset-access` borra el objeto de Storage y los certificados ya finalizados con ese logo
dejan de mostrarlo (al **reemplazarlo** no pasa: cada subida es un objeto nuevo).

## 6. Qué se hace fuera de la API

Todo se crea por las Edge Functions con la cuenta que corresponde, salvo:

- **Liberar la reserva de QA-06:** el cargador inicia la visita con su propio «dispositivo» y no hay
  API para liberar una reserva; borra la fila de `dispositivos_visita` en la base LOCAL para que el
  navegador de quien prueba pueda tomarla.
- **Activar las cuentas invitadas:** contraseña y confirmación por la API de Auth del stack local
  (clave de servicio de demostración de la CLI).
- **Semilla base:** la de los E2E (`prepararSemilla`) inserta por SQL las filas de `cuentas`,
  `clientes` y `talleres_moviles` de las cuentas base.
- Lecturas de control por SQL local (si la cuenta sigue invitada, el usuario por email).
