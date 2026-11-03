# Verificación de flujos de certificados y arreglo de `repuestos.otros`

## Objetivo

Corregir el error 400 al guardar el borrador de certificado y recorrer los flujos de la app para detectar qué más falla.

## Problema

`Invalid canonical certificate fields: ["repuestos"]` al guardar un borrador con el campo «Otros» vacío. El formulario envía `otros: null`, el contrato Zod lo admite (`src/lib/api/contracts.ts:228`), pero `api_validate_certificate_payload` lo rechaza: un `null` de JSON no es `NULL` de SQL, y su tipo es `'null'`, no `'string'`. `observaciones` sí tiene esa guarda; `otros` no.

## Alcance y restricciones

- Migración aditiva nueva, sin tocar datos ni migraciones ya aplicadas.
- Pruebas contra un Supabase local con Docker. No se toca el proyecto remoto ni los archivos `.env`.
- Sin ramas ni commits salvo pedido del usuario (regla del usuario). El árbol ya tiene 50 archivos modificados sin commitear que no se revierten.
- `supabase db push` remoto y la publicación de funciones quedan a decisión del usuario.
- Los fallos que aparezcan se registran; se corrigen solo si el usuario lo autoriza.

## Tareas

- [x] F1: test SQL en rojo y migración que acepta `otros: null`. Ruta: inline (un archivo mecánico más su test). *`certificate_repuestos_otros_null.test.sql` falló solo en el caso `otros: null` y pasó 4/4 con `20261103020000_allow_null_repuestos_otros.sql`. Pendiente aplicarla en el remoto.*
- [x] F2: `typecheck`, `lint`, `test` y `build` sobre el árbol actual. Ruta: delegada por volumen de salida. *Pasan `typecheck`, `test` (495) y `build`. Fallan `lint` (7 errores `react-hooks/set-state-in-effect`) y la suite SQL (18 de 28 archivos, en su mayoría tests desactualizados; `parte_diario` sin causa identificada).*
- [x] F3: Supabase local con migraciones, funciones y datos de prueba. Ruta: delegada. *Stack en el puerto 55321; Next en una copia del scratchpad porque el `next dev` del usuario ocupa la carpeta del repo.*
- [x] F4: flujos 1 a 4 del plan en navegador, incluido ancho de celular. Ruta: delegada (script Playwright fuera del repo). *Sin errores de red a hosts remotos desde el navegador. Con defectos; ver Progreso. Los flujos de taller se probaron a 820 px, no a 390 px.*
- [x] F5: quitar el `console.error` de diagnóstico de `src/lib/services/edge-transport.ts`. Ruta: inline.
- [x] F6: matriz de cobertura de RN, RF, RNF y CA del DRF. Ruta: delegada (lectura amplia). *90 requerimientos, por lectura de código: 45 implementados, 34 parciales, 7 faltantes, 4 sin determinar. Los ADR 0001, 0005 y 0014 (aceptados) contradicen al DRF; los tests siguen a los ADR y las diferencias se informan.*
- [ ] F7: tests propios basados en requerimientos, incluidos los flujos end-to-end. Ruta: delegada (2 o más archivos).
- [x] F8: botón para instalar la app como PWA, visible para todos los roles. Ruta: delegada (2 o más archivos). *Manifest, íconos, service worker y botón en `AppShell`. Comprobado en un build de producción local con los 4 roles, a tamaño escritorio y 390 px. Falta probar una instalación real, iOS y Firefox. D9 queda resuelto solo para recargar sin conexión; la captura y sincronización offline con el service worker no se probaron.*
- [ ] F9: revisar tipos y medir rendimiento; corregir solo problemas comprobados. Ruta: a definir según lo medido.
- [ ] F10: informe final de resultados.

## Criterios de aceptación

- Un payload con `otros: null` no marca `repuestos` como inválido; uno con `otros: 123` sí.
- El borrador se guarda con «Otros» vacío en el flujo real.
- Cada flujo queda informado como pasó, falló o no se pudo probar, con evidencia.

## Progreso

- 2026-11-03: diagnóstico confirmado contra una base local. Todas las migraciones existentes se aplican desde cero sin errores.
- 2026-11-03: otro proyecto local (`evopadel`) ocupa los puertos por defecto de Supabase y no se toca. El stack de prueba corre desde una copia de `supabase/` en el scratchpad, sin `.temp` ni `.env`, con `project_id` propio y puertos 553xx.

- 2026-11-03: F3 y F4 ejecutadas en el stack local, con arreglos locales fuera del repo. El borrador con «Otros» vacío se guarda. Defectos sin corregir:
  - Bloqueantes: D1 la plantilla exige `fecha_ejecucion` y `tecnico_ejecutor` como campos personalizados y la visita no cierra; D2 un cierre fallido deja la firma y traba la visita; D3 el selector de técnico omite el apellido y da 403; D4 un reemplazo fuera de nómina da 403; D5 la ruta `follow-up-visits` da 404.
  - Graves: D6 el portal falla con `is_current: null`; D7 firmas y fotos no se muestran en el certificado; D8 `/taller/sincronizacion` no sube archivos; D9 no se puede recargar sin conexión.
  - Medios: D10 orden de trabajo, vencimiento de patrón y nómina vacíos; D11 no se guarda la edición de una tarea; D12 el PD/RTO de la tarea no llega a la visita.
  - Menores: D13 errores en inglés, `GET clients/` con 403, fechas ISO e ID en el historial.

- 2026-11-03: el service worker aplica el límite offline de 12 h del ADR-0009, que solo validaba el servidor. Rojo 8 fallidos, verde 61 tests en `src/lib/pwa`. Comprobado en navegador con marcas de tiempo envejecidas por script (11h59 abre, 12h01 bloquea). Un reloj atrasado a mano aún puede extender esa ventana.
- 2026-11-03: decisión sobre los tests: las diferencias entre ADR aceptados y DRF se prueban según el ADR y se informan; cada defecto abierto queda como fallo conocido con su ID.

## Próximo paso

F7 en curso con un agente escritor. Después F9. El usuario todavía debe decidir si se corrigen D1 a D13.
