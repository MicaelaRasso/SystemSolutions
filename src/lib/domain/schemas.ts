/**
 * Esquemas Zod de entrada (formularios). Reutilizables en Edge Functions para validar del lado servidor.
 */

import { z } from "zod"

const requerido = (campo: string) => z.string().trim().min(1, `${campo} es obligatorio`)
const opcional = z.string().trim()

export const loginSchema = z.object({
  email: z.email("Ingresá un email válido"),
  password: z.string().min(1, "Ingresá tu contraseña"),
})
export type LoginInput = z.infer<typeof loginSchema>

export const empresaSchema = z.object({
  razonSocial: requerido("La razón social"),
  cuit: z
    .string()
    .trim()
    .regex(/^\d{2}-\d{8}-\d$/, "Formato esperado: 30-12345678-9"),
  contacto: requerido("El contacto"),
  telefono: requerido("El teléfono"),
  email: z.union([z.literal(""), z.email("Email inválido")]),
  direccion: opcional,
  avisoVencimiento: z.boolean(),
  activo: z.boolean(),
})
export type EmpresaInput = z.infer<typeof empresaSchema>

export const yacimientoSchema = z.object({
  nombre: requerido("El nombre"),
  provincia: requerido("La provincia"),
  operadora: requerido("La operadora"),
})
export type YacimientoInput = z.infer<typeof yacimientoSchema>

export const plantaSchema = z.object({
  nombre: requerido("El nombre"),
})
export type PlantaInput = z.infer<typeof plantaSchema>

export const equipoSchema = z.object({
  nombre: requerido("El nombre"),
  descripcion: opcional,
})
export type EquipoInput = z.infer<typeof equipoSchema>

const numeroOpcional = z.union([
  z.literal(""),
  z.string().regex(/^-?\d+([.,]\d+)?$/, "Debe ser un número"),
])

/** Serie, modelo y otros datos pueden quedar vacíos al alta: se relevan en campo (RF-08). */
export const valvulaSchema = z.object({
  tag: requerido("El TAG"),
  precinto: opcional,
  servicio: opcional,
  marca: opcional,
  nroSerie: opcional,
  modelo: opcional,
  // Valor del catálogo "tipo" (editable desde /admin/catalogos).
  tipo: opcional,
  pv: opcional,
  diamEntrada: opcional,
  diamSalida: opcional,
  rosca: opcional,
  presionOperacion: numeroOpcional,
  temperaturaOperacion: numeroOpcional,
  notas: opcional,
})
export type ValvulaInput = z.infer<typeof valvulaSchema>

export const usuarioClienteSchema = z.object({
  nombre: requerido("El nombre"),
  apellido: requerido("El apellido"),
  email: z.email("Email inválido"),
  activo: z.boolean(),
})
export type UsuarioClienteInput = z.infer<typeof usuarioClienteSchema>

// ---------------------------------------------------------------------------
// Fase 3: catálogos, patrones, talleres y personal
// ---------------------------------------------------------------------------

const fechaIso = (campo: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${campo} es obligatoria`)

export const patronSchema = z.object({
  nombre: requerido("El nombre"),
  nroSerie: requerido("El N° de serie"),
  vencimiento: fechaIso("La fecha de vencimiento"),
  activo: z.boolean(),
})
export type PatronInput = z.infer<typeof patronSchema>

export const tallerSchema = z.object({
  nombre: requerido("El nombre"),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Elegí un color"),
  email: z.email("Email de la cuenta inválido"),
  activo: z.boolean(),
})
export type TallerInput = z.infer<typeof tallerSchema>

export const personaSchema = z.object({
  nombre: requerido("El nombre"),
  apellido: requerido("El apellido"),
  dni: z
    .string()
    .trim()
    .regex(/^\d{7,8}$/, "DNI de 7 u 8 dígitos, sin puntos"),
  activo: z.boolean(),
})
export type PersonaInput = z.infer<typeof personaSchema>

// ---------------------------------------------------------------------------
// Fase 4: tareas (RF-13)
// ---------------------------------------------------------------------------

export const tareaSchema = z
  .object({
    empresaId: requerido("El cliente"),
    yacimientoId: requerido("El yacimiento"),
    plantaId: requerido("La planta"),
    equipoId: requerido("El equipo"),
    /** Vacío = sin asignar (RF-14). */
    tallerId: z.string(),
    contacto: requerido("El contacto"),
    telefono: requerido("El teléfono"),
    fechaSolicitud: fechaIso("La fecha de solicitud"),
    fechaEjecucion: fechaIso("La fecha de ejecución"),
    horario: z.union([
      z.literal(""),
      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM"),
    ]),
    tipo: requerido("El tipo de tarea"),
    detalle: requerido("El detalle del trabajo"),
    pdRto: opcional,
    ordenTrabajo: opcional,
    condiciones: z.array(z.string()),
    estado: z.enum(["pendiente", "asignada", "en_curso", "completada", "cancelada"]),
  })
  .refine((t) => t.fechaEjecucion >= t.fechaSolicitud, {
    path: ["fechaEjecucion"],
    message: "No puede ser anterior a la fecha de solicitud",
  })
export type TareaInput = z.infer<typeof tareaSchema>
