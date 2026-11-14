-- `cuentas_security_audit` (20261006151926) solo se dispara con `update of estado`.
-- La columna heredada `activo` sigue siendo escribible y `sync_cuenta_estado` la
-- traduce a `estado` en un trigger BEFORE, pero PostgreSQL decide los triggers
-- `update of <columna>` por la lista SET de la sentencia, no por lo que cambie un
-- trigger BEFORE. Así, deshabilitar o reactivar una Cuenta por `activo` cambiaba el
-- acceso sin evento de auditoría (test: operational_audit_base, aserción 29).
--
-- El trigger pasa a escuchar también `activo`. La función ya compara old.estado con
-- new.estado (ya sincronizado), así que no duplica eventos ni registra cambios sin
-- efecto.
drop trigger if exists cuentas_security_audit on public.cuentas;
create trigger cuentas_security_audit
after insert or update of estado, activo on public.cuentas
for each row execute function public.audit_cuenta_security_change();
