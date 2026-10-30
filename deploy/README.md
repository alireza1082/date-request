# Date Wheel deployment

## Architecture

```text
Internet → existing VPS Nginx → 127.0.0.1:18080
                              → Docker: unprivileged Nginx :8080
                              → static Vite build
                              → /api/* → internal FastAPI :8000 → Telegram
```

Compose publishes only on IPv4 loopback. It does not take over ports 80 or 443 and adds an internal API with no host port. Telegram credentials are optional and reach only that API. The API catalog now uses a project-scoped SQLite volume; no database service container is needed.

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
test -e .env || cp -n .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d
```

`APP_PORT` defaults to `18080`; `.env` can change it while the bind remains `127.0.0.1` only. The service restarts after a VPS reboot when Docker is enabled at boot.

Before starting on a shared VPS, inspect `docker version`, `docker compose version`, `docker ps`, `sudo ss -ltnp`, `free -h`, and `df -h`. Check the existing firewall with its installed management tool, without changing rules. If `18080` is occupied, choose a free port in `.env` and use that port in the dedicated reverse proxy. Keep the same checkout directory and Compose project name on subsequent updates; a new project name can create a second deployment.

Confirm that the intended release commit exists in the checkout (`git show --no-patch <approved-release-commit>`). A remote clone is not proof that it contains a newer local release; publish/transfer that commit through your normal authorized process first. Never discard local changes to switch releases.

To transfer a local release without pushing, create `git bundle create /path/date-wheel-v1.4.0.bundle master HEAD` on the source machine and copy that file to the VPS. Including `HEAD` lets a fresh clone select its default branch. Run `git clone /path/date-wheel-v1.4.0.bundle date-request` and `git -C date-request bundle verify /path/date-wheel-v1.4.0.bundle` on the VPS. Continue with the install commands inside that directory. The bundle transfers source/history, not a built container; the VPS still needs network access to fetch base images and pinned packages. Its `origin` initially points to the bundle; use a fresh bundle for later transfers or deliberately configure the real remote once it contains the approved release.

## Verify the container

Run these checks before connecting the public virtual host:

```sh
docker compose ps
docker compose logs --tail=100
docker compose port frontend 8080
DATE_WHEEL_CONTAINER=$(docker compose ps -q frontend)
docker inspect "$DATE_WHEEL_CONTAINER" --format '{{.State.Health.Status}} {{json .HostConfig.PortBindings}}'
docker inspect "$DATE_WHEEL_CONTAINER" --format 'image={{.Image}} restart={{.HostConfig.RestartPolicy.Name}}'
docker compose exec -T frontend id
docker compose exec -T frontend nginx -t
docker compose exec -T frontend sh -c 'command -v node || true'
```

Expect `healthy`, only `127.0.0.1:<APP_PORT>` published for `8080/tcp`, restart policy `unless-stopped`, UID/GID `101`, a valid Nginx configuration, and no Node executable. A healthcheck failure marks the container unhealthy; it does not itself trigger the restart policy.

The following uses the actual published port, including a customized `.env` port. Every HTTP status printed should be `200`. The asset loop covers JavaScript, CSS, and bundled Persian fonts; inspect the returned HTML to confirm it is Date Wheel.

```sh
DATE_WHEEL_URL="http://$(docker compose port frontend 8080)"
curl -fsS -o /dev/null -w '%{http_code}\n' "$DATE_WHEEL_URL/"
curl -fsS "$DATE_WHEEL_URL/healthz"
curl -fsSI "$DATE_WHEEL_URL/index.html"
docker compose exec -T frontend find /usr/share/nginx/html/assets -type f |
while IFS= read -r asset; do
    curl -fsS -o /dev/null -w '%{http_code} %{url_effective}\n' \
        "$DATE_WHEEL_URL${asset#/usr/share/nginx/html}" || exit 1
done

DATE_WHEEL_CHECK_DIR=$(mktemp -d)
curl -fsS "$DATE_WHEEL_URL/" -o "$DATE_WHEEL_CHECK_DIR/index.html"
curl -fsS "$DATE_WHEEL_URL/verification/deep-route" -o "$DATE_WHEEL_CHECK_DIR/route.html"
cmp "$DATE_WHEEL_CHECK_DIR/index.html" "$DATE_WHEEL_CHECK_DIR/route.html"
cat "$DATE_WHEEL_CHECK_DIR/index.html"
```

`cmp` should succeed: the SPA route must return the same HTML. Check `curl -I` for a hashed asset path listed above: it must have `Cache-Control: public, max-age=31536000, immutable`. HTML must have `no-cache, no-store, must-revalidate`, `/healthz` must have `no-store`, and a missing `/assets/...` file must return `404`, not the SPA HTML. Confirm the security headers and correct JS/CSS/font content types in these responses.

Then run `docker compose restart`, followed by `docker compose up -d`, and repeat the HTTP checks and log inspection. This verifies restart behavior without rebooting the VPS. Record the successful checkout commit (`git rev-parse HEAD`) and actual image ID (`docker inspect "$DATE_WHEEL_CONTAINER" --format '{{.Image}}'`) in your deployment log. These commands are a verification procedure, not a statement that a particular deployment has passed.

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
docker compose restart
docker compose up -d --build
docker compose build --pull && docker compose up -d
docker compose down
```

Use the last build command when you want to fetch a newer base image before rebuilding. `down` removes this project's container and network; it does not remove images or volumes. The SQLite catalog volume must be preserved; never add `-v` to this command.

## Nginx reverse proxy

Open the existing HTTPS virtual host for the domain and add the `location /` block from [`nginx-reverse-proxy.conf.example`](nginx-reverse-proxy.conf.example). Replace the example domain in your existing `server_name`. The example is a location snippet, not a standalone server: leave the current `listen`, TLS, and certificate directives in place.

First inspect `nginx -v` and `sudo nginx -T` locally on the VPS, locate that domain's dedicated server block, and check for duplicate `server_name` declarations. Keep configuration output private if other sites contain credentials. Merge into an existing `location /` for this domain if present; do not add a duplicate block or replace another site's configuration. Back up the dedicated file before editing.

The proxy forwards the original host, client address chain, and scheme. With the location inside an HTTPS server, `$scheme` forwards `https`. After editing the existing file, validate and reload Nginx using the server's normal process, for example:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

No Certbot or certificate path is assumed. If traffic arrives through another trusted proxy or CDN, configure the existing Nginx real-IP handling there before relying on `$remote_addr`.

If no domain is configured, leave the public virtual host pending. Set the domain's DNS `A` record to the VPS IPv4 address; add an `AAAA` record only if IPv6 routing to this VPS is working. Verify with `dig +short A <domain>` and `dig +short AAAA <domain>`. Inspect existing certificate tooling and port 80/443 routing before requesting a certificate for this domain. Preserve existing certificates and use the VPS's normal HTTPS management process.

After Nginx validation/reload, run `curl -fsSI https://<domain>/`, `curl -fsS https://<domain>/healthz`, and repeat the asset and SPA checks using `DATE_WHEEL_URL=https://<domain>`. Do not use `curl -k`: certificate validation must pass. Inspect the initial response for unexpected redirects, and open the HTTPS page in a browser to check the console/network for missing files and mixed content. Local HTTP checks alone do not establish HTTPS or visual correctness.

## Update and rollback

Update from the deployment branch:

Before pulling or rebuilding an existing healthy deployment, record its commit/image identity in your deployment log and retain the running image under a local rollback tag. Do not use an unhealthy or unverified deployment as the known-good baseline:

```sh
DATE_WHEEL_PREVIOUS_CONTAINER=$(docker compose ps -q frontend)
docker inspect "$DATE_WHEEL_PREVIOUS_CONTAINER" --format '{{.State.Health.Status}} {{.Image}}'
DATE_WHEEL_PREVIOUS_IMAGE=$(docker inspect "$DATE_WHEEL_PREVIOUS_CONTAINER" --format '{{.Image}}')
docker image tag "$DATE_WHEEL_PREVIOUS_IMAGE" date-wheel:rollback
# For 1.3+ also retain the API image when present.
DATE_WHEEL_PREVIOUS_API=$(docker compose ps -q api)
# Run the following only when that container exists:
docker inspect "$DATE_WHEEL_PREVIOUS_API" --format '{{.State.Health.Status}} {{.Image}}'
DATE_WHEEL_PREVIOUS_API_IMAGE=$(docker inspect "$DATE_WHEEL_PREVIOUS_API" --format '{{.Image}}')
docker image tag "$DATE_WHEEL_PREVIOUS_API_IMAGE" date-wheel-api:rollback
```

```sh
git status --short
git pull --ff-only
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
curl -f http://127.0.0.1:18080/healthz
```

For an immediate rollback between 1.3+ deployments, use both retained images without rebuilding it. This restores the exact application image even when base-image tags have changed. Use the same project directory and `.env`:

```sh
DATE_WHEEL_ROLLBACK_FILE=$(mktemp)
cat > "$DATE_WHEEL_ROLLBACK_FILE" <<'YAML'
services:
  frontend:
    image: date-wheel:rollback
  api:
    image: date-wheel-api:rollback
YAML
docker compose -f compose.yaml -f "$DATE_WHEEL_ROLLBACK_FILE" up -d --no-build --pull never
docker compose ps
docker compose logs --tail=100
```

Repeat health, HTTP, asset, and public HTTPS checks. A subsequent normal `docker compose up` uses the normal release image again, so record that rollback is active before any later update.

If no retained image exists, first ensure the working tree is clean, then check out a known-good commit or tag containing compatible deployment files and rebuild. Commits predating Docker support cannot use this procedure directly. This restores that source version but may use newer base images, so it is not an exact image rollback:

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

Copy the contents of `dist/` to `/var/www/date-wheel/dist/` on the host. Adapt [`nginx-static.conf.example`](nginx-static.conf.example) for the host's domain and existing HTTPS setup. It includes SPA fallback, a lightweight health endpoint, no-cache HTML, immutable caching for Vite's hashed assets, and a same-origin `/api/` proxy. The React app requires FastAPI for its live catalog; run the API bound to `127.0.0.1:8000` (or change the upstream in the example). Do not expose the API port publicly. Docker Compose remains the recommended deployment.

## Troubleshooting

- **Container is unhealthy:** run `docker compose logs --tail=100`; then check `docker compose ps` and `curl -i http://127.0.0.1:18080/healthz`.
- **Port is already in use:** set a free loopback port in `.env` (`APP_PORT=18081`), then run `docker compose up -d` and update the upstream in the existing Nginx virtual host.
- **The domain returns 502:** confirm the container is healthy and the proxy points to the same loopback port from `.env`.
- **The page is old after an update:** request `/index.html` and confirm its `Cache-Control` is `no-cache, no-store, must-revalidate`; hashed files under `/assets/` are safe to cache immutably.
- **Build needs a refreshed Nginx base image:** run `docker compose build --pull` and then `docker compose up -d`.

## API, SQLite, and Telegram (1.4.0)

The existing localhost frontend port stays unchanged. Frontend Nginx forwards `/api/*` to `api:8000` on the Compose network; the API publishes no host port. Only the API receives `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Empty values disable delivery. There is one unprivileged, read-only API process with a 192 MB limit, healthcheck, bounded logs, and restart policy. No host Nginx changes are needed for `date.benjiro.ir`.

Follow [Telegram setup](../api/README.md). Deploy/update both images together with `docker compose up -d --build`; inspect `docker compose ps` and `docker compose logs --tail=100 api`. `curl -f http://127.0.0.1:18080/api/status` reports availability, while the existing `/healthz` stays a frontend health endpoint. API health is monitored internally at `/healthz`. For rollback, restore the previous approved Git commit in a clean checkout and rebuild both services. If rolling back to a frontend-only release, stop **only this project's** API service first (`docker compose stop api`) before switching; leave other services untouched. Preserve the SQLite catalog volume across recreation; see the SQLite milestone notes in the API README.

The Vite build can be served as static files, but the complete application requires FastAPI for the live catalog, seasonal settings, history, administration, and Telegram. Without a same-origin `/api/` proxy, the wheel will show a retryable catalog error rather than use stale bundled activities. To run the API without Docker, bind it to `127.0.0.1:8000` under your normal process supervisor and add a dedicated `/api/` proxy in this project's vhost. Forward `Host $http_host`, limit request bodies to 2k, disable access logs for that location, and set a 10s proxy read timeout. Always validate `nginx -t` before reloading.

## SQLite persistence and live catalog (1.4.0)

The API mounts the `sqlite_data` named volume at `/app/data` while retaining its read-only root filesystem and non-root UID 65534. The configured database is `/app/data/date-wheel.sqlite3`. API port exposure and frontend port 18080 are unchanged. On a new volume Docker copies the image directory's ownership; if an existing volume has incompatible ownership, startup fails rather than replacing it. Inspect and back up that volume before manually correcting permissions.

Validate the catalog with `curl -f http://127.0.0.1:18080/api/catalog`. Startup/seeding is transactional, versioned, and repeatable; recreation retains data when the same Compose project/volume is used. The public frontend reads this database-backed catalog dynamically and refreshes it before each spin; admin changes appear without rebuilding the frontend. Follow [SQLite backup and rollback instructions](../api/README.md#persistence-backups-and-rollback) before upgrades. Do not delete the named volume on stop, update, or rollback. Schema upgrades are forward-only; restore a matching database backup to a separate volume before rolling back to an older API image.
