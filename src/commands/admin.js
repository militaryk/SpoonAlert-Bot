'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');

const { config, servers, log, ALLOWED_SERVER_HOSTS } = require('../config');
const { store, saveUserConfigs, saveConfig, pruneOrphanedState } = require('../store');
const { isAdmin, isSuperAdmin, addAdminRole, removeAdminRole } = require('../permissions');
const { formatUptime } = require('../lib/time');
const { BOT_VERSION, BOT_START_TIME, getUsageCount } = require('../stats');
const { ephemeralReply } = require('../ui/reply');

/**
 * Validate a candidate players.json URL.
 *
 * Whatever is accepted here gets fetched from the bot host every 30 seconds
 * forever, so this is the SSRF boundary. The host allowlist is opt-in via
 * ALLOWED_SERVER_HOSTS: a blanket private-IP block would reject the LAN
 * address most self-hosted Squaremap installs actually use.
 */
function validateServerUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, reason: 'That is not a valid URL.' };
    }
    if (!/^https?:$/.test(parsed.protocol)) {
        return { ok: false, reason: 'The URL must start with `http://` or `https://`.' };
    }
    if (ALLOWED_SERVER_HOSTS.length > 0 && !ALLOWED_SERVER_HOSTS.includes(parsed.hostname.toLowerCase())) {
        return {
            ok: false,
            reason:
                `\`${parsed.hostname}\` is not in this bot's allowed server hosts. ` +
                'Ask the bot owner to add it to `ALLOWED_SERVER_HOSTS`.'
        };
    }
    return { ok: true };
}

/** Admin actions are worth a log line naming who did what, and where. */
function logAdmin(interaction, message) {
    log(`ADMIN ${interaction.user.tag} (${interaction.user.id}) in guild ${interaction.guildId}: ${message}`);
}

module.exports = [
    {
        data: new SlashCommandBuilder()
            .setName('admin-server-add')
            .setDescription('Add a new Minecraft server (admin only)')
            .addStringOption(opt => opt.setName('name').setDescription('Server name').setRequired(true))
            .addStringOption(opt =>
                opt
                    .setName('url')
                    .setDescription('players.json URL (full /tiles/players.json URL)')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions('0')
            .setContexts(InteractionContextType.Guild),
        async execute(interaction) {
            if (!isAdmin(interaction)) {
                await ephemeralReply(interaction, 'You do not have permission to add servers.');
                return;
            }

            const name = interaction.options.getString('name');
            const url = interaction.options.getString('url');

            const check = validateServerUrl(url);
            if (!check.ok) {
                await ephemeralReply(interaction, check.reason);
                return;
            }
            if (!config.servers) config.servers = [];
            if (config.servers.some(s => s.name === name)) {
                await ephemeralReply(interaction, `A server with the name **${name}** already exists.`);
                return;
            }

            config.servers.push({ name, url });
            // Roll the in-memory change back if it could not be persisted, so
            // the poller never polls a server that is not in config.json.
            if (!saveConfig()) {
                config.servers.pop();
                await ephemeralReply(
                    interaction,
                    `Could not write config.json, so **${name}** was not added. Check file permissions on the bot host.`
                );
                return;
            }

            logAdmin(interaction, `added server "${name}" (${url})`);
            await ephemeralReply(interaction, `Server **${name}** added with URL: \`${url}\`.`);
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('admin-server-remove')
            .setDescription('Remove a Minecraft server (admin only)')
            .addStringOption(opt =>
                opt.setName('name').setDescription('Server name to remove').setRequired(true)
            )
            .setDefaultMemberPermissions('0')
            .setContexts(InteractionContextType.Guild),
        async execute(interaction) {
            if (!isAdmin(interaction)) {
                await ephemeralReply(interaction, 'You do not have permission to remove servers.');
                return;
            }

            const name = interaction.options.getString('name');
            if (!config.servers) config.servers = [];
            const idx = config.servers.findIndex(s => s.name === name);
            if (idx === -1) {
                await ephemeralReply(interaction, `No server found with the name **${name}**.`);
                return;
            }

            const [removedServer] = config.servers.splice(idx, 1);
            if (!saveConfig()) {
                config.servers.splice(idx, 0, removedServer);
                await ephemeralReply(
                    interaction,
                    `Could not write config.json, so **${name}** was not removed. Check file permissions on the bot host.`
                );
                return;
            }

            // Players are tracked across all servers, so a monitored player is
            // only orphaned once there are no servers left at all.
            let affectedUsers = 0;
            if (servers().length === 0) {
                for (const userCfg of Object.values(store.userConfigs)) {
                    if (userCfg.player) {
                        userCfg.player = null;
                        affectedUsers++;
                    }
                }
            }
            saveUserConfigs();
            // Alerts and position history keyed to the removed server can never
            // be matched by a poll again.
            pruneOrphanedState();

            logAdmin(interaction, `removed server "${name}"`);
            await ephemeralReply(
                interaction,
                `Server **${name}** removed. ${affectedUsers} user(s) had their monitored player removed because there are no servers left.`
            );
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('admin-role-add')
            .setDescription('Grant a role admin access (super admin only)')
            .addRoleOption(opt =>
                opt.setName('role').setDescription('Role to grant admin access').setRequired(true)
            )
            .setDefaultMemberPermissions('0')
            .setContexts(InteractionContextType.Guild),
        async execute(interaction) {
            if (!isSuperAdmin(interaction)) {
                await ephemeralReply(interaction, 'Only the super admin can add admin roles.');
                return;
            }
            // A role option hands back a real snowflake, so there is no way to
            // typo a name into granting access to the wrong role.
            const role = interaction.options.getRole('role');
            if (!addAdminRole(role.id)) {
                await ephemeralReply(interaction, `**${role.name}** already has admin access.`);
                return;
            }
            if (!saveConfig()) {
                removeAdminRole(role.id);
                await ephemeralReply(
                    interaction,
                    'Could not write config.json, so the change was not applied.'
                );
                return;
            }
            logAdmin(interaction, `granted admin to role "${role.name}" (${role.id})`);
            await ephemeralReply(interaction, `**${role.name}** now has admin access.`);
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('admin-role-remove')
            .setDescription('Revoke a role’s admin access (super admin only)')
            .addRoleOption(opt =>
                opt.setName('role').setDescription('Role to revoke admin access from').setRequired(true)
            )
            .setDefaultMemberPermissions('0')
            .setContexts(InteractionContextType.Guild),
        async execute(interaction) {
            if (!isSuperAdmin(interaction)) {
                await ephemeralReply(interaction, 'Only the super admin can remove admin roles.');
                return;
            }
            const role = interaction.options.getRole('role');
            if (!removeAdminRole(role.id)) {
                await ephemeralReply(interaction, `**${role.name}** does not have admin access.`);
                return;
            }
            // Revocation must not fail open the way the in-memory list did.
            if (!saveConfig()) {
                addAdminRole(role.id);
                await ephemeralReply(
                    interaction,
                    'Could not write config.json, so admin access was NOT revoked.'
                );
                return;
            }
            logAdmin(interaction, `revoked admin from role "${role.name}" (${role.id})`);
            await ephemeralReply(interaction, `**${role.name}** no longer has admin access.`);
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('bot-status')
            .setDescription('Show bot version, uptime, server list, and usage stats (admin only)')
            .setDefaultMemberPermissions('0')
            .setContexts(InteractionContextType.Guild),
        readOnly: true,
        async execute(interaction) {
            if (!isAdmin(interaction)) {
                await ephemeralReply(interaction, 'You do not have permission to use this command.');
                return;
            }

            // Names only. Rendering full URLs here leaked the host of a
            // self-hosted Squaremap, which is usually a home IP or DDNS name.
            const serverList =
                servers()
                    .map(s => `• ${s.name}`)
                    .join('\n') || 'No servers configured.';

            await ephemeralReply(interaction, {
                embeds: [
                    {
                        title: 'SpoonAlert Bot Status',
                        color: 0x0099ff,
                        fields: [
                            { name: 'Version', value: BOT_VERSION, inline: true },
                            {
                                name: 'Uptime',
                                value: formatUptime(Date.now() - BOT_START_TIME),
                                inline: true
                            },
                            {
                                name: 'Total Users',
                                value: String(Object.keys(store.userConfigs).length),
                                inline: true
                            },
                            {
                                name: 'Commands Used (since restart)',
                                value: String(getUsageCount()),
                                inline: true
                            },
                            { name: 'Servers Monitored', value: String(servers().length), inline: true },
                            { name: 'Server List', value: serverList }
                        ]
                    }
                ]
            });
        }
    }
];
