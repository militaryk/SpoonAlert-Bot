'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { ephemeralReply } = require('../ui/reply');

// Shown on the Discord application page and in /help. Death notifications were
// advertised here for a year without ever existing -- `dead` is hardcoded
// false in the poller and nothing ever reads it.
const BOT_DESCRIPTION = `SpoonAlert watches Minecraft players on your server and sends you a DM when they join, disconnect, or go AFK.
Everything lives in one dashboard: run \`/spoon\` and use the buttons.
Perfect for AFK warriors and forgetful adventurers!`;

const HELP_FIELDS = [
    {
        name: '/spoon',
        value:
            'Your dashboard. Set the player you want to watch, then toggle alerts from the buttons:\n' +
            '• **Leave alerts** — DM when your player leaves the server\n' +
            '• **AFK-only** — narrow those down to leaves that happened while they were ' +
            'standing still, so logging off on purpose stays quiet\n' +
            '• **Join alerts** — DM when they come online\n' +
            '• **Persistent** — keep leave alerts on even while your player is offline\n' +
            '• **AFK timer** — watch for a leave over a set number of hours\n' +
            '• **Idle time** — how long standing still counts as AFK\n\n' +
            'You are never DMed just for going AFK.'
    },
    { name: '/help', value: 'Show this message.' },
    {
        name: 'Admin',
        value:
            '`/admin-server-add`, `/admin-server-remove`, `/admin-role-add`, ' +
            '`/admin-role-remove`, `/bot-status`'
    }
];

module.exports = [
    {
        data: new SlashCommandBuilder().setName('help').setDescription('Show help for SpoonAlert bot'),
        // Reads nothing and changes nothing, so it must not mint a stored
        // record (and a full-file write) for a passer-by.
        readOnly: true,
        async execute(interaction) {
            await ephemeralReply(interaction, {
                embeds: [
                    {
                        title: 'SpoonAlert Help',
                        description: BOT_DESCRIPTION,
                        color: 0x00ff99,
                        fields: HELP_FIELDS,
                        footer: { text: 'Made for AFK warriors and blocky adventurers!' }
                    }
                ]
            });
        }
    }
];
