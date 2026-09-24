/**
 * Valores semilla de las listas desplegables del certificado.
 * Fuente: "SYS_Certificado Modelo_Referencias.pdf". Serán editables desde /admin/catalogos.
 */

import type { ListaCatalogo } from "./types"

const CLASES_150 = [
  "1/2",
  "3/4",
  "1",
  "1 1/2",
  "2",
  "2 1/2",
  "3",
  "3 1/2",
  "4",
  "4 1/2",
  "6",
  "8",
  "10",
]
const CLASES_600 = ["1/2", "3/4", "1", "1 1/2", "2", "2 1/2", "3", "4", "6", "8", "10"]
const CLASES_900 = ["1", "2", "3", "4", "6", "8", "10", "1 1/2"]
const SIN_CLASE = ["1/4", "1/2", "3/4", "1", "1 1/2", "2", "2 1/2", "3", "3/8"]

const conClase = (medidas: string[], clase: number) => medidas.map((m) => `${m}"#${clase}`)
const sinClase = SIN_CLASE.map((m) => `${m}"`)

// En la fuente figura `4 1/2"300`; se normaliza a `4 1/2"#300` (a confirmar con el cliente).
const bridadas = [
  ...conClase(CLASES_150, 150),
  ...conClase(CLASES_150, 300),
  ...conClase(CLASES_600, 600),
  ...conClase(CLASES_900, 900),
]

export const CATALOGO_SEMILLA: Record<ListaCatalogo, string[]> = {
  diamEntrada: ['3/8"BSP', ...bridadas, ...sinClase, '1 1/2"#1500'],
  diamSalida: [...sinClase, '3/8"BSP', ...bridadas],
  rosca: ["NPT", "N/A"],
  unidad: ["Kg/Cm2", "psi", "BAR", "mmH2O", "Otro"],
  tipo: ["PILOTADA", "CONVENCIONAL"],
  alcance: [
    "DESMONTAJE",
    "DESARME",
    "LIMPIEZA",
    "VERIFICAR INTERNOS",
    "RECTIF. ASIENTO",
    "RECTIF. OBTURADOR",
    "VERIFICAR O'RINGS",
    "PRUEBA SET",
    "CALIBRACION",
    "PINTADO",
    "PRECINTO/PLACA DATOS",
  ],
  repuestos: [
    "KIT O'RING",
    "JUNTAS INTERNO",
    "ASIENTO",
    "OBTURADOR",
    "U'PACKING",
    "RESORTE",
    "BONETE",
    "TUERCAS",
    "ESPARRAGOS",
    "JUNTAS PROCESO",
  ],
  // Provisorio hasta definir P-11.
  condicionesServicio: [
    "Válvulas en altura",
    "Requiere hidrogrúa",
    "Requiere andamio",
    "Requiere permiso de trabajo",
  ],
}

export const PATRONES_SEMILLA: { nombre: string; nroSerie: string }[] = [
  { nombre: "KELLER LEO 1", nroSerie: "122330" },
  { nombre: "KELLER LEO 2", nroSerie: "116474" },
  { nombre: "KELLER LEO 2", nroSerie: "140286" },
  { nombre: "KELLER LEO 2", nroSerie: "140287" },
  { nombre: "WIKA", nroSerie: "1A03L5X9T33" },
  { nombre: "WIKA", nroSerie: "1A03L5XAS33" },
  { nombre: "FLUKE 717", nroSerie: "300G" },
  { nombre: "KELLER DRUCK", nroSerie: "22443" },
  { nombre: "WIKA", nroSerie: "1A03ALKI5IH" },
]

export const PROVINCIAS = ["Neuquén", "Río Negro", "Mendoza", "La Pampa", "Chubut", "Santa Cruz"]

/** Tipos de tarea que se toman al cargar una solicitud. */
export const TIPOS_TAREA = [
  "Mantenimiento y calibración",
  "Calibración",
  "Recalibración",
  "Relevamiento",
] as const

/** Paleta para distinguir talleres en agenda y cronograma. */
export const COLORES_TALLER = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#ca8a04",
  "#475569",
]

export const LISTA_CATALOGO_LABEL: Record<ListaCatalogo, { titulo: string; descripcion: string }> =
  {
    diamEntrada: { titulo: "Ø Entrada / #", descripcion: "Desplegable 1 del certificado" },
    diamSalida: { titulo: "Ø Salida / #", descripcion: "Desplegable 2 del certificado" },
    rosca: { titulo: "Rosca", descripcion: "Desplegable 3 del certificado" },
    unidad: { titulo: "Unidad de medida", descripcion: "Desplegable 4: unidades de los ensayos" },
    tipo: { titulo: "Tipo de funcionamiento", descripcion: "Desplegable 6: tipo de válvula" },
    alcance: { titulo: "Alcance", descripcion: "Casillas de mantenimiento (sección 1.3)" },
    repuestos: { titulo: "Repuestos", descripcion: "Casillas de repuestos (sección 1.3)" },
    condicionesServicio: {
      titulo: "Condiciones del servicio",
      descripcion: "Se relevan al tomar la solicitud (P-11)",
    },
  }
