'use strict';

const { ENV_ADMIN_USER_ID } = require('./config');

// NOTE: authorising by role *name* means anyone who can create a role called
// "Admin" in any guild the bot has joined gains control of the global server
// list. Phase 5 of the plan replaces this with role IDs scoped to one guild.
const ADMIN_ROLE_NAMES = ['Admin', 'Administrator', 'SpoonAdmin'];

function isSuperAdmin(interaction) {
    return interaction.user.id === ENV_ADMIN_USER_ID;
}

/**
 * One admin check, replacing the three subtly different copies that used to
 * live inline in the command chain.
 */
function isAdmin(interaction) {
    if (isSuperAdmin(interaction)) return true;
    if (!interaction.guild) return false;
    const member = interaction.guild.members.cache.get(interaction.user.id);
    return Boolean(member && member.roles.cache.some(role => ADMIN_ROLE_NAMES.includes(role.name)));
}

/** Returns false if the role was already present. */
function addAdminRole(roleName) {
    if (ADMIN_ROLE_NAMES.includes(roleName)) return false;
    ADMIN_ROLE_NAMES.push(roleName);
    return true;
}

/** Returns false if the role was not in the list. */
function removeAdminRole(roleName) {
    const idx = ADMIN_ROLE_NAMES.indexOf(roleName);
    if (idx === -1) return false;
    ADMIN_ROLE_NAMES.splice(idx, 1);
    return true;
}

module.exports = { ADMIN_ROLE_NAMES, isAdmin, isSuperAdmin, addAdminRole, removeAdminRole };
