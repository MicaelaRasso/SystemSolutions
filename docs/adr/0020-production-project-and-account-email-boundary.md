# System Solutions production project and account email boundary

**Status: accepted**

This is a single System Solutions project with no client billing or separate handoff boundary. Administradores create Cuentas, and the MVP sends the resulting `Correo de creación de cuenta` through Supabase; a future move to Resend remains undecided. The production domain is `SystemSolutions`. Privileged Edge Function credentials are stored in Supabase for the MVP and are not rotated during this scope. Certificate-expiration notifications remain outside the MVP under ADR-0011.
