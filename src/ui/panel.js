'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const { servers } = require('../config');
const { formatTimeLeft } = require('../lib/time');
const { TOGGLE, VIEW, ACTION, SELECT, MODAL } = require('./ids');

const COLOR_ON = 0x00ff99;
const COLOR_OFF = 0x747f8d;

// Fixed choices beat a free-text modal here: fewer failure modes, one less
// click, and nothing to validate.
const AFK_HOUR_CHOICES = [1, 2, 4, 8, 12, 24, 48, 168];
const AFK_THRESHOLD_CHOICES = [1, 5, 10, 15, 30, 60];

function onOff(value) {
    return value ? 'On' : 'Off';
}

function toggleButton(customId, label, enabled, disabled = false) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(`${label}: ${onOff(enabled)}`)
        .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(disabled);
}

/** "3h 20m left" across however many servers, or null when nothing is armed. */
function afkAlertSummary(userAlerts, now = Date.now()) {
    const live = Object.values(userAlerts || {}).filter(a => a.expiresAt > now);
    if (live.length === 0) return null;
    const soonest = Math.min(...live.map(a => a.expiresAt));
    const where = live.length === 1 ? '1 server' : `${live.length} servers`;
    return `${formatTimeLeft(soonest - now)} (${where})`;
}

function describePlayer(userCfg) {
    if (!userCfg.player) return '_none set_';
    const list = servers();
    if (list.length === 1) return `**${userCfg.player.name}** on \`${list[0].name}\``;
    return `**${userCfg.player.name}** on all servers`;
}

/**
 * The dashboard. Rendered fresh from the store on every interaction rather
 * than held in memory: an ephemeral message cannot be pushed to by the bot, so
 * the panel is strictly pull-based and always reflects current state.
 */
function renderPanel(userCfg, userAlerts, { isAdmin = false } = {}) {
    const hasPlayer = Boolean(userCfg.player);
    const alertSummary = afkAlertSummary(userAlerts);

    // The two disconnect toggles interact, so state them as one sentence
    // rather than as two booleans the reader has to combine themselves.
    let disconnectRule;
    if (userCfg.afkDetection) {
        disconnectRule = `Only if AFK ${userCfg.afkThresholdMinutes}+ min`;
    } else if (userCfg.detection) {
        disconnectRule = 'Any disconnect';
    } else {
        disconnectRule = 'Off';
    }

    const fields = [
        { name: 'Monitored player', value: describePlayer(userCfg) },
        { name: 'Tell me when they leave', value: disconnectRule, inline: true },
        { name: 'Join alerts', value: onOff(userCfg.joinNotify), inline: true },
        { name: 'Persistent', value: onOff(userCfg.persistentDetection), inline: true }
    ];

    if (alertSummary) {
        fields.push({ name: 'AFK alert', value: alertSummary, inline: true });
    }

    const embed = {
        title: 'SpoonAlert',
        description: hasPlayer
            ? 'Use the buttons below to change what you get notified about.'
            : '**Start by setting the Minecraft player you want to watch.**',
        color: hasPlayer && userCfg.detection ? COLOR_ON : COLOR_OFF,
        fields,
        footer: { text: 'Only you can see this panel.' }
    };

    // Toggles are pointless without a player to apply them to, so they stay
    // disabled until one is set.
    const toggles = new ActionRowBuilder().addComponents(
        toggleButton(TOGGLE.DETECTION, 'Leave alerts', userCfg.detection, !hasPlayer),
        // Renamed from "AFK detect", which implied a notification when the
        // player goes idle. It does the opposite: it filters leave alerts down
        // to the ones that happened while they were standing still.
        toggleButton(TOGGLE.AFK, 'AFK-only', userCfg.afkDetection, !hasPlayer),
        toggleButton(TOGGLE.JOIN, 'Join alerts', userCfg.joinNotify, !hasPlayer),
        toggleButton(TOGGLE.PERSIST, 'Persistent', userCfg.persistentDetection, !hasPlayer)
    );

    const playerRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(ACTION.SET_PLAYER)
            .setLabel(hasPlayer ? 'Change player' : 'Set player')
            .setStyle(hasPlayer ? ButtonStyle.Secondary : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(ACTION.STOP_PLAYER)
            .setLabel('Stop monitoring')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!hasPlayer),
        new ButtonBuilder()
            .setCustomId(VIEW.AFK_TIMER)
            .setLabel(alertSummary ? 'AFK timer (active)' : 'AFK timer')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPlayer),
        new ButtonBuilder()
            .setCustomId(VIEW.AFK_THRESHOLD)
            .setLabel('Idle time')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPlayer)
    );

    const navButtons = [
        new ButtonBuilder().setCustomId(ACTION.REFRESH).setLabel('Refresh').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(VIEW.SERVERS).setLabel('Servers').setStyle(ButtonStyle.Secondary)
    ];
    if (isAdmin) {
        navButtons.push(
            new ButtonBuilder().setCustomId(VIEW.ADMIN).setLabel('Admin').setStyle(ButtonStyle.Secondary)
        );
    }
    const nav = new ActionRowBuilder().addComponents(...navButtons);

    return { embeds: [embed], components: [toggles, playerRow, nav] };
}

function backRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(VIEW.MAIN).setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
}

/** Pick how long a timed AFK disconnect alert should run for. */
function renderAfkTimer(userCfg, userAlerts) {
    const summary = afkAlertSummary(userAlerts);
    const options = AFK_HOUR_CHOICES.map(h => ({
        label: h === 168 ? '1 week' : `${h} hour${h === 1 ? '' : 's'}`,
        value: String(h)
    }));
    if (summary) {
        options.push({ label: 'Cancel the active alert', value: 'cancel' });
    }

    const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(SELECT.AFK_HOURS)
            .setPlaceholder(summary ? `Currently ${summary}` : 'Choose how long to watch for')
            .addOptions(options)
    );

    return {
        embeds: [
            {
                title: 'AFK timer',
                description:
                    `Get a DM if **${userCfg.player ? userCfg.player.name : 'your player'}** disconnects ` +
                    'within the chosen window. Disconnect alerts are switched on automatically while it runs.' +
                    (summary ? `\n\nActive: **${summary}**` : ''),
                color: COLOR_OFF
            }
        ],
        components: [select, backRow()]
    };
}

/** Pick how long a player must stand still before counting as AFK. */
function renderAfkThreshold(userCfg) {
    const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(SELECT.AFK_THRESHOLD)
            .setPlaceholder(`Currently ${userCfg.afkThresholdMinutes} minutes`)
            .addOptions(
                AFK_THRESHOLD_CHOICES.map(m => ({
                    label: `${m} minute${m === 1 ? '' : 's'}`,
                    value: String(m)
                }))
            )
    );

    return {
        embeds: [
            {
                title: 'Idle time',
                description:
                    'How long your player must stand still before they count as AFK.\n' +
                    'Choosing a value also switches **AFK-only** on.\n\n' +
                    'You are never messaged for going AFK — this only decides which ' +
                    'disconnects are worth telling you about.',
                color: COLOR_OFF
            }
        ],
        components: [select, backRow()]
    };
}

function renderServers() {
    const list = servers();
    return {
        embeds: [
            {
                title: 'Configured servers',
                description: list.length
                    ? list.map(s => `• ${s.name}`).join('\n')
                    : 'No servers configured. Ask an admin to add one.',
                color: COLOR_OFF
            }
        ],
        components: [backRow()]
    };
}

function renderAdmin() {
    return {
        embeds: [
            {
                title: 'Admin commands',
                description:
                    'These stay as slash commands so they are auditable and hard to hit by accident:\n\n' +
                    '`/admin-server-add` — add a Squaremap server\n' +
                    '`/admin-server-remove` — remove a server\n' +
                    '`/admin-role-add` — grant a role admin access\n' +
                    '`/admin-role-remove` — revoke it\n' +
                    '`/bot-status` — version, uptime and usage',
                color: COLOR_OFF
            }
        ],
        components: [backRow()]
    };
}

/** Free text is unavoidable for a username, so this one is a modal. */
function buildPlayerModal(currentName) {
    const input = new TextInputBuilder()
        .setCustomId(MODAL.PLAYER_INPUT)
        .setLabel('Minecraft username')
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(16)
        .setRequired(true)
        .setPlaceholder('e.g. Steve');
    if (currentName) input.setValue(currentName);

    return new ModalBuilder()
        .setCustomId(MODAL.PLAYER)
        .setTitle('Which player should I watch?')
        .addComponents(new ActionRowBuilder().addComponents(input));
}

module.exports = {
    AFK_HOUR_CHOICES,
    AFK_THRESHOLD_CHOICES,
    afkAlertSummary,
    renderPanel,
    renderAfkTimer,
    renderAfkThreshold,
    renderServers,
    renderAdmin,
    buildPlayerModal
};
