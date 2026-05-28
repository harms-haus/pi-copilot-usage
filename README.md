# pi-copilot-usage

> A lightweight [pi coding agent](https://pi.dev) extension that monitors your GitHub Copilot premium interactions quota in real time and displays a color-coded progress bar in the terminal footer via [pi-powerline](https://github.com/harms-haus/pi-powerline).

## Features

- Fetches GitHub Copilot premium interactions quota usage from the official API
- Displays a color-coded progress bar in the pi-powerline footer (Line 2, right-aligned)
- Caches responses for 60 seconds to minimize API calls
- Automatically activates only when a Copilot provider is selected
- Gracefully handles network errors, missing API keys, and headless sessions

## Installation

```bash
pi install git:github.com/harms-haus/pi-copilot-usage
```

Then restart pi or run `/reload`.

> **Note:** This extension uses the same footer widget key (`"zai-usage"`) as [pi-zai-usage](https://github.com/harms-haus/pi-zai-usage). They are mutually exclusive — only one activates based on provider selection (Copilot vs Z.ai). Do not rely on both simultaneously.

## How It Works

When a GitHub Copilot model is selected (provider name `"github-copilot"`), this extension:

1. Fetches your current premium interactions quota from the GitHub Copilot API using a 3-tier auth fallback:
   - **Tier 1:** Direct API key as Bearer token
   - **Tier 2:** Token exchange via the GitHub Copilot internal token endpoint (`/copilot_internal/v2/token`)
   - **Tier 3:** `gh auth token` CLI fallback
2. Publishes the usage percentage and reset time to the UI via `ctx.ui.setStatus()`

The published status is consumed by [pi-powerline](https://github.com/harms-haus/pi-powerline), which renders it as a color-coded progress bar on footer **Line 2**, right-aligned.

### Caching

Responses are cached for **60 seconds**. Within the TTL, cached data is returned immediately without an API call. The cache is cleared when the selected provider changes (e.g., switching from Copilot to another provider). When all auth tiers fail, the extension enters an error backoff for 60 seconds before retrying.

## Events

The extension listens to the following pi lifecycle events:

| Event              | Behavior                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `session_start`    | Fetches and publishes usage data                                                              |
| `model_select`     | Clears the cache if the provider changed, then fetches and publishes usage data               |
| `turn_end`         | Fetches and publishes usage data (respects cache TTL and error backoff)                       |
| `session_shutdown` | Clears the status display                                                                     |

When no UI is available, all events return early. When the active provider is not `github-copilot`, the handlers clear any previously published status rather than fetching new data.

## Status Payload

The extension publishes under the status key `"zai-usage"`:

```json
{ "percentage": 42.5, "resetTimeMs": 1719360000000 }
```

| Field         | Type                  | Description                                                                       |
| ------------- | --------------------- | --------------------------------------------------------------------------------- |
| `percentage`  | `number`              | Premium interactions quota used, rounded to one decimal place and clamped to 0–100 |
| `resetTimeMs` | `number \| undefined` | Unix timestamp (ms) when the quota resets, or undefined if not provided            |

## Integration with pi-powerline

The progress bar is rendered by [pi-powerline](https://github.com/harms-haus/pi-powerline) on footer **Line 2**, right-aligned. Install both extensions for the full experience:

```bash
pi install git:github.com/harms-haus/pi-powerline
pi install git:github.com/harms-haus/pi-copilot-usage
```

## Requirements

- **GitHub Copilot subscription** — configure via `/login` for the `copilot` provider in pi
- **pi-powerline** — renders the progress bar in the footer (optional; without it the status is still published but not displayed)

## License

MIT
