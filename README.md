# SpoonAlert

**Current Version:** `1.1.1`

SpoonAlert is a Discord bot that monitors Minecraft players on your server and sends you a DM when they disconnect or die.  
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

## Features

- **Player Disconnect Alerts:** Get notified when your tracked player leaves the server.
- **AFK Alerts:** Temporarily enable disconnect alerts for a set time.
- **Easy Setup:** Configure via environment variables and `config.json`.
- **Multi-server Support:** Monitor players across multiple Minecraft servers.
- **Admin Commands:** Add/remove servers and admin roles via Discord.

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

Edit `config.json` to set your Minecraft servers and polling intervals:

```json
{
  "discordToken": "@@DISCORD_TOKEN_ENV@@",
  "channelId": "@@DISCORD_CHANNEL_ID_ENV@@",
  "servers": [
    {
      "name": "Your Server Name",
      "url": "http://your-server/tiles/players.json"
    }
  ],
  "pollIntervalOnlineSeconds": 30,
  "pollIntervalOfflineSeconds": 30,
  "loggingEnabled": true
}
```

- `servers`: List of Minecraft servers to monitor. Each must have a `name` and a `url` to its `players.json` (the full URL to `/tiles/players.json` from your Squaremap install).
- `pollIntervalOnlineSeconds`: How often (in seconds) to check for player status when any tracked player is online (default: 30).
- `pollIntervalOfflineSeconds`: How often (in seconds) to check when no tracked players are online (default: 30).
- `loggingEnabled`: Set to `true` to enable console logging for bot actions.

**Note:**  
- The `discordToken` and `channelId` fields are not used if you set the values via the `.env` file and Discord slash commands.
- You can add multiple servers to the `servers` array for multi-server monitoring.

### 5. Run the Bot

```sh
node index.js
```

---

## Hosting

You can host SpoonAlert on any Node.js-compatible platform, including Pterodactyl, Heroku, or your own server.

---

## Commands Reference

All commands are available as Discord slash commands:

| Command                | Description                                      |
|------------------------|--------------------------------------------------|
| `/player-add <name>`   | Set the Minecraft player you want to monitor.    |
| `/player-remove`       | Stop monitoring your current player.             |
| `/alert-enable`        | Enable disconnect notifications.                 |
| `/alert-disable`       | Disable disconnect notifications.                |
| `/alert-status`        | Show your current notification and AFK alert status. |
| `/alert-persistent`    | Toggle persistent detection (auto-enable detection even when offline). |
| `/afk-alert <hours>`   | Enable AFK disconnect alert for your player for a set number of hours. |
| `/server-list`         | List all configured Minecraft servers.           |
| `/help`                | Show help and command documentation.             |
| `/admin-server-add`    | Add a new Minecraft server (admin only). **The URL must be the full URL to your `/tiles/players.json` file.** |
| `/admin-server-remove` | Remove a Minecraft server (admin only).          |
| `/admin-role-add`      | Add a role to the admin list (super admin only). |
| `/admin-role-remove`   | Remove a role from the admin list (super admin only). |

---

## Notes

- The bot stores user/player configs in `userConfigs.json`.
- AFK alerts are stored in `afkAlerts.json` for persistence.
- Make sure your bot has permission to send DMs to users.
- For multi-user support, invite the bot to your server and use the commands in the configured channel.
- Polling intervals are controlled by `pollIntervalOnlineSeconds` and `pollIntervalOfflineSeconds` in `config.json`.

---

## License

MIT
