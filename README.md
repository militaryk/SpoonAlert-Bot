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
- **Leave Alerts:** Get notified when your tracked player leaves the server.
- **AFK-only Mode:** Narrow those down to leaves that happened while your player was standing still, so logging off on purpose stays quiet.
- **Player Join Alerts:** Get notified when your tracked player joins the server.
- **AFK Timer:** Temporarily watch for a leave over a set number of hours.
- **Easy Setup:** Configure via environment variables and `config.json`.
- **Multi-server Support:** Monitor players across multiple Minecraft servers.
- **Admin Commands:** Add/remove servers and admin roles via Discord.

---

## The Dashboard

Run `/spoon`. The panel is private — only you can see it or click its buttons — and it always
reflects your current settings.

```
+--------------------------------------------------+
|  SpoonAlert                                      |
|  Monitored player       Steve on SurvivalSMP     |
|  Tell me when they leave   Only if AFK 10+ min   |
|  Join alerts  Off       Persistent  Off          |
|  AFK alert    3h 20m left (1 server)             |
+--------------------------------------------------+
[Leave alerts: On][AFK-only: On][Join alerts: Off][Persistent: Off]
[Change player][Stop monitoring][AFK timer][Idle time]
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

# Optional
ADMIN_GUILD_ID=
ALLOWED_SERVER_HOSTS=
```

| Variable | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token from the [Discord Developer Portal](https://discord.com/developers/applications). |
| `ADMIN_USER_ID` | yes | Your Discord user ID. This account is always an admin. Must be a 17–20 digit ID; the bot refuses to start otherwise. |
| `ADMIN_GUILD_ID` | no | Pin admin commands to one server. When set, they are registered *only* there and the admin check refuses everywhere else. |
| `ALLOWED_SERVER_HOSTS` | no | Comma-separated hostnames `/admin-server-add` is allowed to accept, e.g. `map.example.com,192.168.1.50`. Left unset, any `http(s)` URL is accepted. |

> **Why `ALLOWED_SERVER_HOSTS` matters:** whatever URL an admin adds gets fetched from
> the machine running the bot every 30 seconds, forever. If you share admin access with
> anyone you don't fully trust, set this. It's opt-in because a blanket private-IP block
> would reject the LAN address most self-hosted Squaremap installs actually use.

### Granting admin access to others

Use `/admin-role-add` and pick the role. Access is stored by **role ID** in `config.json`,
so it survives restarts and cannot be gained by creating a role with a particular name.

> **Upgrading:** older versions granted admin to anyone holding a role *named* `Admin`,
> `Administrator`, or `SpoonAdmin`, in any server the bot had joined — and the list was
> only held in memory, so revoking a role undid itself on the next restart. Those names
> no longer grant anything. After updating, run `/admin-role-add` once per role you
> actually want to have access. Your `ADMIN_USER_ID` account is unaffected.

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
npm start
```

Requires **Node.js 18 or newer** (it uses the built-in `fetch`).

---

## Development

```sh
npm test          # unit tests (node:test, no network or Discord needed)
npm run lint      # eslint
npm run format    # prettier
```

The tests need neither a Discord token nor network access — `SPOONALERT_CONFIG` points them at
a fixture and `SPOONALERT_STATE_DIR` sends any state writes to a temp directory, so they never
touch real user data.

---

## Deployment (Pterodactyl, automatic)

Every push to `main` runs the tests and, if they pass, restarts the Pterodactyl server.
**A restart is the deploy** — the Node.js egg's startup command already does the work:

```sh
if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi;
if [ -f /home/container/package.json ]; then npm install; fi; node index.js
```

So the CI job ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) only has to
prove the code is healthy and then ask the panel to restart, and finally poll until the server
reports `running` — without that last check, a deploy that boots into a crash loop would still
show a green tick.

### One-time server setup

On the **Startup** tab set:

| Variable | Value |
|---|---|
| `Git Repo Address` | `https://github.com/militaryk/SpoonAlert-Bot` |
| `Branch` | `main` |
| `AUTO_UPDATE` | `1` |
| `User Uploaded Files` | `0` |

> ⚠️ **`AUTO_UPDATE` only works if `/home/container/.git` exists.** If the files were uploaded
> by hand rather than cloned, the `[[ -d .git ]]` test fails, `git pull` never runs, and the
> bot boots the old code **with no error shown**. To convert an existing manual install:
> back up `.env`, `config.json`, `userConfigs.json`, `afkAlerts.json` and `afkTracking.json`,
> stop the server, delete everything in `/home/container`, hit **Reinstall Server** (the
> install script refuses to clone into a non-empty non-git directory), then re-upload those
> five files.

### Repository secrets

Create a Client API key under **Account → API Credentials**, then:

```sh
gh secret set PTERO_PANEL_URL   # https://panel.example.com  (no trailing slash)
gh secret set PTERO_SERVER_ID   # the short hash from /server/<id>
gh secret set PTERO_API_KEY     # the key you just created
```

The deploy job fails with a named error if any of the three is missing.

### What a deploy never touches

`.env`, `config.json`, `userConfigs.json`, `afkAlerts.json` and `afkTracking.json` are all
gitignored, so they live only on the server and survive every pull. This is exactly why the
pipeline uses git rather than an SFTP mirror — a mirror with `--delete` would wipe them.

---

## Hosting

You can host SpoonAlert on any Node.js-compatible platform, including Pterodactyl, Heroku, or your own server.

**Run it under a supervisor that restarts on exit.** The bot exits deliberately on
unrecoverable startup problems (missing config, bad token, corrupt `userConfigs.json`), and
nothing should be relied on to run forever unattended.

With [pm2](https://pm2.keymetrics.io/):

```sh
npm install -g pm2
pm2 start index.js --name spoonalert
pm2 save && pm2 startup
```

Or as a systemd unit (`/etc/systemd/system/spoonalert.service`):

```ini
[Unit]
Description=SpoonAlert Discord bot
After=network-online.target

[Service]
WorkingDirectory=/opt/spoonalert
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

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
| **Leave alerts**   | DM you when your player leaves the server.                |
| **AFK-only**       | Narrow those down to leaves that happened while your player was standing still. |
| **Join alerts**    | DM you when your player comes online.                     |
| **Persistent**     | Keep leave alerts on even while your player is offline.   |
| **Change player**  | Set which Minecraft username to watch.                    |
| **Stop monitoring**| Clear your player and all its alert state.                |
| **AFK timer**      | Watch for a leave over a set number of hours (up to a week). |
| **Idle time**      | How long standing still counts as AFK (1–60 minutes).     |

### AFK-only, explained

**You are never DMed for going AFK.** Standing still is the normal state of an AFK farm, so
being told about it every time would be noise. Instead, idleness is remembered and used to
decide whether a *disconnect* is worth telling you about:

| AFK-only | What happened | Result |
|---|---|---|
| On | Idle 20 min, then dropped | 💤 **alert** |
| On | Playing actively, then logged off | silent |
| Off | Any disconnect at all | alert |

So with it on you hear about the AFK farm getting kicked, and not about yourself logging off
for the night. An **AFK timer** overrides this — arming one is an explicit "tell me if they
drop during this window", so it fires either way.

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
