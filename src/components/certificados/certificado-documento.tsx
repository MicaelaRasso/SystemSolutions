import { Check, ImageOff } from "lucide-react"

import { Logo } from "@/components/brand/logo"
import { cn } from "@/lib/utils"

import {
  SIN_DATO,
  type CertificadoVista,
  type FirmaVista,
  type FotoVista,
} from "./certificado-vista"

/**
 * Certificado SYS en formato A4, fiel al modelo (secciones 1.0 a 1.5, Anexo fotográfico y pie legal).
 * Presentacional: recibe el modelo de vista ya armado y no consulta datos.
 */
export function CertificadoDocumento({
  vista,
  requiereFirma,
  className,
}: {
  vista: CertificadoVista
  requiereFirma: boolean
  className?: string
}) {
  const { ubicacion, valvula, mantenimiento, ensayos, fotos, firmas } = vista
  return (
    <article
      data-certificado-hoja
      aria-label={`Certificado ${vista.numero}`}
      className={cn(
        "relative isolate min-h-[297mm] w-[210mm] bg-white px-[12mm] py-[10mm] font-mono text-[7.5pt] leading-[1.35] text-zinc-900",
        className,
      )}
    >
      {requiereFirma && <MarcaRequiereFirma />}

      <header className="grid grid-cols-[38mm_1fr_38mm] items-center gap-[4mm] pb-[5mm]">
        <Logo variant="color" className="text-[11pt]" />
        <h2 className="text-center text-[9pt] leading-snug font-bold">
          MANTENIMIENTO Y CALIBRACIÓN
          <br />
          VÁLVULAS DE SEGURIDAD
        </h2>
        <div className="flex h-[14mm] items-center justify-end">
          {vista.logoCliente?.url && (
            // eslint-disable-next-line @next/next/no-img-element -- dirección firmada del backend
            <img
              src={vista.logoCliente.url}
              alt="Logo del cliente"
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
      </header>

      <Seccion numero="1.0" titulo="UBICACIÓN">
        <div className="grid grid-cols-[1fr_auto] gap-x-[6mm]">
          <dl className="space-y-[0.8mm]">
            <Campo etiqueta="Provincia" valor={ubicacion.provincia} />
            <Campo etiqueta="Yacimiento" valor={ubicacion.yacimiento} />
            <Campo etiqueta="Operadora" valor={ubicacion.operadora} />
            <Campo etiqueta="Contratista" valor={ubicacion.contratista} />
            <Campo etiqueta="Locación" valor={ubicacion.locacion} />
            <Campo etiqueta="Equipo" valor={ubicacion.equipo} />
          </dl>
          <dl className="space-y-[0.8mm]">
            <Campo
              etiqueta="Certificado #"
              valor={vista.numero}
              etiquetaAncho="w-[34mm]"
              ancho="w-[24mm]"
              alinear="derecha"
            />
            <Campo
              etiqueta="PD/RTO"
              valor={vista.pdRto}
              etiquetaAncho="w-[34mm]"
              ancho="w-[24mm]"
              alinear="derecha"
            />
            <Campo
              etiqueta="Fecha ejecución"
              valor={vista.fechaEjecucion}
              etiquetaAncho="w-[34mm]"
              ancho="w-[24mm]"
              alinear="derecha"
            />
            <Campo
              etiqueta="Orden de trabajo"
              valor={vista.ordenTrabajo}
              etiquetaAncho="w-[34mm]"
              ancho="w-[24mm]"
              alinear="derecha"
            />
          </dl>
        </div>
      </Seccion>

      <Seccion numero="1.1" titulo="VÁLVULA DE SEGURIDAD">
        <div className="grid grid-cols-[1fr_auto] gap-x-[6mm]">
          <dl className="space-y-[0.8mm]">
            <Campo etiqueta="Precinto" valor={valvula.precinto} ancho="w-[42mm]" />
            <Campo etiqueta="Servicio" valor={valvula.servicio} ancho="w-[42mm]" />
            <Campo etiqueta="TAG" valor={valvula.tag} ancho="w-[42mm]" />
            <Campo etiqueta="Marca" valor={valvula.marca} ancho="w-[42mm]" />
            <Campo etiqueta="# Serie" valor={valvula.serie} ancho="w-[42mm]" />
            <Campo etiqueta="Modelo" valor={valvula.modelo} ancho="w-[42mm]" />
            <Campo etiqueta="Tipo" valor={valvula.tipo} ancho="w-[42mm]" />
            <Campo etiqueta="PV" valor={valvula.pv} ancho="w-[42mm]" />
          </dl>
          <dl className="space-y-[0.8mm]">
            <Campo
              etiqueta="Ø Ent./#"
              valor={valvula.diametroEntrada}
              etiquetaAncho="w-[26mm]"
              ancho="w-[26mm]"
              unidad="in."
            />
            <Campo
              etiqueta="Ø Sal./#"
              valor={valvula.diametroSalida}
              etiquetaAncho="w-[26mm]"
              ancho="w-[26mm]"
              unidad="in."
            />
            <Campo
              etiqueta="Rosca"
              valor={valvula.rosca}
              etiquetaAncho="w-[26mm]"
              ancho="w-[26mm]"
              unidad="in."
            />
            <div className="h-[9mm]" aria-hidden />
            <Campo
              etiqueta="P. operación"
              valor={valvula.presionOperacion}
              etiquetaAncho="w-[26mm]"
              ancho="w-[26mm]"
              unidad="Kg/cm2"
            />
            <Campo
              etiqueta="T° operación"
              valor={valvula.temperaturaOperacion}
              etiquetaAncho="w-[26mm]"
              ancho="w-[26mm]"
              unidad="°C"
            />
          </dl>
        </div>
      </Seccion>

      <Seccion numero="1.2" titulo="MANTENIMIENTO">
        <div className="grid grid-cols-2 gap-x-[8mm]">
          <Casillas titulo="ALCANCE" items={mantenimiento.alcance} />
          <Casillas
            titulo="REPUESTOS"
            items={mantenimiento.repuestos}
            otros={mantenimiento.otros}
          />
        </div>
      </Seccion>

      <Seccion numero="1.3" titulo="ENSAYOS">
        <div className="grid grid-cols-[1fr_auto] gap-x-[6mm]">
          <table className="border-separate border-spacing-y-[0.8mm]">
            <thead>
              <tr className="font-bold">
                <th scope="col" className="w-[34mm]">
                  <span className="sr-only">Ensayo</span>
                </th>
                <th scope="col" className="w-[20mm] text-center">
                  VALOR
                </th>
                <th scope="col" className="w-[20mm] text-center">
                  UNIDAD
                </th>
              </tr>
            </thead>
            <tbody>
              <FilaEnsayo etiqueta="SP inicial" ensayo={ensayos.spInicial} />
              <FilaEnsayo etiqueta="SP apertura" ensayo={ensayos.spApertura} />
              <FilaEnsayo etiqueta="Presión de cierre" ensayo={ensayos.presionCierre} />
            </tbody>
          </table>
          <dl>
            <Campo
              etiqueta="Ejecutó"
              valor={ensayos.ejecuto}
              etiquetaAncho="w-auto"
              ancho="w-[48mm]"
            />
          </dl>
        </div>
        <dl className="mt-[1mm] space-y-[0.8mm]">
          <Campo
            etiqueta="Patrón utilizado"
            valor={ensayos.patron}
            etiquetaAncho="w-[34mm]"
            ancho="w-[70mm]"
          />
          <Campo
            etiqueta="Vencimiento"
            valor={ensayos.vencimientoPatron}
            etiquetaAncho="w-[34mm]"
            ancho="w-[70mm]"
          />
        </dl>
      </Seccion>

      <Seccion numero="1.4" titulo="OBSERVACIONES">
        <p className="mx-[10mm] min-h-[20mm] bg-[linear-gradient(to_bottom,transparent_calc(5mm-1px),var(--color-zinc-300)_calc(5mm-1px))] bg-[length:100%_5mm] text-[8pt] leading-[5mm] whitespace-pre-line">
          {vista.observaciones === SIN_DATO ? "" : vista.observaciones}
        </p>
        {vista.adicionales.length > 0 && (
          <dl className="mx-[10mm] mt-[2mm] space-y-[0.8mm]">
            {vista.adicionales.map((dato) => (
              <Campo
                key={dato.etiqueta}
                etiqueta={dato.etiqueta}
                valor={dato.valor}
                etiquetaAncho="w-[40mm]"
                ancho="w-[80mm]"
              />
            ))}
          </dl>
        )}
      </Seccion>

      <Seccion numero="1.5" titulo="APROBACIÓN">
        <div className="grid grid-cols-2 gap-x-[12mm] px-[6mm]">
          <Firma titulo="POR SYSTEM SOLUTIONS" firma={firmas.tecnico} />
          <Firma titulo="POR CLIENTE" firma={firmas.cliente} />
        </div>
        <dl className="mt-[3mm] px-[6mm]">
          <Campo
            etiqueta="Nómina del taller"
            valor={vista.nomina}
            etiquetaAncho="w-auto"
            ancho="w-[110mm]"
          />
        </dl>
      </Seccion>

      <section aria-label="Anexo fotográfico" className="mt-[2mm] border-t-2 border-cert-linea pt-[3mm]">
        <div data-certificado-seccion className="pb-[4mm]">
          <h3 className="mb-[2.5mm] border-b border-cert-linea pb-[0.8mm] text-[8pt] font-bold tracking-wide uppercase">
            ANEXO — REGISTRO FOTOGRÁFICO
          </h3>
          <h4 className="mb-[2mm] text-[7.5pt] font-bold">FOTO VÁLVULA DESARMADA</h4>
          <Fotos fotos={fotos.desarmada} descripcion="Válvula desarmada" pares />
        </div>

        <div data-certificado-seccion className="pb-[4mm]">
          <h4 className="mb-[2mm] border-b border-cert-linea pb-[0.8mm] text-[7.5pt] font-bold">
            FOTO VÁLVULA ARMADA PARA ENSAYOS
          </h4>
          <Fotos fotos={fotos.ensamblada_prueba} descripcion="Válvula armada para ensayos" />
        </div>

        <div data-certificado-seccion className="pb-[4mm]">
          <h4 className="mb-[2mm] border-b border-cert-linea pb-[0.8mm] text-[7.5pt] font-bold">
            FOTO VÁLVULA ARMADA CON CHAPA Y PRECINTO
          </h4>
          <Fotos fotos={fotos.placa_precinto} descripcion="Válvula armada con chapa y precinto" />
        </div>

        {vista.fotosParteDiario && vista.fotosParteDiario.length > 0 && (
          <div data-certificado-seccion className="pb-[4mm]">
            <h4 className="mb-[2mm] border-b border-cert-linea pb-[0.8mm] text-[7.5pt] font-bold">
              FOTO PARTE DIARIO {vista.pdRto !== SIN_DATO ? `(${vista.pdRto})` : ""}
            </h4>
            <Fotos fotos={vista.fotosParteDiario} descripcion="Parte diario" />
          </div>
        )}
      </section>

      <footer
        data-certificado-seccion
        className="mt-[3mm] space-y-[2mm] border-t border-cert-linea pt-[2mm] text-[6.5pt] leading-snug"
      >
        <p>
          LOS RESULTADOS CONTENIDOS EN EL PRESENTE CERTIFICADO ESTÁN REFERIDOS AL MOMENTO Y
          CONDICIONES EN QUE SE REALIZARON LOS ENSAYOS. SYSTEM SOLUTIONS SRL NO SE RESPONSABILIZA DE
          LOS PERJUICIOS QUE PUEDAN DERIVARSE DEL USO INADECUADO DE ESTE CERTIFICADO.
        </p>
        <p className="border-t border-cert-linea pt-[2mm]">
          SI POR CUESTIONES OPERATIVAS SE ACTIVA UN DISPOSITIVO DE SEGURIDAD, SERÁ NECESARIO SU
          RECALIBRACIÓN Y AJUSTE INDEPENDIENTEMENTE A LA FECHA DE SU ÚLTIMO MANTENIMIENTO Y/O
          CALIBRACIÓN.-
        </p>
      </footer>
    </article>
  )
}

/**
 * Leyenda "REQUIERE FIRMA". En pantalla se repite tres veces a lo alto de la hoja; con `unica`
 * muestra una sola, centrada, como en cada hoja impresa (la usa el PDF para estamparla por hoja).
 */
export function MarcaRequiereFirma({ unica = false }: { unica?: boolean }) {
  return (
    <div
      data-certificado-marca
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex flex-col items-center overflow-hidden",
        unica ? "justify-center" : "justify-around",
      )}
    >
      {(unica ? [0] : [0, 1, 2]).map((i) => (
        <span
          key={i}
          aria-hidden={i > 0 || undefined}
          className="-rotate-[35deg] rounded-[2mm] border-[1.2mm] border-double border-cert-valor/45 px-[6mm] py-[1mm] font-sans text-[46pt] font-black tracking-[0.06em] whitespace-nowrap text-cert-valor/45"
        >
          REQUIERE FIRMA
        </span>
      ))}
    </div>
  )
}

function Seccion({
  numero,
  titulo,
  children,
}: {
  numero: string
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section data-certificado-seccion className="pb-[4mm]">
      <h3 className="mb-[2.5mm] border-b border-cert-linea pb-[0.8mm] text-[7.5pt] font-bold">
        {numero} {titulo}
      </h3>
      {children}
    </section>
  )
}

function Valor({ valor, className }: { valor: string; className?: string }) {
  const sinDato = valor === SIN_DATO
  return (
    <span
      className={cn(
        "block min-h-[4.2mm] truncate border-b border-zinc-300 bg-cert-campo px-[1.2mm] font-bold",
        sinDato ? "text-zinc-400" : "text-cert-valor",
        className,
      )}
    >
      {valor}
    </span>
  )
}

function Campo({
  etiqueta,
  valor,
  unidad,
  etiquetaAncho = "w-[28mm]",
  ancho = "w-[62mm]",
  alinear = "izquierda",
}: {
  etiqueta: string
  valor: string
  unidad?: string
  etiquetaAncho?: string
  ancho?: string
  alinear?: "izquierda" | "derecha"
}) {
  return (
    <div className="flex items-baseline gap-[1.2mm]">
      <dt className={cn("shrink-0 text-right font-bold uppercase", etiquetaAncho)}>{etiqueta}:</dt>
      <dd className={cn("min-w-0", ancho)}>
        <Valor valor={valor} className={alinear === "derecha" ? "text-right" : undefined} />
      </dd>
      {unidad && <span className="shrink-0">{unidad}</span>}
    </div>
  )
}

function FilaEnsayo({
  etiqueta,
  ensayo,
}: {
  etiqueta: string
  ensayo: { valor: string; unidad: string }
}) {
  return (
    <tr>
      <th scope="row" className="pr-[1.2mm] text-right font-bold uppercase">
        {etiqueta}:
      </th>
      <td className="px-[0.6mm]">
        <Valor valor={ensayo.valor} className="text-center" />
      </td>
      <td className="px-[0.6mm]">
        <Valor valor={ensayo.unidad} className="text-center" />
      </td>
    </tr>
  )
}

function Casillas({
  titulo,
  items,
  otros,
}: {
  titulo: string
  items: { label: string; marcado: boolean }[]
  otros?: string | null
}) {
  return (
    <div>
      <p className="mb-[1mm] pr-[10mm] text-right font-bold">{titulo}</p>
      <ul className="space-y-[0.6mm]">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-end gap-[2mm]">
            <span className="text-right uppercase">{item.label}</span>
            <Casilla marcado={item.marcado} />
          </li>
        ))}
        {otros !== undefined && (
          <li className="flex items-center justify-end gap-[2mm]">
            <span>OTROS</span>
            <Casilla marcado={Boolean(otros)} />
          </li>
        )}
      </ul>
      {otros && <Valor valor={otros} className="mt-[1mm] whitespace-normal" />}
    </div>
  )
}

function Casilla({ marcado }: { marcado: boolean }) {
  return (
    <span
      role="img"
      aria-label={marcado ? "Marcado" : "Sin marcar"}
      className="flex w-[8mm] justify-center bg-cert-campo py-[0.3mm]"
    >
      <span className="flex size-[3mm] items-center justify-center border border-zinc-600 bg-white">
        {marcado && <Check className="size-[2.6mm] stroke-[3]" aria-hidden />}
      </span>
    </span>
  )
}

function Fotos({
  fotos,
  descripcion,
  pares = false,
}: {
  fotos: FotoVista[]
  descripcion: string
  pares?: boolean
}) {
  const lista = fotos.length ? fotos : [null]
  return (
    <div
      className={cn(
        "grid justify-center gap-[6mm]",
        pares || lista.length > 1 ? "grid-cols-[repeat(2,62mm)]" : "grid-cols-[62mm]",
      )}
    >
      {lista.map((foto, i) => (
        <figure
          key={i}
          className="flex h-[52mm] items-center justify-center overflow-hidden border border-zinc-300 bg-zinc-50"
        >
          {foto?.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- dirección firmada del backend
            <img
              src={foto.url}
              alt={`${descripcion}, foto ${i + 1}`}
              className="size-full object-contain"
            />
          ) : (
            <figcaption className="flex flex-col items-center gap-[1.5mm] px-[4mm] text-center font-sans text-[7pt] text-zinc-500">
              <ImageOff className="size-[5mm]" aria-hidden />
              {foto ? "Foto registrada; la vista previa no está disponible" : "Sin foto cargada"}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  )
}

function Firma({ titulo, firma }: { titulo: string; firma: FirmaVista | null }) {
  return (
    <div>
      <div className="flex h-[22mm] flex-col items-center justify-center bg-cert-campo px-[3mm] text-center">
        {firma?.imagenUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- firma registrada en la visita
          <img
            src={firma.imagenUrl}
            alt={`Firma de ${firma.nombre}`}
            className="max-h-full object-contain"
          />
        ) : firma ? (
          <>
            <span className="font-bold text-cert-valor">{firma.nombre}</span>
            <span className="font-sans text-[6.5pt] text-zinc-600">
              Firma registrada el {firma.fecha}
            </span>
          </>
        ) : (
          <span className="font-sans text-[6.5pt] text-zinc-500">Pendiente de firma</span>
        )}
      </div>
      <p className="mt-[1mm] border-t border-cert-linea pt-[1mm] text-center font-bold">{titulo}</p>
      {firma?.imagenUrl && (
        <p className="text-center text-[6.5pt]">
          {firma.nombre} · {firma.fecha}
        </p>
      )}
    </div>
  )
}
