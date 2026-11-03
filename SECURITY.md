# Security

## Reporting vulnerabilities

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/kilianlabs/session-insight/security/advisories/new).
Include the affected version or image digest, reproduction steps, and the impact.
Use synthetic session data and omit credentials, real IP addresses, and other
personal information. Avoid disclosing an unpatched vulnerability in public issues.

## Run securely

Session Insight has no authentication or rate limiting. Run it on a trusted
private network and restrict access to the applications that need it. If access
is needed from outside that network, provide authentication, TLS, and rate limiting at a proxy.

The service downloads GeoLite data from a third-party mirror over HTTPS. The
database is validated before use and expires after 30 days. See
[deployment and database updates](docs/operations.md) for network requirements and update behavior.

Security fixes target the latest stable release. The `edge` image is a development
build; use a versioned release or image digest for production.
