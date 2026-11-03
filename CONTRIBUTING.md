# Contributing

To run Session Insight in your application, start with the [Docker guide](README.md#run-with-docker).
The steps below are for making and testing code changes.

## Local setup

Install Node.js 26 LTS, then install and enable Corepack to use the pnpm version
declared in `package.json`.

```sh
git clone https://github.com/kilianlabs/session-insight.git
cd session-insight
npm install --global corepack
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

When updating dependencies, run `pnpm audit` and commit the lockfile alongside
your changes.

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
