'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SPOONALERT_CONFIG = path.join(__dirname, 'fixtures', 'config.json');
process.env.SPOONALERT_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'spoonalert-store-'));
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.ADMIN_USER_ID = '123456789012345678';

const { store, getUserConfig, pruneOrphanedState } = require('../src/store');

// The fixture configures exactly one server, named TestServer.
const SERVER = 'TestServer';

test.beforeEach(() => {
    store.userConfigs = {};
    store.afkAlerts = {};
    store.afkTracking = {};
});

test('getUserConfig creates and persists a record on first use', () => {
    const cfg = getUserConfig('u1');
    assert.equal(cfg.player, null);
    assert.equal(cfg.detection, true);
    assert.ok(store.userConfigs.u1, 'stored for next time');
});

test('getUserConfig with persist:false does not mint a record', () => {
    // Read-only interactions should not create a permanent entry, and a
    // full-file write, for everyone who ever pressed a button.
    const cfg = getUserConfig('u-readonly', { persist: false });
    assert.equal(cfg.detection, true, 'still gets usable defaults');
    assert.equal(store.userConfigs['u-readonly'], undefined, 'nothing stored');
});

test('pruneOrphanedState drops entries for servers that no longer exist', () => {
    store.userConfigs.u1 = { player: { name: 'Steve' } };
    store.afkAlerts.u1 = {
        [`Steve|${SERVER}`]: { expiresAt: Date.now() + 3600000 },
        'Steve|DeletedServer': { expiresAt: Date.now() + 3600000 }
    };

    const removed = pruneOrphanedState();

    assert.equal(removed, 1);
    assert.deepEqual(Object.keys(store.afkAlerts.u1), [`Steve|${SERVER}`]);
});

test('pruneOrphanedState drops entries for a player no longer being watched', () => {
    store.userConfigs.u1 = { player: { name: 'Alex' } };
    store.afkTracking.u1 = {
        [`Steve|${SERVER}`]: { x: 1, y: 2, z: 3, lastMoved: 1 },
        [`Alex|${SERVER}`]: { x: 4, y: 5, z: 6, lastMoved: 1 }
    };

    pruneOrphanedState();

    assert.deepEqual(Object.keys(store.afkTracking.u1), [`Alex|${SERVER}`]);
});

test('pruneOrphanedState removes a user entry once it is empty', () => {
    store.userConfigs.u1 = { player: null };
    store.afkAlerts.u1 = { [`Steve|${SERVER}`]: { expiresAt: Date.now() + 3600000 } };

    pruneOrphanedState();

    assert.equal(store.afkAlerts.u1, undefined, 'no empty shell left behind');
});

test('pruneOrphanedState leaves healthy state alone and reports no work', () => {
    store.userConfigs.u1 = { player: { name: 'Steve' } };
    const expiresAt = Date.now() + 3600000;
    store.afkAlerts.u1 = { [`Steve|${SERVER}`]: { expiresAt } };

    assert.equal(pruneOrphanedState(), 0, 'nothing removed, so nothing saved');
    assert.equal(store.afkAlerts.u1[`Steve|${SERVER}`].expiresAt, expiresAt);
});
