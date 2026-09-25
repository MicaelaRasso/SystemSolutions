# System Solutions — Gestión de calibración de válvulas de seguridad

Front end (Next.js 16 + Tailwind 4 + shadcn/ui) del sistema descrito en `Contexto/DRF_System_Solutions_v1_1`.
El plan de implementación y su avance están en [`planning.md`](planning.md).

> La app frontend funciona actualmente contra datos simulados guardados en el
> `localStorage` del navegador (`NEXT_PUBLIC_DATA_SOURCE=mock`). El backend
> Supabase ya dispone de la migración PostgreSQL y la Edge Function
> `service-access`; la implementación `src/lib/services/supabase/` todavía debe
> conectarse a esos contratos sin modificar las pantallas.

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
    auth/              Sesión simulada (cookie) y AuthProvider
```

Variables opcionales: `NEXT_PUBLIC_MOCK_ERROR_RATE` (0–1) simula errores de red para probar estados de error.

## Backend Supabase

La API autenticada está documentada en [`supabase/README.md`](supabase/README.md). Todas las operaciones de negocio pasan por la Edge Function `service-access`, que delega en RPCs PostgreSQL con las reglas de autorización del dominio. El acceso directo a las tablas está bloqueado por RLS y privilegios de base de datos.
