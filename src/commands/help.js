'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { ephemeralReply } = require('../ui/reply');

// Shown on the Discord application page and in /help. Death notifications were
// advertised here for a year without ever existing -- `dead` is hardcoded
// false in the poller and nothing ever reads it.
const BOT_DESCRIPTION = `SpoonAlert watches Minecraft players on your server and sends you a DM when they join, disconnect, or go AFK.
Add or remove players to your watchlist, toggle notifications, and get status updates with slash commands.
Perfect for AFK warriors and forgetful adventurers!`;

const HELP_FIELDS = [
    { name: '/alert-enable', value: 'Enable disconnect notifications.' },
    { name: '/alert-disable', value: 'Disable disconnect notifications.' },
    { name: '/alert-status', value: 'Show your current notification and AFK alert status.' },
    {
        name: '/alert-persistent',
        value: 'Toggle persistent detection (auto-enable detection even when offline).'
    },
    { name: '/player-add <name>', value: 'Monitor a Minecraft player.' },
    { name: '/player-remove', value: 'Stop monitoring your player.' },
    { name: '/server-list', value: 'List all configured Minecraft servers.' },
    { name: '/afk-alert <hours>', value: 'Enable AFK disconnect alert for your player.' },
    { name: '/afk-enable <minutes>', value: 'Enable AFK detection (1-60 minutes of inactivity).' },
    { name: '/afk-disable', value: 'Disable AFK detection.' },
    { name: '/join-enable', value: 'Enable player join notifications.' },
    { name: '/join-disable', value: 'Disable player join notifications.' },
    { name: '/help', value: 'Show this help message.' }
];

module.exports = [
    {
        data: new SlashCommandBuilder().setName('help').setDescription('Show help for SpoonAlert bot'),
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
