"use client"

import { PageHeader } from "@/components/common/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { ListasEditor } from "./listas-editor"
import { PatronesEditor } from "./patrones-editor"

export function CatalogosAdmin() {
  return (
    <>
      <PageHeader
        titulo="Catálogos"
        descripcion="Opciones de los desplegables y casillas del certificado, patrones de calibración y condiciones que se relevan al tomar una solicitud."
      />
      <Tabs defaultValue="listas" className="gap-4">
        <TabsList>
          <TabsTrigger value="listas">Listas y casillas</TabsTrigger>
          <TabsTrigger value="patrones">Patrones</TabsTrigger>
        </TabsList>
        <TabsContent value="listas">
          <ListasEditor />
        </TabsContent>
        <TabsContent value="patrones">
          <PatronesEditor />
        </TabsContent>
      </Tabs>
    </>
  )
}
