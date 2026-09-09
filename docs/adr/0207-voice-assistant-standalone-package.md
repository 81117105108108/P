# ADR 0207: Distribute Voice Assistant as a standalone plugin

- Status: Accepted
- Date: 2026-09-10
- Decision: D375

## Context

ADR 0206 added the permission-gated Voice Assistant capability and the shared
desktop controller. The first implementation lived under the application's
bundled plugin resources, which couples its release, installation, and
permission review to the desktop application even though the plugin uses only
public host APIs.

## Decision

1. Distribute Voice Assistant as the independently installable plugin
   `com.vastsa.voice-assistant`.
2. Keep its source in a standalone plugin directory with its own manifest,
   README, changelog, and LGPL-3.0 license. Pack it as a `.piplug` artifact
   using the repository plugin devkit.
3. Do not copy the plugin into `apps/desktop/resources/plugins`, do not mark it
   as a bundled default, and do not grant its permissions automatically.
4. Preserve the public `pi.agent`, `pi.models`, `pi.desktop`, and panel APIs.
   The host controller, operation catalog, dangerous-operation confirmation,
   and MCP token boundary remain unchanged.
5. Treat the source in this repository as the host-contract and package-build
   fixture. Official marketplace publication remains a separate submission to
   the publisher-owned plugin distribution repository.

## Consequences

- Users can install, update, disable, or uninstall Voice Assistant without
  changing the application bundle.
- Permission review happens when the package is installed or enabled, and the
  package can be removed without a desktop release.
- The application no longer ships microphone, model, or desktop-control grants
  for this feature by default.
- The standalone package must keep its manifest id stable across releases so
  settings, grants, and upgrades remain associated with the same plugin.

## Alternatives rejected

- Keeping Voice Assistant in `resources/plugins`: rejected because it makes a
  user-installable third-party surface appear to be a first-party feature and
  couples its lifecycle to the desktop release.
- Giving the standalone package a second desktop-operation implementation:
  rejected because it would diverge from the reviewed MCP controller.
