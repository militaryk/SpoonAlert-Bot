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

module.exports = { POSITION_TOLERANCE, hasMoved, hasActiveAlert, pruneExpiredAlerts };
