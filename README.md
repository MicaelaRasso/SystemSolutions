# System Solutions — Gestión de calibración de válvulas de seguridad

Front end (Next.js 16 + Tailwind 4 + shadcn/ui) del sistema descrito en `Contexto/DRF_System_Solutions_v1_1`.
El plan de implementación y su avance están en [`planning.md`](planning.md).

> La app frontend funciona actualmente contra datos simulados guardados en el
> `localStorage` del navegador (`NEXT_PUBLIC_DATA_SOURCE=mock`). El backend
> Supabase dispone de la migración PostgreSQL, cinco Edge Functions por dominio
> y `service-access` como fallback temporal. Para usar la integración autenticada desde el navegador,
> configura `NEXT_PUBLIC_DATA_SOURCE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`,
> `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o el alias compatible
> `NEXT_PUBLIC_SUPABASE_ANON_KEY`) y las URLs directas opcionales
> `NEXT_PUBLIC_IDENTITY_ADMIN_URL`, `NEXT_PUBLIC_ASSET_ACCESS_URL`,
> `NEXT_PUBLIC_SERVICE_WORKFLOW_URL`, `NEXT_PUBLIC_CERTIFICATE_FIELD_URL` y
> `NEXT_PUBLIC_OFFLINE_SYNC_URL` (o `NEXT_PUBLIC_SERVICE_ACCESS_URL` como fallback).
> El adaptador usa exclusivamente la Edge
> Function para operaciones de negocio y archivos; el navegador solo se
> comunica directamente con Supabase Auth para la sesión. El modo `mock` sigue
> siendo el valor predeterminado para la demo.

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

Cuentas de demostración (contraseña `demo1234`), también disponibles con un clic en el login:

| Rol                 | Email                               |
| ------------------- | ----------------------------------- |
| Súper Administrador | superadmin@systemsrl.com.ar         |
| Administrador       | admin@systemsrl.com.ar              |
| Taller móvil        | taller1@systemsrl.com.ar            |
| Cliente             | cliente@compresionpatagonica.com.ar |

Desde el menú de usuario, **Restablecer datos demo** vuelve a la semilla original.

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
    services/          Contratos + implementación mock (datos semilla ficticios)
    hooks/queries.ts   Hooks de TanStack Query sobre los servicios
  auth/              AuthProvider; cookie mock sólo para demo/tests
  supabase/          Clientes SSR de Auth y contexto autorizado por Edge
```

Variables opcionales: `NEXT_PUBLIC_MOCK_ERROR_RATE` (0–1) simula errores de red para probar estados de error.

## Backend Supabase

La API autenticada está documentada en [`supabase/README.md`](supabase/README.md). Las operaciones pasan por la Edge Function propietaria de cada capacidad (`identity-admin`, `asset-access`, `service-workflow`, `certificate-field` u `offline-sync`); `service-access` sólo es un fallback temporal. El navegador no llama tablas, RPCs, Data API ni Storage directamente; Supabase Auth es la única excepción para gestionar la sesión. RLS y privilegios de base de datos conservan la autorización final.
