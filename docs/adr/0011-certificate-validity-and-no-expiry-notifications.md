# Certificate validity and expiry notifications

**Status: accepted**

A `Certificado finalizado` is valid for one calendar year from its `Fecha de ejecución`, with the validity ending at the end of the anniversary date. A recalibration creates a new certificate and starts a new validity period without changing the immutable historical certificate; the newest unexpired finalized certificate is the current one.

When the Cliente's existing `aviso_vencimiento` setting is enabled, the system sends one email to the Cliente's single MVP account for each finalized certificate, targeting 30 calendar days before that certificate expires. The email identifies the certificate and expiry date and links to the existing certificate page in the portal. A daily job runs at 09:00 in Argentina time; if a run or delivery is missed, it sends one catch-up notice on a later run while the certificate remains unexpired. It never sends repeat reminders after successful delivery.

The notice supplements the application's visual `por vencer` state. It does not change certificate validity or create a certificate lifecycle state.
