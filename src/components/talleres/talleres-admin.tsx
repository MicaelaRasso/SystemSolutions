"use client"

import { PageHeader } from "@/components/common/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { PersonalPanel } from "./personal-panel"
import { TalleresPanel } from "./talleres-panel"

export function TalleresAdmin() {
  return (
    <>
      <PageHeader
        titulo="Talleres y personal"
        descripcion="Equipos de trabajo que salen a campo y las personas que los integran."
      />
      <Tabs defaultValue="talleres" className="gap-4">
        <TabsList>
          <TabsTrigger value="talleres">Talleres móviles</TabsTrigger>
          <TabsTrigger value="personal">Personal</TabsTrigger>
        </TabsList>
        <TabsContent value="talleres">
          <TalleresPanel />
        </TabsContent>
        <TabsContent value="personal">
          <PersonalPanel />
        </TabsContent>
      </Tabs>
    </>
  )
}
