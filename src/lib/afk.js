'use strict';

// Squaremap reports floating point coordinates, so an exactly-still player
// still jitters slightly. Anything under this counts as not having moved.
const POSITION_TOLERANCE = 0.1;

/** Has the player moved from the last recorded position? */
function hasMoved(tracked, pos, tolerance = POSITION_TOLERANCE) {
    return (
        Math.abs(tracked.x - pos.x) > tolerance ||
        Math.abs(tracked.y - pos.y) > tolerance ||
        Math.abs(tracked.z - pos.z) > tolerance
    );
}

/** Does this user have at least one timed AFK alert that has not expired? */
function hasActiveAlert(userAlerts, now = Date.now()) {
    return Object.values(userAlerts || {}).some(alert => alert.expiresAt > now);
}

/** Has this tracked player been standing still for longer than their threshold? */
function isAfk(tracked, thresholdMinutes, now = Date.now()) {
    if (!tracked || typeof tracked.lastMoved !== 'number') return false;
    return now - tracked.lastMoved >= thresholdMinutes * 60 * 1000;
}

/** How long the player has been standing still, in whole minutes. */
function idleMinutes(tracked, now = Date.now()) {
    if (!tracked || typeof tracked.lastMoved !== 'number') return 0;
    return Math.floor((now - tracked.lastMoved) / 60000);
}

/**
 * Which alert, if any, does an observed disconnect warrant?
 *
 * Returns 'timer' | 'afk' | 'plain' | null.
 *
 * AFK detection acts as a FILTER rather than an extra notification: with it on,
 * a player who logs off mid-play is deliberately silent, and only a disconnect
 * that happened while they were standing still is worth hearing about. It does
 * not notify at the moment they go idle -- going AFK is the normal state for an
 * AFK farm, and being told about it every time is noise.
 *
 * A timed AFK alert wins over both, because arming it is an explicit,
 * time-boxed "tell me if they drop during this window".
 */
function disconnectAlertKind({ afkAlertActive, afkDetection, wasAfk, detection }) {
    if (afkAlertActive) return 'timer';
    if (afkDetection) return wasAfk ? 'afk' : null;
    if (detection) return 'plain';
    return null;
}

/**
 * Drop expired alerts from `afkAlerts` in place.
 *
 * Returns { changed, emptiedUsers }, where emptiedUsers lists users whose LAST
 * alert just expired -- the caller turns their detection back off and tells
 * them. A user is only reported if something was actually removed for them, so
 * an already-empty entry cannot trigger a spurious "your alert expired" DM.
 */
function pruneExpiredAlerts(afkAlerts, now = Date.now()) {
    const emptiedUsers = [];
    let changed = false;

    for (const [uid, alerts] of Object.entries(afkAlerts)) {
        let removedForUser = false;
        for (const [key, alert] of Object.entries(alerts)) {
            if (alert.expiresAt <= now) {
                delete alerts[key];
                removedForUser = true;
                changed = true;
            }
        }
        if (Object.keys(alerts).length === 0) {
            delete afkAlerts[uid];
            changed = true;
            if (removedForUser) emptiedUsers.push(uid);
        }
    }

    return { changed, emptiedUsers };
}

module.exports = {
    POSITION_TOLERANCE,
    hasMoved,
    hasActiveAlert,
    isAfk,
    idleMinutes,
    disconnectAlertKind,
    pruneExpiredAlerts
};
