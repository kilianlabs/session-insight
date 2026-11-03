# Image tags and upgrades

Pull Session Insight from `ghcr.io/kilianlabs/session-insight`. Images support
Linux AMD64 and ARM64; Docker selects the image for your platform automatically.

## Choose an image

Use a versioned release for production or `edge` to try the latest development
build. The version numbers below illustrate the tag format.

| Tag                     | Meaning                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `edge`                  | Latest successful build from `main`                                     |
| `0.1.0`                 | A specific release                                                      |
| `0.1`                   | Latest published patch release in that minor series                     |
| `1`                     | Latest published release in that major series, beginning with version 1 |
| `sha-<full commit SHA>` | Build identified by its source commit                                   |

There is no `latest` tag or rolling `0` tag. Tags such as `edge`, `0.1`, and `1`
can point to newer images over time. To keep a deployment on an exact image,
pin its digest: `ghcr.io/kilianlabs/session-insight@sha256:<digest>`.

## Upgrade with Docker Compose

1. Set the `image` in your Compose file to the release tag or digest you want to use.
2. Download the image and recreate the service:

   ```sh
   docker compose pull session-insight
   docker compose up -d session-insight
   ```

3. Check the container's health status with `docker compose ps`. If the service
   does not become healthy, inspect `docker compose logs session-insight`.

Keep the existing `/data/geoip` volume so the service can reuse its database
after the upgrade. Database updates run automatically and do not require an
image upgrade. See [deployment and database updates](operations.md).
