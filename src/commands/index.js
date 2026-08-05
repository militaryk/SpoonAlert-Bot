'use strict';

const alerts = require('./alerts');
const player = require('./player');
const afk = require('./afk');
const admin = require('./admin');
const help = require('./help');

/**
 * Every command, keyed by name.
 *
 * This replaces a ~400-line if/else-if chain in one anonymous callback. That
 * shape hid a dead `/listplayers` branch that was never registered, had no
 * terminal `else` so unknown commands were silently never answered, and got
 * two of its branches physically merged onto one line during editing.
 */
const registry = new Map();

for (const command of [...alerts, ...player, ...afk, ...admin, ...help]) {
    if (registry.has(command.data.name)) {
        throw new Error(`Duplicate command definition: ${command.data.name}`);
    }
    registry.set(command.data.name, command);
}

/** JSON payload for the Discord command-registration API. */
function toJSON() {
    return [...registry.values()].map(command => command.data.toJSON());
}

function get(name) {
    return registry.get(name);
}

module.exports = { registry, get, toJSON };
