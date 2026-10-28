# Checklist de prueba manual: responsive

Se recorre mientras se prueban los flujos funcionales. No hay capturas automáticas: lo que figura acá se revisó leyendo el código y compilando, no mirando la pantalla.

## Cómo usarlo

- Probar en un celular real (375 px de ancho), una tablet en vertical (768 px) y en horizontal (1024 px) y una PC (1280 px o más). Para PC alcanza con achicar la ventana.
- Marcar `[x]` en la columna del dispositivo cuando la pantalla se ve y se usa bien. Si algo falla, dejarlo sin marcar y anotar qué pasó.
- El menú lateral pasa a panel desplegable (botón de arriba a la izquierda) por debajo de 1024 px.

## Qué se mira en todas las pantallas

1. La página no se desplaza hacia los costados (solo lo hacen el cronograma y la hoja A4 del certificado, que tienen su propio desplazamiento).
2. Todo lo que se toca mide al menos 44 px en pantallas táctiles.
3. Al tocar un campo de texto en el celular no se hace zoom.
4. Los diálogos entran en la pantalla y Guardar / Cancelar quedan siempre a la vista.
5. Las tablas se ven como tarjetas en celular.
6. Nada depende de pasar el mouse por encima.
7. Los encabezados con botones se acomodan en varias líneas sin cortarse.

## Administración

| Ruta | Qué mirar | Cel | Tab | PC | Notas |
| --- | --- | :-: | :-: | :-: | --- |
| `/admin` (Panel) | Fechas Desde / Hasta lado a lado; tarjetas de métricas en 1, 2, 3 o 5 columnas; conflictos de sincronización con campos de fecha y hora y botones de resolver | [ ] | [ ] | [ ] | |
| `/admin/cronograma` | Selector de taller en el celular (un taller por vez, días en bloques); en tablet y PC la grilla se desplaza hacia los costados con la columna de días fija; menú de la tarea (Asignar a / Sin asignar) alcanzable con el dedo; semana anterior / Hoy / siguiente; nómina del día | [ ] | [ ] | [ ] | |
| `/admin/agenda` | Calendario del mes con puntos y lista del día elegido en el celular; tocar el día; botón Nueva del día; chips de taller y Mostrar canceladas se acomodan; en PC "+N más" | [ ] | [ ] | [ ] | |
| `/admin/tareas` | Filtros plegados en "Filtros (n)" en el celular; Próximas / Pasadas / Todas; tarjetas tocables que abren la tarea; fila entera tocable en la tabla; solicitudes sin visita (fecha, hora, taller, Programar visita) | [ ] | [ ] | [ ] | |
| `/admin/tareas/nueva` | Formulario en una columna en el celular; selector de fecha propio dentro de la pantalla (375 px); casillas de condiciones fáciles de tocar; Adjuntar archivo; Crear / Cancelar a todo el ancho | [ ] | [ ] | [ ] | |
| `/admin/tareas/[id]` | Encabezado con Cancelar tarea (pide el motivo en un diálogo propio); mismo formulario que Nueva; órdenes de trabajo: Marcar evaluada / No evaluada con su motivo | [ ] | [ ] | [ ] | |
| `/admin/clientes` | Buscador y Mostrar inactivos; tarjetas con contacto, yacimientos, válvulas y aviso; tabla en tablet y PC; tocar el cliente abre su ficha | [ ] | [ ] | [ ] | |
| `/admin/clientes/nuevo` | Formulario en una columna; Crear cliente / Cancelar sin cortarse; Volver arriba tocable | [ ] | [ ] | [ ] | |
| `/admin/clientes/[id]` (datos) | Pestañas Datos / Estructura / Usuarios sin cortarse; formulario de la empresa; logo (subir y quitar); firma pendiente del portal si aparece | [ ] | [ ] | [ ] | |
| `/admin/clientes/[id]/estructura` | Árbol → detalle: en celular y tablet vertical se ve solo el árbol y al elegir un elemento aparece el detalle con "Volver al árbol"; en PC lado a lado; expandir y contraer con el dedo; alta de yacimiento, planta, equipo y válvula en diálogos; ficha de válvula en una columna; historial de certificados como tarjetas | [ ] | [ ] | [ ] | |
| `/admin/clientes/[id]/usuarios` | Tarjetas con acciones de 44 px (reenviar, recuperar, editar, deshabilitar); diálogo de usuario con el selector de accesos y el pie siempre visible; interruptor de cuenta | [ ] | [ ] | [ ] | |
| `/admin/talleres` | Tarjetas de talleres; diálogo de alta y edición: elegir el color con el dedo; reenviar invitación / enviar recuperación; pestaña de personal con buscador y diálogo de persona | [ ] | [ ] | [ ] | |
| `/admin/catalogos` | Pestañas Listas / Patrones; selector de lista en celular y tablet, lista lateral en PC; filas de opciones (editar, interruptor, subir y bajar) que se acomodan en dos líneas; patrones como tarjetas; diálogo con "Sumar un año" | [ ] | [ ] | [ ] | |
| `/admin/certificados` | Filtros plegados en el celular (selectores nativos); Aplicar y Limpiar filtros; tarjetas con Ver detalle y Descargar; paginación Anterior / Siguiente | [ ] | [ ] | [ ] | |
| `/admin/certificados/[id]` | Hoja A4 escalada al ancho de la pantalla y botón "Ver a tamaño real" con desplazamiento propio; Exportar datos (JSON); historial y eventos de auditoría legibles; "Volver al historial" tocable | [ ] | [ ] | [ ] | |
| `/admin/auditoria` | Filtros plegados en el celular; tarjetas con el botón Ver (detalle del evento en línea); en PC panel flotante del detalle; Exportar JSON / CSV (superadmin); paginación | [ ] | [ ] | [ ] | |
| `/admin/configuracion/certificado` | Lista de versiones sobre el editor en celular, lado a lado desde 1280 px; filas de campos en una columna; mover arriba y abajo; Guardar y Activar a todo el ancho; selector de tipo | [ ] | [ ] | [ ] | |
| `/admin/backups` | Redirige a `/superadmin/backups` (solo superadmin) | [ ] | [ ] | [ ] | |

## Superadministración y cuenta

| Ruta | Qué mirar | Cel | Tab | PC | Notas |
| --- | --- | :-: | :-: | :-: | --- |
| `/superadmin` | Redirige a Administradores | [ ] | [ ] | [ ] | |
| `/superadmin/administradores` | Formulario de invitación en una columna; selector de rol nativo; tarjetas de cuentas con correos largos que cortan; botones Reenviar / Recuperar / Deshabilitar | [ ] | [ ] | [ ] | |
| `/superadmin/backups` | Botones de alcance (completo / por fechas) apilados; fechas Desde y Hasta; casilla de confirmación grande; botón largo "Generar y descargar ZIP" que no se corta; aviso de éxito con SHA-256 que corta | [ ] | [ ] | [ ] | |
| `/cuenta/seguridad` | Formulario de cambio de email; email actual largo corta; botón al ancho | [ ] | [ ] | [ ] | |

## Acceso

| Ruta | Qué mirar | Cel | Tab | PC | Notas |
| --- | --- | :-: | :-: | :-: | --- |
| `/` | Redirige a `/login` | [ ] | [ ] | [ ] | |
| `/login` | Panel de marca solo desde 1024 px; logo arriba en celular; teclado de email y contraseña sin zoom; "Olvidé mi contraseña" tocable; avisos de sesión expirada o invitación inválida | [ ] | [ ] | [ ] | |
| `/setup-password` | Tarjeta centrada; dos campos de contraseña sin zoom; mensaje de enlace inválido y botón de volver | [ ] | [ ] | [ ] | |
| `/reset-password` | Igual que la anterior | [ ] | [ ] | [ ] | |
| `/sin-acceso` | Mensaje centrado y botones que se acomodan en dos líneas | [ ] | [ ] | [ ] | |

## Taller (tablet y celular de campo)

| Ruta | Qué mirar | Cel | Tab | PC | Notas |
| --- | --- | :-: | :-: | :-: | --- |
| `/taller` | Lista de visitas; abrir una visita (ancho completo); Evaluada / No evaluada con el dedo; captura del certificado: selectores nativos, números con teclado decimal, casillas grandes; fotos (cámara y galería); **firma con el dedo** (lienzo alto, Limpiar); barra de Guardar fija abajo | [ ] | [ ] | [ ] | |
| `/taller/sincronizacion` | Estado de la cola; ids largos que cortan; botón Reintentar | [ ] | [ ] | [ ] | |

## Portal del cliente

| Ruta | Qué mirar | Cel | Tab | PC | Notas |
| --- | --- | :-: | :-: | :-: | --- |
| `/portal` (Calendario) | Lista de días con visitas en el celular (sin grilla); detalle del día debajo; en PC columna lateral desde 1280 px; Mostrar canceladas | [ ] | [ ] | [ ] | |
| `/portal/turnos` | Filtros plegados en "Filtros (n)"; tarjetas de visitas | [ ] | [ ] | [ ] | |
| `/portal/certificados` | Tarjetas bajo 768 px; tabla desde 768 px; botón Ver certificado | [ ] | [ ] | [ ] | |
| `/portal/certificados/[id]` | **Hoja A4 escalada** al ancho y botón "Ver a tamaño real"; imprimir mantiene el tamaño real | [ ] | [ ] | [ ] | |
| `/portal/empresa` | Datos y logo de la empresa; textos largos cortan; botones de 44 px | [ ] | [ ] | [ ] | |

## Defectos encontrados

| Pantalla | Dispositivo | Qué pasa |
| --- | --- | --- |
| | | |
| | | |
| | | |
