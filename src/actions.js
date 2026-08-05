'use strict';

const { DEFAULT_AFK_THRESHOLD_MINUTES } = require('./lib/userConfig');

const MAX_AFK_ALERT_HOURS = 168;
const MIN_AFK_THRESHOLD_MINUTES = 1;
const MAX_AFK_THRESHOLD_MINUTES = 60;

/**
 * State transitions, with no knowledge of Discord and no disk access.
 *
 * This is the layer a slash command and a button both call, so the two can
 * never drift apart. Callers are responsible for persisting afterwards via
 * store.save*(), which keeps these trivially testable.
 */

function setPlayer(userCfg, name) {
    userCfg.player = { name };
}

/** Returns true if a player was actually being monitored. */
function clearPlayer(userCfg) {
    const found = Boolean(userCfg.player);
    userCfg.player = null;
    return found;
}

function setDetection(userCfg, enabled) {
    userCfg.detection = enabled;
}

/** Flips persistent detection and returns the new value. */
function togglePersistent(userCfg) {
    userCfg.persistentDetection = !userCfg.persistentDetection;
    return userCfg.persistentDetection;
}

function setJoinNotify(userCfg, enabled) {
    userCfg.joinNotify = enabled;
}

function setAfkDetection(userCfg, enabled, minutes) {
    userCfg.afkDetection = enabled;
    if (enabled && typeof minutes === 'number') {
        userCfg.afkThresholdMinutes = minutes;
    }
}

/** Is this a threshold the AFK detector will accept? */
function isValidAfkThreshold(minutes) {
    return (
        Number.isInteger(minutes) &&
        minutes >= MIN_AFK_THRESHOLD_MINUTES &&
        minutes <= MAX_AFK_THRESHOLD_MINUTES
    );
}

/** Clamp a requested alert duration into the range the command advertises. */
function clampAlertHours(hours) {
    if (!hours || hours < 1) return 1;
    if (hours > MAX_AFK_ALERT_HOURS) return MAX_AFK_ALERT_HOURS;
    return hours;
}

/**
 * Arm a timed AFK alert for one player across every configured server.
 * Returns the shared expiry timestamp.
 */
function setAfkAlert(afkAlerts, userId, playerName, serverNames, hours, now = Date.now()) {
    const expiresAt = now + hours * 60 * 60 * 1000;
    if (!afkAlerts[userId]) afkAlerts[userId] = {};
    for (const serverName of serverNames) {
        afkAlerts[userId][`${playerName}|${serverName}`] = { expiresAt };
    }
    return expiresAt;
}

/** Returns true if anything was removed. */
function clearAfkAlerts(afkAlerts, userId) {
    if (!afkAlerts[userId]) return false;
    delete afkAlerts[userId];
    return true;
}

/** Returns true if anything was removed. */
function clearAfkTracking(afkTracking, userId) {
    if (!afkTracking[userId]) return false;
    delete afkTracking[userId];
    return true;
}

module.exports = {
    DEFAULT_AFK_THRESHOLD_MINUTES,
    MAX_AFK_ALERT_HOURS,
    MIN_AFK_THRESHOLD_MINUTES,
    MAX_AFK_THRESHOLD_MINUTES,
    setPlayer,
    clearPlayer,
    setDetection,
    togglePersistent,
    setJoinNotify,
    setAfkDetection,
    isValidAfkThreshold,
    clampAlertHours,
    setAfkAlert,
    clearAfkAlerts,
    clearAfkTracking
};
