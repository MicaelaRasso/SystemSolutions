# Resend transactional email delivery

**Status: accepted**

System Solutions uses Resend as its single SMTP delivery provider for both Supabase Auth messages and application notices, with the shared sender identity `System Solutions`. Auth continues to generate invitation, recovery, and email-change links so token lifecycle stays with Supabase. Application notices are sent by Edge Functions through Resend SMTP; certificate-expiry notices are scheduled, while pending-signature notices are created when a visit closes without the Cliente's signature.

Application notices have durable delivery records and idempotent creation. Temporary SMTP failures may be retried; uncertain outcomes remain available for explicit review. Súper Administradores can list, inspect, and manually retry eligible app notices through protected APIs, with a reason recorded for each retry. The API reports only what the application can observe through Supabase and its SMTP transaction; it does not claim recipient-server delivery, bounce, open, or click status. Auth email status is not mixed into the application's retry API. The phase adds no frontend and does not configure production credentials or sender-domain settings.

## Consequences

- Application Edge Functions use Resend SMTP on port 2587. Supabase's Edge Function SMTP example configures that port and warns that outbound ports 25 and 587 are unavailable. Hosted Supabase Auth uses the SMTP settings configured in the Auth dashboard; Resend's recommended SSL port is 465.
- Both delivery paths use the same verified sender address and `System Solutions` display name. App notices include `text/plain` and HTML MIME parts. Local Supabase Auth templates use the HTML `content_path` supported by Supabase; the template config does not expose a separate plain-text template field. They include a visible raw link as a fallback.
- Auth link tracking is disabled so verification links remain intact.
- The application's mail API exposes queue and SMTP transaction outcomes only. No Resend webhook ingestion or recipient-server delivery telemetry is included.
- Expiry notices run daily at 09:00 in `America/Argentina/Buenos_Aires`, target certificates when their 30-day reminder date has arrived, honor `aviso_vencimiento`, and allow one catch-up before expiration.
- Pending-signature notices send once per closed visit to the single MVP Cliente account, summarize the Yacimiento and affected Plantas/locaciones, and link to the existing certificate page.
- Resend domain verification, SMTP credentials, Auth dashboard settings, and scheduled worker setup are documented for later owner setup; no production state is changed by this decision.
