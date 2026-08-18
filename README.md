<p align="center">
  <img src="icons/keep_focused_icon.png" width="128" alt="Keep Focused logo">
</p>

<h1 align="center">Keep Focused</h1>

<p align="center">
  A lightweight Chrome extension for blocking distracting websites by domain, schedule, and daily session limits.
</p>

<p align="center">
  <a href="README.zh.md">中文 README</a>
</p>

---

## Why Keep Focused?

Distraction is just one click away. **Keep Focused** helps you stay productive by putting simple, flexible rules between you and the sites that break your focus.

### Built for privacy

Most website blockers are made by third-party developers and require broad permissions to read every page you visit. That means a blocker can potentially see:

- Every URL you open
- When and how often you visit specific sites
- Your browsing habits over time

Some extensions send this data to remote servers for analytics, account syncing, or even monetization. Even well-known tools can change ownership or update their privacy policy at any time.

**Keep Focused exists because I wanted a blocker I could fully trust.** It is open-source, runs entirely inside your browser, and keeps all data — rules, usage, settings — in local Chrome storage. There is no account, no cloud sync, no analytics, and no remote server. If you can read the code, you know exactly what it does.

### Flexible, not restrictive

Instead of an all-or-nothing blocker, you decide:

- **Which domains** are distracting.
- **When** they should be blocked (specific days and times).
- **How often** you allow yourself to check them (daily session limits).

## Features

- 🔒 **Domain-based blocking** — Blocks by normalized domain, so `https://domain.com/path` and `https://www.domain.com` match the same rule.
- 🌐 **Subdomain support** — Optionally include subdomains like `forum.domain.com` per rule.
- 📅 **Scheduled rules** — Choose active days and an optional restricted time window.
- 🔢 **Session limits** — Set a daily number of checking sessions. Repeated visits inside the same session window only count once.
- 📊 **Accurate daily totals** — Tracks true daily session counts, including sessions used after resetting today's allowance.
- ⚡ **Master switch** — Quickly turn all blocking on or off from the popup.
- 🎯 **Timed focus mode** — Lock yourself to the current page for a chosen duration. It defaults to 30 minutes, can be changed in the popup or Settings, and automatically ends even when the popup is closed.
- 🔒 **Privacy-first** — Everything stays in your browser; no accounts, no servers, no tracking.

## Showcase

<p align="center">
  <img src="examples/dashboard.png" alt="Keep Focused dashboard" width="720">
</p>

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the project folder.
6. Open the extension settings and add your first rule.

## Usage examples

**Limit checking to 5 sessions on selected days**

| Domain | Days | Time | Sessions | Result |
|---|---|---|---|---|
| `tradingview.com` | Mon / Tue / Sun | All day | 5 | Allows five checking sessions on those days, then blocks until the next local day. |

**Block a site during work hours**

| Domain | Days | Time | Sessions | Result |
|---|---|---|---|---|
| `reddit.com` | Mon–Fri | 09:00–17:00 | 0 | Fully blocks Reddit during weekday work hours; allows it outside that window. |

## Permissions

Keep Focused uses the minimum permissions needed to do its job:

- `storage` — Save your rules and settings locally.
- `tabs` / `webNavigation` — Detect page navigation and count sessions.
- `alarms` — End a timed Focus mode at its scheduled time, even when the popup is closed.
- `notifications` — Notify you when Focus mode switches you back to the locked page (fallback when the popup cannot open automatically).
- `host_permissions: <all_urls>` — Read page URLs so rules can match any domain you choose.

## License

MIT
