# Campos obligatorios marcados con (*)

**Objetivo:** que todo campo obligatorio de los formularios de la app muestre `*` junto a su etiqueta,
para que el usuario sepa qué tiene que completar antes de enviar.

**Origen:** pedido del usuario (2026-11-24) mientras probaba los flujos de aceptación.

## Alcance

- Todos los formularios de `src/` (admin, superadmin, taller, portal): clientes, estructura
  (yacimiento/planta/equipo/válvula), usuarios, talleres, tareas, visitas, certificados, catálogos.
- La obligatoriedad sale del esquema Zod / validación real del formulario, no se inventa.
- Fuera de alcance: cambiar qué campos son obligatorios; `src/components/ui/` salvo necesidad.

## Criterios de aceptación

- Cada campo obligatorio muestra `*` en la etiqueta (visual, `aria-hidden`) y el control lleva
  `aria-required` o `required` semántico sin activar la validación nativa del navegador.
- Los campos opcionales no muestran `*`.
- Un único mecanismo compartido (no asteriscos escritos a mano en cada etiqueta).
- typecheck, lint, npm test, build y e2e 00–12 en verde (los selectores por etiqueta no se rompen).

## Tareas

- [x] T1 — Mecanismo compartido de etiqueta obligatoria + aplicarlo en todos los formularios.
  Ruta: delegada (toca muchos archivos no triviales).

## Progreso y evidencia

### T1 (2026-11-24, ruta delegada)

- Mecanismo: `src/components/common/etiqueta-obligatoria.tsx` con `MarcaObligatoria` (`*` con
  `aria-hidden="true"`) y `EtiquetaCampo` (`FieldLabel` + prop `requerido`). `CampoTexto` acepta
  `requerido` (marca + `aria-required` en el control). Los formularios con `Label` usan
  `<MarcaObligatoria />` dentro de la etiqueta. `DatePicker` acepta `aria-required`. Sin atributo
  `required` nativo nuevo; los nombres accesibles no cambian.
- Formularios: cliente (razón social, CUIT, contacto, teléfono), usuario del cliente, yacimiento
  (nombre, provincia, operadora), planta, equipo, válvula (TAG) y alta de válvula en campo (equipo),
  persona del taller, taller (nombre, email, color), patrón, tarea (ubicación x4, fechas, contacto,
  teléfono, tipo, detalle), cierre de visita vencida (motivo; taller/fecha/horario solo si se pide
  seguimiento), diálogo de motivo, login, alta y recuperación de contraseña, cuenta (nuevo email),
  administradores (correo, nombre, apellido), backup por rango (desde/hasta), firma pendiente del
  portal (nombre, foto), visita del taller (PD, firmante del Cliente, técnico ejecutor), captura de
  certificado (fecha, técnico, ensayos, patrón, campos de plantilla obligatorios; reemplaza los
  `" *"` escritos a mano) y versión de plantilla.
- Omitidos a propósito: filtros y buscadores (no son obligatorios); selects que siempre tienen
  valor (estado de tarea, rol de administrador); campos sin etiqueta visible (solo `aria-label` o
  placeholder: motivo de no evaluada, conflictos de sincronización, listas de catálogos); filas del
  editor de plantillas sin validación en cliente.
- Verificación: `npm run typecheck` OK; `npm run lint` OK; `npm test` (PowerShell) 84 archivos /
  826 tests OK; `npm run build` OK. E2E no se corrió: `servidor.mjs` compila en `.next-e2e` y
  `BASE_URL` es fijo en 3100, los mismos que la demo en curso. Los selectores `getByLabel` de `e2e/`
  siguen valiendo porque la marca es `aria-hidden` y Playwright compara por subcadena.
