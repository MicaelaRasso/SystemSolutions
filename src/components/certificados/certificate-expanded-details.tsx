import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function options(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === "string" ? item : display(record(item).label ?? record(item).id),
        )
        .join(", ") || "—"
    : "—"
}

export function CertificateExpandedDetails({
  certificate,
}: {
  certificate: Record<string, unknown>
}) {
  const technical = record(
    record(certificate.datos_tecnicos).valvula ??
      record(certificate.datos_tecnicos).valve ??
      certificate.datos_tecnicos,
  )
  const tests = record(
    record(certificate.datos_tecnicos).ensayos ?? record(certificate.datos_tecnicos).tests,
  )
  const parts = record(certificate.repuestos)
  const snapshot = record(certificate.plantilla_snapshot)
  const labels = new Map(
    Array.isArray(snapshot.campos)
      ? snapshot.campos.map((field) => [
          String(record(field).clave),
          String(record(field).etiqueta ?? record(field).clave),
        ])
      : [],
  )
  const custom = record(certificate.campos_personalizados)

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ejecución</CardTitle>
          <CardDescription>
            Versión de plantilla: {display(certificate.plantilla_version)}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            <strong>Fecha:</strong> {display(certificate.fecha_ejecucion)}
          </p>
          <p>
            <strong>Técnico:</strong> {display(certificate.tecnico_ejecutor)}
          </p>
          <p>
            <strong>Observaciones:</strong> {display(certificate.observaciones)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos técnicos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {Object.entries(technical).map(([key, value]) => (
            <p key={key}>
              <strong>{key.replaceAll("_", " ")}:</strong> {display(value)}
            </p>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ensayos y calibración</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {["sp_inicial", "sp_apertura", "presion_cierre"].map((key) => (
            <p key={key}>
              <strong>{key.replaceAll("_", " ")}:</strong> {display(tests[key])}
            </p>
          ))}
          <p>
            <strong>Patrón:</strong> {display(record(tests.patron).label ?? tests.patron)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mantenimiento y repuestos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            <strong>Alcance:</strong> {options(certificate.alcance_mantenimiento)}
          </p>
          <p>
            <strong>Repuestos:</strong> {options(parts.items)}
          </p>
          <p>
            <strong>Otros:</strong> {display(parts.otros)}
          </p>
          <p>
            <strong>Catálogo:</strong> {display(parts.catalog_version)}
          </p>
        </CardContent>
      </Card>
      {Object.keys(custom).length ? (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Campos personalizados</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(custom).map(([key, value]) => (
              <p key={key}>
                <strong>{labels.get(key) ?? key}:</strong> {display(value)}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Evidencia fotográfica</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          {["desarmada", "ensamblada_prueba", "placa_precinto"].map((key) => (
            <p key={key}>
              <strong>{key.replaceAll("_", " ")}:</strong>{" "}
              {record(certificate.evidencia_fotografica)[key] ? "Disponible" : "No adjunta"}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
