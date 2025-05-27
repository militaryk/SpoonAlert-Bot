# Changelog

## Version 1.2.0

### New Features

- **Player Join Alerts:** Added ability to get notified when your tracked player joins a server.
  - New commands: `/join-enable` and `/join-disable`
  - Join notifications are shown in `/alert-status` command
  - Users can have join notifications enabled independently of disconnect detection
- **AFK Detection:** Added position-based AFK detection system.
  - New commands: `/afk-enable <minutes>` and `/afk-disable`
  - Tracks player position changes and sends notifications when player hasn't moved for specified time (1-60 minutes)
  - AFK status shown in `/alert-status` command
  - Position data automatically cleaned up when players go offline or detection is disabled
  - Persistent storage in `afkTracking.json` file
- **Dynamic Polling Intervals:** The bot now automatically adjusts polling frequency based on player activity.
  - When tracked players are online: polls every 30 seconds (configurable via `pollIntervalOnlineSeconds`)
  - When no tracked players are online: polls every 2 minutes (configurable via `pollIntervalOfflineSeconds`)
- **Enhanced Error Handling:** Improved error handling for server connection timeouts and network issues.
  - Suppresses stack traces for common network errors (ETIMEDOUT, ECONNREFUSED, etc.)
  - Only logs concise warning messages when servers are offline

### Bug Fixes

- Fixed: Bot no longer crashes when a server is offline or unreachable
- Fixed: Improved bot stability with proper error handling in polling intervals
- Fixed: AFK detection validation ensures minutes parameter is within valid range (1-60)

### Misc

- Updated README.md with new join notification and AFK detection commands
- Added comprehensive help text for AFK detection features
- Improved code organization and maintainability

---

## Version 1.1.1

### Hotfix

- Fixed: AFK alert expiry will no longer disable detection if persistent detection is enabled (`persistentDetection: true`).  
- Clarified `/admin-server-add` command and README to specify the URL must be the full URL to `/tiles/players.json`.

## Version 1.1.0

### Features & Improvements

- **Multi-Server Support:**  
  - The bot can now monitor players across multiple Minecraft servers.
  - All relevant commands and status displays now support multi-server tracking.
  - Admins can add or remove servers dynamically via Discord commands.

- **Admin Management & Commands:**  
  - Added admin role management: super admin can add or remove admin roles via `/admin-role-add` and `/admin-role-remove`.
  - Admin-only commands for server management: `/admin-server-add`, `/admin-server-remove`, `/admin-server-default`.
  - Only users with admin roles (or the super admin) can manage servers and admin roles.

- **Bot Version, Uptime, and Usage Stats:**  
  - Added `BOT_VERSION` (from `package.json`), `BOT_START_TIME`, and `botUsageCount` to display version, uptime, and usage stats in `/bot-status`.

- **AFK Alert Behavior:**  
  - `/afk-alert` now always enables detection when set, even if previously disabled.
  - Detection is **not** disabled when a player disconnects during an active AFK alert.
  - Detection is **only** disabled when the AFK alert time expires and no more AFK alerts remain for the user.
  - When AFK alert expires and detection is disabled, the user receives a DM notification.

- **Auto-disable Detection Logic:**  
  - The auto-disable logic for detection (when persistentDetection is false and player is offline) now skips users with active AFK alerts.

- **Error Handling:**  
  - Fixed missing variable errors for `BOT_START_TIME`, `BOT_VERSION`, and `botUsageCount`.

### Bug Fixes

- Fixed: Detection was being disabled after a disconnect even if an AFK alert was still active.
- Fixed: No notification was sent to the user when AFK alert expired and detection was disabled.
- Fixed: `/afk-alert` did not enable detection if it was previously disabled.

### Misc

- Improved code comments and maintainability.
- Updated polling interval in `config.json` for faster status checks.

---
