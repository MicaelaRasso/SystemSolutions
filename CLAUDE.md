@AGENTS.md

# System Solutions — contexto del proyecto

Sistema de gestión de calibración de válvulas de seguridad para System Solutions SRL (cliente),
desarrollado por Magne Studios. Idioma del proyecto: español (UI, dominio y comentarios).
Stack: Next.js 16 (Vercel) + Supabase (Postgres, Auth, Storage, RLS) + Supabase Edge Functions.

## Cómo retomar

1. `correcciones.md` (raíz): correcciones recientes, checklist de prueba en producción por rol,
   pasos para publicar y decisiones del cliente (D4, N4, etc.). Es lo más actualizado.
2. `planning.md`: plan original por fases y bitácora. **Al trabajar, ir marcando en `planning.md`
   cada tarea que se completa** (pedido explícito del usuario) con una nota de verificación.
3. Dominio: `CONTEXT.md` (glosario) y decisiones en `docs/adr/` (p. ej. 0008 exclusividad de
   equipo, 0009 offline, 0017 plantillas versionadas). Esquema de base: `docs/database-schema.md`.
   Integración front/back: `integration.md`.
4. Fuentes del cliente: `Contexto/DRF_System_Solutions_v1_1 (1).pdf` (requerimientos),
   `Contexto/SYS_Certificado Modelo*.pdf` (diseño del certificado) y
   `Contexto/SYS_Certificado Modelo_Referencias.pdf` (listas desplegables).

## Reglas de arquitectura

- **El navegador solo habla con Supabase Auth.** Todo dato de negocio pasa por las Edge Functions
  (`supabase/functions/<dominio>/`, ADR 0013), que llaman a RPC `api_*` de Postgres. Las rutas
  nuevas se registran en `supabase/functions/_shared/route.ts` (`routeOwner`) y en el handler.
- Front: clientes HTTP por dominio en `src/lib/api/` (contratos Zod en `src/lib/api/contracts.ts`,
  agregados en `edgeApi`). Las pantallas usan los hooks de `src/lib/hooks/queries.ts`
  (TanStack Query); `src/lib/services/` es una capa de compatibilidad que hoy delega en `edge`.
- **Migraciones:** nunca editar una migración ya aplicada. Cada cambio va en un archivo nuevo de
  `supabase/migrations/` con `create or replace` partiendo de la **última** definición de la
  función (muchas RPC se redefinieron varias veces: buscar la más reciente), repitiendo
  `revoke`/`grant execute ... to service_role`. Errores de permiso: `raise ... errcode =
  'insufficient_privilege'` (la edge lo traduce a 403, `_shared/errors.ts`).
- **Offline (taller):** el panel encola operaciones en `src/lib/offline/sync.ts` (IDs e
  idempotency keys generados en el cliente) y se reenvían por lote a la edge `offline-sync`. Los
  tipos de operación están cerrados en el RPC de lote; uno nuevo requiere tocar cola, RPC y
  manejo de conflictos (`sync_conflict_resolution`).
- Zona horaria del negocio: `America/Argentina/Buenos_Aires` (los "días" se calculan en esa zona).
- Reglas de negocio puras del front en `src/lib/domain/rules.ts` (tests en `rules.test.ts`); tipos
  en `types.ts`, esquemas Zod de formularios en `schemas.ts`, traducción de errores en
  `errores.ts`.
- Datos de prueba ficticios: `docs/datos-prueba.md` y `npm run datos:demo`.

## Particularidades técnicas

- Next.js 16: `middleware` ahora se llama `src/proxy.ts`; `params`, `searchParams` y `cookies()`
  son solo async. Usar los tipos globales `PageProps<"/ruta">` y `LayoutProps<"/ruta">` (se generan
  con `npx next typegen`). Ante la duda, leer `node_modules/next/dist/docs/`.
- shadcn/ui con preset radix-nova; `cn` viene del paquete `cn` (oficial de shadcn) y se importa
  desde `@/lib/utils`. No modificar `src/components/ui/` salvo necesidad.
- **Select de Radix:** pasar siempre un string como `value` (`""` para vacío, nunca `undefined`), y
  en `onValueChange` ignorar `""` (`(v) => v && onChange(v)`): cuando el valor se fija por código,
  el `<select>` nativo oculto de Radix emite `""` y borra el valor.
- Diálogos con formulario: usar `FormDialog`, `CampoTexto` y `PieFormulario` de
  `src/components/common/form-dialog.tsx`. Mutaciones con `useServiceMutation` (toast e
  invalidación incluidos).
- Evitar escapes `\uXXXX` al escribir archivos: la herramienta los convierte en el carácter literal.
  Para quitar tildes usar `.replace(/\p{Diacritic}/gu, "")`.

## Verificación antes de dar una fase por terminada

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, y probar el flujo en el navegador
(también en ancho de celular). Prettier: `npm run format`. Si se tocó la base o las edge functions:
tests pgTAP (`supabase/tests/database/`, con Supabase local) y e2e (`npm run test:e2e`, carpeta
`e2e/flujos/`; los helpers del taller están en `e2e/support/taller.ts`).

Publicar: base → edge functions → front, en ese orden (detalle en `correcciones.md`).
