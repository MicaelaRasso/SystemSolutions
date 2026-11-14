"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function SignaturePad({
  title = "Firma digitalizada",
  onChange,
}: {
  title?: string
  onChange: (dataUrl: string | undefined) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const moved = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    const previous = canvas.toDataURL()
    canvas.width = Math.max(1, Math.floor(rect.width * ratio))
    canvas.height = Math.max(1, Math.floor(rect.height * ratio))
    const context = canvas.getContext("2d")
    if (!context) return
    context.scale(ratio, ratio)
    context.lineWidth = 2
    context.lineCap = "round"
    context.strokeStyle = "#172033"
    if (hasInk && previous !== "data:," && previous !== "data:image/png;base64, ") {
      const image = new Image()
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height)
      image.src = previous
    }
  }, [hasInk])

  useEffect(() => {
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [resize])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    canvas.setPointerCapture(event.pointerId)
    const { x, y } = point(event)
    context.beginPath()
    context.moveTo(x, y)
    drawing.current = true
    moved.current = false
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext("2d")
    if (!context) return
    const { x, y } = point(event)
    context.lineTo(x, y)
    context.stroke()
    moved.current = true
    if (!hasInk) setHasInk(true)
  }

  // La imagen se exporta al levantar el dedo: exportarla en cada movimiento traba la tablet.
  const stop = () => {
    if (!drawing.current) return
    drawing.current = false
    if (moved.current) onChange(canvasRef.current?.toDataURL("image/png"))
  }

  const clear = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange(undefined)
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Button type="button" variant="outline" onClick={clear} disabled={!hasInk}>
          Limpiar
        </Button>
      </CardHeader>
      <CardContent>
        <canvas
          ref={canvasRef}
          className="h-[clamp(11rem,34dvh,20rem)] w-full touch-none rounded-md border bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={stop}
          onPointerCancel={stop}
          // Si la tarjeta se mueve en la lista (refresco de la agenda), el navegador suelta la
          // captura y nunca llega `pointerup`: sin esto el trazo se ve pero no se guarda.
          onLostPointerCapture={stop}
          aria-label={title}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Esta imagen es evidencia del flujo de trabajo; no representa una firma criptográfica.
        </p>
      </CardContent>
    </Card>
  )
}

export function dataUrlToFile(dataUrl: string, name: string) {
  const [header, encoded] = dataUrl.split(",")
  const mime = header.match(/data:(.*?);/)?.[1] ?? "image/png"
  const bytes = atob(encoded)
  const buffer = new Uint8Array(bytes.length)
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index)
  return new File([buffer], name, { type: mime })
}
