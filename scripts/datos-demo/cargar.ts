import { randomUUID } from "node:crypto"

import { EMAIL, sql } from "../../e2e/support/api"
import { fechaArgentina, prepararSemilla, TECNICO } from "../../e2e/support/semilla"
import { activarCuentaInvitada, llamar } from "./api"
import { asegurarDestinoLocal } from "./destino"
import { archivoPng, COLORES, firmaDemo, fotoDemo, logoDemo, parteDiarioDemo } from "./imagenes"

/**
 * Dataset de demo y QA para la base LOCAL. Todo lo que crea lleva el prefijo «QA» y se crea por
 * las Edge Functions de la app (validaciones y Registro de auditoría incluidos), con la sesión de
 * la cuenta que haría cada paso: el Administrador programa, el Taller acepta y captura, el
 * Cliente pide y firma. Es idempotente: cada escenario se reconoce por el tag de su primera
 * Válvula y, si ya existe, no se toca. Guía: `docs/guia-pruebas-demo.md`.
 */

export const CUENTAS_DEMO = {
  superadmin: EMAIL.super,
  admin: EMAIL.admin,
  tallerNorte: EMAIL.taller,
  clientePetrolera: EMAIL.cliente,
  tallerSur: "qa.taller.sur@local.test",
  clienteValle: "qa.cliente.valle@local.test",
} as const

const ADMIN = CUENTAS_DEMO.admin

// ---------------------------------------------------------------------------------------------
// Formas mínimas de las respuestas de la API que usa el cargador.

type Opcion = { id: string; label: string }
type Patron = Opcion & { nro_serie?: string; vencimiento?: string }
type Catalogos = {
  replacement_catalog_version: string
  replacement_parts: Opcion[]
  maintenance: Opcion[]
  standards: Patron[]
  units: Opcion[]
}
type ClienteApi = { id: string; razon_social: string; logo_url: unknown }
type TallerApi = { id: string; nombre: string }
type TecnicoApi = { id: string; dni: string }
type YacimientoApi = { id: string; nombre: string; cliente_cuenta_id: string }
type ArbolApi = {
  plantas: { id: string; nombre: string }[]
  equipos: { id: string; nombre: string; planta_id: string }[]
  valvulas: { id: string; nombre: string; equipo_id: string }[]
}
type SolicitudApi = {
  request: { id: string; estado: string; numero_solicitud?: number }
  selected_valves?: { id: string; name: string }[]
}
type OrdenApi = { id: string; valvula_id: string; estado: string }
type VisitaApi = { visit: { id: string; estado: string }; work_orders: OrdenApi[] }
type Evidencia = { image_id: string; bucket: string; object_path: string }

// ---------------------------------------------------------------------------------------------
// Datos ficticios.

type FichaValvula = {
  tipo: "PILOTADA" | "CONVENCIONAL"
  marca: string
  modelo: string
  diametro_entrada: string
  diametro_salida: string
  rosca: string
  servicio: string
  pv: string
  presion: number
  temperatura: number
  set: number
}

const MODELOS: FichaValvula[] = [
  {
    tipo: "PILOTADA",
    marca: "Farris",
    modelo: "2600",
    diametro_entrada: '1"',
    diametro_salida: '2"',
    rosca: "NPT",
    servicio: "GAS COMBUSTIBLE",
    pv: "GAS",
    presion: 12.5,
    temperatura: 45,
    set: 14,
  },
  {
    tipo: "CONVENCIONAL",
    marca: "Crosby",
    modelo: "JOS-E",
    diametro_entrada: '3/4"',
    diametro_salida: '1"',
    rosca: "NPT",
    servicio: "AIRE DE INSTRUMENTOS",
    pv: "AIRE",
    presion: 7,
    temperatura: 30,
    set: 8.5,
  },
  {
    tipo: "CONVENCIONAL",
    marca: "Consolidated",
    modelo: "1900",
    diametro_entrada: '2"',
    diametro_salida: '3"',
    rosca: "N/A",
    servicio: "AGUA DE PROCESO",
    pv: "LÍQUIDO",
    presion: 18,
    temperatura: 60,
    set: 21,
  },
  {
    tipo: "PILOTADA",
    marca: "Anderson Greenwood",
    modelo: "200",
    diametro_entrada: '1 1/2"',
    diametro_salida: '2"',
    rosca: "NPT",
    servicio: "GAS NATURAL",
    pv: "GAS",
    presion: 40,
    temperatura: 35,
    set: 46,
  },
]

type ClaveCliente = "petrolera" | "valle"

const ESTRUCTURA: Record<
  ClaveCliente,
  {
    yacimiento: string
    provincia: string
    operadora: string
    contratista: string
    plantas: string[]
  }
> = {
  petrolera: {
    yacimiento: "QA Loma Alta",
    provincia: "Neuquén",
    operadora: "QA Operadora Austral",
    contratista: "QA Contratista Uno",
    plantas: ["QA Planta Compresora Norte", "QA Batería 3"],
  },
  valle: {
    yacimiento: "QA Valle Medio",
    provincia: "Río Negro",
    operadora: "QA Operadora del Valle",
    contratista: "QA Contratista Dos",
    plantas: ["QA Planta de Tratamiento"],
  },
}

const CLIENTE_VALLE = {
  razon_social: "QA Gas del Valle SRL",
  cuit: "30-71234567-1",
  contacto: "Valeria Demo",
  telefono: "298-555-0142",
  email: CUENTAS_DEMO.clienteValle,
  direccion: "Ruta Ficticia 22 km 5",
}

const TALLER_SUR = { nombre: "QA Taller Sur", color: "#16a34a", email: CUENTAS_DEMO.tallerSur }
const TECNICOS_SUR = [
  { nombre: "Martín", apellido: "Ríos", dni: "39000001" },
  { nombre: "Julia", apellido: "Paz", dni: "39000002" },
]

// ---------------------------------------------------------------------------------------------
// Contexto que arma el cargador.

type TallerDemo = { id: string; email: string; nombre: string; tecnico: string }
type ClienteDemo = {
  id: string
  email: string
  nombre: string
  yacimientoId: string
  plantas: string[]
}
type ValvulaDemo = { id: string; tag: string; ficha: FichaValvula }
type EquipoDemo = { id: string; nombre: string; valvulas: ValvulaDemo[] }

type Contexto = {
  dispositivo: string
  catalogos: Catalogos
  talleres: { norte: TallerDemo; sur: TallerDemo }
  clientes: Record<ClaveCliente, ClienteDemo>
  log: (mensaje: string) => void
}

type Resultado = { solicitudId: string; visitas: string[]; nota?: string }

type Escenario = {
  clave: string
  titulo: string
  cliente: ClaveCliente
  planta: number
  valvulas: number
  construir: (ctx: Contexto, equipo: EquipoDemo) => Promise<Resultado>
}

const tagValvula = (clave: string, indice: number) =>
  `QA-PSV-${clave}${String.fromCharCode(65 + indice)}`

// ---------------------------------------------------------------------------------------------
// Estructura: clientes, talleres, técnicos, nómina y jerarquía.

async function asegurarClienteValle(log: Contexto["log"]): Promise<{ id: string; nombre: string }> {
  const clientes = await llamar<ClienteApi[]>(ADMIN, "asset-access", "clients")
  let cliente = clientes.find((c) => c.razon_social === CLIENTE_VALLE.razon_social)
  if (!cliente) {
    cliente = await llamar<ClienteApi>(ADMIN, "asset-access", "clients", {
      body: { ...CLIENTE_VALLE, aviso_vencimiento: true, activo: true },
    })
    log(`Cliente creado: ${CLIENTE_VALLE.razon_social}`)
  }
  if (!cliente.logo_url) {
    await llamar(ADMIN, "asset-access", `clients/${cliente.id}/logo`, {
      method: "PUT",
      form: { file: archivoPng("logo-gas-del-valle.png", logoDemo(COLORES.logo)) },
    })
    log(`Logo cargado: ${CLIENTE_VALLE.razon_social}`)
  }
  return { id: cliente.id, nombre: CLIENTE_VALLE.razon_social }
}

async function asegurarTallerSur(log: Contexto["log"]) {
  const talleres = await llamar<TallerApi[]>(ADMIN, "identity-admin", "mobile-workshops")
  let taller = talleres.find((t) => t.nombre === TALLER_SUR.nombre)
  if (!taller) {
    taller = await llamar<TallerApi>(ADMIN, "identity-admin", "mobile-workshops", {
      body: TALLER_SUR,
    })
    log(`Taller Móvil creado: ${TALLER_SUR.nombre}`)
  }
  return taller.id
}

/** Fija contraseña de demo y confirma el correo solo si la cuenta sigue invitada. */
async function activarSiHaceFalta(email: string, log: Contexto["log"]) {
  const pendiente = sql(
    `select count(*) from auth.users where lower(email) = lower('${email}') and email_confirmed_at is null`,
  )
  if (pendiente !== "0") {
    await activarCuentaInvitada(email)
    log(`Cuenta activada con la contraseña de demo: ${email}`)
  }
}

async function asegurarTecnicos(log: Contexto["log"]) {
  const existentes = await llamar<TecnicoApi[]>(ADMIN, "identity-admin", "technicians")
  const ids: string[] = []
  for (const tecnico of TECNICOS_SUR) {
    let encontrado = existentes.find((t) => t.dni === tecnico.dni)
    if (!encontrado) {
      encontrado = await llamar<TecnicoApi>(ADMIN, "identity-admin", "technicians", {
        body: tecnico,
      })
      log(`Técnico creado: ${tecnico.nombre} ${tecnico.apellido}`)
    }
    ids.push(encontrado.id)
  }
  return ids
}

/** Nómina de ayer a una semana: las visitas de demo caen en ese rango. */
async function fijarNomina(tallerId: string, personas: string[]) {
  for (let dias = -1; dias <= 7; dias += 1) {
    await llamar(ADMIN, "identity-admin", `staffing/${tallerId}/${fechaArgentina(dias)}`, {
      method: "PUT",
      body: { persona_ids: personas },
    })
  }
}

async function asegurarYacimiento(clienteId: string, clave: ClaveCliente, log: Contexto["log"]) {
  const datos = ESTRUCTURA[clave]
  const yacimientos = await llamar<YacimientoApi[]>(ADMIN, "asset-access", "yacimientos")
  let yacimiento = yacimientos.find(
    (y) => y.nombre === datos.yacimiento && y.cliente_cuenta_id === clienteId,
  )
  if (!yacimiento) {
    yacimiento = await llamar<YacimientoApi>(ADMIN, "asset-access", "yacimientos", {
      body: {
        client_id: clienteId,
        name: datos.yacimiento,
        provincia: datos.provincia,
        operadora: datos.operadora,
        contratista: datos.contratista,
      },
    })
    log(`Yacimiento creado: ${datos.yacimiento}`)
  }
  const arbol = await llamar<ArbolApi>(ADMIN, "asset-access", `yacimientos/${yacimiento.id}/tree`)
  const plantas: string[] = []
  for (const nombre of datos.plantas) {
    let planta = arbol.plantas.find((p) => p.nombre === nombre)
    if (!planta) {
      planta = await llamar<{ id: string; nombre: string }>(ADMIN, "asset-access", "hierarchy", {
        body: { kind: "planta", parent_id: yacimiento.id, name: nombre },
      })
      log(`Planta creada: ${nombre}`)
    }
    plantas.push(planta.id)
  }
  return { yacimientoId: yacimiento.id, plantas }
}

/** Equipo `QA-K-<clave>` con sus Válvulas y la ficha técnica de cada una. */
async function asegurarEquipo(ctx: Contexto, escenario: Escenario): Promise<EquipoDemo> {
  const cliente = ctx.clientes[escenario.cliente]
  const plantaId = cliente.plantas[escenario.planta]
  const nombre = `QA-K-${escenario.clave}`
  const arbol = await llamar<ArbolApi>(
    ADMIN,
    "asset-access",
    `yacimientos/${cliente.yacimientoId}/tree`,
  )
  let equipo = arbol.equipos.find((e) => e.nombre === nombre && e.planta_id === plantaId)
  if (!equipo) {
    equipo = await llamar<ArbolApi["equipos"][number]>(ADMIN, "asset-access", "hierarchy", {
      body: { kind: "equipo", parent_id: plantaId, name: nombre },
    })
  }
  const valvulas: ValvulaDemo[] = []
  for (let i = 0; i < escenario.valvulas; i += 1) {
    const tag = tagValvula(escenario.clave, i)
    const ficha = MODELOS[(Number(escenario.clave) + i) % MODELOS.length]
    let valvula = arbol.valvulas.find((v) => v.nombre === tag && v.equipo_id === equipo.id)
    if (!valvula) {
      valvula = await llamar<ArbolApi["valvulas"][number]>(ADMIN, "asset-access", "hierarchy", {
        body: { kind: "valvula", parent_id: equipo.id, name: tag },
      })
      // La ficha técnica se carga por la edición de la Válvula, como en el panel.
      await llamar(ADMIN, "asset-access", `valves/${valvula.id}`, {
        method: "PATCH",
        body: {
          name: tag,
          marca: ficha.marca,
          numero_serie: `SN-${escenario.clave}${i + 1}`,
          modelo: ficha.modelo,
          tipo: ficha.tipo,
          diametro_entrada: ficha.diametro_entrada,
          clase_entrada: null,
          diametro_salida: ficha.diametro_salida,
          clase_salida: null,
          rosca: ficha.rosca,
          razon_disponibilidad: null,
          precinto: `PR-${escenario.clave}${i + 1}`,
          servicio: ficha.servicio,
          pv: ficha.pv,
          presion_operacion: ficha.presion,
          temperatura_operacion: ficha.temperatura,
          notas: "Válvula de demo (QA)",
        },
      })
    }
    valvulas.push({ id: valvula.id, tag, ficha })
  }
  return { id: equipo.id, nombre, valvulas }
}

// ---------------------------------------------------------------------------------------------
// Pasos del flujo, cada uno con la cuenta que lo hace en la app.

type DatosTarea = {
  clave: string
  detalle: string
  dias: number
  horario: string
  taller?: TallerDemo
  pdRto?: string
  ordenTrabajo?: string
}

/** Alta de tarea del Administrador: solicitud, metadata y visita en una sola transacción. */
async function crearTarea(
  ctx: Contexto,
  cliente: ClienteDemo,
  equipo: EquipoDemo,
  tarea: DatosTarea,
) {
  const fecha = fechaArgentina(tarea.dias)
  const inicio = new Date(`${fecha}T${tarea.horario}:00-03:00`)
  const creada = await llamar<
    SolicitudApi & { scheduled_visit?: { visit?: { id: string } } | null }
  >(ADMIN, "service-workflow", "admin/requests", {
    body: {
      cliente_cuenta_id: cliente.id,
      yacimiento_id: cliente.yacimientoId,
      selections: [{ kind: "equipo", id: equipo.id }],
      metadata: {
        contacto: "Pedro Demo",
        telefono: "299-555-0199",
        fecha_ejecucion: fecha,
        horario: tarea.horario,
        tipo: "Mantenimiento y calibración",
        detalle: `QA-${tarea.clave} · ${tarea.detalle}`,
        pd_rto: tarea.pdRto ?? null,
        orden_trabajo: tarea.ordenTrabajo ?? null,
        condiciones: [],
        adjuntos: [],
      },
      ...(tarea.taller
        ? {
            taller_movil_id: tarea.taller.id,
            starts_at: inicio.toISOString(),
            ends_at: new Date(inicio.getTime() + 3_600_000).toISOString(),
          }
        : {}),
    },
  })
  const visitaId = creada.scheduled_visit?.visit?.id
  if (tarea.taller && !visitaId)
    throw new Error(`QA-${tarea.clave}: la tarea no devolvió la visita`)
  return { solicitudId: creada.request.id, visitaId: visitaId ?? "" }
}

const verVisita = (taller: TallerDemo, visitaId: string) =>
  llamar<VisitaApi>(taller.email, "service-workflow", `visits/${visitaId}`)

const aceptar = (taller: TallerDemo, visitaId: string) =>
  llamar(taller.email, "service-workflow", `visits/${visitaId}/accept`, { body: {} })

/**
 * Como el celular: descarga la agenda (registra el catálogo de repuestos para este dispositivo),
 * reserva la visita y la inicia con ese catálogo.
 */
async function iniciar(ctx: Contexto, taller: TallerDemo, visitaId: string) {
  await llamar(taller.email, "offline-sync", "offline/working-set", {
    body: { device_id: ctx.dispositivo },
  })
  await llamar(taller.email, "offline-sync", `visits/${visitaId}/claim`, {
    body: { device_id: ctx.dispositivo },
  })
  await llamar(taller.email, "service-workflow", `visits/${visitaId}/start`, {
    body: {
      replacement_catalog_version_id: ctx.catalogos.replacement_catalog_version,
      device_id: ctx.dispositivo,
    },
  })
}

async function cargarParteDiario(
  taller: TallerDemo,
  visitaId: string,
  codigo: string,
  foto: boolean,
) {
  await llamar(taller.email, "service-workflow", `visits/${visitaId}/parte-diario`, {
    method: "PUT",
    body: { codigo },
  })
  if (!foto) return
  await llamar(taller.email, "service-workflow", `visits/${visitaId}/parte-diario/images`, {
    form: {
      codigo,
      image_id: randomUUID(),
      file: archivoPng("parte-diario.png", parteDiarioDemo()),
    },
  })
}

type Categoria = "desarmada" | "ensamblada_prueba" | "placa_precinto"

async function subirFoto(
  ctx: Contexto,
  taller: TallerDemo,
  visitaId: string,
  categoria: Categoria,
) {
  const subida = await llamar<Evidencia>(taller.email, "offline-sync", `visits/${visitaId}/media`, {
    form: {
      device_id: ctx.dispositivo,
      operation_id: randomUUID(),
      media_id: randomUUID(),
      kind: "photo",
      category: categoria,
      file: archivoPng(`${categoria}.png`, fotoDemo(COLORES[categoria])),
    },
  })
  return { image_id: subida.image_id, bucket: subida.bucket, object_path: subida.object_path }
}

type Captura = { fecha: string; parcial?: boolean; indice: number }

/** Los mismos datos que arma el formulario de captura: ficha técnica, ensayos, mantenimiento. */
function payloadCertificado(
  ctx: Contexto,
  taller: TallerDemo,
  valvula: ValvulaDemo,
  captura: Captura,
  evidencia: Record<Categoria, Evidencia | null>,
) {
  const { ficha } = valvula
  const unidad = ctx.catalogos.units[0]?.label ?? "Kg/Cm2"
  const patron = ctx.catalogos.standards[captura.indice % ctx.catalogos.standards.length]
  const datosValvula = {
    tag: valvula.tag,
    tipo: ficha.tipo,
    marca: ficha.marca,
    rosca: ficha.rosca,
    modelo: ficha.modelo,
    precinto: `PR-${valvula.tag.slice(-3)}`,
    servicio: ficha.servicio,
    numero_serie: `SN-${valvula.tag.slice(-3)}`,
    pv: ficha.pv,
    clase_entrada: "",
    clase_salida: "",
    diametro_entrada: ficha.diametro_entrada,
    diametro_salida: ficha.diametro_salida,
    presion_operacion: String(ficha.presion),
    temperatura_operacion: String(ficha.temperatura),
    razon_disponibilidad: null,
  }
  if (captura.parcial) {
    return {
      fecha_ejecucion: captura.fecha,
      tecnico_ejecutor: taller.tecnico,
      datos_tecnicos: { valvula: datosValvula },
      evidencia_fotografica: evidencia,
      observaciones: "Borrador a medio cargar: faltan ensayos, mantenimiento y dos fotos.",
    }
  }
  const redondear = (valor: number) => Math.round(valor * 10) / 10
  return {
    fecha_ejecucion: captura.fecha,
    tecnico_ejecutor: taller.tecnico,
    datos_tecnicos: {
      valvula: datosValvula,
      ensayos: {
        patron: patron
          ? {
              id: patron.id,
              label: patron.label,
              nro_serie: patron.nro_serie,
              vencimiento: patron.vencimiento,
            }
          : null,
        sp_inicial: { valor: redondear(ficha.set * 1.04), unidad },
        sp_apertura: { valor: ficha.set, unidad },
        presion_cierre: { valor: redondear(ficha.set * 0.93), unidad },
      },
    },
    campos_personalizados: {},
    alcance_mantenimiento: ctx.catalogos.maintenance.slice(0, 4),
    repuestos: {
      catalog_version: ctx.catalogos.replacement_catalog_version,
      items: ctx.catalogos.replacement_parts.slice(captura.indice % 3, (captura.indice % 3) + 1),
      otros: null,
    },
    evidencia_fotografica: evidencia,
    observaciones: "Calibración de demo: ensayo dentro de tolerancia.",
  }
}

/** Marca la orden como evaluada, abre el borrador, sube las fotos y guarda la captura. */
async function capturar(
  ctx: Contexto,
  taller: TallerDemo,
  visitaId: string,
  orden: OrdenApi,
  valvula: ValvulaDemo,
  captura: Captura,
) {
  await llamar(taller.email, "service-workflow", `work-orders/${orden.id}`, {
    method: "PATCH",
    body: { outcome: "evaluada" },
  })
  const { certificate } = await llamar<{ certificate: { id: string } }>(
    taller.email,
    "certificate-field",
    `work-orders/${orden.id}/certificate-draft`,
    { body: {} },
  )
  const evidencia: Record<Categoria, Evidencia | null> = {
    desarmada: await subirFoto(ctx, taller, visitaId, "desarmada"),
    ensamblada_prueba: captura.parcial
      ? null
      : await subirFoto(ctx, taller, visitaId, "ensamblada_prueba"),
    placa_precinto: captura.parcial
      ? null
      : await subirFoto(ctx, taller, visitaId, "placa_precinto"),
  }
  await llamar(taller.email, "certificate-field", `certificates/${certificate.id}`, {
    method: "PATCH",
    body: payloadCertificado(ctx, taller, valvula, captura, evidencia),
  })
  return certificate.id
}

async function firmar(
  taller: TallerDemo,
  visitaId: string,
  parte: "cliente" | "tecnico",
  nombre: string,
) {
  await llamar(taller.email, "certificate-field", `visits/${visitaId}/signatures`, {
    form: {
      party: parte,
      signer_name: nombre,
      ...(parte === "cliente" ? { capture_method: "pwa_cliente_presencial" } : {}),
      file: archivoPng(`firma-${parte}.png`, firmaDemo(parte === "cliente" ? 0 : 1.7)),
    },
  })
}

type Recorrido = {
  pd?: { codigo: string; foto: boolean }
  /** Fecha de ejecución por índice de Válvula; por defecto, hoy. */
  fechas?: string[]
  /** Representante del Cliente que firma en el lugar; sin él la firma queda pendiente. */
  firmaCliente?: string
  /** Motivo por tag de las Válvulas que quedan sin evaluar. */
  noEvaluadas?: Record<string, string>
}

/** Visita completa en el Taller: aceptar, iniciar, PD, capturas, firmas y cierre. */
async function recorrerVisita(
  ctx: Contexto,
  taller: TallerDemo,
  visitaId: string,
  equipo: EquipoDemo,
  recorrido: Recorrido,
) {
  await aceptar(taller, visitaId)
  await iniciar(ctx, taller, visitaId)
  if (recorrido.pd)
    await cargarParteDiario(taller, visitaId, recorrido.pd.codigo, recorrido.pd.foto)
  const { work_orders: ordenes } = await verVisita(taller, visitaId)
  for (const [indice, valvula] of equipo.valvulas.entries()) {
    const orden = ordenes.find((o) => o.valvula_id === valvula.id)
    if (!orden) throw new Error(`La visita ${visitaId} no tiene orden para ${valvula.tag}`)
    const motivo = recorrido.noEvaluadas?.[valvula.tag]
    if (motivo) {
      await llamar(taller.email, "service-workflow", `work-orders/${orden.id}`, {
        method: "PATCH",
        body: { outcome: "no_evaluada", not_evaluated_reason: motivo },
      })
      continue
    }
    await capturar(ctx, taller, visitaId, orden, valvula, {
      fecha: recorrido.fechas?.[indice] ?? fechaArgentina(),
      indice,
    })
  }
  if (recorrido.firmaCliente) await firmar(taller, visitaId, "cliente", recorrido.firmaCliente)
  await firmar(taller, visitaId, "tecnico", taller.tecnico)
  await llamar(taller.email, "service-workflow", `visits/${visitaId}/complete`, { body: {} })
}

// ---------------------------------------------------------------------------------------------
// Escenarios: uno por estado que hay que poder probar. El tag de la primera Válvula identifica
// cada escenario en la base.

export const ESCENARIOS: Escenario[] = [
  {
    clave: "01",
    titulo: "Solicitud del Cliente sin visita",
    cliente: "petrolera",
    planta: 0,
    valvulas: 2,
    async construir(ctx, equipo) {
      const cliente = ctx.clientes.petrolera
      const creada = await llamar<SolicitudApi>(cliente.email, "service-workflow", "requests", {
        body: {
          yacimiento_id: cliente.yacimientoId,
          selections: [{ kind: "equipo", id: equipo.id }],
        },
      })
      return { solicitudId: creada.request.id, visitas: [] }
    },
  },
  {
    clave: "02",
    titulo: "Tarea programada sin Taller (mañana 10:00)",
    cliente: "petrolera",
    planta: 0,
    valvulas: 1,
    async construir(ctx, equipo) {
      const { solicitudId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "02",
        detalle: "Tarea sin Taller asignado: falta programar la visita",
        dias: 1,
        horario: "10:00",
      })
      return { solicitudId, visitas: [] }
    },
  },
  {
    clave: "03",
    titulo: "Programada a Taller Norte hoy 16:00, pendiente de aceptación",
    cliente: "petrolera",
    planta: 0,
    valvulas: 1,
    async construir(ctx, equipo) {
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "03",
        detalle: "Programada hoy: el Taller todavía no la aceptó",
        dias: 0,
        horario: "16:00",
        taller: ctx.talleres.norte,
      })
      return { solicitudId, visitas: [visitaId] }
    },
  },
  {
    clave: "04",
    titulo: "Programada a QA Taller Sur dentro de 3 días",
    cliente: "petrolera",
    planta: 1,
    valvulas: 2,
    async construir(ctx, equipo) {
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "04",
        detalle: "Visita futura con orden de trabajo",
        dias: 3,
        horario: "09:00",
        taller: ctx.talleres.sur,
        ordenTrabajo: "OT-QA-0004",
      })
      return { solicitudId, visitas: [visitaId] }
    },
  },
  {
    clave: "05",
    titulo: "Aceptada hoy por Taller Norte, lista para iniciar",
    cliente: "petrolera",
    planta: 0,
    valvulas: 2,
    async construir(ctx, equipo) {
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "05",
        detalle: "Aceptada: iniciarla desde /taller",
        dias: 0,
        horario: "11:00",
        taller: ctx.talleres.norte,
        pdRto: "5005",
      })
      await aceptar(ctx.talleres.norte, visitaId)
      return { solicitudId, visitas: [visitaId] }
    },
  },
  {
    clave: "06",
    titulo: "En curso con borrador parcial",
    cliente: "petrolera",
    planta: 1,
    valvulas: 2,
    async construir(ctx, equipo) {
      const taller = ctx.talleres.norte
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "06",
        detalle: "En curso: una Válvula con borrador a medias y otra sin empezar",
        dias: 0,
        horario: "09:00",
        taller,
      })
      await aceptar(taller, visitaId)
      await iniciar(ctx, taller, visitaId)
      await cargarParteDiario(taller, visitaId, "PD6006", false)
      const { work_orders: ordenes } = await verVisita(taller, visitaId)
      const valvula = equipo.valvulas[0]
      const orden = ordenes.find((o) => o.valvula_id === valvula.id)
      if (!orden) throw new Error("QA-06: falta la orden de trabajo")
      await capturar(ctx, taller, visitaId, orden, valvula, {
        fecha: fechaArgentina(),
        parcial: true,
        indice: 0,
      })
      // Sin API para liberar una reserva: se borra la del cargador en la base LOCAL para que el
      // celular o navegador de quien prueba pueda tomar la visita («Reservar en este dispositivo»).
      sql(`delete from public.dispositivos_visita where visita_id = '${visitaId}'`)
      return {
        solicitudId,
        visitas: [visitaId],
        nota: "reserva del dispositivo liberada por SQL local",
      }
    },
  },
  {
    clave: "07",
    titulo: "Completada, falta la firma del Cliente",
    cliente: "petrolera",
    planta: 0,
    valvulas: 2,
    async construir(ctx, equipo) {
      const taller = ctx.talleres.norte
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "07",
        detalle: "Sin representante en el lugar: el Cliente firma desde el portal",
        dias: 0,
        horario: "08:00",
        taller,
        pdRto: "7007",
      })
      await recorrerVisita(ctx, taller, visitaId, equipo, { pd: { codigo: "PD7007", foto: true } })
      return { solicitudId, visitas: [visitaId] }
    },
  },
  {
    clave: "08",
    titulo: "Completada con certificados finalizados",
    cliente: "petrolera",
    planta: 0,
    valvulas: 2,
    async construir(ctx, equipo) {
      const taller = ctx.talleres.norte
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "08",
        detalle: "Recorrido completo con firma presencial del Cliente",
        dias: 0,
        horario: "07:00",
        taller,
        pdRto: "8008",
        ordenTrabajo: "OT-QA-0008",
      })
      await recorrerVisita(ctx, taller, visitaId, equipo, {
        pd: { codigo: "PD8008", foto: true },
        firmaCliente: "Rodrigo Medina",
      })
      return { solicitudId, visitas: [visitaId] }
    },
  },
  {
    clave: "09",
    titulo: "Finalizada para el Cliente con logo (QA Gas del Valle)",
    cliente: "valle",
    planta: 0,
    valvulas: 1,
    async construir(ctx, equipo) {
      const taller = ctx.talleres.sur
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.valle, equipo, {
        clave: "09",
        detalle: "Certificado con el logo del Cliente",
        dias: 0,
        horario: "10:00",
        taller,
        pdRto: "9009",
      })
      await recorrerVisita(ctx, taller, visitaId, equipo, {
        pd: { codigo: "PD9009", foto: true },
        firmaCliente: "Lucía Ferreyra",
      })
      return { solicitudId, visitas: [visitaId] }
    },
  },
  {
    clave: "10",
    titulo: "Visita cancelada por el Administrador (se puede reabrir)",
    cliente: "petrolera",
    planta: 1,
    valvulas: 1,
    async construir(ctx, equipo) {
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "10",
        detalle: "Cancelada: probar «Reabrir»",
        dias: 2,
        horario: "14:00",
        taller: ctx.talleres.sur,
      })
      await llamar(ADMIN, "service-workflow", `visits/${visitaId}/cancel-administrator`, {
        body: { reason: "QA: el Cliente pidió postergar el trabajo" },
      })
      return { solicitudId, visitas: [visitaId] }
    },
  },
  {
    clave: "11",
    titulo: "Completada con una Válvula sin evaluar y visita de seguimiento",
    cliente: "petrolera",
    planta: 1,
    valvulas: 2,
    async construir(ctx, equipo) {
      const taller = ctx.talleres.norte
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "11",
        detalle: "Una Válvula quedó sin evaluar: tiene visita de seguimiento",
        dias: 0,
        horario: "12:00",
        taller,
      })
      const pendiente = equipo.valvulas[1]
      await recorrerVisita(ctx, taller, visitaId, equipo, {
        pd: { codigo: "PD1111", foto: false },
        firmaCliente: "Rodrigo Medina",
        noEvaluadas: { [pendiente.tag]: "Sin acceso: falta andamio en el equipo" },
      })
      const fecha = fechaArgentina(5)
      const inicio = new Date(`${fecha}T09:00:00-03:00`)
      const seguimiento = await llamar<{ visit: { id: string } }>(
        ADMIN,
        "service-workflow",
        `requests/${solicitudId}/follow-up-visits`,
        {
          body: {
            source_visit_id: visitaId,
            valve_ids: [pendiente.id],
            taller_movil_id: ctx.talleres.sur.id,
            starts_at: inicio.toISOString(),
            ends_at: new Date(inicio.getTime() + 3_600_000).toISOString(),
          },
        },
      )
      return { solicitudId, visitas: [visitaId, seguimiento.visit.id] }
    },
  },
  {
    clave: "12",
    titulo: "Certificados vencido y por vencer (RN-06)",
    cliente: "petrolera",
    planta: 0,
    valvulas: 2,
    async construir(ctx, equipo) {
      const taller = ctx.talleres.norte
      const { solicitudId, visitaId } = await crearTarea(ctx, ctx.clientes.petrolera, equipo, {
        clave: "12",
        detalle: "Ejecución histórica: un certificado vencido y otro por vencer",
        dias: 0,
        horario: "06:00",
        taller,
      })
      await recorrerVisita(ctx, taller, visitaId, equipo, {
        pd: { codigo: "PD1212", foto: true },
        firmaCliente: "Rodrigo Medina",
        // La vigencia es de un año desde la ejecución: -400 días ya venció, -350 vence en ~15.
        fechas: [fechaArgentina(-400), fechaArgentina(-350)],
      })
      return { solicitudId, visitas: [visitaId] }
    },
  },
]

// ---------------------------------------------------------------------------------------------

export type OpcionesCarga = { log?: (mensaje: string) => void }

export type InformeCarga = {
  creados: string[]
  existentes: string[]
  escenarios: { clave: string; titulo: string; solicitud: string; estado: string }[]
}

export async function cargarDatosDemo(opciones: OpcionesCarga = {}): Promise<InformeCarga> {
  // Primero la barrera: si el destino (E2E_SUPABASE_URL / E2E_DB_CONTAINER) no es local, no se
  // hace ningún pedido ni se toca ninguna base.
  asegurarDestinoLocal()
  const log = opciones.log ?? (() => undefined)

  // Cuentas base (super, admin, Taller Norte, Cliente Petrolera) con la misma semilla que E2E,
  // así una corrida E2E posterior la reconoce y no intenta crearlas otra vez.
  const semilla = await prepararSemilla(`DEMO${Date.now().toString(36).toUpperCase()}`)
  const valle = await asegurarClienteValle(log)
  await activarSiHaceFalta(CUENTAS_DEMO.clienteValle, log)
  const tallerSurId = await asegurarTallerSur(log)
  await activarSiHaceFalta(CUENTAS_DEMO.tallerSur, log)
  const tecnicosSur = await asegurarTecnicos(log)
  await fijarNomina(semilla.tallerId, [semilla.tecnicos.principal, semilla.tecnicos.segundo])
  await fijarNomina(tallerSurId, tecnicosSur)

  const petrolera = await asegurarYacimiento(semilla.cuentas.cliente, "petrolera", log)
  const valleEstructura = await asegurarYacimiento(valle.id, "valle", log)
  const ctx: Contexto = {
    dispositivo: randomUUID(),
    catalogos: await llamar<Catalogos>(
      CUENTAS_DEMO.tallerNorte,
      "certificate-field",
      "certificate-capture/catalogs",
    ),
    talleres: {
      norte: {
        id: semilla.tallerId,
        email: CUENTAS_DEMO.tallerNorte,
        nombre: "Taller Norte",
        tecnico: TECNICO.completo,
      },
      sur: {
        id: tallerSurId,
        email: CUENTAS_DEMO.tallerSur,
        nombre: TALLER_SUR.nombre,
        tecnico: `${TECNICOS_SUR[0].nombre} ${TECNICOS_SUR[0].apellido}`,
      },
    },
    clientes: {
      petrolera: {
        id: semilla.cuentas.cliente,
        email: CUENTAS_DEMO.clientePetrolera,
        nombre: "Petrolera Ficticia SA",
        ...petrolera,
      },
      valle: {
        id: valle.id,
        email: CUENTAS_DEMO.clienteValle,
        nombre: valle.nombre,
        ...valleEstructura,
      },
    },
    log,
  }

  const informe: InformeCarga = { creados: [], existentes: [], escenarios: [] }
  const solicitudes = await llamar<SolicitudApi[]>(ADMIN, "service-workflow", "requests")
  const solicitudDe = (tag: string) =>
    solicitudes.find((s) => s.selected_valves?.some((v) => v.name === tag))

  // Un Taller Móvil solo puede tener una visita en curso: QA-06 deja la suya abierta, así que se
  // carga al final para no bloquear a los escenarios de Taller Norte que inician y completan visitas.
  const ordenCarga = [
    ...ESCENARIOS.filter((e) => e.clave !== "06"),
    ...ESCENARIOS.filter((e) => e.clave === "06"),
  ]
  for (const escenario of ordenCarga) {
    const etiqueta = `QA-${escenario.clave} ${escenario.titulo}`
    const previa = solicitudDe(tagValvula(escenario.clave, 0))
    if (previa) {
      informe.existentes.push(etiqueta)
      log(`= ${etiqueta} (ya estaba)`)
      continue
    }
    log(`+ ${etiqueta}…`)
    const equipo = await asegurarEquipo(ctx, escenario)
    const resultado = await escenario.construir(ctx, equipo)
    informe.creados.push(etiqueta)
    if (resultado.nota) log(`  (${resultado.nota})`)
  }

  const finales = await llamar<SolicitudApi[]>(ADMIN, "service-workflow", "requests")
  const visitas = await llamar<{ visit: { estado: string; solicitud_id: string } }[]>(
    ADMIN,
    "service-workflow",
    "visits",
  )
  for (const escenario of ESCENARIOS) {
    const solicitud = finales.find((s) =>
      s.selected_valves?.some((v) => v.name === tagValvula(escenario.clave, 0)),
    )
    const estadosVisitas = visitas
      .filter((v) => solicitud && v.visit.solicitud_id === solicitud.request.id)
      .map((v) => v.visit.estado)
    informe.escenarios.push({
      clave: `QA-${escenario.clave}`,
      titulo: escenario.titulo,
      solicitud: solicitud?.request.numero_solicitud
        ? `#${solicitud.request.numero_solicitud}`
        : "?",
      estado: solicitud
        ? `${solicitud.request.estado} / visitas: ${estadosVisitas.join(", ") || "-"}`
        : "falta",
    })
  }
  return informe
}
