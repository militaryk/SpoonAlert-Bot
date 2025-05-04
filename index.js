require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, InteractionType } = require('discord.js');
const fetch = require('node-fetch');
const config = require('./config.json');
const fs = require('fs');
const path = require('path');

const discordToken = process.env.DISCORD_TOKEN;
const alertChannelId = "1368463031339843615";
let wasOnline = false;
let detectionEnabled = true; // Default: enabled
let deathNotifyEnabled = true; // Default: enabled
let lastPlayerState = null;

// Persistent storage for tracked players using a JSON file
const USER_CONFIGS_PATH = path.join(__dirname, 'userConfigs.json');

// Track users and their players: { [discordUserId]: { players: Set<string>, deathNotify: boolean, detection: boolean, wasOnline: { [player]: bool }, lastState: { [player]: { online, dead } } } }
let userConfigs = {};

// Load userConfigs from disk
function loadUserConfigs() {
    try {
        if (fs.existsSync(USER_CONFIGS_PATH)) {
            const raw = fs.readFileSync(USER_CONFIGS_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            // Convert players array to Set for each user
            for (const [uid, cfg] of Object.entries(parsed)) {
                cfg.players = new Set(cfg.players);
            }
            userConfigs = parsed;
        }
    } catch (e) {
        console.error('Failed to load userConfigs:', e);
        userConfigs = {};
    }
}

// Save userConfigs to disk
function saveUserConfigs() {
    try {
        // Convert Sets to arrays for serialization
        const serializable = {};
        for (const [uid, cfg] of Object.entries(userConfigs)) {
            serializable[uid] = {
                ...cfg,
                players: Array.from(cfg.players)
            };
        }
        fs.writeFileSync(USER_CONFIGS_PATH, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save userConfigs:', e);
    }
}

// Load configs at startup
loadUserConfigs();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: ['CHANNEL'] });

// Bot description (for Discord application page)
const BOT_DESCRIPTION = `SpoonAlert watches Minecraft players on your server and sends you a DM when they disconnect or die. 
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

// Register slash commands
const commands = [
    new SlashCommandBuilder().setName('enablealert').setDescription('Enable player disconnect detection'),
    new SlashCommandBuilder().setName('disablealert').setDescription('Disable player disconnect detection'),
    new SlashCommandBuilder().setName('statusalert').setDescription('Show detection status'),
    new SlashCommandBuilder().setName('toggledeathalert').setDescription('Toggle player death notifications'),
    new SlashCommandBuilder()
        .setName('addplayer')
        .setDescription('Add a player to monitor')
        .addStringOption(opt => opt.setName('player').setDescription('Minecraft player name').setRequired(true)),
    new SlashCommandBuilder()
        .setName('removeplayer')
        .setDescription('Remove a player from monitoring')
        .addStringOption(opt => opt.setName('player').setDescription('Minecraft player name').setRequired(true)),
    new SlashCommandBuilder()
        .setName('listplayers')
        .setDescription('List your monitored players'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show help for SpoonAlert bot')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
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

    // Register commands for the guilds the bot is in
    const rest = new REST({ version: '10' }).setToken(discordToken);
    const guilds = client.guilds.cache.map(guild => guild.id);
    for (const guildId of guilds) {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guildId),
            { body: commands }
        );
    }
    setInterval(checkPlayerStatus, config.pollIntervalSeconds * 1000);
    checkPlayerStatus();
});

client.on('interactionCreate', async interaction => {
    if (
        interaction.type !== InteractionType.ApplicationCommand ||
        interaction.channelId !== alertChannelId
    ) return;

    const discordUserId = interaction.user.id;
    if (!userConfigs[discordUserId]) {
        userConfigs[discordUserId] = {
            players: new Set(),
            deathNotify: true,
            detection: true,
            wasOnline: {},
            lastState: {}
        };
        saveUserConfigs();
    }
    const userCfg = userConfigs[discordUserId];

    if (interaction.commandName === 'enablealert') {
        userCfg.detection = true;
        saveUserConfigs();
        await interaction.reply({ content: 'Player disconnect detection enabled.', ephemeral: true });
    } else if (interaction.commandName === 'disablealert') {
        userCfg.detection = false;
        saveUserConfigs();
        await interaction.reply({ content: 'Player disconnect detection disabled.', ephemeral: true });
    } else if (interaction.commandName === 'statusalert') {
        await interaction.reply({
            content: `Player disconnect detection is currently **${userCfg.detection ? 'enabled' : 'disabled'}**.\nPlayer death notifications are **${userCfg.deathNotify ? 'enabled' : 'disabled'}**.\nMonitored players: ${[...userCfg.players].join(', ') || 'None'}`,
            ephemeral: true
        });
    } else if (interaction.commandName === 'toggledeathalert') {
        userCfg.deathNotify = !userCfg.deathNotify;
        saveUserConfigs();
        await interaction.reply({
            content: `Player death notifications are now **${userCfg.deathNotify ? 'enabled' : 'disabled'}**.`,
            ephemeral: true
        });
    } else if (interaction.commandName === 'addplayer') {
        const player = interaction.options.getString('player');
        userCfg.players.add(player);
        saveUserConfigs();
        await interaction.reply({ content: `Added player **${player}** to your monitored list.`, ephemeral: true });
    } else if (interaction.commandName === 'removeplayer') {
        const player = interaction.options.getString('player');
        if (userCfg.players.delete(player)) {
            saveUserConfigs();
            await interaction.reply({ content: `Removed player **${player}** from your monitored list.`, ephemeral: true });
        } else {
            await interaction.reply({ content: `Player **${player}** was not in your monitored list.`, ephemeral: true });
        }
    } else if (interaction.commandName === 'listplayers') {
        await interaction.reply({
            content: `Your monitored players: ${[...userCfg.players].join(', ') || 'None'}`,
            ephemeral: true
        });
    } else if (interaction.commandName === 'help') {
        await interaction.reply({
            embeds: [{
                title: 'SpoonAlert Help',
                description: BOT_DESCRIPTION,
                color: 0x00ff99,
                fields: [
                    { name: '/addplayer <name>', value: 'Add a Minecraft player to your watchlist.' },
                    { name: '/removeplayer <name>', value: 'Remove a player from your watchlist.' },
                    { name: '/listplayers', value: 'List all players you are monitoring.' },
                    { name: '/enablealert', value: 'Enable disconnect notifications.' },
                    { name: '/disablealert', value: 'Disable disconnect notifications.' },
                    { name: '/toggledeathalert', value: 'Toggle death notifications.' },
                    { name: '/statusalert', value: 'Show your current notification settings.' },
                    { name: '/help', value: 'Show this help message.' }
                ],
                footer: { text: 'Made for AFK warriors and blocky adventurers!' }
            }],
            ephemeral: true
        });
    }
});

// Remove global lastServerOnline, use per-user per-player tracking for server status

async function checkPlayerStatus() {
    try {
        const res = await fetch(config.playersJsonUrl);
        if (!res.ok) throw new Error('Failed to fetch players.json');
        const data = await res.json();

        let playersArr = [];
        if (Array.isArray(data)) {
            playersArr = data;
        } else if (Array.isArray(data.players)) {
            playersArr = data.players;
        } else {
            console.error('Unexpected players.json structure:', data);
            return;
        }

        // For each user, check their players
        for (const [discordUserId, userCfg] of Object.entries(userConfigs)) {
            if (!userCfg.detection || userCfg.players.size === 0) continue;
            for (const playerName of userCfg.players) {
                const player = playersArr.find(p => p.name === playerName);
                const online = !!player;

                // Only notify about server status if the player was online and now is not (disconnected)
                if (userCfg.wasOnline[playerName] && !online) {
                    const user = await client.users.fetch(discordUserId);
                    if (user) {
                        user.send(`Player **${playerName}** has disconnected from the server.`);
                    }
                }

                // Detect death
                if (player) {
                    let isDead = false;
                    if ('dead' in player) {
                        isDead = !!player.dead;
                    } else if ('health' in player) {
                        isDead = player.health <= 0;
                    }
                    if (
                        userCfg.deathNotify &&
                        userCfg.lastState[playerName] &&
                        userCfg.lastState[playerName].online &&
                        !userCfg.lastState[playerName].dead &&
                        isDead
                    ) {
                        const user = await client.users.fetch(discordUserId);
                        if (user) {
                            user.send(`Player **${playerName}** has died.`);
                        }
                    }
                    userCfg.lastState[playerName] = { online: true, dead: isDead };
                } else {
                    userCfg.lastState[playerName] = { online: false, dead: false };
                }

                userCfg.wasOnline[playerName] = online;
            }
        }
    } catch (err) {
        // Do not notify about server status unless a tracked player was online and now is not
        console.error('Error checking player status:', err);
    }
}

client.login(discordToken);
