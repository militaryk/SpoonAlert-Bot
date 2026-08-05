'use strict';

const spoon = require('./spoon');
const admin = require('./admin');
const help = require('./help');

/**
 * Every command, keyed by name.
 *
 * This replaces a ~400-line if/else-if chain in one anonymous callback. That
 * shape hid a dead `/listplayers` branch that was never registered, had no
 * terminal `else` so unknown commands were silently never answered, and got
 * two of its branches physically merged onto one line during editing.
 *
 * The twelve toggle and status commands that used to live here are now buttons
 * on the /spoon panel. rest.put replaces the whole command set, so they
 * disappear from autocomplete on the next start with no manual deregistration.
 */
const registry = new Map();

for (const command of [...spoon, ...admin, ...help]) {
    if (registry.has(command.data.name)) {
        throw new Error(`Duplicate command definition: ${command.data.name}`);
    }
    registry.set(command.data.name, command);
}

// Derived from the module itself, so it cannot drift from what admin.js exports.
const ADMIN_COMMAND_NAMES = new Set(admin.map(command => command.data.name));

/**
 * JSON payload for the Discord command-registration API.
 *
 * With ADMIN_GUILD_ID set, the admin commands are registered only into that
 * one guild, so they are not even visible anywhere else.
 */
function toJSON({ includeAdmin = true } = {}) {
    return [...registry.values()]
        .filter(command => includeAdmin || !ADMIN_COMMAND_NAMES.has(command.data.name))
        .map(command => command.data.toJSON());
}

function get(name) {
    return registry.get(name);
}

module.exports = { registry, get, toJSON, ADMIN_COMMAND_NAMES };
