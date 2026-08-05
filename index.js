require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, InteractionType } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// config.json used to be a bare `require`, which throws SyntaxError (empty/truncated
// file) or MODULE_NOT_FOUND (fresh clone) before anything can explain why.
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
    console.error(
        `[SpoonAlert] Could not read config.json: ${e.code === 'ENOENT' ? 'file not found' : e.message}\n` +
        '            Copy config.json.template to config.json and fill in your servers.'
    );
    process.exit(1);
}

// Add this to load the version from package.json
const BOT_VERSION = require('./package.json').version;

// Add this line to record the bot's start time
const BOT_START_TIME = Date.now();

// Add this line to track total commands used
let botUsageCount = 0;

const discordToken = process.env.DISCORD_TOKEN;
const alertChannelId = "1368463031339843615";
let wasOnline = false;
let detectionEnabled = true; // Default: enabled
let deathNotifyEnabled = true; // Default: enabled
let lastPlayerState = null;

// Persistent storage for tracked players using a JSON file
const USER_CONFIGS_PATH = path.join(__dirname, 'userConfigs.json');
// Add AFK alert persistent storage path
const AFK_ALERTS_PATH = path.join(__dirname, 'afkAlerts.json');
// Add AFK tracking storage path
const AFK_TRACKING_PATH = path.join(__dirname, 'afkTracking.json');

// Track users and their player: { [discordUserId]: { player: {name}, ... } }
let userConfigs = {};

// Load userConfigs from disk
function loadUserConfigs() {
    try {
        if (fs.existsSync(USER_CONFIGS_PATH)) {
            const raw = fs.readFileSync(USER_CONFIGS_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            for (const [uid, cfg] of Object.entries(parsed)) {
                // Convert players array/object to single player object (name only)
                if (Array.isArray(cfg.players) && cfg.players.length > 0) {
                    cfg.player = { name: cfg.players[0].name || cfg.players[0] };
                } else if (cfg.player && typeof cfg.player === "object") {
                    cfg.player = { name: cfg.player.name };
                } else if (cfg.player && typeof cfg.player === "string") {
                    cfg.player = { name: cfg.player };
                } else {
                    cfg.player = null;
                }
                delete cfg.players;
                if (typeof cfg.persistentDetection !== 'boolean') {
                    cfg.persistentDetection = false;
                }
                // Ensure defaultPlayer is present (null if missing)
                if (!('defaultPlayer' in cfg)) {
                    cfg.defaultPlayer = null;
                }
                // Ensure joinNotify is present (false if missing)
                if (typeof cfg.joinNotify !== 'boolean') {
                    cfg.joinNotify = false;
                }
                // Ensure afkDetection is present (false if missing)
                if (typeof cfg.afkDetection !== 'boolean') {
                    cfg.afkDetection = false;
                }
                // Ensure afkThresholdMinutes is present (10 if missing)
                if (typeof cfg.afkThresholdMinutes !== 'number' || cfg.afkThresholdMinutes < 1) {
                    cfg.afkThresholdMinutes = 10;
                }
            }
            userConfigs = parsed;
        }
    } catch (e) {
        log('Failed to load userConfigs:', e);
        userConfigs = {};
    }
}

// Save userConfigs to disk
function saveUserConfigs() {
    try {
        const serializable = {};
        for (const [uid, cfg] of Object.entries(userConfigs)) {
            serializable[uid] = {
                ...cfg,
                // Save as player, not players array
                player: cfg.player || null,
                persistentDetection: !!cfg.persistentDetection,
                joinNotify: !!cfg.joinNotify,
                afkDetection: !!cfg.afkDetection,
                afkThresholdMinutes: cfg.afkThresholdMinutes || 10,
                defaultPlayer: cfg.defaultPlayer || null // ensure defaultPlayer is saved
            };
            delete serializable[uid].players;
        }
        fs.writeFileSync(USER_CONFIGS_PATH, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (e) {
        log('Failed to save userConfigs:', e);
    }
}

// Add AFK alert tracking: { [discordUserId]: { [key]: { expiresAt: timestamp } } }
let afkAlerts = {};

// Add AFK position tracking: { [discordUserId]: { [key]: { x, y, z, lastMoved: timestamp, afkDetectionEnabled: boolean, afkThresholdMinutes: number } } }
let afkTracking = {};

// Load afkAlerts from disk
function loadAfkAlerts() {
    try {
        if (fs.existsSync(AFK_ALERTS_PATH)) {
            const raw = fs.readFileSync(AFK_ALERTS_PATH, 'utf8');
            afkAlerts = JSON.parse(raw);
        }
    } catch (e) {
        log('Failed to load afkAlerts:', e);
        afkAlerts = {};
    }
}

// Save afkAlerts to disk
function saveAfkAlerts() {
    try {
        fs.writeFileSync(AFK_ALERTS_PATH, JSON.stringify(afkAlerts, null, 2), 'utf8');
    } catch (e) {
        log('Failed to save afkAlerts:', e);
    }
}

// Load afkTracking from disk
function loadAfkTracking() {
    try {
        if (fs.existsSync(AFK_TRACKING_PATH)) {
            const raw = fs.readFileSync(AFK_TRACKING_PATH, 'utf8');
            afkTracking = JSON.parse(raw);
        }
    } catch (e) {
        log('Failed to load afkTracking:', e);
        afkTracking = {};
    }
}

// Save afkTracking to disk
function saveAfkTracking() {
    try {
        fs.writeFileSync(AFK_TRACKING_PATH, JSON.stringify(afkTracking, null, 2), 'utf8');
    } catch (e) {
        log('Failed to save afkTracking:', e);
    }
}

// Load configs at startup
loadUserConfigs();
loadAfkAlerts();
loadAfkTracking();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });

// Every DM goes through here. Previously each site did a bare, unawaited
// `user.send()`; that promise rejects with 50007 whenever the recipient has DMs
// off or has blocked the bot, and an unhandled rejection terminates Node 15+ --
// taking down alerts for every other user. Never throws, so callers in the poll
// loop can't be unwound by one undeliverable message.
async function sendDm(userId, content) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(content);
        return true;
    } catch (err) {
        log(`Could not DM ${userId}:`, err.code || err.message || err);
        return false;
    }
}

// Backstop: console.error directly, not log(), so this is never hidden by
// loggingEnabled being false.
process.on('unhandledRejection', err => {
    console.error('[SpoonAlert] Unhandled promise rejection:', err);
});

// Bot description (for Discord application page)
const BOT_DESCRIPTION = `SpoonAlert watches Minecraft players on your server and sends you a DM when they join, disconnect, or go AFK.
Add or remove players to your watchlist, toggle notifications, and get status updates with slash commands.
Perfect for AFK warriors and forgetful adventurers!`;

// Funny activities for rich presence
const funnyActivities = [
    { type: 'PLAYING', name: 'hide and seek with creepers' },
    { type: 'WATCHING', name: 'Steve trip over blocks' },
    { type: 'LISTENING', name: 'pigstep on repeat' },
    { type: 'PLAYING', name: 'AFK Olympics' },
    { type: 'WATCHING', name: 'the grass grow' },
    { type: 'PLAYING', name: 'tag with Endermen' },
    { type: 'WATCHING', name: 'for disconnects...' }
];

const ADMIN_ROLE_NAMES = ['Admin', 'Administrator', 'SpoonAdmin']; // Add your admin role names here
const ENV_ADMIN_USER_ID = process.env.ADMIN_USER_ID; // Discord user ID of the super admin

// Fail fast on missing credentials. An unset ADMIN_USER_ID is especially nasty:
// `interaction.user.id !== undefined` is always true, so the role commands
// silently reject everyone, including the owner, with no hint of the cause.
if (!discordToken) {
    console.error('[SpoonAlert] DISCORD_TOKEN is not set. Add it to your .env file.');
    process.exit(1);
}
if (!/^\d{17,20}$/.test(ENV_ADMIN_USER_ID || '')) {
    console.error(
        '[SpoonAlert] ADMIN_USER_ID is missing or malformed (expected a Discord user ID, 17-20 digits).\n' +
        '            Without it, nobody can use /admin-role-add or /admin-role-remove.'
    );
    process.exit(1);
}

// Register slash commands
const commands = [
    new SlashCommandBuilder().setName('alert-enable').setDescription('Enable player disconnect detection'),
    new SlashCommandBuilder().setName('alert-disable').setDescription('Disable player disconnect detection'),
    new SlashCommandBuilder().setName('alert-status').setDescription('Show your alert and AFK status'),
    (() => {
        const builder = new SlashCommandBuilder()
            .setName('player-add')
            .setDescription('Monitor a Minecraft player')
            .addStringOption(opt => opt.setName('player').setDescription('Minecraft player name').setRequired(true));
        // Remove server option from player-add, always monitor on all servers
        return builder;
    })(),
    (() => {
        const builder = new SlashCommandBuilder()
            .setName('player-remove')
            .setDescription('Stop monitoring your player');
        return builder;
    })(),
    new SlashCommandBuilder()
        .setName('server-list')
        .setDescription('List all configured Minecraft servers'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show help for SpoonAlert bot'),
    new SlashCommandBuilder()
        .setName('alert-persistent')
        .setDescription('Toggle persistent detection (auto-enable detection even when offline)'),
    new SlashCommandBuilder()
        .setName('join-enable')
        .setDescription('Enable player join notifications'),
    new SlashCommandBuilder()
        .setName('join-disable')
        .setDescription('Disable player join notifications'),
    new SlashCommandBuilder()
        .setName('afk-enable')
        .setDescription('Enable AFK detection for your monitored player')
        .addIntegerOption(opt => 
            opt.setName('minutes')
                .setDescription('Minutes of inactivity before being marked as AFK (1-60)')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('afk-disable')
        .setDescription('Disable AFK detection for your monitored player'),
    // --- admin commands ---
    new SlashCommandBuilder()
        .setName('admin-server-add')
        .setDescription('Add a new Minecraft server (admin only)')
        .addStringOption(opt => opt.setName('name').setDescription('Server name').setRequired(true))
        .addStringOption(opt => opt.setName('url').setDescription('players.json URL (full /tiles/players.json URL)').setRequired(true))
        .setDefaultMemberPermissions('0')
        .setDMPermission(false),
    new SlashCommandBuilder()
        .setName('admin-server-remove')
        .setDescription('Remove a Minecraft server (admin only)')
        .addStringOption(opt => opt.setName('name').setDescription('Server name to remove').setRequired(true))
        .setDefaultMemberPermissions('0')
        .setDMPermission(false),
    new SlashCommandBuilder()
        .setName('admin-role-add')
        .setDescription('Add a role to the admin list (super admin only)')
        .addStringOption(opt => opt.setName('rolename').setDescription('Role name to add as admin').setRequired(true))
        .setDefaultMemberPermissions('0')
        .setDMPermission(false),
    new SlashCommandBuilder()
        .setName('admin-role-remove')
        .setDescription('Remove a role from the admin list (super admin only)')
        .addStringOption(opt => opt.setName('rolename').setDescription('Role name to remove from admin').setRequired(true))
        .setDefaultMemberPermissions('0')
        .setDMPermission(false),
    (() => {
        const builder = new SlashCommandBuilder()
            .setName('afk-alert')
            .setDescription('Enable AFK disconnect alert for your monitored player for a set number of hours (up to 168)')
            .addIntegerOption(opt =>
                opt.setName('hours')
                    .setDescription('Number of hours to track (1-168)')
                    .setRequired(true)
            );
        // Remove server option from afk-alert, always applies to all servers
        return builder;
    })(),
    new SlashCommandBuilder()
        .setName('bot-status')
        .setDescription('Show bot version, uptime, server list, and usage stats (admin only)')
        .setDefaultMemberPermissions('0')
        .setDMPermission(false),
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    log(`Logged in as ${client.user.tag}`);
    // Set rich presence with a random funny activity, change every 5 minutes
    function setRandomActivity() {
        const activity = funnyActivities[Math.floor(Math.random() * funnyActivities.length)];
        // Discord.js v14: type must be ActivityType enum or number, not string
        // Import ActivityType from discord.js
        const { ActivityType } = require('discord.js');
        let type = ActivityType.Playing;
        if (activity.type === 'PLAYING') type = ActivityType.Playing;
        else if (activity.type === 'WATCHING') type = ActivityType.Watching;
        else if (activity.type === 'LISTENING') type = ActivityType.Listening;
        client.user.setActivity(activity.name, { type });
    }
    setRandomActivity();
    setInterval(setRandomActivity, 5 * 60 * 1000);

    // Start polling first. Command registration below can fail (a guild joined
    // without the applications.commands scope returns 403), and it used to throw
    // out of this listener before polling was ever started -- stale commands are
    // survivable, no monitoring at all is not.
    startPolling(POLL_ONLINE_MS);

    // Register commands for the guilds the bot is in
    const rest = new REST({ version: '10' }).setToken(discordToken);
    const guilds = client.guilds.cache.map(guild => guild.id);
    for (const guildId of guilds) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        } catch (err) {
            log(`Failed to register commands for guild ${guildId}:`, err.message || err);
        }
    }

    // Initial call, also wrapped
    try {
        await checkPlayerStatus();
    } catch (err) {
        log('Error in initial checkPlayerStatus:', err);
    }
});

// Helper for ephemeral flag compatibility (Discord.js v14+)
function ephemeralReply(interaction, options) {
    // Discord.js v14+ prefers { flags: 64 } for ephemeral
    if (options && options.ephemeral) {
        options.flags = 64;
        delete options.ephemeral;
    }
    return interaction.reply(options);
}

client.on('interactionCreate', async interaction => {
    if (interaction.type !== InteractionType.ApplicationCommand) return;

    // Optionally, if you want to restrict to a specific channel, check and reply with an error instead of silently returning:
    // if (interaction.channelId !== alertChannelId) {
    //     await interaction.reply({ content: 'Please use this command in the correct channel.', ephemeral: true });
    //     return;
    // }

    const discordUserId = interaction.user.id;
    if (!userConfigs[discordUserId]) {
        userConfigs[discordUserId] = {
            player: null,
            deathNotify: true,
            detection: true,
            joinNotify: false,
            afkDetection: false,
            afkThresholdMinutes: 10,
            persistentDetection: false,
            wasOnline: {},
            lastState: {}
        };
        saveUserConfigs();
    }
    const userCfg = userConfigs[discordUserId];

    if (interaction.commandName === 'alert-enable') {
        userCfg.detection = true;
        saveUserConfigs();
        log(`User ${interaction.user.tag} (${discordUserId}) enabled disconnect detection.`);
        await ephemeralReply(interaction, { content: 'Player disconnect detection enabled.', ephemeral: true });
    } else if (interaction.commandName === 'alert-disable') {
        userCfg.detection = false;
        // Remove all AFK alerts for this user
        if (afkAlerts[discordUserId]) {
            delete afkAlerts[discordUserId];
            saveAfkAlerts();
        }
        saveUserConfigs();
        log(`User ${interaction.user.tag} (${discordUserId}) disabled disconnect detection and cleared AFK alerts.`);
        await ephemeralReply(interaction, { content: 'Player disconnect detection disabled and all AFK alerts cleared.', ephemeral: true });
    } else if (interaction.commandName === 'alert-persistent') {
        userCfg.persistentDetection = !userCfg.persistentDetection;
        saveUserConfigs();
        await ephemeralReply(interaction, {
            content: `Persistent detection is now **${userCfg.persistentDetection ? 'enabled' : 'disabled'}**.\n` +
                (userCfg.persistentDetection
                    ? 'Detection will remain enabled even if you disconnect.'
                    : 'Detection will auto-disable when you disconnect.'),
            ephemeral: true
        });
    } else if (interaction.commandName === 'alert-status') {
        let list;
        if (userCfg.player) {
            if ((config.servers || []).length === 1) {
                list = `**${userCfg.player.name}** on \`${config.servers[0].name}\``;
            } else {
                list = `**${userCfg.player.name}** on all servers`;
            }
        } else {
            list = 'None';
        }

        // Show remaining AFK alerts for this user, grouping by time left
        let afkMsg = '';
        if (afkAlerts[discordUserId]) {
            const now = Date.now();
            // Map: timeLeftStr => { servers: [], until: timestamp }
            const timeGroups = {};
            for (const [key, alert] of Object.entries(afkAlerts[discordUserId])) {
                if (alert.expiresAt > now) {
                    const [player, server] = key.split('|');
                    const msLeft = alert.expiresAt - now;
                    let hours = Math.floor(msLeft / 3600000);
                    let mins = Math.round((msLeft % 3600000) / 60000);
                    if (mins === 60) {
                        hours += 1;
                        mins = 0;
                    }
                    let timeStr = hours > 0
                        ? (mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`)
                        : `${mins}m left`;
                    // Use expiresAt as the grouping key to combine servers with same end time
                    const groupKey = `${alert.expiresAt}|${timeStr}`;
                    if (!timeGroups[groupKey]) timeGroups[groupKey] = { servers: [], until: alert.expiresAt, timeStr };
                    timeGroups[groupKey].servers.push(server);
                }
            }
            const groupEntries = Object.values(timeGroups);
            if (groupEntries.length > 0) {
                afkMsg = '\nAFK alerts:\n' + groupEntries.map(group => {
                    let serverDisplay;
                    if (group.servers.length === 1) {
                        serverDisplay = `\`${group.servers[0]}\``;
                    } else {
                        serverDisplay = group.servers.map(s => `\`${s}\``).join(', ');
                    }
                    // Format end time in user's local time
                    const untilDate = new Date(group.until);
                    const untilStr = untilDate.toLocaleString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: undefined,
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                    return `- ${serverDisplay}: ${group.timeStr} (ends at ${untilStr} local time)`;
                }).join('\n');
            }
        }        await ephemeralReply(interaction, {
            content:
                `Player disconnect detection is currently **${userCfg.detection ? 'enabled' : 'disabled'}**.\n` +
                `Persistent detection is **${userCfg.persistentDetection ? 'enabled' : 'disabled'}**.\n` +
                `Player join notifications are **${userCfg.joinNotify ? 'enabled' : 'disabled'}**.\n` +
                `AFK detection is **${userCfg.afkDetection ? `enabled (${userCfg.afkThresholdMinutes} minutes)` : 'disabled'}**.\n` +
                `Monitored player: ${list}` +
                (afkMsg ? afkMsg : ''),
            ephemeral: true
        });
    } else if (interaction.commandName === 'player-add') {
        if (!config.servers || config.servers.length === 0) {
            await interaction.reply({ content: 'No servers are configured. Please ask an admin to add a server first.', ephemeral: true });
            return;
        }
        if (userCfg.player && userCfg.player.name) {
            await interaction.reply({ content: 'You are already monitoring a player. Use `/player-remove` before adding a new one.', ephemeral: true });
            return;
        }
        const player = interaction.options.getString('player');
        userCfg.player = { name: player };
        saveUserConfigs();
        let msg;
        if ((config.servers || []).length === 1) {
            msg = `Now monitoring player **${player}** on \`${config.servers[0].name}\`.`;
        } else {
            msg = `Now monitoring player **${player}** on all servers.`;
        }
        await ephemeralReply(interaction, { content: msg, ephemeral: true });
    } else if (interaction.commandName === 'player-remove') {
        // Remove the user's monitored player (no input needed)
        let found = false;
        if (userCfg.player) {
            found = true;
            userCfg.player = null;
        }
        saveUserConfigs();
        if (found) {
            await ephemeralReply(interaction, { content: `Stopped monitoring your player.`, ephemeral: true });
        } else {
            await ephemeralReply(interaction, { content: `You are not currently monitoring any player.`, ephemeral: true });
        }
    } else if (interaction.commandName === 'listplayers') {
        let list;
        if (userCfg.player) {
            if ((config.servers || []).length === 1) {
                list = `**${userCfg.player.name}** on \`${config.servers[0].name}\``;
            } else {
                list = `**${userCfg.player.name}** on all servers`;
            }
        } else {
            list = 'None';
        }
        await ephemeralReply(interaction, {
            content: `Your monitored player: ${list}`,
            ephemeral: true
        });
    } else if (interaction.commandName === 'server-list') {
        const servers = (config.servers || []).map(s => `**${s.name}**`).join('\n') || 'No servers configured.';
        await ephemeralReply(interaction, { content: `Configured servers:\n${servers}`, ephemeral: true });
    } else if (interaction.commandName === 'help') {
        await ephemeralReply(interaction, {
            embeds: [{
                title: 'SpoonAlert Help',
                description: BOT_DESCRIPTION,
                color: 0x00ff99,
                fields: [
                    { name: '/alert-enable', value: 'Enable disconnect notifications.' },
                    { name: '/alert-disable', value: 'Disable disconnect notifications.' },
                    { name: '/alert-status', value: 'Show your current notification and AFK alert status.' },
                    { name: '/alert-persistent', value: 'Toggle persistent detection (auto-enable detection even when offline).' },
                    { name: '/player-add <name>', value: 'Monitor a Minecraft player.' },
                    { name: '/player-remove', value: 'Stop monitoring your player.' },
                    { name: '/server-list', value: 'List all configured Minecraft servers.' },                    { name: '/afk-alert <hours>', value: 'Enable AFK disconnect alert for your player.' },
                    { name: '/afk-enable <minutes>', value: 'Enable AFK detection (1-60 minutes of inactivity).' },
                    { name: '/afk-disable', value: 'Disable AFK detection.' },
                    { name: '/join-enable', value: 'Enable player join notifications.' },
                    { name: '/join-disable', value: 'Disable player join notifications.' },
                    { name: '/help', value: 'Show this help message.' }
                ],
                footer: { text: 'Made for AFK warriors and blocky adventurers!' }
            }],
            ephemeral: true
        });
    } else if (interaction.commandName === 'admin-server-add') {
        // Super admin can always add servers
        if (interaction.user.id !== ENV_ADMIN_USER_ID) {
            // Otherwise, must have admin role
            const member = interaction.guild?.members.cache.get(interaction.user.id);
            const isAdmin = member && member.roles.cache.some(role => ADMIN_ROLE_NAMES.includes(role.name));
            if (!isAdmin) {
                await interaction.reply({ content: 'You do not have permission to add servers.', ephemeral: true });
                return;
            }
        }
        const name = interaction.options.getString('name');
        const url = interaction.options.getString('url');
        // Validate URL is absolute and starts with http:// or https://
        try {
            const parsedUrl = new URL(url);
            if (!/^https?:$/.test(parsedUrl.protocol)) {
                throw new Error();
            }
        } catch {
            await interaction.reply({ content: 'Invalid URL. Please provide a valid absolute URL starting with http:// or https://', ephemeral: true });
            return;
        }
        if (!config.servers) config.servers = [];
        if (config.servers.some(s => s.name === name)) {
            await interaction.reply({ content: `A server with the name **${name}** already exists.`, ephemeral: true });
            return;
        }
        config.servers.push({ name, url });
        // Save to config.json
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
        await ephemeralReply(interaction, { content: `Server **${name}** added with URL: \`${url}\`.`, ephemeral: true });
        return;
    } else if (interaction.commandName === 'admin-server-remove') {
        // Super admin can always remove servers
        if (interaction.user.id !== ENV_ADMIN_USER_ID) {
            // Otherwise, must have admin role
            const member = interaction.guild?.members.cache.get(interaction.user.id);
            const isAdmin = member && member.roles.cache.some(role => ADMIN_ROLE_NAMES.includes(role.name));
            if (!isAdmin) {
                await interaction.reply({ content: 'You do not have permission to remove servers.', ephemeral: true });
                return;
            }
        }
        const name = interaction.options.getString('name');
        if (!config.servers) config.servers = [];
        const idx = config.servers.findIndex(s => s.name === name);
        if (idx === -1) {
            await interaction.reply({ content: `No server found with the name **${name}**.`, ephemeral: true });
            return;
        }
        config.servers.splice(idx, 1);
        // Save to config.json
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
        // Remove any player from userConfigs if their tracked player is now orphaned (i.e., no servers left)
        let affectedUsers = 0;
        for (const userCfg of Object.values(userConfigs)) {
            // If the user is tracking a player, and there are now zero servers, or only one server and it doesn't match
            if (userCfg.player) {
                // If there are no servers left, or only one and it's not the removed one, keep the player.
                // But if the player was only tracked on the removed server (i.e., only one server before), remove it.
                // Actually, since we track on all servers, only remove if there are now zero servers.
                if ((config.servers || []).length === 0) {
                    userCfg.player = null;
                    affectedUsers++;
                }
            }
        }
        saveUserConfigs();
        await ephemeralReply(interaction, { content: `Server **${name}** removed. ${affectedUsers} user(s) had their monitored player removed because there are no servers left.`, ephemeral: true });
        return;
    } else if (interaction.commandName === 'admin-role-add') {
        if (interaction.user.id !== ENV_ADMIN_USER_ID) {
            await interaction.reply({ content: 'Only the super admin can add admin roles.', ephemeral: true });
            return;
        }
        const rolename = interaction.options.getString('rolename');
        if (!ADMIN_ROLE_NAMES.includes(rolename)) {
            ADMIN_ROLE_NAMES.push(rolename);
            await ephemeralReply(interaction, { content: `Role **${rolename}** added to admin list.`, ephemeral: true });
        } else {
            await ephemeralReply(interaction, { content: `Role **${rolename}** is already in the admin list.`, ephemeral: true });
        }
        return;
    } else if (interaction.commandName === 'admin-role-remove') {
        if (interaction.user.id !== ENV_ADMIN_USER_ID) {
            await interaction.reply({ content: 'Only the super admin can remove admin roles.', ephemeral: true });
            return;
        }
        const rolename = interaction.options.getString('rolename');
        const idx = ADMIN_ROLE_NAMES.indexOf(rolename);
        if (idx !== -1) {
            ADMIN_ROLE_NAMES.splice(idx, 1);
            await ephemeralReply(interaction, { content: `Role **${rolename}** removed from admin list.`, ephemeral: true });
        } else {
            await ephemeralReply(interaction, { content: `Role **${rolename}** is not in the admin list.`, ephemeral: true });
        }
        return;
    } else if (interaction.commandName === 'afk-alert') {
        if (!config.servers || config.servers.length === 0) {
            await interaction.reply({ content: 'No servers are configured. Please ask an admin to add a server first.', ephemeral: true });
            return;
        }
        if (!userCfg.player) {
            await interaction.reply({ content: 'You are not monitoring any player. Use `/player-add` first.', ephemeral: true });
            return;
        }
        const player = userCfg.player.name;
        let hours = interaction.options.getInteger('hours');
        if (!hours || hours < 1) hours = 1;
        if (hours > 168) hours = 168;
        if (!afkAlerts[discordUserId]) afkAlerts[discordUserId] = {};
        for (const server of config.servers || []) {
            const key = `${player}|${server.name}`;
            afkAlerts[discordUserId][key] = { expiresAt: Date.now() + hours * 60 * 60 * 1000 };
        }
        saveAfkAlerts(); // Save after setting AFK alerts
        // Ensure detection is enabled when AFK alert is set
        userCfg.detection = true;
        saveUserConfigs();
        log(`User ${interaction.user.tag} (${discordUserId}) set AFK alert for player "${player}" on all servers for ${hours} hour(s).`);
        let msg;
        if ((config.servers || []).length === 1) {
            msg = `AFK alert enabled for **${player}** on \`${config.servers[0].name}\` for ${hours} hour(s). You will be notified if they disconnect within this period.`;
        } else {
            msg = `AFK alert enabled for **${player}** on all servers for ${hours} hour(s). You will be notified if they disconnect within this period.`;
        }
        await ephemeralReply(interaction, { content: msg, ephemeral: true });
    } else if (interaction.commandName === 'bot-status') {
        // Only allow super admin or admin roles
        let isAdmin = false;
        if (interaction.user.id === ENV_ADMIN_USER_ID) {
            isAdmin = true;
        } else if (interaction.guild) {
            const member = interaction.guild.members.cache.get(interaction.user.id);
            isAdmin = member && member.roles.cache.some(role => ADMIN_ROLE_NAMES.includes(role.name));
        }
        if (!isAdmin) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        // Uptime calculation
        const ms = Date.now() - BOT_START_TIME;
        const days = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        const mins = Math.floor((ms % 3600000) / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        const uptimeStr =
            (days ? `${days}d ` : '') +
            (hours ? `${hours}h ` : '') +
            (mins ? `${mins}m ` : '') +
            `${secs}s`;

        // Server list summary
        const serverList = (config.servers || []).map(s => `• ${s.name} (${s.url})`).join('\n') || 'No servers configured.';

        // User stats
        const userCount = Object.keys(userConfigs).length;

        await ephemeralReply(interaction, {
            embeds: [{
                title: 'SpoonAlert Bot Status',
                color: 0x0099ff,
                fields: [
                    { name: 'Version', value: BOT_VERSION, inline: true },
                    { name: 'Uptime', value: uptimeStr, inline: true },
                    { name: 'Total Users', value: String(userCount), inline: true },
                    { name: 'Total Commands Used', value: String(botUsageCount), inline: true },
                    { name: 'Servers Monitored', value: String((config.servers || []).length), inline: true },
                    { name: 'Server List', value: serverList }
                ]
            }],
            ephemeral: true
        });
        return;
    } else if (interaction.commandName === 'join-enable') {
        userCfg.joinNotify = true;
        saveUserConfigs();
        log(`User ${interaction.user.tag} (${discordUserId}) enabled player join notifications.`);
        await ephemeralReply(interaction, { content: 'Player join notifications enabled.', ephemeral: true });
    } else if (interaction.commandName === 'join-disable') {
        userCfg.joinNotify = false;
        saveUserConfigs();
        log(`User ${interaction.user.tag} (${discordUserId}) disabled player join notifications.`);
        await ephemeralReply(interaction, { content: 'Player join notifications disabled.', ephemeral: true });    } else if (interaction.commandName === 'afk-enable') {
        if (!userCfg.player) {
            await interaction.reply({ content: 'You are not monitoring any player. Use `/player-add` first.', ephemeral: true });
            return;
        }
        const minutes = interaction.options.getInteger('minutes');
        if (minutes < 1 || minutes > 60) {
            await interaction.reply({ content: 'AFK threshold must be between 1 and 60 minutes.', ephemeral: true });
            return;
        }
        userCfg.afkDetection = true;
        userCfg.afkThresholdMinutes = minutes;
        saveUserConfigs();
        log(`User ${interaction.user.tag} (${discordUserId}) enabled AFK detection with a threshold of ${minutes} minutes.`);
        await ephemeralReply(interaction, { content: `AFK detection enabled. You will be notified if your player is inactive for ${minutes} minutes.`, ephemeral: true });    } else if (interaction.commandName === 'afk-disable') {
        userCfg.afkDetection = false;
        // Clean up AFK tracking data for this user
        if (afkTracking[discordUserId]) {
            delete afkTracking[discordUserId];
            saveAfkTracking();
        }
        saveUserConfigs();
        log(`User ${interaction.user.tag} (${discordUserId}) disabled AFK detection.`);
        await ephemeralReply(interaction, { content: 'AFK detection disabled and tracking data cleared.', ephemeral: true });
    }

    // Increment usage count for every code except bot-status itself
    if (interaction.commandName !== 'bot-status') {
        botUsageCount++;
    }

    // ...existing code...
});

// Remove global lastServerOnline, use per-user per-player tracking for server status

// Helper to clean up expired AFK alerts
function cleanupAfkAlerts() {
    const now = Date.now();
    let changed = false;
    for (const [uid, alerts] of Object.entries(afkAlerts)) {
        for (const [key, alert] of Object.entries(alerts)) {
            if (alert.expiresAt <= now) {
                delete afkAlerts[uid][key];
                changed = true;
            }
        }
        if (Object.keys(afkAlerts[uid]).length === 0) {
            delete afkAlerts[uid];
            changed = true;
            // Only disable detection if persistentDetection is false
            if (userConfigs[uid] && !userConfigs[uid].persistentDetection) {
                userConfigs[uid].detection = false;
                saveUserConfigs();
                // Notify user that AFK alert expired and detection is now disabled
                sendDm(
                    uid,
                    "Your AFK alert period has expired. Player disconnect detection is now disabled. Use `/afk-alert` or `/alert-enable` to re-enable."
                );
            }
        }
    }
    if (changed) saveAfkAlerts();
}

// Use polling rates from config.json, with fallback defaults
const POLL_ONLINE_MS = (config.pollIntervalOnlineSeconds ?? 30) * 1000;
const POLL_OFFLINE_MS = (config.pollIntervalOfflineSeconds ?? 120) * 1000;

// --- Dynamic polling interval state ---
let pollIntervalHandle = null;
let lastAnyPlayerOnline = null;
let currentPollIntervalMs = null;

// Guards against overlapping ticks. A server that accepts the connection and
// then stalls used to park an await forever while the interval kept starting
// fresh runs on top of it; when the host recovered they all completed at once,
// each reading the same pre-update wasOnline and each firing a duplicate DM.
let pollInProgress = false;

// Helper to start or restart polling with a new interval
function startPolling(intervalMs) {
    if (pollIntervalHandle) clearInterval(pollIntervalHandle);
    currentPollIntervalMs = intervalMs;
    pollIntervalHandle = setInterval(async () => {
        if (pollInProgress) {
            log('Previous poll still running, skipping this tick.');
            return;
        }
        pollInProgress = true;
        try {
            await checkPlayerStatus();
        } catch (err) {
            log('Error in checkPlayerStatus interval:', err);
        } finally {
            pollInProgress = false;
        }
    }, intervalMs);
}

async function checkPlayerStatus() {
    try {
        // Expire timed AFK alerts. This was a complete function with zero call
        // sites, so alerts never expired, the "your AFK alert expired" DM never
        // fired, and one stale entry pinned a user's detection on forever.
        cleanupAfkAlerts();

        let anyPlayerOnline = false;        // Build a map of { serverName: [{discordUserId, playerName}] }
        const serverMap = {};
        for (const [discordUserId, userCfg] of Object.entries(userConfigs)) {
            // Include users who have detection OR join notifications OR AFK detection enabled
            if ((!userCfg.detection && !userCfg.joinNotify && !userCfg.afkDetection) || !userCfg.player) continue;
            const playerName = userCfg.player.name;
            for (const server of config.servers || []) {
                if (!serverMap[server.name]) serverMap[server.name] = [];
                serverMap[server.name].push({ discordUserId, playerName });
            }
        }

        // For each server, fetch players.json once
        for (const [serverName, tracked] of Object.entries(serverMap)) {
            const serverObj = (config.servers || []).find(s => s.name === serverName);
            if (!serverObj) continue;
            let playersArr = [];
            try {
                // node-fetch defaults are timeout: 0 (wait forever) and size: 0
                // (unbounded body) -- both are wrong for an unattended poller.
                const res = await fetch(serverObj.url, { timeout: 10000, size: 512 * 1024 });
                if (!res.ok) {
                    log(`Server ${serverObj.url} is offline or unreachable (HTTP ${res.status}).`);
                    continue;
                }
                const data = await res.json();
                if (Array.isArray(data)) {
                    playersArr = data;
                } else if (Array.isArray(data.players)) {
                    playersArr = data.players;
                } else {
                    console.error('Unexpected players.json structure:', data);
                    continue;
                }
            } catch (err) {
                if (
                    err.code === 'ECONNREFUSED' ||
                    err.code === 'ETIMEDOUT' ||
                    err.code === 'ENOTFOUND' ||
                    err.type === 'system' ||
                    err.type === 'request-timeout' ||
                    err.type === 'max-size' ||
                    (err.message && err.message.includes('Failed to fetch'))
                ) {
                    log(`Server ${serverObj.url} is offline or unreachable.`);
                } else {
                    log(`Error fetching ${serverObj.url}:`, err);
                }
                continue;
            }

            // For each tracked player on this server
            for (const { discordUserId, playerName } of tracked) {
                const userCfg = userConfigs[discordUserId];
                if (!userCfg) continue;
                const key = `${playerName}|${serverName}`;
                const player = playersArr.find(p => p.name === playerName);
                const online = !!player;                // Track if any monitored player is online
                if (online) anyPlayerOnline = true;

                // --- AFK Detection Position Tracking ---
                if (userCfg.afkDetection && online && player) {
                    if (!afkTracking[discordUserId]) afkTracking[discordUserId] = {};
                    
                    const afkKey = `${playerName}|${serverName}`;
                    const currentPos = { x: player.x, y: player.y, z: player.z };
                    const now = Date.now();
                    
                    if (!afkTracking[discordUserId][afkKey]) {
                        // First time tracking this player - initialize position
                        afkTracking[discordUserId][afkKey] = {
                            x: currentPos.x,
                            y: currentPos.y,
                            z: currentPos.z,
                            lastMoved: now,
                            alerted: false
                        };
                        saveAfkTracking();
                    } else {
                        const tracked = afkTracking[discordUserId][afkKey];
                        
                        // Check if position has changed (with small tolerance for floating point)
                        const tolerance = 0.1;
                        const moved = 
                            Math.abs(tracked.x - currentPos.x) > tolerance ||
                            Math.abs(tracked.y - currentPos.y) > tolerance ||
                            Math.abs(tracked.z - currentPos.z) > tolerance;
                        
                        if (moved) {
                            // Player moved - update position, reset timer, and re-arm
                            // the alert so the next idle streak notifies again.
                            tracked.x = currentPos.x;
                            tracked.y = currentPos.y;
                            tracked.z = currentPos.z;
                            tracked.lastMoved = now;
                            tracked.alerted = false;
                            saveAfkTracking();
                        } else {
                            // Player hasn't moved - check if they've been AFK too long.
                            // Threshold is read live so /afk-enable takes effect on a
                            // player who is already standing still.
                            const timeSinceLastMove = now - tracked.lastMoved;
                            const afkThresholdMs = userCfg.afkThresholdMinutes * 60 * 1000;

                            // `alerted` latches until the player actually moves. This
                            // used to reset lastMoved instead, which left the position
                            // unchanged -- so it re-fired every threshold forever (~96
                            // DMs overnight at 5 minutes) and every message after the
                            // first misreported the idle time as one threshold.
                            if (timeSinceLastMove >= afkThresholdMs && !tracked.alerted) {
                                const afkMinutes = Math.floor(timeSinceLastMove / 60000);
                                log(`AFK detection: Player "${playerName}" has been AFK for ${afkMinutes} minutes on server "${serverName}" (user ${discordUserId}). Sending DM.`);
                                await sendDm(
                                    discordUserId,
                                    `🚨 **AFK Alert**: Player **${playerName}** has been inactive for ${afkMinutes} minutes on ${serverName}.\nLast position: X:${Math.round(tracked.x)}, Y:${Math.round(tracked.y)}, Z:${Math.round(tracked.z)}`
                                );
                                tracked.alerted = true;
                                saveAfkTracking();
                            }
                        }
                    }
                } else if (!online && afkTracking[discordUserId]) {
                    // Player went offline - clean up their AFK tracking
                    const afkKey = `${playerName}|${serverName}`;
                    if (afkTracking[discordUserId][afkKey]) {
                        delete afkTracking[discordUserId][afkKey];
                        if (Object.keys(afkTracking[discordUserId]).length === 0) {
                            delete afkTracking[discordUserId];
                        }
                        saveAfkTracking();
                    }
                }

                // --- Player join alert logic ---
                if (userCfg.joinNotify && userCfg.wasOnline && !userCfg.wasOnline[key] && online) {
                    log(`Join alert: Player "${playerName}" joined server "${serverName}" (user ${discordUserId}). Sending DM.`);
                    await sendDm(discordUserId, `Player **${playerName}** has joined the server (${serverName}).`);
                }

                // --- Disconnect alerts ---
                // One message per disconnect. The AFK-alert branch used to fetch the
                // user, log "Sending AFK DM" and then send nothing; users only ever
                // got a DM because the generic branch below has a strictly weaker
                // condition and fired in the same iteration. These are now mutually
                // exclusive, and the AFK branch sends its own message.
                const disconnected = userCfg.detection && userCfg.wasOnline && userCfg.wasOnline[key] && !online;
                const afkAlertActive =
                    afkAlerts[discordUserId] &&
                    afkAlerts[discordUserId][key] &&
                    afkAlerts[discordUserId][key].expiresAt > Date.now();

                if (disconnected && afkAlertActive) {
                    log(`AFK alert: Player "${playerName}" disconnected from server "${serverName}" (user ${discordUserId}). Sending AFK DM.`);
                    await sendDm(
                        discordUserId,
                        `⏰ **AFK Alert**: Player **${playerName}** has disconnected from ${serverName} during your AFK alert window.`
                    );
                    delete afkAlerts[discordUserId][key];
                    if (Object.keys(afkAlerts[discordUserId]).length === 0) {
                        delete afkAlerts[discordUserId];
                    }
                    saveAfkAlerts(); // Save after deleting AFK alert
                } else if (disconnected) {
                    log(`Disconnect alert: Player "${playerName}" disconnected from server "${serverName}" (user ${discordUserId}). Sending DM.`);
                    await sendDm(discordUserId, `Player **${playerName}** has disconnected from the server (${serverName}).`);
                }

                if (player) {
                    if (!userCfg.lastState) userCfg.lastState = {};
                    userCfg.lastState[key] = { online: true, dead: false };
                } else {
                    if (!userCfg.lastState) userCfg.lastState = {};
                    userCfg.lastState[key] = { online: false, dead: false };
                }

                if (!userCfg.wasOnline) userCfg.wasOnline = {};
                userCfg.wasOnline[key] = online;
            }
        }

        // Auto-disable detection if persistentDetection is false and tracked player is offline on all servers (per user)
        for (const [discordUserId, userCfg] of Object.entries(userConfigs)) {
            if (
                !userCfg.persistentDetection &&
                userCfg.detection &&
                userCfg.player
            ) {
                // Only auto-disable if there are NO active AFK alerts for this user
                // Must check expiry, not just presence -- counting keys meant a
                // single stale entry pinned this user's detection on forever.
                const hasActiveAfk = Object.values(afkAlerts[discordUserId] || {})
                    .some(alert => alert.expiresAt > Date.now());
                if (hasActiveAfk) continue;

                const playerName = userCfg.player.name;
                let anyOnline = false;
                for (const server of config.servers || []) {
                    const key = `${playerName}|${server.name}`;
                    if (userCfg.wasOnline && userCfg.wasOnline[key]) {
                        anyOnline = true;
                        break;
                    }
                }
                if (!anyOnline) {
                    userCfg.detection = false;
                    saveUserConfigs();
                    // No notification sent to user
                }
            }
        }

        // --- Dynamic polling interval logic ---
        let desiredInterval = anyPlayerOnline ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
        if (lastAnyPlayerOnline === null || lastAnyPlayerOnline !== anyPlayerOnline) {
            if (currentPollIntervalMs !== desiredInterval) {
                startPolling(desiredInterval);
                log(`Polling interval set to ${desiredInterval / 1000} seconds (${anyPlayerOnline ? 'players online' : 'no players online'})`);
            }
            lastAnyPlayerOnline = anyPlayerOnline;
        }
    } catch (err) {
        log('Uncaught error in checkPlayerStatus:', err);
    }
}

client.login(discordToken).catch(err => {
    console.error('[SpoonAlert] Failed to log in to Discord:', err.message || err);
    process.exit(1);
});

// Add this helper function near the top, after config is loaded
function log(...args) {
    if (config.loggingEnabled) {
        console.log('[SpoonAlert]', ...args);
    }
}
