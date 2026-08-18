# Changelog

All notable changes to Keep Focused are documented in this file.

## [1.1.0] - 2026-08-17

### Added

- Timed Focus mode with a 30-minute default duration.
- A focus-duration control in both the popup and Settings page.
- A live countdown while Focus mode is active.
- A scheduled background alarm that automatically ends Focus mode and notifies you when time is complete.

### Changed

- Focus state now persists an end time, so the time limit remains reliable after the popup closes or the background service worker restarts.
- Existing installations receive the new 30-minute default during upgrade.

## [1.0.0]

### Added

- Domain rules, schedules, daily session limits, and manual Focus mode.
