'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SUPER_ADMIN = '123456789012345678';
process.env.SPOONALERT_CONFIG = path.join(__dirname, 'fixtures', 'config.json');
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.ADMIN_USER_ID = SUPER_ADMIN;

const { config } = require('../src/config');
const perms = require('../src/permissions');

const ADMIN_ROLE = '999888777666555444';
const OTHER_ROLE = '111222333444555666';

/** Guild interaction with the given role ids on the member. */
function guildInteraction(userId, roleIds = [], guildId = 'guild-1') {
    return {
        user: { id: userId },
        guild: {},
        guildId,
        member: { roles: { cache: new Map(roleIds.map(id => [id, { id }])) } }
    };
}

function dmInteraction(userId) {
    return { user: { id: userId }, guild: null, guildId: null, member: null };
}

test.beforeEach(() => {
    config.adminRoleIds = [];
});

test('the super admin is always an admin, even in DMs', () => {
    assert.equal(perms.isAdmin(guildInteraction(SUPER_ADMIN)), true);
    assert.equal(perms.isAdmin(dmInteraction(SUPER_ADMIN)), true);
});

test('with no admin roles configured, nobody else qualifies', () => {
    assert.equal(perms.isAdmin(guildInteraction('other-user', [ADMIN_ROLE])), false);
});

test('a member holding a configured admin role qualifies', () => {
    perms.addAdminRole(ADMIN_ROLE);
    assert.equal(perms.isAdmin(guildInteraction('other-user', [ADMIN_ROLE])), true);
    assert.equal(perms.isAdmin(guildInteraction('other-user', [OTHER_ROLE])), false);
    assert.equal(perms.isAdmin(guildInteraction('other-user', [])), false);
});

test('a role merely NAMED Admin grants nothing', () => {
    // The old check was `ADMIN_ROLE_NAMES.includes(role.name)`, so anyone with
    // Manage Roles could mint themselves control of the global server list.
    perms.addAdminRole(ADMIN_ROLE);
    const impostor = {
        user: { id: 'attacker' },
        guild: {},
        guildId: 'some-other-guild',
        member: { roles: { cache: new Map([['looks-official', { id: 'looks-official', name: 'Admin' }]]) } }
    };
    assert.equal(perms.isAdmin(impostor), false);
});

test('admin access never applies outside a guild for non-super-admins', () => {
    perms.addAdminRole(ADMIN_ROLE);
    assert.equal(perms.isAdmin(dmInteraction('other-user')), false);
});

test('addAdminRole and removeAdminRole report whether they changed anything', () => {
    assert.equal(perms.addAdminRole(ADMIN_ROLE), true);
    assert.equal(perms.addAdminRole(ADMIN_ROLE), false, 'already present');
    assert.deepEqual(config.adminRoleIds, [ADMIN_ROLE], 'stored in config for persistence');

    assert.equal(perms.removeAdminRole(ADMIN_ROLE), true);
    assert.equal(perms.removeAdminRole(ADMIN_ROLE), false, 'already gone');
    assert.deepEqual(config.adminRoleIds, []);
});

test('revoking a role takes effect immediately', () => {
    // The old list lived only in memory, so a revoked role came back on the
    // next restart -- failing open.
    perms.addAdminRole(ADMIN_ROLE);
    const interaction = guildInteraction('other-user', [ADMIN_ROLE]);
    assert.equal(perms.isAdmin(interaction), true);

    perms.removeAdminRole(ADMIN_ROLE);
    assert.equal(perms.isAdmin(interaction), false);
});

test('a raw member payload with an array of role ids still works', () => {
    perms.addAdminRole(ADMIN_ROLE);
    const raw = {
        user: { id: 'other-user' },
        guild: {},
        guildId: 'guild-1',
        member: { roles: [ADMIN_ROLE] }
    };
    assert.equal(perms.isAdmin(raw), true);
});
