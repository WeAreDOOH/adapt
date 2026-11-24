# Production deployment

Adapt is a static web application. It is served directly by Nginx from
`/var/www/adapt/current`, a symlink to a timestamped directory in
`/var/www/adapt/releases/`.

There is intentionally no long-running Adapt service: the static deployment uses no
additional application memory and stays isolated from the other applications on the host.

The Nginx virtual host is in `deploy/nginx/adapt.conf`. After `adapt.dooh.com` points to the
server, Certbot can add the HTTPS listener and certificate without changing the application.
