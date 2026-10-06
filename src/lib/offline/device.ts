export const OFFLINE_DEVICE_ID_STORAGE_KEY = "systemsolutions.offline.device-id"

export function getOfflineDeviceId() {
  if (typeof window === "undefined")
    throw new Error("La identidad del dispositivo offline requiere un navegador")
  const existing = window.localStorage.getItem(OFFLINE_DEVICE_ID_STORAGE_KEY)
  if (existing) return existing
  const value = window.crypto.randomUUID()
  window.localStorage.setItem(OFFLINE_DEVICE_ID_STORAGE_KEY, value)
  return value
}
