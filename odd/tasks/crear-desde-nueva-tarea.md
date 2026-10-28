# Crear cliente, yacimiento y planta desde «Nueva tarea»

## Pedido del usuario

En `/admin/tareas/nueva`, al abrir el desplegable de Cliente se debe poder agregar un cliente nuevo en una ventana modal, sin cerrar ni perder el formulario de la tarea. Lo mismo para Yacimiento y para Planta / locación.

## Alcance

- Cliente, Yacimiento y Planta / locación. Equipo / unidad no se pidió: queda fuera (se informa).
- Solo en el formulario de nueva tarea (`tarea-form.tsx`); el selector en otras pantallas no cambia.

## Decisiones

- Cada desplegable termina con una opción «+ Agregar …» (separada de las demás) que abre la ventana modal. Se muestra aunque la lista esté vacía.
- Yacimiento solo ofrece crear si ya hay un cliente elegido; Planta solo si hay yacimiento. Se crean ya vinculados al nivel elegido.
- Al guardar, se refresca la lista y el valor nuevo queda seleccionado; el formulario de la tarea conserva todo lo que ya se había completado.
- Reusar los diálogos y formularios existentes de estructura (`estructura/dialogs.tsx`) y de clientes (`empresa-form.tsx`) en lugar de duplicarlos.
- Crear un cliente envía una invitación por correo a la cuenta del cliente (comportamiento actual de `/admin/clientes/nuevo`): se mantiene y se avisa en el diálogo.
- Los diálogos viven en un portal pero sus eventos suben por el árbol de React: el envío del diálogo no debe disparar el envío del formulario de la tarea (`stopPropagation`).
- No se crean ramas ni se hacen commits sin que el usuario lo indique.

## Tareas

- [x] C1: soporte en `UbicacionCascade` para una opción «+ Agregar» por nivel (prop opt-in), con lógica pura probada (cuándo se ofrece, valor centinela, selección posterior).
- [x] C2: modal de cliente reutilizando el formulario existente, sin redirección, devuelve el cliente creado.
- [x] C3: modales de yacimiento y planta reutilizando `YacimientoDialog` / `PlantaDialog`, vinculados al nivel elegido.
- [ ] C4: integración en `tarea-form.tsx` y verificación (typecheck, lint, test, build). Hecho salvo la prueba manual en navegador (pendiente del usuario).

## Progreso

- 2026-10-14: alcance confirmado por el usuario.
- 2026-10-14 C1: lógica pura en `src/components/tareas/ubicacion-logica.ts` (centinela `CREAR`, `etiquetaCrear`, `opcionesDe`, `elegirNivel`) con 11 tests (RED observado: módulo inexistente; luego GREEN). `ubicacion-cascade.tsx` usa `OpcionesNivel` (opción «+ Agregar …» separada, sola si la lista está vacía) y prop opt-in `permitirCrear`; test de markup `ubicacion-cascade.test.tsx` con el Select de Radix reemplazado por etiquetas simples (4 tests). Para sumar Equipo: agregar `equipoId` a `NIVELES_CREABLES` y un diálogo en el cascade.
- 2026-10-14 C2: `EmpresaForm` acepta `dialogo={{cerrar,onCreated}}` (sin redirección, pie del diálogo, ids con prefijo para no chocar con `contacto`/`telefono` de la tarea, aviso de invitación por correo); nuevo `src/components/clientes/empresa-dialog.tsx`. La página `/admin/clientes/nuevo` queda igual. La invitación se confirma en `supabase/functions/asset-access/index.ts` (POST clients -> `inviteUserByEmail`).
- 2026-10-14 C3: `FormDialog`, `YacimientoDialog` y `PlantaDialog` aceptan `open`/`onOpenChange` y `trigger` opcional (usos existentes sin cambios). Los diálogos se montan en el cascade dentro de un `div.contents` con `onSubmit` + `stopPropagation` para que el alta no envíe el formulario de la tarea. El diálogo se abre desde `onCloseAutoFocus` del Select (con respaldo a 400 ms) para evitar disputa de foco y `pointer-events` bloqueados.
- 2026-10-14 C4: `tarea-form.tsx` pasa `permitirCrear` (aplica a alta y edición, ya que ambos usan `TareaForm`). Verificación: `npm run typecheck` OK; `npm test` 56 archivos / 453 tests OK; `npm run build` OK; `npm run lint` solo los 2 errores conocidos de `talleres/visitas-panel.tsx`; detector de diseño `[]`. Falta la prueba manual en navegador (sin verificación visual).
