# Enrichment API

`POST /api/enrich` accepts `application/json`. Use [openapi.json](../openapi.json)
or `GET /api/openapi.json` to generate a client; the operation ID is `enrichSession`.

## Request

| Field          | Required | Meaning                                                            |
| -------------- | -------- | ------------------------------------------------------------------ |
| `ip`           | Yes      | One IPv4 or IPv6 address, without a port, zone ID, or proxy chain. |
| `user_agent`   | Yes      | Original User-Agent, up to 4096 characters. Use `""` when absent.  |
| `client_hints` | No       | Original browser Client Hint headers with lowercase names.         |

Supported hints are `sec-ch-ua`, `sec-ch-ua-full-version-list`, `sec-ch-ua-mobile`,
`sec-ch-ua-model`, `sec-ch-ua-platform`, and `sec-ch-ua-form-factors`. The full-version
list can supply browser names when the basic brand list is unavailable. CPU and
OS-version hints are not needed for this response.

```json
{
  "ip": "8.8.8.8",
  "user_agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  "client_hints": {
    "sec-ch-ua": "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\"",
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": "\"Android\"",
    "sec-ch-ua-model": "\"Pixel 9\""
  }
}
```

Preserve quotes in header values. The application must request high-entropy hints
such as the model from the browser using `Accept-CH`; see
[UAParser.js Client Hint usage](https://docs.uaparser.dev/intro/quick-start/using-node-js.html).
Missing hints are fine. Unknown fields are rejected, and the request limit is 32 KiB.

The caller resolves the originating IP using its trusted proxy configuration.
The sidecar uses the JSON body, not transport or proxy headers, and normalizes
IPv4-mapped IPv6 internally before lookup.

## Response

Every response contains exactly these six fields:

| Field          | Meaning                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `device_type`  | `desktop`, `mobile`, `tablet`, `smarttv`, `console`, `wearable`, `embedded`, `xr`, or `unknown`. |
| `device_model` | Model such as `iPhone` or `Pixel 9`, or null.                                                    |
| `browser`      | Browser name without a version, or null.                                                         |
| `os`           | Operating system name without a version, or null.                                                |
| `country_code` | ISO country code for localization by the caller, or null.                                        |
| `city`         | Approximate city name in English, or null.                                                       |

Non-public addresses and database misses return null city and country fields.
A city can be missing while the country is known. Locations can reflect a VPN or
network gateway. Device information is best effort: desktop is inferred only for
a recognized desktop OS and browser, excluding known bots. UAParser.js considers
at most the first 500 UA characters.

## Session history integration

Store the six response values alongside the input IP as a sign-in snapshot. Preserve the snapshot
when rotating the session credential, and remove it with the session's existing
history retention or account deletion. Raw User-Agent and Client Hints need not
be persisted for this display.

Use the device type for an icon, show the model when known, and combine the browser
and OS into a label such as “Chrome on Windows”. Translate `country_code` with
`Intl.DisplayNames` for a location such as “Berlin, Germany”. Show the IP in
session details alongside the existing status, timestamps, and logout controls.

## Errors and health

Errors use `application/problem+json` with `type`, `title`, `status`, and `detail`.
Statuses are 400 (invalid input), 404 (unknown route), 413 (body too large), 415
(unsupported media type), 500 (enrichment failed), and 503 (no usable GeoIP database).
Request values are omitted from errors and logs. All responses use
`Cache-Control: no-store`.

`GET /health` returns `200` with `{ "status": "ok" }` when GeoIP data is usable,
or `503` after it expires. Enrichment resumes automatically when an update succeeds.
