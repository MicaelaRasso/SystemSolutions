import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { crearUsuario, edge, sql } from "./api"

/** Datos ficticios que la suite crea una sola vez por base. */
export type Semilla = {
  cuentas: { super: string; admin: string; taller: string; cliente: string; cliente2: string }
  tallerId: string
  yacimientoId: string
  plantaId: string
  yacimientoOtroClienteId: string
  valvulaOtroClienteId: string
  tecnicos: { principal: string; segundo: string }
  plantillaE2eId: string
}

export const CLIENTE = "Petrolera Ficticia SA"
export const OTRO_CLIENTE = "Gasífera Inventada SRL"
export const YACIMIENTO = "Campo Sur"
export const PLANTA = "Planta Uno"
export const TALLER = "Taller Norte"
export const TECNICO = { nombre: "Tomas", apellido: "Tecnico", completo: "Tomas Tecnico" }
export const SEGUNDO_TECNICO = { nombre: "Laura", apellido: "Lopez", completo: "Laura Lopez" }
export const VERSION_PLANTILLA_MIGRACION = "SYS_Certificado_Modelo1"

const ARCHIVO_SEMILLA = join("e2e", ".artifacts", "semilla.json")

type CampoPlantilla = { clave: string; obligatorio: boolean; [clave: string]: unknown }
type Plantilla = { id: string; version: string; estado: string; campos: CampoPlantilla[] }

/** Hoy y días vecinos en la zona horaria del negocio, sin depender de la de la máquina. */
export function fechaArgentina(desplazamientoDias = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + desplazamientoDias * 86_400_000))
}

export function leerSemilla(): Semilla {
  return JSON.parse(readFileSync(ARCHIVO_SEMILLA, "utf8")) as Semilla
}

async function plantillaDeMigracion() {
  const plantillas = await edge<Plantilla[]>("admin", "certificate-field", "certificate-templates")
  const encontrada = plantillas.find((p) => p.version === VERSION_PLANTILLA_MIGRACION)
  if (!encontrada) throw new Error(`Falta la plantilla ${VERSION_PLANTILLA_MIGRACION}`)
  return encontrada
}

/** Publica como versión nueva los campos dados y la deja activa, por la misma API que el panel. */
export async function activarPlantilla(version: string, campos: CampoPlantilla[]) {
  const borrador = await edge<Plantilla>("admin", "certificate-field", "certificate-templates", {
    method: "POST",
    body: { version, campos },
  })
  await edge("admin", "certificate-field", `certificate-templates/${borrador.id}/activate`, {
    method: "POST",
    body: {},
  })
  return borrador.id
}

/** Activa una copia exacta de la plantilla de la migración, la que exhibe el defecto D1. */
export async function activarPlantillaDeMigracion(sufijo: string) {
  const { campos } = await plantillaDeMigracion()
  return activarPlantilla(`migracion-${sufijo}`, campos)
}

/**
 * Aísla D1: misma plantilla que la migración, pero sin exigir como campos personalizados
 * `fecha_ejecucion` y `tecnico_ejecutor`. Son columnas propias del certificado y siguen validadas.
 */
export async function activarPlantillaSinD1(sufijo: string) {
  const { campos } = await plantillaDeMigracion()
  return activarPlantilla(
    `e2e-sin-d1-${sufijo}`,
    campos.map((campo) =>
      ["fecha_ejecucion", "tecnico_ejecutor"].includes(campo.clave)
        ? { ...campo, obligatorio: false }
        : campo,
    ),
  )
}

async function crearJerarquia(clienteId: string, yacimiento: string, planta: string) {
  const y = await edge<{ id: string }>("admin", "asset-access", "yacimientos", {
    method: "POST",
    body: {
      client_id: clienteId,
      clientId: clienteId,
      name: yacimiento,
      nombre: yacimiento,
      provincia: "Neuquén",
      operadora: "Operadora Ficticia",
      contratista: "Contratista Ficticia",
    },
  })
  const p = await edge<{ id: string }>("admin", "asset-access", "hierarchy", {
    method: "POST",
    body: { kind: "planta", parent_id: y.id, name: planta },
  })
  return { yacimientoId: y.id, plantaId: p.id }
}

async function sembrarDesdeCero(sufijo: string): Promise<Semilla> {
  const cuentas = {
    super: await crearUsuario("super", { nombre: "Sofia", apellido: "Superadmin" }),
    admin: await crearUsuario("admin", { nombre: "Ana", apellido: "Administradora" }),
    taller: await crearUsuario("taller", { nombre: TALLER, apellido: "" }),
    cliente: await crearUsuario("cliente", { nombre: "Carla", apellido: "Cliente" }),
    cliente2: await crearUsuario("cliente2", { nombre: "Otto", apellido: "Otro" }),
  }
  const tallerId = sql(`
insert into public.cuentas (id, rol, estado, activo) values
  ('${cuentas.super}', 'super_administrador', 'activa', true),
  ('${cuentas.admin}', 'administrador_regular', 'activa', true),
  ('${cuentas.taller}', 'taller_movil', 'activa', true),
  ('${cuentas.cliente}', 'cliente', 'activa', true),
  ('${cuentas.cliente2}', 'cliente', 'activa', true)
on conflict (id) do update set rol = excluded.rol, estado = 'activa', activo = true;
insert into public.clientes (cuenta_id, nombre, razon_social, cuit, contacto, telefono, email, direccion) values
  ('${cuentas.cliente}', '${CLIENTE}', '${CLIENTE}', '30-12345678-9', 'Carla Cliente', '299-555-0101', 'cliente@local.test', 'Calle Falsa 123'),
  ('${cuentas.cliente2}', '${OTRO_CLIENTE}', '${OTRO_CLIENTE}', '30-98765432-1', 'Otto Otro', '299-555-0102', 'cliente2@local.test', 'Calle Inventada 456')
on conflict (cuenta_id) do nothing;
with t as (insert into public.talleres_moviles (nombre, color) values ('${TALLER}', '#2563eb') returning id),
     l as (insert into public.taller_cuentas (taller_movil_id, cuenta_id) select id, '${cuentas.taller}' from t)
select id from t;
`)
    .split("\n")
    .pop()!

  const principal = await crearJerarquia(cuentas.cliente, YACIMIENTO, PLANTA)
  const otro = await crearJerarquia(cuentas.cliente2, "Campo Ajeno", "Planta Ajena")
  const equipoAjeno = await edge<{ id: string }>("admin", "asset-access", "hierarchy", {
    method: "POST",
    body: { kind: "equipo", parent_id: otro.plantaId, name: "K-AJENO" },
  })
  const valvulaAjena = await edge<{ id: string }>("admin", "asset-access", "hierarchy", {
    method: "POST",
    body: { kind: "valvula", parent_id: equipoAjeno.id, name: "PSV-AJENA" },
  })

  const tecnico = await edge<{ id: string }>("admin", "identity-admin", "technicians", {
    method: "POST",
    body: { nombre: TECNICO.nombre, apellido: TECNICO.apellido, dni: "30111222" },
  })
  const segundo = await edge<{ id: string }>("admin", "identity-admin", "technicians", {
    method: "POST",
    body: { nombre: SEGUNDO_TECNICO.nombre, apellido: SEGUNDO_TECNICO.apellido, dni: "30111333" },
  })

  return {
    cuentas,
    tallerId,
    ...principal,
    yacimientoOtroClienteId: otro.yacimientoId,
    valvulaOtroClienteId: valvulaAjena.id,
    tecnicos: { principal: tecnico.id, segundo: segundo.id },
    plantillaE2eId: await activarPlantillaSinD1(sufijo),
  }
}

function semillaVigente(): Semilla | undefined {
  if (!existsSync(ARCHIVO_SEMILLA)) return undefined
  const guardada = JSON.parse(readFileSync(ARCHIVO_SEMILLA, "utf8")) as Semilla
  const admin = sql(`select id from auth.users where email = 'admin@local.test'`)
  return admin === guardada.cuentas.admin ? guardada : undefined
}

/** Idempotente: después de `db reset` vuelve a sembrar; si no, reutiliza lo que ya está. */
export async function prepararSemilla(sufijo: string) {
  const semilla = semillaVigente() ?? (await sembrarDesdeCero(sufijo))
  mkdirSync(dirname(ARCHIVO_SEMILLA), { recursive: true })
  writeFileSync(ARCHIVO_SEMILLA, JSON.stringify(semilla, null, 2))

  // La nómina se fija para los días que puede usar una corrida, también cerca de medianoche.
  for (const dias of [-1, 0, 1, 2, 3]) {
    await edge(
      "admin",
      "identity-admin",
      `staffing/${semilla.tallerId}/${fechaArgentina(dias)}`,
      {
        method: "PUT",
        body: { persona_ids: [semilla.tecnicos.principal, semilla.tecnicos.segundo] },
      },
    )
  }
  // Una corrida anterior interrumpida pudo dejar activa la plantilla de la migración.
  const activa = await edge<Plantilla>("admin", "certificate-field", "certificate-templates/active")
  if (!activa.version.startsWith("e2e-sin-d1-")) {
    semilla.plantillaE2eId = await activarPlantillaSinD1(sufijo)
    writeFileSync(ARCHIVO_SEMILLA, JSON.stringify(semilla, null, 2))
  }
  return semilla
}
