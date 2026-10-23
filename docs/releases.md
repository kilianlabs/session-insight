# Container releases

Repository: [kilianlabs/session-insight](https://github.com/kilianlabs/session-insight).
Images: `ghcr.io/kilianlabs/session-insight`.

## Image tags

| Tag                     | Meaning                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `edge`                  | Latest successful build from `main`                                     |
| `0.1.0`                 | A specific release, built from the matching `v0.1.0` Git tag            |
| `0.1`                   | Latest published patch release in that minor series                     |
| `1`                     | Latest published release in that major series, beginning with version 1 |
| `sha-<full commit SHA>` | Build identified by its source commit                                   |

There is no `latest` tag or rolling `0` tag. For reproducible deployments, use a
manifest digest, such as `ghcr.io/kilianlabs/session-insight@sha256:...`.
Do not move existing release tags. Publish releases in increasing order within
a series: publishing an older version again also moves its minor/major aliases.

## GitHub setup

After the repository has been pushed to GitHub, enable GitHub Actions and allow
its workflows to publish packages. The container workflow uses the repository's
`GITHUB_TOKEN` with `packages: write`; no personal access token is required.
Publishing is restricted to `kilianlabs/session-insight`.

Enable private vulnerability reporting in the repository's security settings so
the reporting link in [SECURITY.md](../SECURITY.md) is available. Require the
**Check project and containers** status check for pull requests into `main`.
Enable the Renovate GitHub App for this repository to apply
[the dependency update configuration](../.github/renovate.json).

The first successful push to `main` creates the GHCR package and its `edge` tag.
Check the package's visibility in GitHub Packages; make it public if anonymous
pulls are intended. If the package already exists, grant this repository Actions
access to it. The image's source label links it to this repository.

## Publish a release

Release tags must use stable `vMAJOR.MINOR.PATCH` versions, such as `v0.1.0`.

1. Update the version in `package.json`. The API reads its version from this file.
2. Run `pnpm openapi` and `pnpm check`, then commit and push the changes.
3. Create and push the matching Git tag, for example:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. Wait for the Container workflow to finish before deploying the new image.

The workflow first runs the full checks, then builds and smoke-tests Linux AMD64
and ARM64 sequentially on one runner using QEMU. After those pass, a single
publishing job uses Buildx to build and push both platforms together with the
image tags. GitHub Actions are pinned to commit SHAs, and the Alpine Node base
image is pinned to a multi-platform digest.

The Actions **Run workflow** button can retry publishing from `main` or a release
tag. Manual runs on other branches run checks but do not publish images.
