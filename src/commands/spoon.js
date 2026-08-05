'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const { store } = require('../store');
const { isAdmin } = require('../permissions');
const { renderPanel } = require('../ui/panel');

module.exports = [
    {
        data: new SlashCommandBuilder().setName('spoon').setDescription('Open your SpoonAlert dashboard'),
        async execute(interaction, { userCfg, userId }) {
            // Ephemeral, so only the person who ran it can see or click it --
            // which is also why no button needs an ownership check.
            await interaction.reply({
                ...renderPanel(userCfg, store.afkAlerts[userId], { isAdmin: isAdmin(interaction) }),
                flags: MessageFlags.Ephemeral
            });
        }
    }
];
