'use strict';

/** Uptime as "1d 2h 3m 4s", omitting leading units that are zero. */
function formatUptime(ms) {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return (days ? `${days}d ` : '') + (hours ? `${hours}h ` : '') + (mins ? `${mins}m ` : '') + `${secs}s`;
}

/**
 * Remaining time as "3h 20m left". Minutes are rounded, so 59.6 minutes has to
 * carry into the hour rather than rendering as "0h 60m left".
 */
function formatTimeLeft(msLeft) {
    let hours = Math.floor(msLeft / 3600000);
    let mins = Math.round((msLeft % 3600000) / 60000);
    if (mins === 60) {
        hours += 1;
        mins = 0;
    }
    if (hours > 0) {
        return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
    }
    return `${mins}m left`;
}

module.exports = { formatUptime, formatTimeLeft };
