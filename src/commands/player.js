'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { servers } = require('../config');
const { saveUserConfigs } = require('../store');
const actions = require('../actions');
const { ephemeralReply } = require('../ui/reply');

module.exports = [
    {
        data: new SlashCommandBuilder()
            .setName('player-add')
            .setDescription('Monitor a Minecraft player')
            .addStringOption(opt =>
                opt.setName('player').setDescription('Minecraft player name').setRequired(true)
            ),
        async execute(interaction, { userCfg }) {
            const serverList = servers();
            if (serverList.length === 0) {
                await ephemeralReply(
                    interaction,
                    'No servers are configured. Please ask an admin to add a server first.'
                );
                return;
            }
            if (userCfg.player && userCfg.player.name) {
                await ephemeralReply(
                    interaction,
                    'You are already monitoring a player. Use `/player-remove` before adding a new one.'
                );
                return;
            }

            const player = interaction.options.getString('player');
            actions.setPlayer(userCfg, player);
            saveUserConfigs();

            const where = serverList.length === 1 ? `\`${serverList[0].name}\`` : 'all servers';
            await ephemeralReply(interaction, `Now monitoring player **${player}** on ${where}.`);
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('player-remove')
            .setDescription('Stop monitoring your player'),
        async execute(interaction, { userCfg }) {
            const found = actions.clearPlayer(userCfg);
            saveUserConfigs();
            await ephemeralReply(
                interaction,
                found ? 'Stopped monitoring your player.' : 'You are not currently monitoring any player.'
            );
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('server-list')
            .setDescription('List all configured Minecraft servers'),
        async execute(interaction) {
            const list = servers()
                .map(s => `**${s.name}**`)
                .join('\n');
            await ephemeralReply(interaction, `Configured servers:\n${list || 'No servers configured.'}`);
        }
    }
];
