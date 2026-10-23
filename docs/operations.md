# Operations

See the [README](../README.md) for configuration and Docker Compose setup.

## Container storage and networking

The Alpine container runs as UID 1000. Mount a writable volume at `/data/geoip`
to retain the database across restarts. Use one volume per instance; bind mounts
must be writable by UID 1000. A read-only root filesystem is supported when the
cache volume remains writable.

Keep the unauthenticated API on a private network and allow outbound HTTPS to
`raw.githubusercontent.com` for database updates. Session inputs never leave the
service. The image contains license notices but no production database snapshot.
Its health check allows 150 seconds for the first download.

## Database updates

The service downloads unmodified GeoLite2-City MMDB files from
[P3TERX/GeoLite.mmdb](https://github.com/P3TERX/GeoLite.mmdb).
A valid cache is loaded immediately at startup while an update runs in the
background. Without a usable cache, startup waits for the first download and
fails if it cannot complete. Successful downloads schedule the next update in
24 hours; failed updates retry after one hour.

Downloads have a two-minute timeout and a 128 MiB size limit. The service validates
the database type, IPv4/IPv6 support, and build date before atomically replacing
the cache and active reader. Invalid or older replacements are rejected.

Databases expire 30 days after their embedded build date. Expired data is no
longer served: `/health` and valid `/api/enrich` requests return `503` until an
update succeeds. Hourly maintenance removes expired cache files. OpenAPI remains
available. Monitor health checks and update-failure messages in container logs.

`SIGINT` and `SIGTERM` close the HTTP server and cancel downloads and timers,
including during the initial download. Active HTTP requests have five seconds to
finish before their connections are closed.
Interrupted downloads are removed on shutdown or the next startup. Remove the
cache volume when decommissioning the service.

## Logs

Lifecycle messages go to standard output: startup, database cache loading and
downloads, the listening address once the HTTP server is ready, and shutdown.
The background GeoIP updater logs each run, successful database replacements,
the next scheduled update or retry time in UTC, and when it stops. Failed updates
include the error details. Warnings and errors go to standard error. Session
inputs and enrichment results are never logged.

## Data licensing

MaxMind attribution and data terms are in [NOTICE](../NOTICE), also included at
`/app/NOTICE` in the image. Keep the data current and remove superseded copies
within 30 days of a new release, including backups outside the service's cache.
