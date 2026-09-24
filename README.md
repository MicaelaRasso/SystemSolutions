# System Solutions — Gestión de calibración de válvulas de seguridad

Front end (Next.js 16 + Tailwind 4 + shadcn/ui) del sistema descrito en `Contexto/DRF_System_Solutions_v1_1`.
El plan de implementación y su avance están en [`planning.md`](planning.md).

> Por ahora no hay backend: la app funciona contra datos simulados guardados en el `localStorage`
> del navegador (`NEXT_PUBLIC_DATA_SOURCE=mock`). La conexión con Supabase + Edge Functions
> se hace implementando `src/lib/services/supabase/` con los contratos de `src/lib/services/contracts.ts`.

## Uso

```bash
npm install
npm run dev        # http://localhost:3000
```

Cuentas de demostración (contraseña `demo1234`), también disponibles con un clic en el login:

| Rol | Email |
|---|---|
| Súper Administrador | superadmin@systemsrl.com.ar |
| Administrador | admin@systemsrl.com.ar |
| Taller móvil | taller1@systemsrl.com.ar |
| Cliente | cliente@compresionpatagonica.com.ar |

Desde el menú de usuario, **Restablecer datos demo** vuelve a la semilla original.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | Chequeo de tipos |
| `npm run lint` | ESLint |
| `npm test` | Tests de reglas de negocio (Vitest) |
| `npm run format` | Prettier |

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
