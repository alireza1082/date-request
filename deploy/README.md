# Date Wheel deployment

## Architecture

```text
Internet → existing VPS Nginx → 127.0.0.1:18080
                              → Docker: unprivileged Nginx :8080
                              → static Vite build
```

Compose publishes only on IPv4 loopback. It does not take over ports 80 or 443 and does not require a backend, database, volume, or secret.

## Requirements

- Git
- Docker Engine with the Docker Compose plugin
- An existing VPS Nginx virtual host if the application needs a public domain

The image build uses Node 22, the repository's pinned pnpm 12.15.0, a frozen lockfile install, and the official unprivileged Nginx image. The final image contains only the Nginx runtime, its configuration, and `dist/`.

## First install

On the VPS:

```sh
git clone <repository>
cd date-request
cp .env.example .env
docker compose up -d --build
```

`APP_PORT` defaults to `18080`; `.env` can change it while the bind remains `127.0.0.1` only. The service restarts after a VPS reboot when Docker is enabled at boot.

## Operate the service

```sh
docker compose ps
docker compose logs --tail=100
curl -f http://127.0.0.1:18080/healthz
```

The health endpoint returns `200 ok`. Compose also checks it inside the container. To manage the service:

```sh
docker compose stop
docker compose start
docker compose restart frontend
docker compose up -d --build
docker compose build --pull frontend && docker compose up -d
docker compose down
```

Use the last build command when you want to fetch a newer base image before rebuilding. `down` removes this project's container and network; it does not remove images or volumes. There are no application data volumes to preserve.

## Nginx reverse proxy

Open the existing HTTPS virtual host for the domain and add the `location /` block from [`nginx-reverse-proxy.conf.example`](nginx-reverse-proxy.conf.example). Replace the example domain in your existing `server_name`. The example is a location snippet, not a standalone server: leave the current `listen`, TLS, and certificate directives in place.

The proxy forwards the original host, client address chain, and scheme. With the location inside an HTTPS server, `$scheme` forwards `https`. After editing the existing file, validate and reload Nginx using the server's normal process, for example:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

No Certbot or certificate path is assumed. If traffic arrives through another trusted proxy or CDN, configure the existing Nginx real-IP handling there before relying on `$remote_addr`.

## Update and rollback

Update from the deployment branch:

```sh
git status --short
git pull --ff-only
docker compose up -d --build
docker compose ps
curl -f http://127.0.0.1:18080/healthz
```

To roll back, first ensure the working tree has no local changes you need, then check out a known-good commit or tag and rebuild:

```sh
git status --short
git switch --detach <known-good-commit-or-tag>
docker compose up -d --build
docker compose ps
```

Return to the deployment branch when ready with `git switch <deployment-branch>` and update it normally. This procedure does not reset or delete Git history, images, or volumes.

## Static Nginx alternative

Docker is the recommended deployment. To deploy the static build instead, install the pinned dependencies and build locally or in CI:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Copy the contents of `dist/` to `/var/www/date-wheel/dist/` on the host. Adapt [`nginx-static.conf.example`](nginx-static.conf.example) for the host's domain and existing HTTPS setup. It includes SPA fallback, a lightweight health endpoint, no-cache HTML, and immutable caching for Vite's hashed assets.

## Troubleshooting

- **Container is unhealthy:** run `docker compose logs --tail=100`; then check `docker compose ps` and `curl -i http://127.0.0.1:18080/healthz`.
- **Port is already in use:** set a free loopback port in `.env` (`APP_PORT=18081`), then run `docker compose up -d` and update the upstream in the existing Nginx virtual host.
- **The domain returns 502:** confirm the container is healthy and the proxy points to the same loopback port from `.env`.
- **The page is old after an update:** request `/index.html` and confirm its `Cache-Control` is `no-cache, no-store, must-revalidate`; hashed files under `/assets/` are safe to cache immutably.
- **Build needs a refreshed Nginx base image:** run `docker compose build --pull frontend` and then `docker compose up -d`.
