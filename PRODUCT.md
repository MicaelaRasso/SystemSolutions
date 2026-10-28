# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Administrador de System Solutions:** organiza la agenda y el cronograma semanal de talleres, gestiona clientes y su estructura, consulta el histórico y las métricas. Trabaja en PC.
- **Taller móvil:** cuenta compartida por equipo, usada en tablets Android de gama media en el campo, con o sin conexión. Registra la calibración y emite el certificado.
- **Cliente:** operadoras y contratistas del sector petrolero, con uno o más usuarios por empresa. Consulta su calendario de visitas, el histórico y descarga certificados vigentes y firmados.
- **Súper administrador:** gestiona cuentas de administrador y backups.

## Product Purpose

Gestionar la calibración, como mínimo anual, de válvulas de seguridad (PSV) y emitir el certificado digital que reemplaza al papel. El sistema reemplaza una herramienta externa y arranca sin migrar datos.

## Operating Context

Jerarquía: Cliente → Yacimiento → Planta/Locación → Equipo → Válvula. Flujo: el Admin carga la solicitud, se agenda una visita con un taller, el taller ejecuta en campo, carga datos, fotos y firmas, y al sincronizar el servidor asigna el número de certificado.

## Capabilities and Constraints

- El certificado debe respetar el modelo SYS (secciones 1.0 a 1.8, fotos, ensayos y firmas) y el pie legal.
- Sin firmas, el Cliente solo previsualiza con la leyenda "REQUIERE FIRMA" y no puede descargar. El Admin descarga siempre.
- El Cliente solo ve certificados vigentes y únicamente sus yacimientos asignados. No solicita turnos (fase posterior, marzo de 2027).
- Idioma de la interfaz: español.
- Decisiones abiertas con el cliente: formato del número de certificado, nombre del PDF (P-08), operadora frente a contratista.

## Evidence on Hand

- `Contexto/DRF_System_Solutions_v1_1 (1).pdf`: requerimientos.
- `Contexto/SYS_Certificado Modelo*.pdf`: diseño del certificado y listas de referencia.
- Los datos semilla son ficticios. No inventar clientes, personas ni certificados reales.

## Product Principles

1. El certificado es el producto: fiel al modelo y legible impreso.
2. El campo manda: la carga funciona en tablet y sin conexión.
3. Cada rol ve solo lo que le corresponde.
4. Trazabilidad completa: nada se pierde y todo queda auditado.
