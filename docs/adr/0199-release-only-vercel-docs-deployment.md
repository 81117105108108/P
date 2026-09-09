# ADR 0199: Deploy the documentation site only from releases

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

The documentation site is hosted by Vercel with `docs` as its Root Directory.
Vercel's Git integration was creating a deployment check for every pull
request update, even though the site is intended to publish with the desktop
release. That made unrelated pull requests wait on a deployment that did not
provide useful review value.

## Decision

Keep the Vercel project configuration in `docs/vercel.json`, but set
`git.deploymentEnabled` to `false`. Vercel's GitHub integration therefore does
not create automatic deployments or status checks for Git pushes and pull
requests.

Add a `deploy-docs` job to the tag-based Release workflow. After the GitHub
Release is published, the job uses Vercel CLI with `--prod`. The project id,
account id, and token are supplied through GitHub Actions secrets rather than
committed configuration.

## Consequences

- Pull requests and ordinary branch pushes do not build Vercel Preview deployments.
- A matching `vX.Y.Z` release updates the production documentation site.
- Release automation requires `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
  `VERCEL_PROJECT_ID` repository secrets.
- The project can remain connected to GitHub for source metadata; only the
  automatic Git deployment path is disabled.

## Alternatives considered

- Keep Preview deployments for every pull request: useful for visual review,
  but wasteful for this documentation site and the source of the repeated
  pending checks.
- Deploy only on pushes to `main`: removes PR previews but can publish docs
  before the corresponding desktop release.
- Store a Vercel project link in the repository: exposes project wiring that
  belongs in deployment secrets and creates local `.vercel` state.
