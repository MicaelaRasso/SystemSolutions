# Flujos de aceptación

Recorridos de punta a punta para comprobar que el sistema cumple lo pedido en el DRF (los códigos
RF, RN, RNF y CA) y lo acordado después con el cliente. Cada flujo es independiente: tiene los datos
que necesita, los pasos por rol y el resultado esperado.

## Antes de empezar

| Entorno | Cómo preparar los datos |
|---------|-------------------------|
| Local | `npm run datos:demo` y después `npm run demo:app` (http://localhost:3100). Los escenarios QA-01 a QA-12 están en [`guia-pruebas-demo.md`](guia-pruebas-demo.md). |
| Producción | Crear datos de prueba a mano, con nombres que empiecen con «PRUEBA», por ejemplo «PRUEBA Cliente». El dataset de demo **no** se carga en producción. |

- **Roles:** hacen falta 4 sesiones: Súper administrador, Administrador, Taller Móvil (en un celular o tablet) y Cliente. Conviene usar otro navegador o una ventana privada para cada una.
- **Ancho de pantalla:** probar cada flujo también a ancho de celular.
- **Registro:** marcar cada resultado. Si algo falla, anotar el paso, el mensaje que apareció y una captura.

---

## F1. Alta de cliente y estructura

**Cubre:** RF-02, RF-05, CA-06. **Rol:** Administrador.

1. Clientes → Nuevo cliente: cargar los datos y el correo del usuario cliente.
2. Sin esperar a que el cliente active su cuenta, cargar un yacimiento, una planta, un equipo y dos válvulas con sus datos técnicos.
3. Corregir un error de tipeo en el nombre del equipo.
4. Subir el logo del cliente.

**Resultado esperado**
- [ ] El cliente queda con la cuenta «pendiente» y le llega el correo de invitación.
- [ ] Se puede cargar toda la estructura sin que el cliente active la cuenta.
- [ ] El cambio de nombre se guarda y se ve en las listas.
- [ ] El logo se ve en la ficha del cliente.

## F2. Crear una tarea (solicitud y visita)

**Cubre:** RF-13, RF-14, RF-16, RN-11, CA-01. **Rol:** Administrador.

1. Tareas → Nueva tarea: elegir cliente, yacimiento y equipo, y cargar el PD/RTO, la orden de trabajo y el taller.
2. Cargar la fecha, el inicio y el **fin estimado** (el formulario propone inicio + 1 h).
3. Guardar.
4. Repetir con un equipo **sin válvulas**.
5. Repetir con el mismo equipo del paso 1, en un horario que se superponga con la visita anterior.
6. Crear una tarea **sin taller** y después asignarle uno desde «sin visita».

**Resultado esperado**
- [ ] En el paso 3 se crea la solicitud con su número y la visita con su horario.
- [ ] En el paso 4 la app no deja crear la tarea y avisa que el equipo no tiene válvulas. No aparece ninguna «Válvula 1» automática.
- [ ] En el paso 5 aparece un error en español y **no** se crea ninguna solicitud nueva.
- [ ] En el paso 6 la tarea aparece en «sin visita» con el nombre del yacimiento y la fecha precargada, y al asignarle un taller pasa a la agenda.

## F3. Agenda y cronograma

**Cubre:** RF-10, RF-11, RF-12, RF-39, CA-15. **Rol:** Administrador.

1. Abrir la agenda del mes y el cronograma por taller.
2. Tocar una tarjeta.

**Resultado esperado**
- [ ] Cada tarjeta muestra el horario (en 24 h), el cliente, la planta, el contacto, el teléfono y el detalle.
- [ ] El cronograma ordena las visitas por taller y por día.
- [ ] Al tocar una tarjeta se abre el detalle de la tarea.

## F4. Visita completa en campo, con conexión

**Cubre:** RF-17 a RF-27, RN-07, RN-12, RN-15, CA-02, CA-03, CA-10. **Rol:** Taller Móvil, en el celular.

1. Abrir la agenda y aceptar la visita de F2.
2. Iniciar la visita.
3. Cargar el **número de Parte Diario** del talonario y sacarle una foto («Sacar foto») o elegirla de la galería.
4. **Agregar una válvula en campo**:
   - una que ya existe en la estructura del cliente;
   - una nueva, creada en el momento.
5. Para cada válvula: evaluarla, completar el certificado, adjuntar las 3 fotos de evidencia y guardar el borrador.
6. Recargar la página y volver a la visita.
7. Firma del cliente presencial: nombre del representante y firma.
8. Firma del técnico: elegir **cualquier técnico**, incluso uno que no esté en la nómina del día.
9. Tocar «Completar visita» y **confirmar** en el diálogo.

**Resultado esperado**
- [ ] La visita aparece en la agenda aunque su horario ya haya pasado.
- [ ] El PD muestra la miniatura de la foto y el contador.
- [ ] Las válvulas agregadas se suman a la visita.
- [ ] Después de recargar siguen el borrador y las fotos.
- [ ] Antes de cerrar aparece la confirmación; tocando «Cancelar» no se cierra nada.
- [ ] Al confirmar se ve «Completando visita…» y después «Visita completada».
- [ ] Como Administrador: los certificados tienen número y no muestran la marca REQUIERE FIRMA.

## F5. Certificado: contenido y descarga

**Cubre:** RF-26, RF-27, RF-29, RN-05, RN-16, RNF-09, CA-02, CA-05, CA-14. **Rol:** Administrador. Usar un certificado de F4.

1. Abrir el certificado.
2. Descargarlo o imprimirlo.

**Resultado esperado**
- [ ] Las secciones 1.0 a 1.5 están en orden y les sigue el ANEXO.
- [ ] El encabezado tiene el logo de System Solutions y el logo del cliente.
- [ ] Aparecen la orden de trabajo de la tarea y la nómina de la jornada.
- [ ] El ANEXO tiene las 3 fotos de la válvula, y el PD con su número y su foto.
- [ ] La aprobación muestra los nombres, las fechas y las firmas dibujadas de ambos firmantes.
- [ ] El nombre de archivo sigue la nomenclatura acordada.

## F6. Firma diferida del cliente

**Cubre:** RN-04, RN-12, RF-23, RF-28, RF-35, RNF-12, CA-05. **Roles:** Taller Móvil, Cliente y Administrador.

1. Taller: hacer una visita como en F4, pero en la firma del cliente marcar **«No hay representante presente»** y cerrar.
2. Cliente: entrar al portal y abrir el certificado.
3. Cliente: firmar desde el portal.
4. Administrador: revisar la auditoría.

**Resultado esperado**
- [ ] Antes de la firma del cliente: el certificado no tiene número, muestra la marca REQUIERE FIRMA y el cliente no lo puede descargar.
- [ ] El Administrador sí puede descargarlo aunque falte la firma del cliente.
- [ ] Después de firmar: el certificado tiene número, no muestra la marca y el cliente lo puede descargar.
- [ ] La auditoría registra quién firmó, el nombre y la hora exacta.

## F7. Trabajo sin conexión

**Cubre:** RF-18, RF-19, RF-20, RF-21, RF-22, RF-25, RNF-04, RNF-07, RN-08, CA-02, CA-04. **Rol:** Taller Móvil, en el celular.

1. Con conexión: abrir la agenda y reservar la visita en el dispositivo.
2. Pasar a modo avión.
3. Recargar `/taller`, iniciar la visita, cargar el PD con su foto, agregar una válvula, capturar el certificado con sus fotos, firmar y completar.
4. Volver a tener conexión y abrir `/taller/sincronizacion`.

**Resultado esperado**
- [ ] Sin conexión la agenda sigue disponible y todo se guarda «pendiente de sincronizar».
- [ ] Al reconectar se suben las fotos y las firmas, la visita queda completada en el servidor y se emiten los números de certificado.
- [ ] No quedan «cambios fallidos». Si queda alguno, se ve su motivo y el botón «Reintentar sincronización».
- [ ] La válvula agregada sin conexión existe **una sola vez**.

## F8. Visita no terminada y visita de seguimiento

**Cubre:** RF-15, RF-25, RF-35, RF-40, RN-02, RN-03. **Roles:** Taller Móvil, Administrador y Cliente.

1. Taller: en una visita de 3 válvulas, certificar una, marcar otra como «no evaluada» con su motivo y cerrar la visita como **no terminada**.
2. Administrador: abrir la tarea y usar **«Programar otra visita»**.
3. Cliente: abrir `/portal/turnos`.

**Resultado esperado**
- [ ] La válvula no evaluada conserva su motivo.
- [ ] Al programar la nueva visita aparecen preseleccionadas las válvulas que faltaron.
- [ ] La visita de seguimiento se crea sin errores.
- [ ] El cliente ve las dos visitas dentro de la misma solicitud.

## F9. Una visita en curso por taller y cierre automático

**Cubre:** ADR 0024 (decisión del cliente del 14/11). **Roles:** Taller Móvil y Administrador.

1. Taller: iniciar una visita y, sin completarla, intentar iniciar otra.
2. Completar la primera y después iniciar la segunda **sin recargar la página**.
3. Dejar una visita en curso pasadas las 23:59. En producción hace falta tener pg_cron activo; ver `correcciones.md`.
4. Al día siguiente, como Administrador: cerrar la visita que quedó en «Requiere finalización».

**Resultado esperado**
- [ ] En el paso 1 la app no deja iniciar la segunda visita y explica por qué.
- [ ] En el paso 2 la segunda visita se puede iniciar.
- [ ] Pasadas las 23:59 la visita pasa sola a «Requiere finalización».
- [ ] El Administrador la puede cerrar, y el cierre **exige la firma del técnico**.

## F10. Reprogramar, cancelar y reabrir

**Cubre:** RF-15. **Rol:** Administrador.

1. Cambiar la fecha y el horario de una visita con taller y de otra sin taller.
2. Desasignar el taller de una visita aceptada, con un motivo, y volver a asignarlo.
3. Cancelar una visita y reactivarla; probarlo también con una visita que el taller ya había aceptado.
4. En una solicitud que ya tiene una visita completada, crear un seguimiento y cancelarlo.

**Resultado esperado**
- [ ] Las visitas se mueven en la agenda.
- [ ] La visita reabierta vuelve a «programada» y admite cambios.
- [ ] En el paso 4, «Programar otra visita» sigue disponible: cancelar el seguimiento no cancela la solicitud.

## F11. Portal del cliente

**Cubre:** RF-33, RF-35, RF-45, RN-01, RN-06, RN-09, CA-06, CA-08, CA-14. **Rol:** Cliente.

1. Abrir Turnos y el calendario.
2. Abrir Certificados y filtrar por Parte Diario.
3. Abrir un certificado vencido, desde la lista y pegando su URL directa.
4. Abrir Mi empresa.

**Resultado esperado**
- [ ] Turnos y calendario muestran solo las visitas del cliente.
- [ ] La lista de certificados carga rápido, sin fechas en formato técnico ni códigos internos.
- [ ] El filtro por PD funciona.
- [ ] El certificado vencido figura como tal, no se puede abrir ni descargar, tampoco por URL directa.
- [ ] Mi empresa muestra los datos y el logo, sin errores.

## F12. Seguridad y permisos

**Cubre:** RN-09, RN-14, RF-36, RF-46, RNF-01, RNF-02, RNF-03, CA-06.

1. Cliente A: intentar abrir por URL un yacimiento o un certificado del cliente B.
2. Cliente: buscar en el portal una opción para pedir turnos.
3. Administrador regular: intentar entrar a Backups.
4. Taller: intentar modificar un certificado ya finalizado.
5. Sin sesión: abrir cualquier pantalla interna.

**Resultado esperado**
- [ ] El cliente A no ve nada del cliente B.
- [ ] El portal no ofrece pedir turnos y la API rechaza que un cliente cree solicitudes.
- [ ] Solo el Súper administrador accede a Backups.
- [ ] El certificado finalizado no se puede modificar.
- [ ] Sin sesión, la app redirige al login.

---

## Resumen para firmar la aceptación

| Flujo | Resultado | Observaciones |
|-------|-----------|---------------|
| F1 Alta de cliente y estructura | ☐ OK ☐ Falla | |
| F2 Crear tarea | ☐ OK ☐ Falla | |
| F3 Agenda y cronograma | ☐ OK ☐ Falla | |
| F4 Visita completa con conexión | ☐ OK ☐ Falla | |
| F5 Certificado: contenido y descarga | ☐ OK ☐ Falla | |
| F6 Firma diferida del cliente | ☐ OK ☐ Falla | |
| F7 Trabajo sin conexión | ☐ OK ☐ Falla | |
| F8 No terminada y seguimiento | ☐ OK ☐ Falla | |
| F9 Una visita en curso y cierre automático | ☐ OK ☐ Falla | |
| F10 Reprogramar, cancelar y reabrir | ☐ OK ☐ Falla | |
| F11 Portal del cliente | ☐ OK ☐ Falla | |
| F12 Seguridad y permisos | ☐ OK ☐ Falla | |

**Fuera de alcance por ahora:** la plantilla de certificado por tarea (Etapa 4, issues #85, #87, #90, #92 y #93).
