@AGENTS.md

# System Solutions — contexto del proyecto

Front end del sistema de gestión de calibración de válvulas de seguridad para System Solutions SRL
(cliente), desarrollado por Magne Studios. Idioma del proyecto: español (UI, dominio y comentarios).

## Cómo retomar

1. Leer `planning.md`: es el plan y la bitácora de avance. Las tareas hechas están tachadas `[x]`
   con una nota en cursiva de lo decidido. La sección 9 tiene los pendientes con el cliente y el
   supuesto que se tomó mientras tanto.
2. **Al trabajar, ir marcando en `planning.md` cada tarea que se completa** (pedido explícito del
   usuario) y agregar la nota de verificación al final de cada fase.
3. Fuentes: `Contexto/DRF_System_Solutions_v1_1 (1).pdf` (requerimientos RN/RF/RNF/CA),
   `Contexto/SYS_Certificado Modelo*.pdf` (diseño del certificado, con anotaciones a mano) y
   `Contexto/SYS_Certificado Modelo_Referencias.pdf` (listas desplegables). Si `Contexto/` no está
   en el repo, pedirle los PDFs al usuario.

Estado al 2026-09-24: fases 0 a 4 terminadas y verificadas. Sigue la **fase 5** (app de campo y
certificado), la más crítica.

## Reglas de arquitectura

- **Solo front end por ahora.** No hay backend: todo corre contra datos simulados en el
  `localStorage` del navegador. Stack final: Next.js + Supabase (Postgres, Auth, Storage, RLS)
  + Edge Functions.
- Las pantallas **nunca** acceden a datos directo: usan los contratos de
  `src/lib/services/contracts.ts` a través de los hooks de `src/lib/hooks/queries.ts`
  (TanStack Query). La implementación actual está en `src/lib/services/mock/`; la de Supabase irá
  en `src/lib/services/supabase/` con las mismas interfaces. Cada contrato indica con un comentario
  "Futuro: …" su destino real.
- Los mocks respetan las reglas de negocio que después hará el backend (numeración, filtros por
  cliente, validaciones) y simulan latencia.
- Reglas de negocio puras en `src/lib/domain/rules.ts`, con tests en `rules.test.ts`. Tipos en
  `types.ts`, esquemas Zod de formularios en `schemas.ts`, valores semilla en `catalogos.ts`.
- Si cambia la forma de los datos del seed, subir `MOCK_DB_VERSION` en
  `src/lib/services/mock/seed.ts` para que se regenere el `localStorage`.
- Datos semilla ficticios (empresas y personas inventadas). Contraseña demo: `demo1234`.

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
(también en ancho de celular). Prettier: `npm run format`.
