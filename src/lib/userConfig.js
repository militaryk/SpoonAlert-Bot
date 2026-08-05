'use strict';

const DEFAULT_AFK_THRESHOLD_MINUTES = 10;

// Written by older versions, read by nothing. Dropped on load so existing
// files shrink the first time they are saved.
const DEAD_FIELDS = ['lastState', 'defaultPlayer', 'deathNotify', 'wasOnline'];

/**
 * Bring one stored user config up to the current shape, in place.
 *
 * Three legacy player shapes exist in the wild from earlier versions: a
 * `players` array, `player` as an object, and `player` as a bare string. All
 * collapse to `{ name }`, or null when there is nothing usable.
 */
function normalizeUserConfig(cfg) {
    if (Array.isArray(cfg.players) && cfg.players.length > 0) {
        const first = cfg.players[0];
        const name = first && typeof first === 'object' ? first.name : first;
        cfg.player = name ? { name } : null;
    } else if (cfg.player && typeof cfg.player === 'object') {
        cfg.player = cfg.player.name ? { name: cfg.player.name } : null;
    } else if (cfg.player && typeof cfg.player === 'string') {
        cfg.player = { name: cfg.player };
    } else {
        cfg.player = null;
    }
    delete cfg.players;

    // Fields that were written every poll and never read. `wasOnline` in
    // particular is now in-memory only: a persisted `true` survived restarts
    // and re-enables and looked like a player who had just disconnected.
    for (const dead of DEAD_FIELDS) delete cfg[dead];

    // Serialisation is now an explicit allowlist rather than a spread, so
    // every field it writes needs a default here.
    if (typeof cfg.detection !== 'boolean') cfg.detection = true;
    if (typeof cfg.persistentDetection !== 'boolean') cfg.persistentDetection = false;
    if (typeof cfg.joinNotify !== 'boolean') cfg.joinNotify = false;
    if (typeof cfg.afkDetection !== 'boolean') cfg.afkDetection = false;
    if (typeof cfg.afkThresholdMinutes !== 'number' || cfg.afkThresholdMinutes < 1) {
        cfg.afkThresholdMinutes = DEFAULT_AFK_THRESHOLD_MINUTES;
    }
    return cfg;
}

/** Strip a user config down to exactly the fields that belong on disk. */
function serializeUserConfig(cfg) {
    return {
        player: cfg.player || null,
        detection: !!cfg.detection,
        persistentDetection: !!cfg.persistentDetection,
        joinNotify: !!cfg.joinNotify,
        afkDetection: !!cfg.afkDetection,
        afkThresholdMinutes: cfg.afkThresholdMinutes || DEFAULT_AFK_THRESHOLD_MINUTES
    };
}

module.exports = { DEFAULT_AFK_THRESHOLD_MINUTES, DEAD_FIELDS, normalizeUserConfig, serializeUserConfig };
