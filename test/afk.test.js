'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
    hasMoved,
    hasActiveAlert,
    isAfk,
    idleMinutes,
    disconnectAlertKind,
    pruneExpiredAlerts
} = require('../src/lib/afk');

test('hasMoved ignores sub-tolerance jitter', () => {
    const tracked = { x: 100, y: 64, z: -200 };
    assert.equal(hasMoved(tracked, { x: 100, y: 64, z: -200 }), false, 'identical position');
    assert.equal(hasMoved(tracked, { x: 100.05, y: 64, z: -200 }), false, 'within tolerance');
    assert.equal(hasMoved(tracked, { x: 100.1, y: 64, z: -200 }), false, 'exactly at tolerance');
});

test('hasMoved detects movement on any axis', () => {
    const tracked = { x: 100, y: 64, z: -200 };
    assert.equal(hasMoved(tracked, { x: 100.2, y: 64, z: -200 }), true, 'x');
    assert.equal(hasMoved(tracked, { x: 100, y: 65, z: -200 }), true, 'y');
    assert.equal(hasMoved(tracked, { x: 100, y: 64, z: -199 }), true, 'z');
    // Negative coordinates must compare by magnitude of the difference.
    assert.equal(hasMoved(tracked, { x: 100, y: 64, z: -201 }), true, 'negative z');
});

test('hasActiveAlert only counts unexpired alerts', () => {
    const now = 1000;
    assert.equal(hasActiveAlert(undefined, now), false, 'no entry at all');
    assert.equal(hasActiveAlert({}, now), false, 'empty entry');
    assert.equal(hasActiveAlert({ 'Steve|S1': { expiresAt: 500 } }, now), false, 'expired');
    assert.equal(hasActiveAlert({ 'Steve|S1': { expiresAt: 1000 } }, now), false, 'exactly now');
    assert.equal(hasActiveAlert({ 'Steve|S1': { expiresAt: 1500 } }, now), true, 'still live');
    // This is the case that used to pin detection on forever: one dead entry
    // alongside nothing live still counted as "active" when merely counting keys.
    assert.equal(
        hasActiveAlert({ 'Steve|S1': { expiresAt: 500 }, 'Steve|S2': { expiresAt: 1500 } }, now),
        true,
        'mixed, one live'
    );
});

test('pruneExpiredAlerts removes only expired entries', () => {
    const alerts = {
        u1: { 'Steve|S1': { expiresAt: 500 }, 'Steve|S2': { expiresAt: 1500 } }
    };
    const { changed, emptiedUsers } = pruneExpiredAlerts(alerts, 1000);

    assert.equal(changed, true);
    assert.deepEqual(emptiedUsers, [], 'user still has a live alert, so not emptied');
    assert.deepEqual(Object.keys(alerts.u1), ['Steve|S2']);
});

test('pruneExpiredAlerts reports users whose last alert expired', () => {
    const alerts = {
        u1: { 'Steve|S1': { expiresAt: 500 } },
        u2: { 'Alex|S1': { expiresAt: 9999 } }
    };
    const { changed, emptiedUsers } = pruneExpiredAlerts(alerts, 1000);

    assert.equal(changed, true);
    assert.deepEqual(emptiedUsers, ['u1']);
    assert.equal(alerts.u1, undefined, 'emptied user removed entirely');
    assert.ok(alerts.u2, 'untouched user survives');
});

test('pruneExpiredAlerts does not fire for an already-empty entry', () => {
    // An empty {} entry must not be reported as "just expired" -- doing so
    // would DM the user that an alert they never had has ended, and switch
    // their detection off.
    const alerts = { u1: {} };
    const { changed, emptiedUsers } = pruneExpiredAlerts(alerts, 1000);

    assert.equal(changed, true, 'the stray empty entry is still cleaned up');
    assert.deepEqual(emptiedUsers, [], 'but nobody is notified');
});

test('isAfk compares idle time against the live threshold', () => {
    const now = 60 * 60 * 1000; // 1h
    const tracked = { lastMoved: now - 20 * 60 * 1000 }; // idle 20 minutes

    assert.equal(isAfk(tracked, 10, now), true, '20 idle vs 10 min threshold');
    assert.equal(isAfk(tracked, 20, now), true, 'exactly at the threshold counts');
    assert.equal(isAfk(tracked, 30, now), false, '20 idle vs 30 min threshold');
    assert.equal(isAfk(undefined, 10, now), false, 'never observed is not AFK');
    assert.equal(isAfk({}, 10, now), false, 'no lastMoved is not AFK');
});

test('idleMinutes reports whole minutes standing still', () => {
    const now = 60 * 60 * 1000;
    assert.equal(idleMinutes({ lastMoved: now - 90 * 1000 }, now), 1);
    assert.equal(idleMinutes({ lastMoved: now }, now), 0);
    assert.equal(idleMinutes(undefined, now), 0);
});

// The rule the user asked for: going AFK is silent; a disconnect only matters
// if they were AFK when it happened.
test('AFK-only mode alerts on an AFK disconnect', () => {
    const kind = disconnectAlertKind({
        afkAlertActive: false,
        afkDetection: true,
        wasAfk: true,
        detection: true
    });
    assert.equal(kind, 'afk');
});

test('AFK-only mode stays silent when they logged off mid-play', () => {
    // Even with plain leave alerts on: AFK-only filters, it does not add.
    assert.equal(
        disconnectAlertKind({
            afkAlertActive: false,
            afkDetection: true,
            wasAfk: false,
            detection: true
        }),
        null
    );
    assert.equal(
        disconnectAlertKind({
            afkAlertActive: false,
            afkDetection: true,
            wasAfk: false,
            detection: false
        }),
        null
    );
});

test('without AFK-only, every disconnect alerts', () => {
    assert.equal(
        disconnectAlertKind({
            afkAlertActive: false,
            afkDetection: false,
            wasAfk: false,
            detection: true
        }),
        'plain'
    );
    assert.equal(
        disconnectAlertKind({
            afkAlertActive: false,
            afkDetection: false,
            wasAfk: true,
            detection: true
        }),
        'plain',
        'AFK state is irrelevant when the filter is off'
    );
});

test('an armed AFK timer overrides both toggles', () => {
    // Arming a timer is an explicit "tell me if they drop in this window", so
    // it wins even over the AFK-only filter and even with everything else off.
    for (const wasAfk of [true, false]) {
        assert.equal(
            disconnectAlertKind({
                afkAlertActive: true,
                afkDetection: true,
                wasAfk,
                detection: false
            }),
            'timer',
            `wasAfk=${wasAfk}`
        );
    }
});

test('everything off means silence', () => {
    assert.equal(
        disconnectAlertKind({
            afkAlertActive: false,
            afkDetection: false,
            wasAfk: true,
            detection: false
        }),
        null
    );
});

test('pruneExpiredAlerts is a no-op when everything is live', () => {
    const alerts = { u1: { 'Steve|S1': { expiresAt: 9999 } } };
    const { changed, emptiedUsers } = pruneExpiredAlerts(alerts, 1000);

    assert.equal(changed, false, 'no write should be triggered');
    assert.deepEqual(emptiedUsers, []);
    assert.deepEqual(alerts, { u1: { 'Steve|S1': { expiresAt: 9999 } } });
});
