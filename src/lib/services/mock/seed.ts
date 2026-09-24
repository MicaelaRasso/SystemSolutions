/**
 * Datos de demostración. Nombres de empresas y personas ficticios.
 * Generación determinística para que todos vean los mismos datos.
 */

import { addDays, format, isWeekend, parseISO, startOfWeek, subDays } from "date-fns"

import { CATALOGO_SEMILLA, PATRONES_SEMILLA, TIPOS_TAREA } from "@/lib/domain/catalogos"
import { nombreArchivoCertificado } from "@/lib/domain/rules"
import type {
  AccesoCliente,
  Certificado,
  Empresa,
  Equipo,
  Firma,
  EstadoTarea,
  ListaCatalogo,
  NominaJornada,
  OpcionCatalogo,
  Patron,
  Persona,
  Planta,
  Taller,
  Tarea,
  Usuario,
  Valvula,
  ValorCampo,
  Yacimiento,
} from "@/lib/domain/types"

export const DEMO_PASSWORD = "demo1234"

export interface MockDb {
  version: number
  usuarios: Usuario[]
  accesos: AccesoCliente[]
  empresas: Empresa[]
  yacimientos: Yacimiento[]
  plantas: Planta[]
  equipos: Equipo[]
  valvulas: Valvula[]
  talleres: Taller[]
  personas: Persona[]
  patrones: Patron[]
  catalogo: OpcionCatalogo[]
  certificados: Certificado[]
  tareas: Tarea[]
  nominas: NominaJornada[]
  secuencias: { certificado: number; solicitud: number }
}

export const MOCK_DB_VERSION = 2

/** PRNG determinístico (mulberry32). */
function prng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CREADO = "2026-08-01T12:00:00.000Z"

const FIRMA_DEMO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><path d="M10 40 C 40 10, 60 60, 90 30 S 140 20, 190 35" stroke="#1e3a8a" stroke-width="2" fill="none"/></svg>',
  )

interface DefEmpresa {
  empresa: Omit<Empresa, "creadoEn" | "activo">
  yacimientos: {
    nombre: string
    provincia: string
    operadora: string
    plantas: { nombre: string; equipos: string[] }[]
  }[]
}

const EMPRESAS: DefEmpresa[] = [
  {
    empresa: {
      id: "emp-1",
      razonSocial: "Compresión Patagónica SRL",
      cuit: "30-71234567-8",
      contacto: "Julieta Ferreyra",
      telefono: "299 555-0101",
      email: "operaciones@compresionpatagonica.com.ar",
      direccion: "Parque Industrial Neuquén, Calle 5 N° 120",
      avisoVencimiento: true,
    },
    yacimientos: [
      {
        nombre: "Bandurria Oeste",
        provincia: "Neuquén",
        operadora: "Operadora Neuquina SA",
        plantas: [
          { nombre: "Planta Compresora N°8", equipos: ["K52100", "K52200"] },
          { nombre: "Batería BO-3", equipos: ["SEP-301"] },
        ],
      },
      {
        nombre: "Loma Campana",
        provincia: "Neuquén",
        operadora: "Hidrocarburos del Valle SA",
        plantas: [{ nombre: "Estación Compresora LC-2", equipos: ["K41000", "K41100", "DH-12"] }],
      },
    ],
  },
  {
    empresa: {
      id: "emp-2",
      razonSocial: "Servicios Petroleros del Sur SA",
      cuit: "30-70987654-3",
      contacto: "Ricardo Almonacid",
      telefono: "299 555-0202",
      email: "mantenimiento@serviciosdelsur.com.ar",
      direccion: "Ruta 7 km 12, Centenario",
      avisoVencimiento: false,
    },
    yacimientos: [
      {
        nombre: "Aguada Pichana",
        provincia: "Neuquén",
        operadora: "Energía Austral SA",
        plantas: [
          { nombre: "Planta de Tratamiento AP-1", equipos: ["PT-100", "PT-110"] },
          { nombre: "Locación AP-x45", equipos: ["CAB-45"] },
        ],
      },
      {
        nombre: "Estación Fernández Oro",
        provincia: "Río Negro",
        operadora: "Energía Austral SA",
        plantas: [{ nombre: "Planta EFO", equipos: ["K-EFO-1"] }],
      },
    ],
  },
  {
    empresa: {
      id: "emp-3",
      razonSocial: "Gas Andino Operaciones SA",
      cuit: "30-69876543-1",
      contacto: "Mariana Sosa",
      telefono: "261 555-0303",
      email: "planta@gasandino.com.ar",
      direccion: "Av. San Martín 2450, Mendoza",
      avisoVencimiento: true,
    },
    yacimientos: [
      {
        nombre: "Puesto Hernández",
        provincia: "Mendoza",
        operadora: "Gas Andino Operaciones SA",
        plantas: [{ nombre: "Planta PH Norte", equipos: ["K-PH-01", "HT-02"] }],
      },
    ],
  },
]

const MARCAS = ["MERCER VALVE", "CROSBY", "FARRIS", "ANDERSON GREENWOOD", "LESER", "CONSOLIDATED"]
const SERVICIOS = [
  "GAS COMBUSTIBLE",
  "GAS DE PROCESO",
  "AIRE DE INSTRUMENTOS",
  "AGUA DE REFRIGERACIÓN",
  "CONDENSADO",
]
const PV = ["GAS", "LIQUIDO", "VAPOR"]
const MODELOS = ["T800", "JOS-E", "2600", "81P", "526", "1900"]

const PERSONAS: Omit<Persona, "id" | "activo">[] = [
  { nombre: "Facundo", apellido: "Rojas", dni: "35123456" },
  { nombre: "Leandro", apellido: "Paredes", dni: "33987123" },
  { nombre: "Matías", apellido: "Cifuentes", dni: "38456789" },
  { nombre: "Diego", apellido: "Nahuel", dni: "31222333" },
  { nombre: "Emiliano", apellido: "Vidal", dni: "36777888" },
  { nombre: "Gustavo", apellido: "Lagos", dni: "29111444" },
  { nombre: "Pablo", apellido: "Benítez", dni: "40111222" },
]

export function crearSeed(): MockDb {
  const rnd = prng(20260827)
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)]

  const talleres: Taller[] = [
    { id: "tal-1", nombre: "Taller Móvil 1", color: "#2563eb", activo: true },
    { id: "tal-2", nombre: "Taller Móvil 2", color: "#16a34a", activo: true },
    { id: "tal-3", nombre: "Taller Móvil 3", color: "#ea580c", activo: true },
  ]

  const usuarios: Usuario[] = [
    {
      id: "usr-super",
      email: "superadmin@systemsrl.com.ar",
      nombre: "Sofía",
      apellido: "Herrera",
      rol: "superadmin",
      activo: true,
      creadoEn: CREADO,
    },
    {
      id: "usr-admin-1",
      email: "admin@systemsrl.com.ar",
      nombre: "Laura",
      apellido: "Méndez",
      rol: "admin",
      activo: true,
      creadoEn: CREADO,
    },
    {
      id: "usr-admin-2",
      email: "operaciones@systemsrl.com.ar",
      nombre: "Martín",
      apellido: "Quiroga",
      rol: "admin",
      activo: true,
      creadoEn: CREADO,
    },
    ...talleres.map<Usuario>((t, i) => ({
      id: `usr-taller-${i + 1}`,
      email: `taller${i + 1}@systemsrl.com.ar`,
      nombre: t.nombre,
      apellido: "",
      rol: "taller",
      tallerId: t.id,
      activo: true,
      creadoEn: CREADO,
    })),
    {
      id: "usr-cli-1",
      email: "cliente@compresionpatagonica.com.ar",
      nombre: "Julieta",
      apellido: "Ferreyra",
      rol: "cliente",
      empresaId: "emp-1",
      activo: true,
      creadoEn: CREADO,
    },
    {
      id: "usr-cli-2",
      email: "bandurria@compresionpatagonica.com.ar",
      nombre: "Tomás",
      apellido: "Aguirre",
      rol: "cliente",
      empresaId: "emp-1",
      activo: true,
      creadoEn: CREADO,
    },
    {
      id: "usr-cli-3",
      email: "cliente@serviciosdelsur.com.ar",
      nombre: "Ricardo",
      apellido: "Almonacid",
      rol: "cliente",
      empresaId: "emp-2",
      activo: true,
      creadoEn: CREADO,
    },
    {
      id: "usr-cli-4",
      email: "cliente@gasandino.com.ar",
      nombre: "Mariana",
      apellido: "Sosa",
      rol: "cliente",
      empresaId: "emp-3",
      activo: true,
      creadoEn: CREADO,
    },
  ]

  const empresas: Empresa[] = []
  const yacimientos: Yacimiento[] = []
  const plantas: Planta[] = []
  const equipos: Equipo[] = []
  const valvulas: Valvula[] = []

  let psv = 2700
  EMPRESAS.forEach((def) => {
    empresas.push({ ...def.empresa, activo: true, creadoEn: CREADO })
    def.yacimientos.forEach((y, yi) => {
      const yacimientoId = `${def.empresa.id}-y${yi + 1}`
      yacimientos.push({
        id: yacimientoId,
        empresaId: def.empresa.id,
        nombre: y.nombre,
        provincia: y.provincia,
        operadora: y.operadora,
      })
      y.plantas.forEach((p, pi) => {
        const plantaId = `${yacimientoId}-p${pi + 1}`
        plantas.push({ id: plantaId, yacimientoId, nombre: p.nombre })
        p.equipos.forEach((nombreEquipo, ei) => {
          const equipoId = `${plantaId}-e${ei + 1}`
          equipos.push({ id: equipoId, plantaId, nombre: nombreEquipo })
          const cantidad = 2 + Math.floor(rnd() * 3)
          for (let v = 0; v < cantidad; v++) {
            psv += 1 + Math.floor(rnd() * 20)
            // ~1 de cada 4 válvulas sin serie/modelo: se relevan en campo.
            const relevada = rnd() > 0.25
            valvulas.push({
              id: `${equipoId}-v${v + 1}`,
              equipoId,
              tag: `PSV-${psv}`,
              precinto: String(9400000 + Math.floor(rnd() * 99999)),
              servicio: pick(SERVICIOS),
              marca: pick(MARCAS),
              nroSerie: relevada ? String(15000000 + Math.floor(rnd() * 999999)) : undefined,
              modelo: relevada ? pick(MODELOS) : undefined,
              tipo: rnd() > 0.5 ? "PILOTADA" : "CONVENCIONAL",
              pv: pick(PV),
              diamEntrada: pick(CATALOGO_SEMILLA.diamEntrada),
              diamSalida: pick(CATALOGO_SEMILLA.diamSalida),
              rosca: pick(CATALOGO_SEMILLA.rosca),
              presionOperacion: Math.round(5 + rnd() * 60),
              temperaturaOperacion: Math.round(15 + rnd() * 60),
            })
          }
        })
      })
    })
  })

  const accesos: AccesoCliente[] = [
    { usuarioId: "usr-cli-1", nivel: "yacimiento", refId: "emp-1-y1" },
    { usuarioId: "usr-cli-1", nivel: "yacimiento", refId: "emp-1-y2" },
    { usuarioId: "usr-cli-2", nivel: "planta", refId: "emp-1-y1-p1" },
    { usuarioId: "usr-cli-3", nivel: "yacimiento", refId: "emp-2-y1" },
    { usuarioId: "usr-cli-3", nivel: "yacimiento", refId: "emp-2-y2" },
    { usuarioId: "usr-cli-4", nivel: "yacimiento", refId: "emp-3-y1" },
  ]

  const personas: Persona[] = PERSONAS.map((p, i) => ({ ...p, id: `per-${i + 1}`, activo: true }))

  const patrones: Patron[] = PATRONES_SEMILLA.map((p, i) => ({
    ...p,
    id: `pat-${i + 1}`,
    vencimiento: format(addDays(parseISO("2026-03-01"), i * 45), "yyyy-MM-dd"),
    activo: true,
  }))

  const catalogo: OpcionCatalogo[] = (Object.keys(CATALOGO_SEMILLA) as ListaCatalogo[]).flatMap(
    (lista) =>
      CATALOGO_SEMILLA[lista].map((valor, orden) => ({
        id: `cat-${lista}-${orden}`,
        lista,
        valor,
        orden,
        activo: true,
      })),
  )

  // Certificados: 0 a 2 por válvula entre mar-2025 y sep-2026, numerados por fecha.
  const borradores: Omit<Certificado, "nro" | "nombreArchivo">[] = []
  const inicio = parseISO("2025-03-01")
  valvulas.forEach((v, vi) => {
    const equipo = equipos.find((e) => e.id === v.equipoId)!
    const planta = plantas.find((p) => p.id === equipo.plantaId)!
    const yac = yacimientos.find((y) => y.id === planta.yacimientoId)!
    const cantidad = Math.floor(rnd() * 3)
    for (let c = 0; c < cantidad; c++) {
      const fecha = format(addDays(inicio, Math.floor(rnd() * 570)), "yyyy-MM-dd")
      const taller = pick(talleres)
      const nomina = [pick(personas), pick(personas)].filter((p, i, arr) => arr.indexOf(p) === i)
      const firmaTecnico: Firma = {
        nombre: nomina[0].nombre,
        apellido: nomina[0].apellido,
        dni: nomina[0].dni,
        imagen: FIRMA_DEMO,
        fecha,
      }
      const firmado = rnd() > 0.15
      const snapshot: Record<string, ValorCampo> = {
        tag: { tipo: "valor", valor: v.tag },
        precinto: { tipo: "valor", valor: v.precinto ?? "" },
        servicio: { tipo: "valor", valor: v.servicio ?? "" },
        marca: { tipo: "valor", valor: v.marca ?? "" },
        nroSerie: v.nroSerie
          ? { tipo: "valor", valor: v.nroSerie }
          : { tipo: "DATO_NO_ENCONTRADO" },
        modelo: v.modelo ? { tipo: "valor", valor: v.modelo } : { tipo: "DATO_NO_ENCONTRADO" },
        tipo: { tipo: "valor", valor: v.tipo ?? "" },
        pv: { tipo: "valor", valor: v.pv ?? "" },
        diamEntrada: { tipo: "valor", valor: v.diamEntrada ?? "" },
        diamSalida: { tipo: "valor", valor: v.diamSalida ?? "" },
        rosca: { tipo: "valor", valor: v.rosca ?? "" },
      }
      const sp = Math.round((5 + rnd() * 30) * 10) / 10
      borradores.push({
        id: `cert-${vi}-${c}`,
        localId: `local-${vi}-${c}`,
        tareaId: "",
        tallerId: taller.id,
        empresaId: yac.empresaId,
        yacimientoId: yac.id,
        plantaId: planta.id,
        equipoId: equipo.id,
        valvulaId: v.id,
        fechaEjecucion: fecha,
        emitidoEn: `${fecha}T18:00:00.000Z`,
        emitidoPor: usuarios.find((u) => u.tallerId === taller.id)!.id,
        ordenTrabajo: String(10116000 + Math.floor(rnd() * 999)),
        pdRto: String(4000 + Math.floor(rnd() * 200)),
        valvula: snapshot,
        alcance: CATALOGO_SEMILLA.alcance.filter(() => rnd() > 0.4),
        repuestos: CATALOGO_SEMILLA.repuestos.filter(() => rnd() > 0.8),
        ensayos: {
          spInicial: { valor: sp, unidad: "Kg/Cm2" },
          spApertura: { valor: Math.round((sp + 0.1) * 10) / 10, unidad: "Kg/Cm2" },
          presionCierre: { valor: Math.round((sp - 0.2) * 10) / 10, unidad: "Kg/Cm2" },
          patronId: pick(patrones).id,
          ejecuto: `${nomina[0].apellido.toUpperCase()} ${nomina[0].nombre.toUpperCase()}`,
        },
        fotos: [],
        nomina: nomina.map(({ nombre, apellido, dni }) => ({ nombre, apellido, dni })),
        firmaTecnico,
        firmaCliente: firmado
          ? {
              nombre: "Representante",
              apellido: "Cliente",
              dni: "30111222",
              imagen: FIRMA_DEMO,
              fecha,
            }
          : undefined,
        revision: 0,
      })
    }
  })

  borradores.sort((a, b) => a.fechaEjecucion.localeCompare(b.fechaEjecucion))
  const certificados: Certificado[] = borradores.map((c, i) => {
    const nro = i + 1
    const equipo = equipos.find((e) => e.id === c.equipoId)!
    const planta = plantas.find((p) => p.id === c.plantaId)!
    const tag = c.valvula.tag.tipo === "valor" ? c.valvula.tag.valor : ""
    return {
      ...c,
      nro,
      nombreArchivo: nombreArchivoCertificado({
        tag,
        equipo: equipo.nombre,
        locacion: planta.nombre,
        nro,
        fechaEjecucion: c.fechaEjecucion,
      }),
    }
  })

  // Tareas y nóminas: relativas a la fecha de hoy para que la agenda siempre tenga datos cerca.
  const hoy = format(new Date(), "yyyy-MM-dd")
  const lunes = startOfWeek(parseISO(hoy), { weekStartsOn: 1 })
  const HORARIOS = ["07:00", "07:30", "08:00", "08:30", "09:00", "10:00", "13:00", "14:00"]
  const CONTACTOS = [
    { contacto: "Supervisor de planta", telefono: "299 555-1100" },
    { contacto: "Jefe de mantenimiento", telefono: "299 555-1200" },
    { contacto: "Coordinación de campo", telefono: "299 555-1300" },
  ]
  const DETALLES = [
    "Calibración anual de PSV de la unidad",
    "Recalibración de válvula disparada por sobrepresión",
    "Mantenimiento y calibración de válvulas del listado adjunto",
    "Relevamiento de válvulas instaladas y datos de placa",
  ]

  const borradoresTareas: Omit<Tarea, "nroSolicitud">[] = []
  for (let d = -35; d <= 35; d++) {
    const fecha = addDays(lunes, d)
    if (isWeekend(fecha)) continue
    const cantidad = rnd() < 0.35 ? 0 : 1 + Math.floor(rnd() * 2)
    for (let i = 0; i < cantidad; i++) {
      const equipo = pick(equipos)
      const planta = plantas.find((p) => p.id === equipo.plantaId)!
      const yac = yacimientos.find((y) => y.id === planta.yacimientoId)!
      const fechaEjecucion = format(fecha, "yyyy-MM-dd")
      const pasada = fechaEjecucion < hoy
      const asignada = pasada || rnd() < 0.7
      let estado: EstadoTarea = asignada ? "asignada" : "pendiente"
      if (pasada) estado = rnd() < 0.9 ? "completada" : "cancelada"
      else if (fechaEjecucion === hoy && asignada) estado = "en_curso"
      const tipo = pick(TIPOS_TAREA)
      borradoresTareas.push({
        id: `tar-${borradoresTareas.length + 1}`,
        empresaId: yac.empresaId,
        yacimientoId: yac.id,
        plantaId: planta.id,
        equipoId: equipo.id,
        tallerId: asignada ? pick(talleres).id : undefined,
        ...pick(CONTACTOS),
        fechaSolicitud: format(subDays(fecha, 3 + Math.floor(rnd() * 18)), "yyyy-MM-dd"),
        fechaEjecucion,
        horario: pick(HORARIOS),
        tipo,
        detalle: pick(DETALLES),
        ordenTrabajo: rnd() < 0.6 ? String(10116000 + Math.floor(rnd() * 999)) : undefined,
        pdRto: rnd() < 0.4 ? String(4000 + Math.floor(rnd() * 200)) : undefined,
        condiciones: CATALOGO_SEMILLA.condicionesServicio.filter(() => rnd() < 0.3),
        adjuntos: [],
        estado,
      })
    }
  }
  // El N° de solicitud se asignó al cargar la tarea: sigue el orden de la fecha de solicitud.
  const SOLICITUD_INICIAL = 1000
  const tareas: Tarea[] = borradoresTareas
    .sort((a, b) => a.fechaSolicitud.localeCompare(b.fechaSolicitud))
    .map((t, i) => ({ ...t, nroSolicitud: SOLICITUD_INICIAL + i + 1 }))

  // Nóminas cargadas hasta la semana siguiente; más adelante quedan vacías para cargarlas.
  const nominas: NominaJornada[] = []
  for (let d = -35; d <= 11; d++) {
    const fecha = addDays(lunes, d)
    if (isWeekend(fecha)) continue
    const disponibles = [...personas].sort(() => rnd() - 0.5)
    talleres.forEach((t, i) => {
      nominas.push({
        tallerId: t.id,
        fecha: format(fecha, "yyyy-MM-dd"),
        personaIds: disponibles.slice(i * 2, i * 2 + 2).map((p) => p.id),
      })
    })
  }

  return {
    version: MOCK_DB_VERSION,
    usuarios,
    accesos,
    empresas,
    yacimientos,
    plantas,
    equipos,
    valvulas,
    talleres,
    personas,
    patrones,
    catalogo,
    certificados,
    tareas,
    nominas,
    secuencias: {
      certificado: certificados.length,
      solicitud: SOLICITUD_INICIAL + tareas.length,
    },
  }
}
