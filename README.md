# System Solutions — Gestión de calibración de válvulas de seguridad

Front end (Next.js 16 + Tailwind 4 + shadcn/ui) del sistema descrito en `Contexto/DRF_System_Solutions_v1_1`.
El plan de implementación y su avance están en [`planning.md`](planning.md).

> La app frontend usa Supabase Auth y siete Edge Functions por dominio. Configura
> `NEXT_PUBLIC_SUPABASE_URL`,
> `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y las URLs directas opcionales
> `NEXT_PUBLIC_IDENTITY_ADMIN_URL`, `NEXT_PUBLIC_ASSET_ACCESS_URL`,
> `NEXT_PUBLIC_SERVICE_WORKFLOW_URL`, `NEXT_PUBLIC_AUDIT_LOG_URL`,
> `NEXT_PUBLIC_CERTIFICATE_FIELD_URL`, `NEXT_PUBLIC_OFFLINE_SYNC_URL` y
> `NEXT_PUBLIC_BACKUP_EXPORT_URL`. Si no se especifican URLs directas, se usan
> automáticamente las rutas propietarias bajo `NEXT_PUBLIC_SUPABASE_URL`.
> El adaptador usa exclusivamente la Edge
> Function para operaciones de negocio y archivos; el navegador solo se
> comunica directamente con Supabase Auth para la sesión.
> Las Edge Functions usan `SUPABASE_PUBLISHABLE_KEY` para validar sesiones y
> `SUPABASE_SECRET_KEY` para operaciones privilegiadas; la clave secreta nunca
> debe exponerse al navegador.

Para permitir que una sesión de Taller Móvil ya verificada navegue por el trabajo
cacheado durante una interrupción, configura `OFFLINE_SESSION_SECRET` en el
servidor Next.js con al menos 32 caracteres aleatorios. El ticket firmado dura
12 horas y solo habilita las rutas de Taller Móvil; las operaciones sincronizadas
siguen verificándose en las Edge Functions. Genera el valor con
`openssl rand -base64 32`.

## Stack

- Web application: Next.js
- Deployment: Vercel
- Backend edge functions: Supabase Edge Functions
- Database: PostgreSQL hosted by Supabase

## Uso

```bash
npm install
npm run dev        # http://localhost:3000
```

El acceso requiere una cuenta de Supabase Auth válida.

## Scripts

| Comando             | Qué hace                            |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Servidor de desarrollo              |
| `npm run build`     | Build de producción                 |
| `npm run typecheck` | Chequeo de tipos                    |
| `npm run lint`      | ESLint                              |
| `npm test`          | Tests de reglas de negocio (Vitest) |
| `npm run format`    | Prettier                            |

## Estructura

```
src/
  app/                 Rutas por rol: admin/, superadmin/, taller/, portal/, login/
  proxy.ts             Redirección por sesión y rol (Next 16: reemplaza a middleware)
  components/          UI por dominio (clientes/, estructura/, …) + shadcn en ui/
  config/navigation.ts Menú de cada rol
  lib/
    domain/            Tipos, esquemas Zod, catálogos y reglas de negocio (con tests)
    services/          Adaptadores compatibles sobre las capacidades Edge
    hooks/queries.ts   Hooks de TanStack Query sobre los servicios
  auth/              AuthProvider y sesión SSR de Supabase
  supabase/          Clientes SSR de Auth y contexto autorizado por Edge
```

## Backend Supabase

La API autenticada está documentada en [`supabase/README.md`](supabase/README.md). Las operaciones pasan por la Edge Function propietaria de cada capacidad (`identity-admin`, `asset-access`, `service-workflow`, `certificate-field` u `offline-sync`). El navegador no llama tablas, RPCs, Data API ni Storage directamente; Supabase Auth es la única excepción para gestionar la sesión. RLS y privilegios de base de datos conservan la autorización final.
