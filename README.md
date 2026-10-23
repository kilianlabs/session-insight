# Session Insight

Turn an IP address and User-Agent into the details people need to recognize a session:
device type and model, browser name, operating system name, city, and country code.
Optional browser Client Hints improve detection when User-Agent strings omit details.

Session Insight is a small HTTP service built with Hono, GeoLite2, and
UAParser.js. Lookups run locally. It does not store session data or call external
services while handling requests. The GeoLite2-City database downloads automatically
on first start and updates daily from [P3TERX/GeoLite.mmdb](https://github.com/P3TERX/GeoLite.mmdb).
No MaxMind account or license key is needed to download from this mirror.

## Run with Docker

Images are published to `ghcr.io/kilianlabs/session-insight` for Linux AMD64 and ARM64.
Use `edge` to try the current development version:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -v session-insight-geoip:/data/geoip \
  ghcr.io/kilianlabs/session-insight:edge
```

For production, choose a versioned release or pin an image digest. There is no
`latest` tag. See [image tags and releases](docs/releases.md).

To add the service to an existing Docker Compose stack:

```yaml
services:
  session-insight:
    image: ghcr.io/kilianlabs/session-insight:edge
    restart: unless-stopped
    volumes:
      - session-insight-geoip:/data/geoip

volumes:
  session-insight-geoip:
```

Other services on the same network can call
`http://session-insight:3000/api/enrich`. No host port is needed for internal use.
The API has no authentication; keep it on a trusted private network.
The first start needs outbound HTTPS to download the database and can take up to
two minutes. The volume keeps the database available across container restarts.

## Enrich a session

```sh
curl http://localhost:3000/api/enrich \
  -H 'Content-Type: application/json' \
  -d '{
    "ip": "8.8.8.8",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  }'
```

The response contains exactly six fields:

```json
{
  "device_type": "desktop",
  "device_model": null,
  "browser": "Chrome",
  "os": "Windows",
  "country_code": "US",
  "city": null
}
```

Unknown values are `null`, and an unrecognized device type is `unknown`.
Private and reserved IPs have `country_code: null` and `city: null`. The caller
already has the original IP; it is not echoed back. Country codes can be translated
into the user's language by the application.

Locations are approximate and can reflect a VPN or network gateway. Device
detection is a best-effort description, not proof of a user's identity.

| Endpoint                | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `POST /api/enrich`      | Enrich an IP address and User-Agent          |
| `GET /api/openapi.json` | Download the OpenAPI contract                |
| `GET /health`           | Check that the service has usable GeoIP data |

See the [API guide](docs/api.md) for Client Hints, field descriptions, and errors,
or use [openapi.json](openapi.json) to generate a client.

## Configuration

| Variable             | Default                                       | Purpose                           |
| -------------------- | --------------------------------------------- | --------------------------------- |
| `HOST`               | `0.0.0.0` in Docker; `127.0.0.1` locally      | Listen address                    |
| `PORT`               | `3000`                                        | HTTP port                         |
| `GEOIP_DATABASE_DIR` | `/data/geoip` in Docker; `geoip-data` locally | Writable database cache directory |

The container runs as a non-root user and includes a health check. Database updates
take effect without a restart. Failed updates retry hourly while the last usable
database remains active. See
[deployment and database updates](docs/operations.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and checks.
Report bugs or suggest improvements in [GitHub Issues](https://github.com/kilianlabs/session-insight/issues).
For security issues, see [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License, version 3 only](LICENSE) (`AGPL-3.0-only`).

This product includes GeoLite Data created by MaxMind, available from
[https://www.maxmind.com](https://www.maxmind.com/).

Database and contents copyright MaxMind, Inc. GeoLite data is subject to
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and the
[GeoLite End User License Agreement](https://www.maxmind.com/en/geolite/eula),
separately from the application's AGPL license. IP locations are approximate and
must not be used to identify a specific household, individual, or street address.
See [NOTICE](NOTICE) for attribution and database licensing details.
