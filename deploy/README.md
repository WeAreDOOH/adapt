# Production deployment

Adapt's planner is static, with a small authentication gateway that reuses the
Microsoft Entra identity verification and approved-user list from Experiments.
Nginx proxies to the loopback-only `Adapt.service` on port 3103. Releases live in
`/var/www/adapt/releases/`, with `/var/www/adapt/current` as the active symlink.

The gateway validates secure, HTTP-only session cookies and serves the planner only to
authenticated users. It is memory-capped and cannot write to the system or project files.

The temporary certificate-issuance host is `deploy/nginx/adapt-http.conf`; the final TLS host
is `deploy/nginx/adapt.conf`. The Entra application must allow `https://adapt.dooh.com` as a
browser redirect URI.
