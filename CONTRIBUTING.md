# Contributing

## Local setup

Install Node.js 24 and enable Corepack to use the pnpm version declared in `package.json`.

```sh
git clone https://github.com/kilianlabs/session-insight.git
cd session-insight
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

The development server listens on `http://127.0.0.1:3000` after downloading GeoLite2
data into `geoip-data/`. Internet access is needed for the first start; no database
credentials are needed. Tests use a small synthetic MMDB fixture and run offline.

## Checks

```sh
pnpm check
```

This runs TypeScript checking, linting, formatting checks, tests, OpenAPI drift
checking, and the production build. Useful commands while developing:

```sh
pnpm test:unit    # watch tests
pnpm format      # format files
pnpm openapi     # regenerate the API contract after changing schemas or routes
pnpm build
pnpm start
```

Run `pnpm audit` before a release or after updating dependencies. Renovate checks
packages, GitHub Actions, and Docker images on Monday mornings in `Europe/Berlin`.
Renovate automatically merges digest, patch, minor, and lockfile maintenance
updates after checks pass. Major updates require manual review and merging.
Commit the lockfile alongside any dependency changes.

Use [private vulnerability reporting](SECURITY.md) for security issues.

## Container testing

```sh
docker build -t session-insight:local .
docker run --rm -i --entrypoint node \
  session-insight:local --input-type=module < scripts/smoke-container.mjs
```

The smoke test checks the actual server inside the Alpine container, including
non-root execution, an automatic database download, IPv4/IPv6 enrichment,
validation, OpenAPI, and shutdown with an incomplete HTTP request. This test needs outbound HTTPS.
CI builds and tests AMD64 and ARM64 sequentially on one runner, using QEMU for
ARM64. Pull requests do not publish images or require registry credentials.

## Releases

Maintainers can find the versioning and GHCR publishing process in
[docs/releases.md](docs/releases.md).
