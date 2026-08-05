'use strict';

const { SlashCommandBuilder } = require('discord.js');

const { config, servers, log } = require('../config');
const { store, saveUserConfigs, saveConfig } = require('../store');
const { isAdmin, isSuperAdmin, addAdminRole, removeAdminRole } = require('../permissions');
const { formatUptime } = require('../lib/time');
const { BOT_VERSION, BOT_START_TIME, getUsageCount } = require('../stats');
const { ephemeralReply } = require('../ui/reply');

/** Reject anything that is not an absolute http(s) URL. */
function isValidServerUrl(url) {
    try {
        return /^https?:$/.test(new URL(url).protocol);
    } catch {
        return false;
    }
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
            .setDMPermission(false),
        async execute(interaction) {
            if (!isAdmin(interaction)) {
                await ephemeralReply(interaction, 'You do not have permission to add servers.');
                return;
            }

            const name = interaction.options.getString('name');
            const url = interaction.options.getString('url');

            if (!isValidServerUrl(url)) {
                await ephemeralReply(
                    interaction,
                    'Invalid URL. Please provide a valid absolute URL starting with http:// or https://'
                );
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
            .setDMPermission(false),
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
            .setDescription('Add a role to the admin list (super admin only)')
            .addStringOption(opt =>
                opt.setName('rolename').setDescription('Role name to add as admin').setRequired(true)
            )
            .setDefaultMemberPermissions('0')
            .setDMPermission(false),
        async execute(interaction) {
            if (!isSuperAdmin(interaction)) {
                await ephemeralReply(interaction, 'Only the super admin can add admin roles.');
                return;
            }
            const rolename = interaction.options.getString('rolename');
            if (addAdminRole(rolename)) {
                logAdmin(interaction, `added admin role "${rolename}"`);
                await ephemeralReply(interaction, `Role **${rolename}** added to admin list.`);
            } else {
                await ephemeralReply(interaction, `Role **${rolename}** is already in the admin list.`);
            }
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('admin-role-remove')
            .setDescription('Remove a role from the admin list (super admin only)')
            .addStringOption(opt =>
                opt.setName('rolename').setDescription('Role name to remove from admin').setRequired(true)
            )
            .setDefaultMemberPermissions('0')
            .setDMPermission(false),
        async execute(interaction) {
            if (!isSuperAdmin(interaction)) {
                await ephemeralReply(interaction, 'Only the super admin can remove admin roles.');
                return;
            }
            const rolename = interaction.options.getString('rolename');
            if (removeAdminRole(rolename)) {
                logAdmin(interaction, `removed admin role "${rolename}"`);
                await ephemeralReply(interaction, `Role **${rolename}** removed from admin list.`);
            } else {
                await ephemeralReply(interaction, `Role **${rolename}** is not in the admin list.`);
            }
        }
    },
    {
        data: new SlashCommandBuilder()
            .setName('bot-status')
            .setDescription('Show bot version, uptime, server list, and usage stats (admin only)')
            .setDefaultMemberPermissions('0')
            .setDMPermission(false),
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
