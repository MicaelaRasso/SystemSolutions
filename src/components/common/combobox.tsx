"use client"

import { Check, ChevronsUpDown, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** Selector con búsqueda para listas largas (p. ej. Ø entrada/salida, 56 opciones). */
export function Combobox({
  id,
  value,
  onChange,
  opciones,
  placeholder = "Seleccionar…",
  buscar = "Buscar…",
  vacio = "Sin resultados",
  invalid,
  disabled,
}: {
  id?: string
  value: string
  onChange: (valor: string) => void
  opciones: string[]
  placeholder?: string
  buscar?: string
  vacio?: string
  invalid?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            disabled={disabled}
            className="flex-1 justify-between font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value || placeholder}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-48 p-0" align="start">
          <Command>
            <CommandInput placeholder={buscar} />
            <CommandList>
              <CommandEmpty>{vacio}</CommandEmpty>
              <CommandGroup>
                {opciones.map((op) => (
                  <CommandItem
                    key={op}
                    value={op}
                    onSelect={() => {
                      onChange(op)
                      setOpen(false)
                    }}
                  >
                    <Check className={cn(value === op ? "opacity-100" : "opacity-0")} />
                    {op}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Quitar selección"
          onClick={() => onChange("")}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
