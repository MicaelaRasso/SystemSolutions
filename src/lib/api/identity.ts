import { z } from "zod"

import type { EdgeAccessClient } from "../services/edge"
import { browserSupabase, type BrowserSupabaseClient } from "../services/edge-transport"
import { ServiceError } from "../services/contracts"
import { accountDtoSchema, edgeContextResponseSchema } from "./contracts"

export const identityQueryKeys = {
  context: () => ["edge", "identity", "context"] as const,
}

export const identityInvalidations = [["edge"]] as const

export function createIdentityApi(
  edge: EdgeAccessClient,
  auth: () => BrowserSupabaseClient = browserSupabase,
) {
  const json = (value: unknown) => JSON.stringify(value)

  return {
    context: () => edge.request("context", edgeContextResponseSchema),
    administrators: {
      list: () => edge.request("accounts/administrators", accountDtoSchema.array()),
      create: (data: {
        email: string
        nombre: string
        apellido: string
        rol: "administrador_regular" | "super_administrador"
      }) => edge.request("accounts/administrators", accountDtoSchema, {
        method: "POST",
        body: json(data),
      }),
      setActive: (id: string, active: boolean) => edge.request(`accounts/administrators/${id}`, accountDtoSchema, {
        method: "PATCH",
        body: json({ activo: active }),
      }),
      resendInvitation: (id: string) => edge.request(`accounts/${id}/invitation/resend`, z.object({ sent: z.boolean() }), {
        method: "POST",
        body: "{}",
      }),
      recoverLostEmail: (id: string, data: { email: string; verificationReference: string }) =>
        edge.request(`accounts/${id}/email-recovery`, z.object({ verificationRequired: z.boolean() }), {
          method: "POST",
          body: json({ email: data.email, verification_reference: data.verificationReference }),
        }),
    },
    triggerPasswordRecovery: (accountId: string) => edge.request(`accounts/${accountId}/recovery`, z.object({ sent: z.boolean() }), {
      method: "POST",
      body: "{}",
    }),
    requestPasswordReset: async (email: string, redirectTo?: string) => {
      const { error } = await auth().auth.resetPasswordForEmail(email.trim(),
        redirectTo ? { redirectTo } : undefined,
      )
      // Keep the response independent of account existence. Supabase's Auth
      // endpoint also applies its configured rate limits and email expiry.
      if (error) throw new ServiceError("No se pudo procesar la solicitud de recuperación", "invalid")
      return { requested: true as const }
    },
    requestEmailChange: async (email: string, redirectTo?: string) => {
      await edge.request("account-security/email-change", z.string(), {
        method: "PUT",
        body: json({ email: email.trim() }),
      })
      const { error } = redirectTo
        ? await auth().auth.updateUser({ email: email.trim() }, { emailRedirectTo: redirectTo })
        : await auth().auth.updateUser({ email: email.trim() })
      if (error) throw new ServiceError("No se pudo iniciar el cambio de email", "invalid")
      // Supabase sends its configured confirmation messages to the old and
      // new addresses. The account email changes only after verification.
      return { verificationRequired: true as const }
    },
  }
}

export type IdentityApi = ReturnType<typeof createIdentityApi>
