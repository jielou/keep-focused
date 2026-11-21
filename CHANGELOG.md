# Changelog

All notable changes to Keep Focused are documented in this file.

## [Unreleased]

## [1.2.0] - 2026-11-21

### Added

- An explicit Completely block / Limit daily sessions choice, weekday/weekend/every-day presets, and a live schedule summary.
- Automatic complete-block enforcement for already-open tabs at schedule boundaries, startup, and rule/settings changes, with a periodic recovery check.
- Time block and Session limit tags beside domains in the saved-rule list.
- Optional, on-demand suggestions for the ten most visited domains in the last seven days, with one-click selection and local-only history processing.
- An optional limit on regular-window tabs in Settings, disabled until a value is chosen.
- An English agent guide covering architecture, storage contracts, privacy, development checks, and release workflow.
- Dependency-free regression checks for schedules, background enforcement, tab limits, and history aggregation.

### Changed

- Schedule evaluation is shared between the service worker and settings page and uses local time consistently.
- Overnight windows belong to the selected start day; adjacent and overlapping complete blocks are combined when calculating availability.
- New rules default to complete blocking on weekdays from 08:00 to 17:00. Existing zero-session rules remain complete blocks.
- The rule editor validates selected days and distinct custom start/end times and preserves paused state when editing.
- Settings layouts adapt to narrow screens.

### Privacy

- History access is an optional permission requested from the suggestions button. History and suggestion results are never persisted or uploaded.
- Suggestions use actual in-window visits instead of lifetime URL counts. Queries are capped at 10,000 URLs, with a visible partial-ranking notice when capped.

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
