'use strict';

const { config, ENV_ADMIN_USER_ID, ADMIN_GUILD_ID, log } = require('./config');

/**
 * Admin access is granted by role ID, persisted in config.json.
 *
 * It used to be granted by role *name* against a hardcoded
 * ['Admin','Administrator','SpoonAdmin'], which meant anyone who could create a
 * role called "Admin" in ANY guild the bot had joined gained control of the
 * global server list -- and the list only lived in memory, so revoking a role
 * silently un-revoked itself on the next restart.
 *
 * Role IDs are globally unique snowflakes, so requiring one inherently scopes
 * access to the guild that owns the role. ADMIN_GUILD_ID is optional extra
 * hardening on top of that.
 */
function adminRoleIds() {
    if (!Array.isArray(config.adminRoleIds)) config.adminRoleIds = [];
    return config.adminRoleIds;
}

function isSuperAdmin(interaction) {
    return interaction.user.id === ENV_ADMIN_USER_ID;
}

/** The one admin check, replacing three subtly different inline copies. */
function isAdmin(interaction) {
    if (isSuperAdmin(interaction)) return true;
    if (!interaction.guild) return false;
    // When pinned to one guild, a role ID from anywhere else is not enough.
    if (ADMIN_GUILD_ID && interaction.guildId !== ADMIN_GUILD_ID) return false;

    const roleIds = adminRoleIds();
    if (roleIds.length === 0) return false;

    // interaction.member is already resolved for guild interactions; the old
    // code went through guild.members.cache, which is often empty.
    const member = interaction.member;
    if (!member || !member.roles) return false;

    const memberRoles = member.roles.cache;
    if (memberRoles) return roleIds.some(id => memberRoles.has(id));
    // Raw API shape (no GuildMember cached): roles is an array of ids.
    return Array.isArray(member.roles) && roleIds.some(id => member.roles.includes(id));
}

/** Returns false if the role was already an admin. */
function addAdminRole(roleId) {
    const roleIds = adminRoleIds();
    if (roleIds.includes(roleId)) return false;
    roleIds.push(roleId);
    return true;
}

/** Returns false if the role was not an admin. */
function removeAdminRole(roleId) {
    const roleIds = adminRoleIds();
    const idx = roleIds.indexOf(roleId);
    if (idx === -1) return false;
    roleIds.splice(idx, 1);
    return true;
}

/** Warn once at startup if nothing but the super admin can administer the bot. */
function reportAdminSetup() {
    const count = adminRoleIds().length;
    if (count === 0) {
        log('No admin roles configured; only the super admin can use the admin commands.');
    } else {
        log(`${count} admin role(s) configured${ADMIN_GUILD_ID ? ` (guild ${ADMIN_GUILD_ID})` : ''}.`);
    }
}

module.exports = {
    adminRoleIds,
    isAdmin,
    isSuperAdmin,
    addAdminRole,
    removeAdminRole,
    reportAdminSetup
};
