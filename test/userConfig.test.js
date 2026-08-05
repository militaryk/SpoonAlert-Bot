'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normalizeUserConfig, serializeUserConfig } = require('../src/lib/userConfig');

test('normalizeUserConfig migrates the legacy players array', () => {
    const cfg = normalizeUserConfig({ players: [{ name: 'Steve' }, { name: 'Alex' }] });
    assert.deepEqual(cfg.player, { name: 'Steve' }, 'first player wins');
    assert.equal('players' in cfg, false, 'legacy key is dropped');
});

test('normalizeUserConfig migrates an array of bare strings', () => {
    const cfg = normalizeUserConfig({ players: ['Steve'] });
    assert.deepEqual(cfg.player, { name: 'Steve' });
});

test('normalizeUserConfig accepts player as object or string', () => {
    assert.deepEqual(normalizeUserConfig({ player: { name: 'Steve' } }).player, { name: 'Steve' });
    assert.deepEqual(normalizeUserConfig({ player: 'Steve' }).player, { name: 'Steve' });
});

test('normalizeUserConfig nulls out unusable player shapes', () => {
    assert.equal(normalizeUserConfig({}).player, null, 'missing');
    assert.equal(normalizeUserConfig({ player: null }).player, null, 'explicit null');
    assert.equal(normalizeUserConfig({ players: [] }).player, null, 'empty array');
    assert.equal(normalizeUserConfig({ player: {} }).player, null, 'object with no name');
});

test('normalizeUserConfig fills in missing defaults', () => {
    const cfg = normalizeUserConfig({});
    assert.equal(cfg.persistentDetection, false);
    assert.equal(cfg.joinNotify, false);
    assert.equal(cfg.afkDetection, false);
    assert.equal(cfg.afkThresholdMinutes, 10);
    assert.equal(cfg.defaultPlayer, null);
});

test('normalizeUserConfig preserves values that are already valid', () => {
    const cfg = normalizeUserConfig({
        player: { name: 'Steve' },
        persistentDetection: true,
        joinNotify: true,
        afkDetection: true,
        afkThresholdMinutes: 45
    });
    assert.equal(cfg.persistentDetection, true);
    assert.equal(cfg.joinNotify, true);
    assert.equal(cfg.afkDetection, true);
    assert.equal(cfg.afkThresholdMinutes, 45);
});

test('normalizeUserConfig repairs an out-of-range threshold', () => {
    assert.equal(normalizeUserConfig({ afkThresholdMinutes: 0 }).afkThresholdMinutes, 10);
    assert.equal(normalizeUserConfig({ afkThresholdMinutes: -5 }).afkThresholdMinutes, 10);
    assert.equal(
        normalizeUserConfig({ afkThresholdMinutes: '20' }).afkThresholdMinutes,
        10,
        'string is not a number'
    );
});

test('serializeUserConfig round-trips through normalize', () => {
    const original = normalizeUserConfig({ players: ['Steve'], afkThresholdMinutes: 15 });
    const onDisk = serializeUserConfig(original);
    assert.equal('players' in onDisk, false);
    assert.deepEqual(onDisk.player, { name: 'Steve' });
    assert.equal(onDisk.afkThresholdMinutes, 15);

    // Reloading what we wrote must not change anything.
    assert.deepEqual(normalizeUserConfig({ ...onDisk }), original);
});
