# SpoonAlert

**Current Version:** `1.2.0`

SpoonAlert is a Discord bot that monitors Minecraft players on your server and sends you a DM when they join, disconnect, or go AFK.  
Easily manage your watchlist and notification preferences with slash commands.

---

[**View the full Changelog**](./CHANGELOG.md)

---

## ⚠️ Disclaimer

```
IMPORTANT: SpoonAlert relies on the Squaremap API for player status.
If a player dies, goes invisible, or wears a pumpkin, Squaremap may remove them from the map.
This will trigger a disconnect alert from the bot, even if the player is still online.
```

---

## Alert Modes Explained

> **Detection Modes:**
>
> - **Persistent Detection:**  
>   If enabled, disconnect alerts will always be sent for your tracked player, even if you go offline or after an AFK alert expires. Detection will not auto-disable.
>
> - **Non-Persistent Detection:**  
>   If enabled, disconnect alerts are sent only while you are online or until your tracked player disconnects. Detection will auto-disable when your player is offline and you have no active AFK alerts.
>
> - **AFK Alert:**  
>   Temporarily enables disconnect alerts for a set number of hours, regardless of your persistent setting.  
>   - If persistent detection is **off**, detection will auto-disable when the AFK alert expires (and you will be notified).
>   - If persistent detection is **on**, detection will remain enabled after the AFK alert expires.

---

## Features

- **One dashboard:** `/spoon` opens a private panel with buttons for everything. No commands to memorise.
- **Player Disconnect Alerts:** Get notified when your tracked player leaves the server.
- **Player Join Alerts:** Get notified when your tracked player joins the server.
- **AFK Detection:** Get notified when your player hasn't moved for a specified time period.
- **AFK Alerts:** Temporarily enable disconnect alerts for a set time.
- **Easy Setup:** Configure via environment variables and `config.json`.
- **Multi-server Support:** Monitor players across multiple Minecraft servers.
- **Admin Commands:** Add/remove servers and admin roles via Discord.

---

## The Dashboard

Run `/spoon`. The panel is private — only you can see it or click its buttons — and it always
reflects your current settings.

```
+------------------------------------------------+
|  SpoonAlert                                    |
|  Monitored player   **Steve** on `SurvivalSMP` |
|  Disconnect  On     Join  Off                  |
|  AFK detection  On (10 min)   Persistent  Off  |
|  AFK alert  3h 20m left (1 server)             |
+------------------------------------------------+
[Disconnect: On][Join: Off][AFK detect: On][Persistent: Off]
[Change player][Stop monitoring][AFK timer][AFK threshold]
[Refresh][Servers][Admin*]
```

Toggle buttons are green when on and grey when off, so the panel reads at a glance.
`*` The Admin button only appears if you have admin access.

The panel keeps working after the bot restarts — button routing is stateless, so an old panel
is never left dead. If you leave one open for a long time, hit **Refresh** to re-sync it.

---

## How to Setup the Bot

### 1. Clone the Repository

```sh
git clone https://github.com/militaryk/SpoonAlert-Bot
cd SpoonAlert-Bot
```

### 2. Install Dependencies

```sh
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```
DISCORD_TOKEN=your_discord_bot_token
ADMIN_USER_ID=your_discord_user_id
```

- `DISCORD_TOKEN`: Your Discord bot token (get from [Discord Developer Portal](https://discord.com/developers/applications)).
- `ADMIN_USER_ID`: Your Discord user ID (for super admin access).

### 4. Configure Bot Settings

Copy the template files and configure them:

```sh
cp config.json.template config.json
cp userConfigs.json.template userConfigs.json
```

Then edit `config.json` to set your Minecraft servers and polling intervals:

```json
{
  "servers": [
    {
      "name": "Your Server Name",
      "url": "http://your-server/tiles/players.json"
    }
  ],
  "pollIntervalOnlineSeconds": 30,
  "pollIntervalOfflineSeconds": 120,
  "loggingEnabled": true
}
```

- `servers`: List of Minecraft servers to monitor. Each must have a `name` and a `url` to its `players.json` (the full URL to `/tiles/players.json` from your Squaremap install).
- `pollIntervalOnlineSeconds`: How often (in seconds) to check for player status when any tracked player is online (default: 30).
- `pollIntervalOfflineSeconds`: How often (in seconds) to check when no tracked players are online (default: 120).
- `loggingEnabled`: Set to `true` to enable console logging for bot actions.

**Note:**  
- The Discord token and admin user ID come from `.env`, not `config.json`.
- You can add multiple servers to the `servers` array for multi-server monitoring.
- `userConfigs.json` will be automatically populated as users interact with the bot.

### 5. Run the Bot

```sh
node index.js
```

---

## Hosting

You can host SpoonAlert on any Node.js-compatible platform, including Pterodactyl, Heroku, or your own server.

---

## Commands Reference

There are only seven commands — everything a normal user needs lives on the `/spoon` panel.

| Command                | Description                                      |
|------------------------|--------------------------------------------------|
| `/spoon`               | Open your dashboard. Set your player and toggle every alert from here. |
| `/help`                | Show help.                                       |
| `/admin-server-add`    | Add a new Minecraft server (admin only). **The URL must be the full URL to your `/tiles/players.json` file.** |
| `/admin-server-remove` | Remove a Minecraft server (admin only).          |
| `/admin-role-add`      | Add a role to the admin list (super admin only). |
| `/admin-role-remove`   | Remove a role from the admin list (super admin only). |
| `/bot-status`          | Show version, uptime and usage stats (admin only). |

### Panel controls

| Control            | What it does                                              |
|--------------------|-----------------------------------------------------------|
| **Disconnect**     | DM you when your player leaves the server.                |
| **Join**           | DM you when your player comes online.                     |
| **AFK detect**     | DM you when your player stops moving.                     |
| **Persistent**     | Keep disconnect alerts on even while your player is offline. |
| **Change player**  | Set which Minecraft username to watch.                    |
| **Stop monitoring**| Clear your player and all its alert state.                |
| **AFK timer**      | Watch for a disconnect for a set number of hours (up to a week). |
| **AFK threshold**  | How long standing still counts as AFK (1–60 minutes).     |

> **Upgrading from an older version?** The twelve commands these buttons replace
> (`/alert-*`, `/player-*`, `/join-*`, `/afk-*`, `/server-list`) are gone. Command registration
> replaces the whole set, so they disappear from autocomplete the first time the bot starts.
> Your existing settings are untouched.

---

## Notes

- The bot stores user/player configs in `userConfigs.json` (created from template).
- Configuration is stored in `config.json` (created from template).
- AFK alerts are stored in `afkAlerts.json` for persistence.
- AFK tracking data is stored in `afkTracking.json` for position monitoring.
- Template files (`*.template`) are provided for initial setup.
- Make sure your bot has permission to send DMs to users.
- For multi-user support, invite the bot to your server and use the commands in the configured channel.
- Polling intervals are controlled by `pollIntervalOnlineSeconds` and `pollIntervalOfflineSeconds` in `config.json`.

---

## License

MIT
