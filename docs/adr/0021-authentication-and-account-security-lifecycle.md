# Authentication and account-security lifecycle

**Status: accepted**

System Solutions provisions Cuentas through administrator-triggered Supabase invitations and models their lifecycle as `pendiente`, `activa`, or `deshabilitada`; ordinary administration never deletes the identity, and each Cuenta keeps one immutable Rol. Invitation links use Supabase's configured Email OTP expiration (the current default is one hour), while resending invalidates the previous invitation. Cuenta owners may request password recovery by email, administrators may initiate recovery without seeing or setting passwords, and email changes require verification of the new address, notification of the old address where available, and session revocation. Regular Administradores may manage Cliente and Taller Móvil Cuentas; only Súper administradores may manage Administrador Cuentas. Disabling a Cliente or Taller Móvil disables its associated Cuentas while preserving them for reactivation. The MVP has no MFA and uses Supabase's normal refresh-session behavior, with application checks of current account state on each request; a disabled Cuenta is rejected immediately by the application even though an already-issued access-token JWT remains valid until expiry. A Taller Móvil uses one shared Cuenta that may have multiple sessions, with individual accountability supplied by the selected Técnico, visit and device events, signatures, and audit records. Security lifecycle events and rejected administrative attempts are audited, but passwords and ordinary successful logins are not; an incorrectly provisioned role is corrected by disabling the original Cuenta and creating a replacement.

## Consequences

- Account-state checks are part of every authenticated application-data path, not only login and session refresh.
- Email delivery and invitation/reset expiry remain governed by Supabase Auth configuration rather than a separate application timer.
- Shared Taller Móvil access remains operationally convenient, but visit-level device exclusivity and Técnico attribution remain necessary for accountability.
- Adding MFA later must extend this lifecycle without changing the immutable-role or preserved-history rules.
