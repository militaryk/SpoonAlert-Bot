'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { log } = require('../config');
const { store, saveUserConfigs, saveAfkAlerts } = require('../store');
const actions = require('../actions');
const { ephemeralReply, formatMonitoredPlayer, formatAfkAlerts } = require('../ui/reply');

module.exports = [
    {
        data: new SlashCommandBuilder()
            .setName('alert-enable')
            .setDescription('Enable player disconnect detection'),
        async execute(interaction, { userCfg, userId }) {
            actions.setDetection(userCfg, true);
            saveUserConfigs();
            log(`User ${interaction.user.tag} (${userId}) enabled disconnect detection.`);
            await ephemeralReply(interaction, 'Player disconnect detection enabled.');
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('alert-disable')
            .setDescription('Disable player disconnect detection'),
        async execute(interaction, { userCfg, userId }) {
            actions.setDetection(userCfg, false);
            if (actions.clearAfkAlerts(store.afkAlerts, userId)) {
                saveAfkAlerts();
            }
            saveUserConfigs();
            log(
                `User ${interaction.user.tag} (${userId}) disabled disconnect detection and cleared AFK alerts.`
            );
            await ephemeralReply(
                interaction,
                'Player disconnect detection disabled and all AFK alerts cleared.'
            );
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('alert-persistent')
            .setDescription('Toggle persistent detection (auto-enable detection even when offline)'),
        async execute(interaction, { userCfg }) {
            const enabled = actions.togglePersistent(userCfg);
            saveUserConfigs();
            await ephemeralReply(
                interaction,
                `Persistent detection is now **${enabled ? 'enabled' : 'disabled'}**.\n` +
                    (enabled
                        ? 'Detection will remain enabled even if you disconnect.'
                        : 'Detection will auto-disable when you disconnect.')
            );
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('alert-status')
            .setDescription('Show your alert and AFK status'),
        async execute(interaction, { userCfg, userId }) {
            await ephemeralReply(
                interaction,
                `Player disconnect detection is currently **${userCfg.detection ? 'enabled' : 'disabled'}**.\n` +
                    `Persistent detection is **${userCfg.persistentDetection ? 'enabled' : 'disabled'}**.\n` +
                    `Player join notifications are **${userCfg.joinNotify ? 'enabled' : 'disabled'}**.\n` +
                    `AFK detection is **${userCfg.afkDetection ? `enabled (${userCfg.afkThresholdMinutes} minutes)` : 'disabled'}**.\n` +
                    `Monitored player: ${formatMonitoredPlayer(userCfg)}` +
                    formatAfkAlerts(store.afkAlerts[userId])
            );
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('join-enable')
            .setDescription('Enable player join notifications'),
        async execute(interaction, { userCfg, userId }) {
            actions.setJoinNotify(userCfg, true);
            saveUserConfigs();
            log(`User ${interaction.user.tag} (${userId}) enabled player join notifications.`);
            await ephemeralReply(interaction, 'Player join notifications enabled.');
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('join-disable')
            .setDescription('Disable player join notifications'),
        async execute(interaction, { userCfg, userId }) {
            actions.setJoinNotify(userCfg, false);
            saveUserConfigs();
            log(`User ${interaction.user.tag} (${userId}) disabled player join notifications.`);
            await ephemeralReply(interaction, 'Player join notifications disabled.');
        }
    }
];
