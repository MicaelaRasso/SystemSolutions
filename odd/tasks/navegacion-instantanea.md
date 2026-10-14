# Navegación instantánea y optimización de carga

## Objetivo

La app se siente lenta. Al cambiar de sección, la página nueva tiene que mostrarse de inmediato y los datos cargarse después, con un indicador giratorio de carga ("ruedita") mientras se espera la base de datos.

## Diagnóstico inicial

- No existe ningún `loading.tsx`: Next espera a que el servidor termine antes de pintar la página nueva.
- `src/proxy.ts` → `src/lib/supabase/proxy.ts:84-104` corre en cada navegación: `getClaims()`, `getSession()` y `fetchAuthenticatedContext()`. Este último llama a la Edge Function `GET /context`, que suma un viaje de red y un posible arranque en frío.
- 6 layouts o páginas vuelven a llamar a `requerirSesion` del lado del servidor.

## Diagnóstico (T1)

Análisis de código (sin credenciales para medir en la app real; no hay tiempos medidos).

Viajes de red al hacer clic en una sección (navegación cliente, sin `loading.tsx`):

1. **Sin prefetch.** Todas las rutas son dinámicas (los layouts por rol leen cookies vía `requerirSesion`). Sin `loading.tsx`, Next no prefetchea rutas dinámicas: el clic espera la respuesta completa del servidor antes de cambiar la pantalla (`node_modules/next/dist/docs/01-app/02-guides/prefetching.md`).
2. **Proxy en cada request** (`src/lib/supabase/proxy.ts`): `getClaims()` (local si el proyecto firma JWT asimétricos; si firma HS256, `auth-js` llama a `getUser()` = 1 viaje a Auth), `getSession()` (local) y `GET /context` en `identity-admin` (1 viaje a Edge, con posible arranque en frío, timeout 2,5 s).
3. **Layout del servidor**: al cambiar de layout de rol (por ejemplo, `/admin` → `/cuenta/seguridad`) `requerirSesion` repite `getClaims()` + `GET /context`. Entre páginas hermanas el layout compartido no se vuelve a renderizar (partial rendering), pero `/admin/backups` llama a `requerirSesion` en la página.
4. **Cliente**: recién después de pintar la página arrancan las consultas de TanStack Query (1+ viajes a Edge por pantalla).

Total en serie antes de ver la pantalla nueva: 1 viaje a Edge (`/context`) + 0–1 a Auth, y 2 viajes a Edge + 0–2 a Auth al cambiar de layout. Después, los datos.

Otros hallazgos:

- TanStack Query ya tiene defaults razonables en `src/components/providers.tsx`: `staleTime` 30 s, `retry` 1, `refetchOnWindowFocus` false. No hay tormentas de refetch.
- No hay `force-dynamic` ni `revalidate`; el único `no-store` es el fetch a `/context` (correcto, es autorización).
- Las páginas son envoltorios finos de componentes cliente; los datos ya se piden en el cliente. No hay fetch de datos en el servidor que bloquee el render.
- `estructuraApi.arbol` hace lista de yacimientos y luego `Promise.all` de árboles (2 etapas, inherente al contrato). Las demás cascadas están en mutaciones, no en lecturas.
- Los `Link` del sidebar usan prefetch por defecto; hoy no sirve porque las rutas dinámicas no tienen `loading.tsx`. Al agregarlo, cada link visible se prefetchea y cada prefetch pasa por el proxy: sin T3, eso multiplicaría las llamadas a `/context`.
- Estados de carga inconsistentes: mezcla de `Skeleton` de bloque, textos "Cargando…" sueltos y ningún indicador entre el clic y la pantalla nueva.

## Restricciones

- No hay cambios en `supabase/`: el proxy es un chequeo optimista y la autorización real la hacen las Edge Functions (no se debilita).
- No se agregan dependencias nuevas.
- Se mantiene la estética actual: el indicador usa los tokens y componentes existentes.
- Se sigue respetando el ticket offline del taller.

## Tareas

- [x] T1: medir y diagnosticar. Ruta: delegada. _Hallazgos en "Diagnóstico (T1)"; sin commit propio, va junto con T2._
- [x] T2: componente de carga (indicador giratorio) y `loading.tsx` por sección, para que la navegación sea inmediata. Estados de carga de TanStack Query unificados con el mismo indicador. Ruta: delegada.
  _`Cargando` en `src/components/common/cargando.tsx` (LoaderCircle de lucide, `role="status"`, `aria-live`, texto oculto que se muestra con movimiento reducido, aparición con 150 ms de retardo). `loading.tsx` en `admin`, `superadmin`, `taller`, `portal`, `cuenta/seguridad` y `admin/clientes/[id]` (deja visible el encabezado del cliente). Rueda chica en el ítem del sidebar con `useLinkStatus` mientras la navegación no arranca. 20 pantallas pasan de Skeleton de bloque o texto "Cargando…" al mismo indicador; se mantienen los skeletons con forma (filas de clientes, métricas del panel, tarjetas de talleres, encabezado del cliente). Excepción test-first: UI sin lógica; checks estructurales + build._
- [x] T3: abaratar el proxy y la sesión del servidor (cachear el rol, evitar `GET /context` en cada navegación, deduplicar `requerirSesion`). Ruta: delegada.
  _Cookie `systemsolutions.context-cache` (httpOnly, `sameSite=lax`, `secure` en https) con el rol, firmada con HMAC usando una clave derivada de `OFFLINE_SESSION_SECRET` (separada de la del ticket offline), atada al `sub` y al `session_id` del JWT verificado por `getClaims()`, TTL 5 min (`src/lib/auth/context-cache.ts`). El proxy la verifica antes de `getSession()` y `/context`; si acierta, no hay viaje a Edge. En un fallo la emite tras `/context` y también se la pasa al request, así el layout del mismo request no repite `/context`. Se borra si no hay sesión de Supabase o si `/context` deniega o devuelve otra cuenta. `getVerifiedSesion` lee la misma cookie y queda memoizada por request con `cache()` de React. El ticket offline del taller no cambia: se renueva en cada consulta real a `/context` (cada ≤5 min). Sin `OFFLINE_SESSION_SECRET` (≥32 caracteres) no hay caché y todo se comporta como antes: **el deploy necesita esa variable configurada**. Riesgo aceptado: un cambio de rol o una cuenta deshabilitada se refleja en la navegación en hasta 5 min; los datos siguen protegidos porque cada Edge Function autoriza por su cuenta. Tests: `context-cache.test.ts` (11: acierto, sin cookie, otro sujeto, otra sesión, vencida, emitida en el futuro, payload y firma alterados, clave del ticket offline, TTL excesivo o rol inválido, sin secreto) y `proxy.test.ts` (5: fallo con emisión y reenvío, acierto sin `/context`, otro sujeto, denegado, sin sesión). RED: el módulo no existía; los 5 de proxy fallan contra el `proxy.ts` anterior._
- [x] T4: optimizaciones de datos (`staleTime` y prefetch de TanStack Query, consultas en cascada, prefetch de `Link`) y verificación. Ruta: delegada.
  _`staleTime` de 5 min para catálogos (admin y resumen), patrones, talleres, personal y el contexto de la cuenta (`useEdgeContext`); sus mutaciones ya los invalidan. Los defaults globales (30 s, `retry` 1, sin refetch al enfocar) ya eran correctos y no cambian. `experimental.staleTimes.dynamic = 30` en `next.config.ts`: volver a una sección visitada hace menos de 30 s no pasa por el proxy ni el servidor. Por eso el logout ahora hace navegación completa (`window.location.replace`), igual que el login, y descarta el cache del router. Los `Link` ya usaban prefetch por defecto; con los `loading.tsx` de T2 ahora sí prefetchean el layout y el fallback. No se encontraron cascadas de lectura evitables: `arbol` (lista → árboles en paralelo) y portal empresa (contexto → empresa) dependen del dato anterior._

## Efecto esperado

Estimación por análisis de código (no se pudo medir en la app real: no hay credenciales).

- Clic en una sección: la pantalla cambia al instante con el layout visible y la rueda en el contenido (fallback prefetcheado), en vez de esperar al servidor.
- Viajes en serie antes de pintar la página nueva, con la caché del rol vigente: de 1 viaje a Edge (`/context`) + 0–1 a Auth, a 0 a Edge + 0–1 a Auth (`getClaims` es local si los JWT son asimétricos). Al cambiar de layout de rol: de 2 a 0 viajes a Edge. Primer request tras vencer la caché: 1 viaje (el layout reutiliza el del proxy).
- Prefetch de los links del sidebar: cada uno pasa por el proxy, pero con caché no llama a `/context`.
- Volver a una sección en menos de 30 s: sin viaje al servidor; datos del cache de TanStack Query.
- Pendiente de verificar en navegador y con credenciales reales. Si el proyecto de Supabase firma JWT con HS256, `getClaims()` sigue haciendo 1 viaje a Auth por request: conviene activar las claves de firma asimétricas.

## Checks

`npm run typecheck`, `npm run lint` (2 errores ya existentes en `visitas-panel.tsx`), `npm test`, `npm run build`.

## Progreso

- 2026-10-13: rama `perf/navegacion-instantanea`, creada desde `feat/pantallas-faltantes`.
- T1 + T2: commit `676b8ac` (`feat(ui): navegacion instantanea con indicador de carga compartido`). typecheck OK, lint solo con los 2 errores conocidos de `visitas-panel.tsx`, tests 40/40 archivos (349).
- T3: commit `aa872c6` (`perf(auth): cachea el rol firmado ...`). RED: módulo inexistente; 5 tests de proxy fallan contra el `proxy.ts` anterior. GREEN: 42 archivos, 365 tests.
- T4: typecheck OK; lint solo con los 2 errores conocidos de `visitas-panel.tsx`; tests 42/42 archivos (365); `npm run build` OK (rutas protegidas dinámicas `ƒ`, como se esperaba porque los layouts leen cookies; estáticas: `/`, `/reset-password`, `/setup-password`, `/sin-acceso`). Falta probar en el navegador con credenciales reales.
