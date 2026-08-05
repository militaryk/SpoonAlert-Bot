'use strict';

const { REST, Routes, InteractionType } = require('discord.js');

const { discordToken, log, logError, POLL_ONLINE_MS } = require('./src/config');
const { loadAll, getUserConfig } = require('./src/store');
const { client } = require('./src/discord/client');
const { startPresenceRotation } = require('./src/discord/presence');
const { checkPlayerStatus, startPolling } = require('./src/poller');
const commands = require('./src/commands');
const { recordUsage } = require('./src/stats');
const { ephemeralReply } = require('./src/ui/reply');

// Backstop for anything that still escapes a handler. console.error directly,
// not log(), so it is never hidden by loggingEnabled being false.
process.on('unhandledRejection', err => {
    logError('Unhandled promise rejection:', err);
});

loadAll();

client.once('ready', async () => {
    log(`Logged in as ${client.user.tag}`);
    startPresenceRotation(client);

    // Start polling first. Command registration below can fail (a guild joined
    // without the applications.commands scope returns 403), and it used to
    // throw out of this listener before polling was ever started -- stale
    // commands are survivable, no monitoring at all is not.
    startPolling(POLL_ONLINE_MS);

    const rest = new REST({ version: '10' }).setToken(discordToken);
    const body = commands.toJSON();
    for (const guildId of client.guilds.cache.map(guild => guild.id)) {
        try {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
        } catch (err) {
            log(`Failed to register commands for guild ${guildId}:`, err.message || err);
        }
    }

    try {
        await checkPlayerStatus();
    } catch (err) {
        log('Error in initial checkPlayerStatus:', err);
    }
});

/** Last-resort reply so a thrown handler never leaves the user hanging. */
async function replyWithError(interaction) {
    const content = 'Something went wrong running that command. Please try again.';
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content, flags: 64 });
        } else {
            await ephemeralReply(interaction, content);
        }
    } catch {
        // The interaction is already dead (3s timeout, or already answered).
        // Nothing more we can do, and throwing here would be worse.
    }
}

client.on('interactionCreate', async interaction => {
    if (interaction.type !== InteractionType.ApplicationCommand) return;

    const command = commands.get(interaction.commandName);
    if (!command) {
        // The old chain had no terminal else, so an unregistered command was
        // simply never answered -- the user saw "The application did not respond".
        log(`Unknown command received: ${interaction.commandName}`);
        await ephemeralReply(interaction, 'Unknown command. Try `/help`.');
        return;
    }

    const userId = interaction.user.id;
    const userCfg = getUserConfig(userId);

    // Counted before dispatch so commands that return early are counted too.
    if (interaction.commandName !== 'bot-status') {
        recordUsage();
    }

    try {
        await command.execute(interaction, { userCfg, userId });
    } catch (err) {
        logError(`Error handling /${interaction.commandName}:`, err);
        await replyWithError(interaction);
    }
});

client.login(discordToken).catch(err => {
    logError('Failed to log in to Discord:', err.message || err);
    process.exit(1);
});
