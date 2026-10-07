# Resend and Supabase email setup

This runbook configures Resend SMTP for Supabase Auth and the application email worker. It contains no production credentials and does not authorize changing hosted project settings. Complete it with the project owner.

## Resend sender identity

1. Add the sending domain in Resend and publish the DNS records Resend provides. Wait for the domain to become verified.
2. Choose a sender address on that verified domain, for example `notificaciones@your-domain.example`.
3. Create a Resend API key with sending permission. Store it as a secret; do not commit it or paste it into chat.
4. Use `System Solutions <notificaciones@your-domain.example>` as the From identity in both Supabase Auth and the application worker.
5. Disable click/open tracking for this sender. Supabase Auth links are one-time security links and must not be rewritten by tracking.

## Supabase Auth SMTP

In the hosted Supabase Dashboard, open **Authentication → SMTP Settings** and configure:

| Setting | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) |
| Username | `resend` |
| Password | Resend API key |
| Sender email | The verified address above |
| Sender name | `System Solutions` |

This SMTP connection is made by hosted Auth, not by an Edge Function. The Edge runtime's outgoing-port restrictions therefore do not apply to this Dashboard SMTP setting.

The repository config at `supabase/config.toml` points local Auth to the Spanish invitation, recovery, email-change, and email-changed HTML templates in `supabase/templates/`. Auth email templates support an HTML content path; the templates include their raw confirmation URL so the message remains usable if button styling is unavailable. For a hosted project, copy the same content into the Dashboard's Auth Email Templates editor; local `config.toml` does not update hosted templates. Set link tracking off in Resend.

Auth keeps ownership of link creation and lifecycle. Use the existing invitation/resend and recovery flows to smoke-test delivery, then verify that invitation setup and `/reset-password` complete with the expected redirects. Verify email change with both old and new inboxes because `double_confirm_changes` is enabled.

## Application Edge Function secrets

Set these secrets in the linked Supabase project (and in the local Edge Function environment for local development):

```sh
supabase secrets set \
  SMTP_HOST=smtp.resend.com \
  SMTP_PORT=2587 \
  SMTP_USERNAME=resend \
  SMTP_PASSWORD='<Resend API key>' \
  SMTP_FROM='System Solutions <notificaciones@your-domain.example>' \
  APP_BASE_URL='https://<the-verified-application-host>' \
  MAILER_WORKER_TOKEN='<random secret of at least 32 bytes>'
```

`SUPABASE_URL` and the Supabase service key are supplied by the Edge runtime. Do not set the Resend API key under a `SUPABASE_` name. `SMTP_PORT=2587` uses STARTTLS; the Edge Function requires TLS before sending credentials.

The worker entrypoint is `POST /functions/v1/email-delivery/internal/process`. It has platform JWT verification disabled so the private worker token can authorize scheduled calls; the endpoint compares `x-mailer-worker-token` before accessing the service-role client. Keep this token private and rotate it when staff or scheduler access changes. The user-facing list/detail/retry API routes still authenticate through the application gateway and require Súper Administrador authorization in SQL.

## Schedule and invoke the worker

`service-workflow` wakes the worker after a successful visit close. That wake-up is best-effort; queued mail remains durable if the call fails. Configure these recurring calls so delivery retries and expiry notices continue independently:

| Purpose | Frequency | Request body |
| --- | --- | --- |
| Process queued messages | Every 5 minutes | `{}` |
| Queue 30-day expiry notices and process the queue | Daily at 12:00 UTC (09:00 Argentina) | `{"enqueue_expiry":true}` |

Use Supabase Cron with `pg_net`/Vault or an external scheduler. Enable the `pg_cron`, `pg_net`, and Vault extensions if they are not already enabled. Add Vault secrets named `mailer_project_url` (the project's HTTPS URL) and `mailer_worker_token` (the same value configured as the Edge Function secret) through the Dashboard's Vault interface. Do not put secret values in migration SQL. Schedule both jobs with:

```sql
select cron.schedule(
  'systemsolutions-mailer-process',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'mailer_project_url') || '/functions/v1/email-delivery/internal/process',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-mailer-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mailer_worker_token')
      ),
      body := '{}'::jsonb
    );
  $$
);

select cron.schedule(
  'systemsolutions-mailer-expiry-daily',
  '0 12 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'mailer_project_url') || '/functions/v1/email-delivery/internal/process',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-mailer-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'mailer_worker_token')
      ),
      body := '{"enqueue_expiry":true}'::jsonb
    );
  $$
);
```

Supabase Cron uses UTC, so `0 12 * * *` is 09:00 in Argentina (UTC−3). Remove or update these jobs through `cron.unschedule` if the schedule changes. Alternatively, an external scheduler can use this request:

```sh
curl --fail-with-body --request POST \
  "$SUPABASE_URL/functions/v1/email-delivery/internal/process" \
  --header "content-type: application/json" \
  --header "x-mailer-worker-token: $MAILER_WORKER_TOKEN" \
  --data '{}'
```

The daily operation selects finalized certificates whose 30-day reminder date has arrived and whose expiry is still today or later in `America/Argentina/Buenos_Aires`, and whose Cliente has `aviso_vencimiento` enabled. The unique certificate key ensures one notification even when a missed daily run is caught up later. The pending-signature trigger queues one grouped notice per completed visit with unsigned pending certificates.

## Smoke test and operational behavior

1. Send an Auth invitation and a password recovery email to an owner-controlled test account. Confirm branding, sender identity, link destination, and link completion.
2. Invoke the worker manually with the internal token and confirm a `200` response. Test a visit closed without a Cliente signature and confirm one queued message to the Cliente account.
3. To exercise expiry delivery safely, use a local/test database record with an expiry date 30 days from the Argentina calendar date and enable `aviso_vencimiento`; invoke with `enqueue_expiry: true`.
4. Review application messages with `GET /email-deliveries`, `GET /email-deliveries/:id`, and `POST /email-deliveries/:id/retry` (body `{ "reason": "..." }`) as a Súper Administrador.
5. Check Resend's SMTP/provider logs for Auth and application messages. The application API records queue state and SMTP transaction results only; it does not collect delivered/bounced/open/click webhooks or represent recipient-mail-server delivery.

For a temporary SMTP rejection, the worker retries with exponential delay up to five automatic attempts. Permanent failures remain `failed`; uncertain SMTP outcomes remain `uncertain` to avoid accidental duplicate sends. Súper Administrators can retry either state with a required reason, which writes an audit event. `smtp_accepted` means Resend accepted the SMTP transaction, not that the recipient's server delivered the email.
