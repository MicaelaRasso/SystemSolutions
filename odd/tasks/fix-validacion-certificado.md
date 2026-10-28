# Corrección: «malformed array literal» al iniciar el borrador de certificado

## Problema

Con conexión, «Iniciar Borrador de certificado» falla con `malformed array literal: "fecha_ejecucion"`. `api_start_certificate_draft` devuelve la validación del borrador nuevo (`api_certificate_validation` → `api_validate_certificate_payload`). Un borrador nuevo no tiene fecha de ejecución, y la validación hace `missing_fields := missing_fields || 'fecha_ejecucion'`. En Postgres, `text[] || 'literal sin tipo'` interpreta el literal como un arreglo (`{...}`) y falla. Afecta a toda rama de la validación que agrega un campo faltante o inválido.

## Decisiones

- Migración nueva y aditiva (`create or replace function`), sin tocar datos. El usuario la aplica con `supabase db push`.
- Solo se reemplazan, en la versión vigente de cada función, los `var || 'literal'` sobre arreglos de texto por `var || 'literal'::text`. No se cambia ninguna otra lógica.
- La prueba SQL no se puede ejecutar sin base de datos local: queda escrita para cuando exista.
- No se crean ramas ni se hacen commits sin que el usuario lo indique.

## Tareas

- [x] F1: identificar la versión vigente de cada función con el patrón (última definición por nombre entre las migraciones). *Script de análisis sobre las 53 migraciones (181 funciones vigentes): 3 funciones afectadas, 20 puntos.*
- [x] F2: migración con esas funciones corregidas, con los mismos permisos. *`20261014130000_fix_certificate_validation_array_literals.sql`; `create or replace` conserva permisos (ninguna se recreó con `drop`).*
- [x] F3: prueba SQL de que un payload vacío devuelve `missing_fields` en vez de fallar. *Nueva `certificate_validation_array_literals.test.sql` (plan 7) y 2 aserciones en `replacement_catalog_visit_freeze.test.sql` (plan 16 a 18) sobre `api_start_certificate_draft`. No ejecutadas: no hay base local.*

## Progreso

- 2026-10-14: diagnóstico confirmado leyendo `20261003221209_canonical_certificate_payload_catalog_contract.sql` (líneas 324-468 y 524-568). Alcance aprobado por el usuario.
- 2026-10-14: F1-F3 hechas. Funciones vigentes afectadas: `api_validate_certificate_payload(jsonb)` (16 puntos, `20261003221209...sql:324`), `api_certificate_test_validation(jsonb)` (3, `20261005154526...sql:29`) y `api_certificate_validation(public.certificados)` (1, `20261005154526...sql:87`). La migración cambia solo `|| 'x'` por `|| 'x'::text` (diff verificado). `api_validate_custom_certificate_fields` usa `|| ('prefijo_' || key_name)` (texto tipado): sin cambio. Verificación: `npm run typecheck` y `npm test` (464) pasan; el SQL no se pudo ejecutar. Pendiente del usuario: `supabase db push` y probar «Iniciar Borrador» con conexión.
