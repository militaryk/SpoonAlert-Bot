'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { servers, log } = require('../config');
const { store, saveUserConfigs, saveAfkAlerts, saveAfkTracking } = require('../store');
const actions = require('../actions');
const { ephemeralReply } = require('../ui/reply');

module.exports = [
    {
        data: new SlashCommandBuilder()
            .setName('afk-enable')
            .setDescription('Enable AFK detection for your monitored player')
            .addIntegerOption(opt =>
                opt
                    .setName('minutes')
                    .setDescription('Minutes of inactivity before being marked as AFK (1-60)')
                    .setRequired(true)
            ),
        async execute(interaction, { userCfg, userId }) {
            if (!userCfg.player) {
                await ephemeralReply(
                    interaction,
                    'You are not monitoring any player. Use `/player-add` first.'
                );
                return;
            }

            const minutes = interaction.options.getInteger('minutes');
            if (!actions.isValidAfkThreshold(minutes)) {
                await ephemeralReply(
                    interaction,
                    `AFK threshold must be between ${actions.MIN_AFK_THRESHOLD_MINUTES} and ${actions.MAX_AFK_THRESHOLD_MINUTES} minutes.`
                );
                return;
            }

            actions.setAfkDetection(userCfg, true, minutes);
            saveUserConfigs();
            log(
                `User ${interaction.user.tag} (${userId}) enabled AFK detection with a threshold of ${minutes} minutes.`
            );
            await ephemeralReply(
                interaction,
                `AFK detection enabled. You will be notified if your player is inactive for ${minutes} minutes.`
            );
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('afk-disable')
            .setDescription('Disable AFK detection for your monitored player'),
        async execute(interaction, { userCfg, userId }) {
            actions.setAfkDetection(userCfg, false);
            if (actions.clearAfkTracking(store.afkTracking, userId)) {
                saveAfkTracking();
            }
            saveUserConfigs();
            log(`User ${interaction.user.tag} (${userId}) disabled AFK detection.`);
            await ephemeralReply(interaction, 'AFK detection disabled and tracking data cleared.');
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('afk-alert')
            .setDescription(
                'Enable AFK disconnect alert for your monitored player for a set number of hours (up to 168)'
            )
            .addIntegerOption(opt =>
                opt.setName('hours').setDescription('Number of hours to track (1-168)').setRequired(true)
            ),
        async execute(interaction, { userCfg, userId }) {
            const serverList = servers();
            if (serverList.length === 0) {
                await ephemeralReply(
                    interaction,
                    'No servers are configured. Please ask an admin to add a server first.'
                );
                return;
            }
            if (!userCfg.player) {
                await ephemeralReply(
                    interaction,
                    'You are not monitoring any player. Use `/player-add` first.'
                );
                return;
            }

            const player = userCfg.player.name;
            const hours = actions.clampAlertHours(interaction.options.getInteger('hours'));

            actions.setAfkAlert(
                store.afkAlerts,
                userId,
                player,
                serverList.map(s => s.name),
                hours
            );
            saveAfkAlerts();

            // An AFK alert is pointless without detection running.
            actions.setDetection(userCfg, true);
            saveUserConfigs();

            log(
                `User ${interaction.user.tag} (${userId}) set AFK alert for player "${player}" on all servers for ${hours} hour(s).`
            );
            const where = serverList.length === 1 ? `\`${serverList[0].name}\`` : 'all servers';
            await ephemeralReply(
                interaction,
                `AFK alert enabled for **${player}** on ${where} for ${hours} hour(s). You will be notified if they disconnect within this period.`
            );
        }
    }
];
