import type { Services } from "./contracts"
import { edgeServices } from "./edge"
import { mockServices } from "./mock"

export * from "./contracts"

const fuente = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock"

function elegir(): Services {
  switch (fuente) {
    case "mock":
      return mockServices
    case "supabase":
      return edgeServices
    default:
      throw new Error(`NEXT_PUBLIC_DATA_SOURCE desconocido: ${fuente}`)
  }
}

export const services: Services = elegir()
