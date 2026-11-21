# Agent guide

## Project overview

Keep Focused is a local-only Chrome Manifest V3 extension. It blocks distracting domains on weekly schedules, limits daily checking sessions, provides timed focus mode, and optionally limits open tabs. There is no build step, package manager setup, backend, analytics, or account system.

Use English for new documentation, UI copy, code comments, commit messages, and release notes. `README.zh.md` is an existing Chinese translation; keep its translated product behavior consistent when updating it.

## Repository map

- `manifest.json`: extension version, permissions, service worker, popup, and settings entry points.
- `src/background.js`: navigation decisions, local usage/session statistics, focus alarms, tab-limit enforcement, and schedule alarms.
- `src/schedule.js`: shared local-time schedule evaluation and availability calculation. Imported by the classic service worker with `importScripts` and loaded before `options.js` in settings.
- `src/domain-suggestions.js`: on-demand Chrome history aggregation. Loaded before `options.js`.
- `src/options.html`, `src/options.js`, `src/options.css`: dashboard, rule editor, saved rules, and general settings.
- `src/popup.*`: master switch and timed focus controls.
- `src/blocked.*`: blocked-page reason and next availability.
- `tests/*.test.cjs`: dependency-free Node tests, including a mocked Chrome service worker.
- `README.md`, `README.zh.md`, `CHANGELOG.md`: user documentation and release history.

Browser scripts are plain JavaScript, not ES modules. Shared helpers conditionally export through CommonJS for Node tests. Preserve the browser script load order and Manifest V3 content-security-policy compatibility.

## Storage and behavior contracts

Persistent state uses `chrome.storage.local`:

- `settings`: `enabled`, `sessionWindowMinutes`, `focusDurationMinutes`, and nullable `maxOpenTabs`.
- `rules`: IDs, normalized domains, subdomain inclusion, selected day labels, time windows, daily limits, enabled state, and update timestamps.
- `usage`: local date -> rule ID -> allowance count and last activity time.
- `sessionStats`: local date -> rule ID -> actual session totals; resetting today's allowance must not erase these totals.
- `focus`: active state, selected tab/window, page URL/domain, and start/end times.

Important invariants:

- `dailyLimit: 0` means a complete block; positive limits mean checking-session allowances. Saved-rule tags derive from this value, not from whether a custom time window exists.
- Schedules use the computer's local clock, include the start, and exclude the end. Overnight windows belong to their start day. Empty day lists in legacy rules mean every day. Legacy equal or invalid time windows retain their all-day fallback; the editor rejects equal custom times for new saves.
- Any matching active complete block takes priority over session allowances. Availability must consider the union of matching complete-block rules, including adjacent windows.
- Background schedule scans must not consume sessions. Check open tabs at boundaries, rule/settings changes, and startup, with a periodic watchdog for missed alarms and clock changes. Do not automatically reopen blocked pages.
- Normalize case and remove `www.` consistently. Other subdomains remain distinct unless a rule includes subdomains; do not approximate registrable domains by stripping to the last two labels.
- Editing a paused rule must preserve its paused state.
- Tab limits apply to regular, non-incognito windows and are disabled when unset. Serialize creation handling to avoid races.

## Privacy and permissions

The `history` permission is optional. Request it directly from a user click before querying history. Suggestions count individual visits within a rolling seven-day window, including reloads and excluding subframe visits; lifetime URL visit counts are not weekly counts. Merge paths and `www`, keep other subdomains separate, and display the top ten domains. Limit queries to 10,000 history URLs, bound concurrent API requests, and label capped results as partial.

Do not persist or upload history queries, full browsing history, or suggestion results. Permission denial, revoked access, empty history, and read failures must leave manual domain entry usable. Invalidate displayed suggestions when history is removed or the permission is revoked. Existing focus state may store the user-selected page URL; this is separate from history suggestions.

## Local development and checks

Use Node.js 20 or newer for the built-in test runner. Run commands from the repository root:

```sh
TZ=America/Los_Angeles node --test tests/*.test.cjs
for file in src/*.js; do node --check "$file" || exit; done
python3 -m json.tool manifest.json > /dev/null
git diff --check
```

For browser verification, load the repository root as an unpacked extension at `chrome://extensions`, then reload the extension and refresh its settings tab after changes. Check:

- Adding, editing, pausing, and deleting complete blocks and session limits, with correct type tags.
- Day presets, custom/all-day times, overnight windows, and validation for empty days/equal times.
- Blocking both new navigation and already-open tabs at the start of a window, and access after the window ends.
- Domain suggestions: permission denial/grant, visit ranking, click-to-fill, empty/error states, and revoked/deleted history.
- Focus expiration and optional tab-limit behavior if those paths change.

Node tests mock Chrome APIs; they do not prove real extension installation, permission prompts, or alarm delivery. State this distinction when reporting verification. Keep browser screenshots/logs in ignored `output/playwright/` or `.playwright-cli/`; never commit personal browsing data or browser profiles.

## Releases

Use semantic versions: compatible new features increment the minor version; fixes increment the patch version. Match `manifest.json` to the dated version section in `CHANGELOG.md`, and keep an `Unreleased` section for future work.

For an explicitly requested release, finish checks, commit the release files, then create an annotated `vMAJOR.MINOR.PATCH` tag on that exact commit. Inspect existing local and remote tags first. Never overwrite or move an existing release tag. Push only the intended branch and tag, and verify their remote object IDs. A Git tag is separate from a GitHub Release page, merging to the default branch, and publishing to the Chrome Web Store; perform those additional actions only when requested.
