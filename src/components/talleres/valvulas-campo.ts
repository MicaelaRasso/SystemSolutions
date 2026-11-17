/**
 * Catálogo de válvulas y equipos del Cliente para agregar válvulas en campo (A3). Funciona sin
 * conexión: sale del contexto guardado de la visita (árbol de su yacimiento y `client_yacimientos`
 * del working set, que trae los yacimientos del mismo Cliente a los que el taller tiene acceso).
 */

import type { FieldValveData } from "@/lib/api/contracts"
import type { ValvulaInput } from "@/lib/domain/schemas"

type Registro = Record<string, unknown>

export interface ArbolYacimiento {
  yacimiento: { id: string; nombre?: string } & Registro
  plantas: Registro[]
  equipos: Registro[]
  valvulas: Registro[]
}

export interface ValvulaCatalogo {
  id: string
  nombre: string
  equipoId: string
  equipoNombre: string
  plantaNombre: string
  yacimientoId: string
  yacimientoNombre: string
  numeroSerie?: string
  /** Fila completa de la válvula, para mostrar sus datos en la orden agregada. */
  valvula: Registro
}

export interface EquipoCatalogo {
  id: string
  nombre: string
  plantaNombre: string
  yacimientoId: string
  yacimientoNombre: string
}

const esRegistro = (valor: unknown): valor is Registro =>
  !!valor && typeof valor === "object" && !Array.isArray(valor)

const texto = (valor: unknown) => (typeof valor === "string" ? valor : "")

const lista = (valor: unknown): Registro[] => (Array.isArray(valor) ? valor.filter(esRegistro) : [])

function comoArbol(valor: unknown): ArbolYacimiento | undefined {
  if (!esRegistro(valor) || !esRegistro(valor.yacimiento)) return undefined
  const yacimiento = valor.yacimiento
  if (typeof yacimiento.id !== "string") return undefined
  return {
    yacimiento: yacimiento as ArbolYacimiento["yacimiento"],
    plantas: lista(valor.plantas),
    equipos: lista(valor.equipos),
    valvulas: lista(valor.valvulas),
  }
}

/** Árboles disponibles: los del Cliente con acceso del taller y, si no figura, el de la visita. */
export function arbolesDeLaVisita(contexto: {
  context?: unknown
  client_yacimientos?: unknown
}): ArbolYacimiento[] {
  const arboles: ArbolYacimiento[] = []
  const vistos = new Set<string>()
  const candidatos = [
    ...(Array.isArray(contexto.client_yacimientos) ? contexto.client_yacimientos : []),
    contexto.context,
  ]
  for (const candidato of candidatos) {
    const arbol = comoArbol(candidato)
    if (!arbol || vistos.has(arbol.yacimiento.id)) continue
    vistos.add(arbol.yacimiento.id)
    arboles.push(arbol)
  }
  return arboles
}

const comparar = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" })

/** Equipos existentes del catálogo, ordenados por yacimiento, planta y nombre. */
export function equiposDelCatalogo(arboles: ArbolYacimiento[]): EquipoCatalogo[] {
  return arboles
    .flatMap((arbol) => {
      const plantas = new Map(arbol.plantas.map((planta) => [planta.id, texto(planta.nombre)]))
      return arbol.equipos
        .filter((equipo) => typeof equipo.id === "string")
        .map((equipo) => ({
          id: equipo.id as string,
          nombre: texto(equipo.nombre),
          plantaNombre: plantas.get(equipo.planta_id) ?? "",
          yacimientoId: arbol.yacimiento.id,
          yacimientoNombre: texto(arbol.yacimiento.nombre),
        }))
    })
    .sort(
      (a, b) =>
        comparar(a.yacimientoNombre, b.yacimientoNombre) ||
        comparar(a.plantaNombre, b.plantaNombre) ||
        comparar(a.nombre, b.nombre),
    )
}

/** Válvulas del catálogo con su ubicación, sin las que ya tiene la visita. */
export function valvulasDelCatalogo(
  arboles: ArbolYacimiento[],
  excluir: ReadonlySet<string>,
): ValvulaCatalogo[] {
  const equipos = new Map(equiposDelCatalogo(arboles).map((equipo) => [equipo.id, equipo]))
  return arboles
    .flatMap((arbol) => arbol.valvulas)
    .flatMap((valvula) => {
      const equipo = equipos.get(texto(valvula.equipo_id))
      if (typeof valvula.id !== "string" || excluir.has(valvula.id) || !equipo) return []
      return [
        {
          id: valvula.id,
          nombre: texto(valvula.nombre),
          equipoId: equipo.id,
          equipoNombre: equipo.nombre,
          plantaNombre: equipo.plantaNombre,
          yacimientoId: equipo.yacimientoId,
          yacimientoNombre: equipo.yacimientoNombre,
          numeroSerie: texto(valvula.numero_serie) || undefined,
          valvula,
        },
      ]
    })
    .sort(
      (a, b) =>
        comparar(a.yacimientoNombre, b.yacimientoNombre) ||
        comparar(a.plantaNombre, b.plantaNombre) ||
        comparar(a.equipoNombre, b.equipoNombre) ||
        comparar(a.nombre, b.nombre),
    )
}

const normalizar = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

/** Filtra por TAG, equipo, planta, yacimiento o N° de serie; cada palabra tiene que aparecer. */
export function buscarValvulas(valvulas: ValvulaCatalogo[], consulta: string): ValvulaCatalogo[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return valvulas
  return valvulas.filter((valvula) => {
    const pajar = normalizar(
      [
        valvula.nombre,
        valvula.equipoNombre,
        valvula.plantaNombre,
        valvula.yacimientoNombre,
        valvula.numeroSerie ?? "",
      ].join(" "),
    )
    return palabras.every((palabra) => pajar.includes(palabra))
  })
}

const textoONulo = (valor: string) => (valor.trim() === "" ? null : valor.trim())
const numeroONulo = (valor: string) =>
  valor.trim() === "" ? null : Number(valor.trim().replace(",", "."))

/** Datos del formulario de válvula (el mismo del Administrador) en el formato del servidor (A2). */
export function datosDeValvulaDeCampo(data: ValvulaInput): FieldValveData {
  return {
    nombre: data.tag.trim().toUpperCase(),
    precinto: textoONulo(data.precinto),
    servicio: textoONulo(data.servicio),
    marca: textoONulo(data.marca),
    numero_serie: textoONulo(data.nroSerie),
    modelo: textoONulo(data.modelo),
    tipo: textoONulo(data.tipo),
    pv: textoONulo(data.pv),
    diametro_entrada: textoONulo(data.diamEntrada),
    diametro_salida: textoONulo(data.diamSalida),
    rosca: textoONulo(data.rosca),
    presion_operacion: numeroONulo(data.presionOperacion),
    temperatura_operacion: numeroONulo(data.temperaturaOperacion),
    notas: textoONulo(data.notas),
  }
}
