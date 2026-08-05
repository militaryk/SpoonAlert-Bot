'use strict';

const { MessageFlags } = require('discord.js');

const { servers } = require('../config');
const { formatTimeLeft } = require('../lib/time');

/**
 * Reply privately to the user who ran the command.
 *
 * The old helper mutated the caller's options object and used the magic number
 * 64, and 14 call sites bypassed it entirely by passing `ephemeral: true`
 * straight to interaction.reply() -- which is deprecated on discord.js 14.19.
 */
function ephemeralReply(interaction, options) {
    const opts = typeof options === 'string' ? { content: options } : { ...options };
    delete opts.ephemeral;
    return interaction.reply({ ...opts, flags: MessageFlags.Ephemeral });
}

/**
 * "**Steve** on `SurvivalSMP`" / "**Steve** on all servers" / "None".
 * Was copy-pasted in four places, which is how /afk-alert ended up telling
 * people to run a command that does not exist.
 */
function formatMonitoredPlayer(userCfg) {
    if (!userCfg.player) return 'None';
    const list = servers();
    if (list.length === 1) {
        return `**${userCfg.player.name}** on \`${list[0].name}\``;
    }
    return `**${userCfg.player.name}** on all servers`;
}

/**
 * Group a user's live AFK alerts by expiry, so servers that end together share
 * one line. Expired entries are skipped rather than shown counting backwards.
 */
function formatAfkAlerts(userAlerts, now = Date.now()) {
    if (!userAlerts) return '';
    const timeGroups = {};

    for (const [key, alert] of Object.entries(userAlerts)) {
        if (alert.expiresAt <= now) continue;
        const [, server] = key.split('|');
        const timeStr = formatTimeLeft(alert.expiresAt - now);
        const groupKey = `${alert.expiresAt}|${timeStr}`;
        if (!timeGroups[groupKey]) {
            timeGroups[groupKey] = { servers: [], until: alert.expiresAt, timeStr };
        }
        timeGroups[groupKey].servers.push(server);
    }

    const groupEntries = Object.values(timeGroups);
    if (groupEntries.length === 0) return '';

    return (
        '\nAFK alerts:\n' +
        groupEntries
            .map(group => {
                const serverDisplay = group.servers.map(s => `\`${s}\``).join(', ');
                const untilStr = new Date(group.until).toLocaleString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: undefined,
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
                return `- ${serverDisplay}: ${group.timeStr} (ends at ${untilStr} local time)`;
            })
            .join('\n')
    );
}

module.exports = { ephemeralReply, formatMonitoredPlayer, formatAfkAlerts };
