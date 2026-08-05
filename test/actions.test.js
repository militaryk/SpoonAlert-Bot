'use strict';

const test = require('node:test');
const assert = require('node:assert');

const actions = require('../src/actions');

function freshConfig() {
    return {
        player: null,
        detection: true,
        joinNotify: false,
        afkDetection: false,
        afkThresholdMinutes: 10,
        persistentDetection: false
    };
}

test('setPlayer and clearPlayer', () => {
    const cfg = freshConfig();

    actions.setPlayer(cfg, 'Steve');
    assert.deepEqual(cfg.player, { name: 'Steve' });

    assert.equal(actions.clearPlayer(cfg), true, 'reports that it removed one');
    assert.equal(cfg.player, null);
    assert.equal(actions.clearPlayer(cfg), false, 'reports nothing to remove the second time');
});

test('togglePersistent flips and returns the new value', () => {
    const cfg = freshConfig();
    assert.equal(actions.togglePersistent(cfg), true);
    assert.equal(cfg.persistentDetection, true);
    assert.equal(actions.togglePersistent(cfg), false);
    assert.equal(cfg.persistentDetection, false);
});

test('setAfkDetection stores the threshold only when enabling', () => {
    const cfg = freshConfig();

    actions.setAfkDetection(cfg, true, 25);
    assert.equal(cfg.afkDetection, true);
    assert.equal(cfg.afkThresholdMinutes, 25);

    // Disabling must not wipe the remembered threshold.
    actions.setAfkDetection(cfg, false);
    assert.equal(cfg.afkDetection, false);
    assert.equal(cfg.afkThresholdMinutes, 25);
});

test('isValidAfkThreshold enforces the advertised 1-60 range', () => {
    assert.equal(actions.isValidAfkThreshold(1), true);
    assert.equal(actions.isValidAfkThreshold(60), true);
    assert.equal(actions.isValidAfkThreshold(0), false);
    assert.equal(actions.isValidAfkThreshold(61), false);
    assert.equal(actions.isValidAfkThreshold(null), false);
    assert.equal(actions.isValidAfkThreshold(10.5), false, 'must be a whole number of minutes');
});

test('clampAlertHours keeps requests inside 1-168', () => {
    assert.equal(actions.clampAlertHours(5), 5);
    assert.equal(actions.clampAlertHours(0), 1);
    assert.equal(actions.clampAlertHours(-3), 1);
    assert.equal(actions.clampAlertHours(null), 1);
    assert.equal(actions.clampAlertHours(1000), 168);
    assert.equal(actions.clampAlertHours(168), 168);
});

test('setAfkAlert arms one entry per server sharing an expiry', () => {
    const afkAlerts = {};
    const expiresAt = actions.setAfkAlert(afkAlerts, 'u1', 'Steve', ['S1', 'S2'], 2, 1000);

    assert.equal(expiresAt, 1000 + 2 * 3600000);
    assert.deepEqual(Object.keys(afkAlerts.u1).sort(), ['Steve|S1', 'Steve|S2']);
    assert.equal(afkAlerts.u1['Steve|S1'].expiresAt, expiresAt);
    assert.equal(afkAlerts.u1['Steve|S2'].expiresAt, expiresAt);
});

test('setAfkAlert re-arming replaces the old expiry for the same key', () => {
    const afkAlerts = {};
    actions.setAfkAlert(afkAlerts, 'u1', 'Steve', ['S1'], 1, 1000);
    const second = actions.setAfkAlert(afkAlerts, 'u1', 'Steve', ['S1'], 5, 1000);

    assert.equal(Object.keys(afkAlerts.u1).length, 1, 'no duplicate key');
    assert.equal(afkAlerts.u1['Steve|S1'].expiresAt, second);
});

test('clearAfkAlerts and clearAfkTracking report whether they removed anything', () => {
    const afkAlerts = { u1: { 'Steve|S1': { expiresAt: 1 } } };
    assert.equal(actions.clearAfkAlerts(afkAlerts, 'u1'), true);
    assert.equal(afkAlerts.u1, undefined);
    assert.equal(actions.clearAfkAlerts(afkAlerts, 'u1'), false, 'second call is a no-op');

    const afkTracking = { u1: { 'Steve|S1': { lastMoved: 1 } } };
    assert.equal(actions.clearAfkTracking(afkTracking, 'u1'), true);
    assert.equal(afkTracking.u1, undefined);
    assert.equal(actions.clearAfkTracking(afkTracking, 'u2'), false, 'unknown user is a no-op');
});
