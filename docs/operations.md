# Deployment and database updates

See the [README](../README.md) for configuration and Docker Compose setup.

## Container storage and networking

The container runs as user ID 1000. Mount a writable volume at `/data/geoip`
to retain the database across restarts. Use one volume per instance; bind mounts
must be writable by user ID 1000. A read-only root filesystem is supported when the
cache volume remains writable.

Keep the unauthenticated API on a private network and allow outbound HTTPS to
`raw.githubusercontent.com` for database updates. Session inputs never leave the
service. The database downloads on first start, so the container's health check
allows 150 seconds for startup.

## Database updates

The service downloads unmodified GeoLite2-City MMDB files from
[P3TERX/GeoLite.mmdb](https://github.com/P3TERX/GeoLite.mmdb).
A usable saved database is available immediately at startup while an update runs
in the background. Without one, startup waits for the first download
and fails if it cannot complete. Successful downloads schedule the next update in
24 hours; failed background updates retry after one hour. Updates take effect
without restarting the service.

Downloads have a two-minute timeout and a 128 MiB size limit. The service checks
each download before using it. If a download fails or contains invalid or older
data, the last usable database stays active until it expires.

Databases expire 30 days after their embedded build date. Expired data is no
longer served: `/health` and valid `/api/enrich` requests return `503` until an
update succeeds. Expired cache files are removed automatically. The API
specification remains available at `/api/openapi.json`.

## Check health and troubleshoot

Use `GET /health` or the container's health status to check whether the service
is ready. For Docker Compose, view its status and logs with:

```sh
docker compose ps session-insight
docker compose logs session-insight
```

If startup fails or the service returns `503`, check that `/data/geoip` is
writable and that the container can reach `raw.githubusercontent.com` over HTTPS.
Once a running service downloads a usable database, it becomes healthy again
automatically. If the first download failed and the container exited, restart it
after fixing the issue.

### Logs

Logs show startup, the listening address, database downloads, and shutdown.
Database update messages include the next update or retry time in UTC. Failed
updates include error details. Warnings and errors go to standard error; other
messages go to standard output. Session inputs and enrichment results are never logged.

## Stop or remove the service

Stop the container normally to let active requests finish. The service allows
five seconds for those requests and cancels pending downloads. Interrupted
downloads are removed on shutdown or the next startup. Keep the database volume
for restarts and upgrades; remove it when you no longer use the service.

## Data licensing

MaxMind attribution and data terms are in [NOTICE](../NOTICE), also included at
`/app/NOTICE` in the image. Keep the data current and remove superseded copies
within 30 days of a new release, including backups outside the service's cache.
