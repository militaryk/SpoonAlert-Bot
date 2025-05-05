# Changelog

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
