'use strict';

const path = require('path');

const {
    config,
    servers,
    log,
    logError,
    CONFIG_PATH,
    USER_CONFIGS_PATH,
    AFK_ALERTS_PATH,
    AFK_TRACKING_PATH
} = require('./config');
const { loadJson, writeJsonAtomic, quarantineCorrupt } = require('./lib/jsonStore');
const {
    normalizeUserConfig,
    serializeUserConfig,
    DEFAULT_AFK_THRESHOLD_MINUTES
} = require('./lib/userConfig');

/**
 * All mutable persisted state lives on this one object rather than in
 * module-level `let`s, so every importer sees the same reference even when a
 * load replaces the contents.
 */
const store = {
    userConfigs: {},
    afkAlerts: {},
    afkTracking: {}
};

/**
 * A corrupt userConfigs.json is FATAL: continuing with {} silently discards
 * everyone's settings, and the next command to run would serialise that empty
 * object straight back over the file, making the loss permanent.
 */
function loadUserConfigs() {
    const { value, status, error } = loadJson(USER_CONFIGS_PATH, {});
    if (status === 'corrupt') {
        const moved = quarantineCorrupt(USER_CONFIGS_PATH);
        logError(`userConfigs.json could not be parsed: ${error.message}`);
        logError(`It has been moved to ${path.basename(moved)}.`);
        logError('Refusing to start with empty settings -- fix or remove that file, then restart.');
        process.exit(1);
    }
    for (const cfg of Object.values(value)) {
        normalizeUserConfig(cfg);
    }
    store.userConfigs = value;
}

/**
 * The AFK caches are derived state that rebuilds itself over the next few
 * polls, so unlike userConfigs a corrupt file is recoverable: quarantine it,
 * say so loudly, and carry on empty.
 */
function loadAfkCache(filePath, label) {
    const { value, status, error } = loadJson(filePath, {});
    if (status === 'corrupt') {
        const moved = quarantineCorrupt(filePath);
        logError(`${label} could not be parsed: ${error.message}`);
        logError(`Moved to ${path.basename(moved)}; continuing with an empty cache.`);
    }
    return value;
}

function loadAll() {
    loadUserConfigs();
    store.afkAlerts = loadAfkCache(AFK_ALERTS_PATH, 'afkAlerts.json');
    store.afkTracking = loadAfkCache(AFK_TRACKING_PATH, 'afkTracking.json');
}

function saveUserConfigs() {
    try {
        const serializable = {};
        for (const [uid, cfg] of Object.entries(store.userConfigs)) {
            serializable[uid] = serializeUserConfig(cfg);
        }
        writeJsonAtomic(USER_CONFIGS_PATH, serializable);
    } catch (e) {
        logError('Failed to save userConfigs:', e);
    }
}

function saveAfkAlerts() {
    try {
        writeJsonAtomic(AFK_ALERTS_PATH, store.afkAlerts);
    } catch (e) {
        logError('Failed to save afkAlerts:', e);
    }
}

function saveAfkTracking() {
    try {
        writeJsonAtomic(AFK_TRACKING_PATH, store.afkTracking);
    } catch (e) {
        logError('Failed to save afkTracking:', e);
    }
}

/**
 * Persist config.json after an admin edits the server list. Returns false
 * rather than throwing: an EACCES/EBUSY here used to escape the interaction
 * handler entirely, so the write failed AND the user was left staring at
 * "The application did not respond".
 */
function saveConfig() {
    try {
        writeJsonAtomic(CONFIG_PATH, config);
        return true;
    } catch (e) {
        logError('Failed to save config.json:', e);
        return false;
    }
}

function defaultUserConfig() {
    return {
        player: null,
        detection: true,
        joinNotify: false,
        afkDetection: false,
        afkThresholdMinutes: DEFAULT_AFK_THRESHOLD_MINUTES,
        persistentDetection: false
    };
}

/**
 * Fetch a user's config, creating it on first use.
 *
 * `persist: false` hands back defaults without minting a permanent record, so
 * read-only interactions do not create an entry (and a full-file write) for
 * everyone who ever pressed a button.
 */
function getUserConfig(userId, { persist = true } = {}) {
    if (!store.userConfigs[userId]) {
        if (!persist) return defaultUserConfig();
        store.userConfigs[userId] = defaultUserConfig();
        log(`Created config for new user ${userId}.`);
        saveUserConfigs();
    }
    return store.userConfigs[userId];
}

/**
 * Drop state keyed to servers that no longer exist or to players nobody is
 * watching any more. Without this, removing a server left keys that no poll
 * could ever match, to be re-parsed on every startup forever.
 */
function pruneOrphanedState() {
    const serverNames = new Set(servers().map(s => s.name));
    let removed = 0;

    for (const collection of [store.afkAlerts, store.afkTracking]) {
        for (const [uid, entries] of Object.entries(collection)) {
            const userCfg = store.userConfigs[uid];
            const currentPlayer = userCfg && userCfg.player ? userCfg.player.name : null;

            for (const key of Object.keys(entries)) {
                const [playerName, serverName] = key.split('|');
                if (!serverNames.has(serverName) || playerName !== currentPlayer) {
                    delete entries[key];
                    removed++;
                }
            }
            if (Object.keys(entries).length === 0) delete collection[uid];
        }
    }

    if (removed > 0) {
        log(`Pruned ${removed} orphaned state entr${removed === 1 ? 'y' : 'ies'}.`);
        saveAfkAlerts();
        saveAfkTracking();
    }
    return removed;
}

module.exports = {
    store,
    loadAll,
    getUserConfig,
    defaultUserConfig,
    pruneOrphanedState,
    saveUserConfigs,
    saveAfkAlerts,
    saveAfkTracking,
    saveConfig
};
