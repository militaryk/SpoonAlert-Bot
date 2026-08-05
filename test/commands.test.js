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
 * The exact command surface as it existed before the module split, captured so
 * the refactor is provably a no-op. Option types are the Discord API numbers:
 * 3 = STRING, 4 = INTEGER.
 */
const EXPECTED = {
    'alert-enable': [],
    'alert-disable': [],
    'alert-persistent': [],
    'alert-status': [],
    'join-enable': [],
    'join-disable': [],
    'player-add': [{ name: 'player', type: 3, required: true }],
    'player-remove': [],
    'server-list': [],
    'afk-enable': [{ name: 'minutes', type: 4, required: true }],
    'afk-disable': [],
    'afk-alert': [{ name: 'hours', type: 4, required: true }],
    'admin-server-add': [
        { name: 'name', type: 3, required: true },
        { name: 'url', type: 3, required: true }
    ],
    'admin-server-remove': [{ name: 'name', type: 3, required: true }],
    'admin-role-add': [{ name: 'rolename', type: 3, required: true }],
    'admin-role-remove': [{ name: 'rolename', type: 3, required: true }],
    'bot-status': [],
    help: []
};

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
    // setDefaultMemberPermissions('0') + setDMPermission(false) keeps them out
    // of DMs and off the default member permission set.
    for (const name of [
        'admin-server-add',
        'admin-server-remove',
        'admin-role-add',
        'admin-role-remove',
        'bot-status'
    ]) {
        const payload = commands.get(name).data.toJSON();
        assert.equal(payload.default_member_permissions, '0', `/${name} default permissions`);
        assert.equal(payload.dm_permission, false, `/${name} is not usable in DMs`);
    }
});

test('get() returns undefined for an unknown command', () => {
    // The old chain had no terminal else, so this case went unanswered.
    assert.equal(commands.get('listplayers'), undefined);
    assert.equal(commands.get('nope'), undefined);
});
