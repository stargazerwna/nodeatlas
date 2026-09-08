# Changelog

All notable changes to nodesAtlas are documented in this file.

## [1.2.3] - 2026-09-08

### Fixed

- Exclude saved local network and workspace configuration from portable downloads.
- Fix "Import Wind nodes" doing nothing in the desktop app by replacing the unsupported browser prompt with an in-app domain form.
- Preserve the Wind domain while live metrics refresh, and support cancelling the import form.

## [1.2.2] - 2026-09-07

### Added

- Show a clickable version indicator when a newer stable GitHub release is available, checking at startup and hourly.

## [1.2.1] - 2026-09-06

### Added

- Add drag-to-select support for multiple topology nodes and bulk deletion with confirmation.
- Add a lower-left copyright link that opens the bundled MIT license.

### Fixed

- Keep Wind imports and live metric refreshes scoped to the active workspace tab.
- Load topology immediately when selecting an empty workspace tab.

## [1.2.0] - 2026-09-04

### Added

- Display CPU and memory utilization on canvas nodes.
- Add LLDP, CDP, and MikroTik neighbor discovery with selectable map import.
- Add canvas panning, wheel zoom, scrollbars, and a corner resize handle.
- Add resizable and collapsible sidebar and inspector panels.
- Add SNMPv3 authentication and encryption support for polling, links, interfaces, and discovery.
- Add SNMP credential controls in the inspector, including visible SNMP v2c community, v3 user, auth protocol, and encryption protocol.
- Add a node right-click menu action to open the device GUI at `http://<node-ip>`.
- Add traffic-aware link styling for links above 1 Mbps, 10 Mbps, 40 Mbps, and 50 Mbps.

### Fixed

- Use HOST-RESOURCES-MIB CPU and memory OIDs for MikroTik RouterOS.
- Correct discovery checkbox styling in the dialog.
- Keep the inspector stable while device settings are focused or being edited during live refreshes.
- Prevent browser text selection while interacting with the topology canvas.
- Show a startup loader while local workspace files are checked, and only show demo nodes when no local workspace exists.
