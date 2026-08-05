'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { formatUptime, formatTimeLeft } = require('../src/lib/time');

test('formatUptime omits leading zero units', () => {
    assert.equal(formatUptime(0), '0s');
    assert.equal(formatUptime(45 * 1000), '45s');
    assert.equal(formatUptime(5 * 60000 + 3000), '5m 3s');
    assert.equal(formatUptime(2 * 3600000 + 5 * 60000 + 3000), '2h 5m 3s');
    assert.equal(formatUptime(26 * 3600000), '1d 2h 0s', 'zero minutes in the middle is dropped');
});

test('formatTimeLeft renders hours and minutes', () => {
    assert.equal(formatTimeLeft(0), '0m left');
    assert.equal(formatTimeLeft(20 * 60000), '20m left');
    assert.equal(formatTimeLeft(3 * 3600000 + 20 * 60000), '3h 20m left');
    assert.equal(formatTimeLeft(3 * 3600000), '3h left', 'exact hour omits minutes');
});

test('formatTimeLeft carries rounded minutes into the hour', () => {
    // 59m 40s rounds to 60 minutes, which must render as 1h -- not "0h 60m".
    assert.equal(formatTimeLeft(59 * 60000 + 40 * 1000), '1h left');
    assert.equal(formatTimeLeft(3600000 + 59 * 60000 + 40 * 1000), '2h left');
});
