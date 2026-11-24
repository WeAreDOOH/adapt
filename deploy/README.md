# Production deployment

Adapt's planner is static, with a small protected API. It uses separate single-tenant
Microsoft Entra registrations for the public SPA and API. The SPA requests the API's
delegated `access_as_user` scope and sends access tokens as bearer tokens. The API validates
Microsoft signing keys, issuer, tenant, audience, authorised SPA and scope before consulting
Adapt's own SQLite user database. Nginx proxies to the loopback-only `Adapt.service` on port 3103. Releases live in
`/var/www/adapt/releases/`, with `/var/www/adapt/current` as the active symlink.

Authentication and application authorisation are separate. Microsoft proves identity; an
active Adapt user row with the verified Microsoft email grants access on each login. Owners
manage that email list inside Adapt. No Entra object ID is bound to an application user.
Roles and organisation permissions remain in SQLite. The service is memory-capped and can
write only to `/var/www/adapt/shared` for that database.

AI document review reads `OPENAI_API_KEY` from `/var/www/adapt/shared/ai.env`. The key is
server-side only. Uploaded files are limited to 10 MB, sent to the OpenAI Responses API with
response storage disabled, and the public demo endpoint is rate limited. Named plan payloads
are stored in the shared SQLite database; view IDs and edit keys are generated independently.

`ADAPT_AUTH_DISABLED=1` is a temporary, reversible production switch. While set, the
planner is served directly at `/`, bearer authentication is bypassed only for the planner,
and the user-administration page and API remain unavailable. Remove the setting to restore
the Microsoft sign-in flow after the Adapt Entra registrations are configured.

The temporary certificate-issuance host is `deploy/nginx/adapt-http.conf`; the final TLS host
is `deploy/nginx/adapt.conf`.
