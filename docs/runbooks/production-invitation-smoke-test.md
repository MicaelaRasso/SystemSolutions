# Production Supabase invitation smoke test

This runbook covers the production-only checks for GitHub issue [#68](https://github.com/MicaelaRasso/SystemSolutions/issues/68). It does not change production. Run it only with the production project owner and their explicit authorization for any dashboard or secret changes.

## What the implementation expects

- Administrator-created accounts are invited with Supabase Auth `inviteUserByEmail` and redirected to `/setup-password`.
- `identity-admin` chooses the redirect origin from the request `Origin` when it is in `ALLOWED_ORIGINS` / `ALLOWED_ORIGIN`; otherwise it uses the first configured allowed origin. If neither is configured, Auth receives no redirect override and uses the project's Site URL.
- The app supports `/auth/callback` for code or token-hash links. The default Supabase confirmation link can also return directly to `/setup-password`, where the browser Auth client must establish a session before the password can be set. The Cuenta remains pending until email confirmation and password setup both complete.
- Edge Functions read `SUPABASE_URL` and `SUPABASE_SECRET_KEY` through the shared runtime adapter. Current Supabase hosted runtimes inject reserved `SUPABASE_` variables, including `SUPABASE_URL` and the JSON key map `SUPABASE_SECRET_KEYS`; legacy `SUPABASE_SERVICE_ROLE_KEY` and supported single-key variables may also exist. The adapter accepts `SUPABASE_SECRET_KEYS` or `SUPABASE_SECRET_KEY`. The browser uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Preparation

1. Confirm the deployed app version includes the account invitation and setup flow, and record its canonical HTTPS origin (the production `SystemSolutions` domain).
2. In the Supabase production project's **Authentication → URL Configuration**, check that **Site URL** is the canonical app origin. Add exact HTTPS redirects for `/setup-password`, `/reset-password`, and `/auth/callback` (plus any other production auth callback actually used). Keep preview and localhost URLs out of production unless there is a documented need; avoid broad wildcards.
3. In the Supabase project's Edge Function runtime, verify the platform-provided `SUPABASE_URL` and secret key availability without copying or exposing their values. `SUPABASE_` is reserved by Supabase: do not try to create custom secrets with that prefix. Configure the app-owned `ALLOWED_ORIGINS` (or legacy `ALLOWED_ORIGIN`) for the production app origin, without a path. The secret key must remain in Supabase's function runtime and never enter a `NEXT_PUBLIC_*` variable, app hosting environment, repository, issue, shell transcript, or test evidence. Do not rotate credentials as part of this MVP check.
4. Verify the invite email template links through `{{ .ConfirmationURL }}` and that its redirect parameter reaches the allowed production setup flow. Do not copy token-bearing links into notes or screenshots.
5. Check the current Auth email provider and delivery limits in the dashboard before testing. Supabase currently says its built-in sender only delivers to project team addresses, is limited to two messages per hour, has no delivery SLA, and is not for production. Delivery to an external controlled mailbox therefore requires the production owner to configure an approved custom SMTP service in Supabase Auth first. The MVP does not add Resend or rotate credentials; no provider choice or SMTP credential is assumed by this runbook. If custom SMTP is not approved/configured, stop and record the blocker instead of attempting the smoke test or repeatedly resending.
6. Arrange a controlled mailbox accessible to the tester and an authorized administrator account. Use a unique test address that the business controls. Ensure the person understands this creates a real production Cuenta and a one-time invitation.

## Smoke test

1. Sign in to the production app as an authorized Administrador and create a test Cuenta using the controlled mailbox and intended role/parent assignment.
2. Confirm the admin flow reports success and the pending Cuenta appears with the expected role and parent. Do not treat this UI result alone as email delivery confirmation.
3. Open the received message and inspect the link destination without forwarding or recording its token. It must stay on the production Supabase verification endpoint and return to the production app's invite setup flow. Do not use an old link or click the link more than once.
4. Open the invitation in a clean browser session, follow it, set a compliant password, and confirm the app lands in the signed-in experience. Verify the account is active only after completing the setup flow, and that the visible role/parent scope is the one assigned.
5. Sign out and sign back in using the new password. Confirm the account reaches only its expected role-scoped area. This checks that setup created a usable credential, not just a session from the invitation link.
6. In the admin screen, disable the test Cuenta if it should not remain usable. Keep the record only as long as the owner wants for audit purposes; do not delete it as routine cleanup.
7. Record pass/fail for each step, UTC time, deployed app version, non-secret Supabase project reference, test Cuenta's internal ID, role/parent assignment, and sanitized Auth/Edge request IDs or error codes. Have the production owner attest that the runtime variables resolve to that project and that the redirect allowlist/template were checked. Never record the recipient's full address, password, Auth token/link, secret key, SMTP credentials, or raw email contents in a shared report.

## Failure handling

- Redirect denied or wrong host: stop; compare the exact redirect URI, Site URL, and Edge `ALLOWED_ORIGINS` with the deployed origin. Change only the production owner's approved settings, then issue one fresh invitation.
- No email or provider rejection: stop resends to avoid rate limits. Check Auth logs and the current sender restrictions in the dashboard. Report sanitized error codes and ask the project owner to decide the delivery path.
- Link is invalid/expired or setup has no session: do not reuse the link. An authorized Administrator may resend once, which replaces the prior invitation token; restart from the new message.
- Password setup works but the Cuenta remains pending, or role/parent scope is wrong: disable the test Cuenta and treat as a release blocker. Preserve only sanitized identifiers for diagnosis.

## Evidence and issue disposition

Attach only a sanitized checklist result and non-sensitive project/app identifiers to issue #68. Evidence must show the owner checked runtime secret availability and exact redirect settings, the actual test invitation was delivered, its link reached the production setup flow, password setup succeeded, and a fresh sign-in had the expected role/parent scope. Include pass/fail per step, UTC time, app version, test Cuenta ID, and sanitized request/error references. Configuration inspection or local tests alone do not satisfy the production acceptance criterion. Close the issue only after all acceptance criteria pass; a runbook does not complete the real production smoke test.

Supabase references: [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Custom SMTP / built-in email service](https://supabase.com/docs/guides/auth/auth-smtp), and [Edge Function environment variables](https://supabase.com/docs/guides/functions/secrets). Supabase reserves the `SUPABASE_` prefix for injected runtime variables. Verify current provider limitations immediately before testing because they can change.
