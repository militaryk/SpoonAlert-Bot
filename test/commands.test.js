'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// src/config validates at import time and exits on missing credentials, so
// these must be set before the registry is pulled in.
process.env.SPOONALERT_CONFIG = path.join(__dirname, 'fixtures', 'config.json');
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.ADMIN_USER_ID = '123456789012345678';

const commands = require('../src/commands');

/**
 * The exact command surface. Option types are the Discord API numbers:
 * 3 = STRING, 4 = INTEGER.
 *
 * Twelve commands were deliberately retired into the /spoon panel; RETIRED
 * below asserts they are really gone, so a stray re-registration is caught.
 */
const EXPECTED = {
    spoon: [],
    help: [],
    'admin-server-add': [
        { name: 'name', type: 3, required: true },
        { name: 'url', type: 3, required: true }
    ],
    'admin-server-remove': [{ name: 'name', type: 3, required: true }],
    // type 8 = ROLE. These took a free-text role NAME until admin access moved
    // to role IDs; a role option hands back a real snowflake instead.
    'admin-role-add': [{ name: 'role', type: 8, required: true }],
    'admin-role-remove': [{ name: 'role', type: 8, required: true }],
    'bot-status': []
};

const RETIRED = [
    'alert-enable',
    'alert-disable',
    'alert-persistent',
    'alert-status',
    'join-enable',
    'join-disable',
    'player-add',
    'player-remove',
    'server-list',
    'afk-enable',
    'afk-disable',
    'afk-alert'
];

test('registers exactly the expected command set', () => {
    const actual = [...commands.registry.keys()].sort();
    assert.deepEqual(actual, Object.keys(EXPECTED).sort());
});

test('every command carries the options it did before the refactor', () => {
    for (const payload of commands.toJSON()) {
        const expected = EXPECTED[payload.name];
        const actual = (payload.options || []).map(o => ({
            name: o.name,
            type: o.type,
            required: Boolean(o.required)
        }));
        assert.deepEqual(actual, expected, `options for /${payload.name}`);
    }
});

test('every command has a description and an executable handler', () => {
    for (const [name, command] of commands.registry) {
        const payload = command.data.toJSON();
        assert.ok(payload.description, `/${name} has a description`);
        assert.ok(
            payload.description.length <= 100,
            `/${name} description is within Discord's 100 char limit`
        );
        assert.equal(typeof command.execute, 'function', `/${name} has an execute()`);
    }
});

test('admin commands are guild-only and hidden by default', () => {
    // setDefaultMemberPermissions('0') keeps them off the default member
    // permission set; setContexts(Guild) -- contexts [0] -- replaces the
    // deprecated setDMPermission(false) and keeps them out of DMs.
    for (const name of commands.ADMIN_COMMAND_NAMES) {
        const payload = commands.get(name).data.toJSON();
        assert.equal(payload.default_member_permissions, '0', `/${name} default permissions`);
        assert.deepEqual(payload.contexts, [0], `/${name} is guild-only`);
    }
});

test('the admin command set is exactly what registration scopes to a guild', () => {
    assert.deepEqual([...commands.ADMIN_COMMAND_NAMES].sort(), [
        'admin-role-add',
        'admin-role-remove',
        'admin-server-add',
        'admin-server-remove',
        'bot-status'
    ]);
});

test('admin commands can be withheld from non-admin guilds', () => {
    const general = commands.toJSON({ includeAdmin: false }).map(c => c.name);
    assert.deepEqual(general.sort(), ['help', 'spoon']);

    const all = commands.toJSON().map(c => c.name);
    assert.equal(all.length, 7);
});

test('get() returns undefined for an unknown command', () => {
    // The old chain had no terminal else, so this case went unanswered.
    assert.equal(commands.get('listplayers'), undefined);
    assert.equal(commands.get('nope'), undefined);
});

test('the twelve panel-replaced commands are no longer registered', () => {
    for (const name of RETIRED) {
        assert.equal(commands.get(name), undefined, `/${name} should now be a button`);
    }
});

test('the command list is small enough to be worth having', () => {
    // Went from 18 commands to 7 -- the whole point of the panel.
    assert.equal(commands.registry.size, 7);
});
