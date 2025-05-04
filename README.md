# SpoonAlert

SpoonAlert is a Discord bot that monitors Minecraft players on your server and sends you a DM when they disconnect or die.  
Easily manage your watchlist and notification preferences with slash commands.

---

## Features

- **Player Disconnect Alerts:** Get notified when tracked players leave the server.
- **Death Notifications:** Receive alerts when a tracked player dies.
- **Custom Watchlist:** Add or remove Minecraft players to monitor.
- **Easy Setup:** Configure via environment variables or config file.

---

## Installation & Setup

### 1. Clone the Repository

```sh
git clone https://github.com/militaryk/SpoonAlert-Bot
cd SpoonAlert-Bot
```

### 2. Install Dependencies

Run the following command **inside the project folder** to install all required dependencies:

```sh
npm install
```

> **Note:**  
> Do **not** use `-g` or `sudo`/administrator privileges.  
> This will create a `node_modules` folder locally with all dependencies needed to run the bot.

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```
DISCORD_TOKEN=your_discord_bot_token
```

- `DISCORD_TOKEN`: Your Discord bot token (get from [Discord Developer Portal](https://discord.com/developers/applications)).

### 4. Configure Bot Settings

Edit `config.json` to set your Minecraft server's player status endpoint and other options:

```json
{
  "discordToken": "@@DISCORD_TOKEN_ENV@@",
  "channelId": "@@DISCORD_CHANNEL_ID_ENV@@",
  "playersJsonUrl": "http://your-server/tiles/players.json",
  "pollIntervalSeconds": 30
}
```

- `playersJsonUrl`: URL to your Minecraft server's `players.json` endpoint.

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
| `/addplayer <name>`    | Add a Minecraft player to your watchlist.        |
| `/removeplayer <name>` | Remove a player from your watchlist.             |
| `/listplayers`         | List all players you are monitoring.             |
| `/enablealert`         | Enable disconnect notifications.                 |
| `/disablealert`        | Disable disconnect notifications.                |
| `/toggledeathalert`    | Toggle death notifications.                      |
| `/statusalert`         | Show your current notification settings.         |
| `/help`                | Show help and command documentation.             |

---

## Notes

- The bot stores user/player configs in `userConfigs.json`.
- Make sure your bot has permission to send DMs to users.
- For multi-user support, invite the bot to your server and use the commands in the configured channel.

---

## License

MIT
