'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const PREFIX = '[SpoonAlert]';
const ROOT = path.join(__dirname, '..');

// SPOONALERT_CONFIG lets the tests point at a fixture instead of the real
// config.json, which is gitignored and so absent on a fresh clone.
// SPOONALERT_STATE_DIR redirects the three state files into a temp directory
// so tests can exercise code that saves without touching real user data.
const CONFIG_PATH = process.env.SPOONALERT_CONFIG || path.join(ROOT, 'config.json');
const STATE_DIR = process.env.SPOONALERT_STATE_DIR || ROOT;
const USER_CONFIGS_PATH = path.join(STATE_DIR, 'userConfigs.json');
const AFK_ALERTS_PATH = path.join(STATE_DIR, 'afkAlerts.json');
const AFK_TRACKING_PATH = path.join(STATE_DIR, 'afkTracking.json');

// config.json used to be a bare `require`, which throws SyntaxError (empty or
// truncated file) or MODULE_NOT_FOUND (fresh clone) before anything can
// explain why.
let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
    console.error(
        `${PREFIX} Could not read config.json: ${e.code === 'ENOENT' ? 'file not found' : e.message}\n` +
            '            Copy config.json.template to config.json and fill in your servers.'
    );
    process.exit(1);
}

const discordToken = process.env.DISCORD_TOKEN;
const ENV_ADMIN_USER_ID = process.env.ADMIN_USER_ID;

// Fail fast on missing credentials. An unset ADMIN_USER_ID is especially nasty:
// `interaction.user.id !== undefined` is always true, so the role commands
// silently reject everyone, including the owner, with no hint of the cause.
if (!discordToken) {
    console.error(`${PREFIX} DISCORD_TOKEN is not set. Add it to your .env file.`);
    process.exit(1);
}
if (!/^\d{17,20}$/.test(ENV_ADMIN_USER_ID || '')) {
    console.error(
        `${PREFIX} ADMIN_USER_ID is missing or malformed (expected a Discord user ID, 17-20 digits).\n` +
            '            Without it, nobody can use /admin-role-add or /admin-role-remove.'
    );
    process.exit(1);
}

/** Routine chatter, silenced by config.loggingEnabled. */
function log(...args) {
    if (config.loggingEnabled) {
        console.log(PREFIX, ...args);
    }
}

/**
 * Failures. Deliberately NOT gated on loggingEnabled -- turning off the
 * 30-second polling chatter should not also hide corrupt state files and
 * failed writes, which is what used to happen when every error path went
 * through log().
 */
function logError(...args) {
    console.error(PREFIX, ...args);
}

/** The configured servers, always an array. */
function servers() {
    return config.servers || [];
}

const POLL_ONLINE_MS = (config.pollIntervalOnlineSeconds ?? 30) * 1000;
const POLL_OFFLINE_MS = (config.pollIntervalOfflineSeconds ?? 120) * 1000;

module.exports = {
    config,
    servers,
    log,
    logError,
    discordToken,
    ENV_ADMIN_USER_ID,
    CONFIG_PATH,
    USER_CONFIGS_PATH,
    AFK_ALERTS_PATH,
    AFK_TRACKING_PATH,
    POLL_ONLINE_MS,
    POLL_OFFLINE_MS
};
