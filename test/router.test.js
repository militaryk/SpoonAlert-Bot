'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// State writes must land in a temp directory, not on real user data.
process.env.SPOONALERT_CONFIG = path.join(__dirname, 'fixtures', 'config.json');
process.env.SPOONALERT_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'spoonalert-router-'));
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.ADMIN_USER_ID = '123456789012345678';

const { handleComponent, handleModal } = require('../src/ui/router');
const { store } = require('../src/store');
const { TOGGLE, VIEW, ACTION, SELECT, MODAL } = require('../src/ui/ids');

const USER = 'u-test-1';

/** Minimal stand-in for a component interaction, recording what it was told to do. */
function fakeComponent(customId, { values, userId = USER } = {}) {
    const captured = { updated: null, replied: null, modal: null };
    return {
        customId,
        values,
        user: { id: userId, tag: 'Tester#0001' },
        guild: null,
        guildId: null,
        captured,
        async update(payload) {
            captured.updated = payload;
        },
        async reply(payload) {
            captured.replied = payload;
        },
        async showModal(modal) {
            captured.modal = modal;
        }
    };
}

function fakeModal(value, { fromMessage = true, userId = USER } = {}) {
    const captured = { updated: null, replied: null };
    return {
        customId: MODAL.PLAYER,
        user: { id: userId, tag: 'Tester#0001' },
        guild: null,
        guildId: null,
        captured,
        fields: { getTextInputValue: () => value },
        isFromMessage: () => fromMessage,
        async update(payload) {
            captured.updated = payload;
        },
        async reply(payload) {
            captured.replied = payload;
        }
    };
}

/** Put one user into a known state before each scenario. */
function resetUser(overrides = {}) {
    store.userConfigs[USER] = {
        player: { name: 'Steve' },
        detection: true,
        joinNotify: false,
        afkDetection: false,
        afkThresholdMinutes: 10,
        persistentDetection: false,
        wasOnline: {},
        lastState: {},
        ...overrides
    };
    delete store.afkAlerts[USER];
    delete store.afkTracking[USER];
    return store.userConfigs[USER];
}

test('toggling disconnect detection flips it and redraws the panel', async () => {
    const cfg = resetUser({ detection: true });

    const off = fakeComponent(TOGGLE.DETECTION);
    await handleComponent(off);
    assert.equal(cfg.detection, false);
    assert.ok(off.captured.updated, 'panel was redrawn in place');
    assert.ok(off.captured.updated.embeds, 'redraw includes the embed');

    const on = fakeComponent(TOGGLE.DETECTION);
    await handleComponent(on);
    assert.equal(cfg.detection, true);
});

test('turning detection off also drops any armed AFK timer', async () => {
    resetUser({ detection: true });
    store.afkAlerts[USER] = { 'Steve|TestServer': { expiresAt: Date.now() + 3600000 } };

    await handleComponent(fakeComponent(TOGGLE.DETECTION));

    assert.equal(store.afkAlerts[USER], undefined, 'timer cleared with detection');
});

test('turning AFK detection off clears its position history', async () => {
    const cfg = resetUser({ afkDetection: true });
    store.afkTracking[USER] = { 'Steve|TestServer': { x: 1, y: 2, z: 3, lastMoved: 1 } };

    await handleComponent(fakeComponent(TOGGLE.AFK));

    assert.equal(cfg.afkDetection, false);
    assert.equal(store.afkTracking[USER], undefined, 'stale positions removed');
});

test('the persistent and join toggles flip independently', async () => {
    const cfg = resetUser();

    await handleComponent(fakeComponent(TOGGLE.PERSIST));
    assert.equal(cfg.persistentDetection, true);
    assert.equal(cfg.joinNotify, false, 'join untouched');

    await handleComponent(fakeComponent(TOGGLE.JOIN));
    assert.equal(cfg.joinNotify, true);
    assert.equal(cfg.persistentDetection, true, 'persistent untouched');
});

test('navigation buttons swap the view without changing state', async () => {
    const cfg = resetUser();
    const before = JSON.stringify(cfg);

    for (const id of [VIEW.AFK_TIMER, VIEW.AFK_THRESHOLD, VIEW.SERVERS, VIEW.ADMIN, VIEW.MAIN]) {
        const interaction = fakeComponent(id);
        await handleComponent(interaction);
        assert.ok(interaction.captured.updated, `${id} rendered a view`);
    }
    assert.equal(JSON.stringify(cfg), before, 'navigation is read-only');
});

test('the set-player button opens a modal rather than replying', async () => {
    resetUser();
    const interaction = fakeComponent(ACTION.SET_PLAYER);

    await handleComponent(interaction);

    assert.ok(interaction.captured.modal, 'a modal was shown');
    assert.equal(interaction.captured.modal.toJSON().custom_id, MODAL.PLAYER);
    assert.equal(interaction.captured.updated, null, 'showModal IS the response');
});

test('stopping monitoring clears the player and all keyed state', async () => {
    const cfg = resetUser();
    store.afkAlerts[USER] = { 'Steve|TestServer': { expiresAt: Date.now() + 3600000 } };
    store.afkTracking[USER] = { 'Steve|TestServer': { x: 1, y: 2, z: 3, lastMoved: 1 } };

    await handleComponent(fakeComponent(ACTION.STOP_PLAYER));

    assert.equal(cfg.player, null);
    // Leftovers here are what used to pin detection on forever, since no poll
    // could ever match the old composite keys again.
    assert.equal(store.afkAlerts[USER], undefined);
    assert.equal(store.afkTracking[USER], undefined);
});

test('choosing AFK timer hours arms an alert per server and forces detection on', async () => {
    const cfg = resetUser({ detection: false });

    await handleComponent(fakeComponent(SELECT.AFK_HOURS, { values: ['4'] }));

    assert.deepEqual(Object.keys(store.afkAlerts[USER]), ['Steve|TestServer']);
    assert.equal(cfg.detection, true, 'an alert is pointless without detection');

    const msLeft = store.afkAlerts[USER]['Steve|TestServer'].expiresAt - Date.now();
    assert.ok(msLeft > 3.9 * 3600000 && msLeft <= 4 * 3600000, `expiry ~4h, got ${msLeft}ms`);
});

test('AFK timer hours are clamped to the advertised maximum', async () => {
    resetUser();
    await handleComponent(fakeComponent(SELECT.AFK_HOURS, { values: ['99999'] }));

    const msLeft = store.afkAlerts[USER]['Steve|TestServer'].expiresAt - Date.now();
    assert.ok(msLeft <= 168 * 3600000, 'never exceeds one week');
});

test('the cancel option clears an armed AFK timer', async () => {
    resetUser();
    store.afkAlerts[USER] = { 'Steve|TestServer': { expiresAt: Date.now() + 3600000 } };

    await handleComponent(fakeComponent(SELECT.AFK_HOURS, { values: ['cancel'] }));

    assert.equal(store.afkAlerts[USER], undefined);
});

test('choosing a threshold enables AFK detection at that value', async () => {
    const cfg = resetUser({ afkDetection: false, afkThresholdMinutes: 10 });

    await handleComponent(fakeComponent(SELECT.AFK_THRESHOLD, { values: ['30'] }));

    assert.equal(cfg.afkDetection, true);
    assert.equal(cfg.afkThresholdMinutes, 30);
});

test('an out-of-range threshold is ignored rather than stored', async () => {
    const cfg = resetUser({ afkThresholdMinutes: 10 });

    await handleComponent(fakeComponent(SELECT.AFK_THRESHOLD, { values: ['9999'] }));

    assert.equal(cfg.afkThresholdMinutes, 10, 'unchanged');
});

test('a customId from an older panel gets a helpful reply, not a crash', async () => {
    resetUser();
    const interaction = fakeComponent('sa:v:removed-in-a-later-version');

    await handleComponent(interaction);

    assert.ok(interaction.captured.replied, 'the user hears back');
    assert.match(interaction.captured.replied.content, /older version/);
});

test('the modal accepts a valid username and updates the panel in place', async () => {
    const cfg = resetUser({ player: null });
    const interaction = fakeModal('Notch');

    await handleModal(interaction);

    assert.deepEqual(cfg.player, { name: 'Notch' });
    assert.ok(interaction.captured.updated, 'panel edited in place via update()');
});

test('the modal rejects names that would corrupt the composite keys', async () => {
    const cfg = resetUser({ player: null });

    for (const bad of ['bad|name', 'ab', 'this-name-is-way-too-long', 'has space', 'emoji😀']) {
        const interaction = fakeModal(bad);
        await handleModal(interaction);
        assert.equal(cfg.player, null, `${bad} was rejected`);
        assert.match(interaction.captured.replied.content, /not a valid Minecraft username/);
    }
});

test('the modal falls back to a reply when not opened from a panel', async () => {
    resetUser({ player: null });
    const interaction = fakeModal('Steve', { fromMessage: false });

    await handleModal(interaction);

    assert.equal(interaction.captured.updated, null);
    assert.match(interaction.captured.replied.content, /Now monitoring/);
});

test('changing to a different player discards the old keyed state', async () => {
    const cfg = resetUser();
    store.afkAlerts[USER] = { 'Steve|TestServer': { expiresAt: Date.now() + 3600000 } };
    store.afkTracking[USER] = { 'Steve|TestServer': { x: 1, y: 2, z: 3, lastMoved: 1 } };

    await handleModal(fakeModal('Alex'));

    assert.deepEqual(cfg.player, { name: 'Alex' });
    assert.equal(store.afkAlerts[USER], undefined, 'Steve-keyed alert removed');
    assert.equal(store.afkTracking[USER], undefined, 'Steve-keyed tracking removed');
});

test('re-submitting the same player keeps the existing state', async () => {
    resetUser();
    const expiresAt = Date.now() + 3600000;
    store.afkAlerts[USER] = { 'Steve|TestServer': { expiresAt } };

    await handleModal(fakeModal('Steve'));

    assert.ok(store.afkAlerts[USER], 'nothing was needlessly cleared');
    assert.equal(store.afkAlerts[USER]['Steve|TestServer'].expiresAt, expiresAt);
});
