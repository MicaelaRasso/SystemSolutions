# Edge Function-only application data gateway

**Status: accepted**

The browser may communicate directly with Supabase Auth only to establish,
refresh, and end a Cuenta session. Every application-data and asset operation
is otherwise sent to an authenticated Supabase Edge Function. This includes
reads and mutations of Clientes, Yacimientos and their Descendientes, service
workflow operations, certificate data, and uploads or retrieval of Imagenes
del certificado and Firmas digitalizadas.

The browser must not call PostgreSQL tables, database RPCs, the Supabase Data
API/PostgREST, or Supabase Storage directly. In particular, a Cuenta's JWT is
not sufficient authority to invoke an application RPC from the browser. Edge
Functions form the browser-facing application API and must validate the
authenticated Cuenta and request contract before performing the operation.

PostgreSQL remains the final authorization boundary. RLS, database privileges,
and the domain authorization checks in database functions continue to enforce
Cliente and Taller Móvil access to a Yacimiento and its Descendientes. The
database configuration must reject direct `anon` and `authenticated` Data API
access to application tables and RPCs; it may admit only requests made through
the internal Edge Function gateway. This requirement is defense in depth, not
a replacement for database authorization.

## Consequences

- Frontend services call authenticated Edge Function routes; components do not
  import a Supabase database or Storage client.
- Each new data or asset capability requires an Edge Function route, request
  and response contract, and authorization test before a frontend screen uses
  it.
- Browser-facing signed Storage upload or download URLs are not part of this
  boundary. The Edge Function performs or proxies those operations.
- Tests must demonstrate that a direct table or RPC request made with a valid
  authenticated JWT is rejected, while the equivalent authorized Edge Function
  request succeeds.
