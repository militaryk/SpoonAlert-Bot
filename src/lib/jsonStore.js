'use strict';

const fs = require('fs');

/**
 * Write JSON via a temp file + rename.
 *
 * Every save used to be a bare writeFileSync over the live path, so a crash,
 * a kill, or an OneDrive/antivirus lock partway through left a truncated file
 * behind -- which the loader then failed to parse, silently resetting every
 * user's settings. rename() is atomic on the same filesystem, so a reader ever
 * only sees the old file or the complete new one.
 */
function writeJsonAtomic(filePath, value) {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

/**
 * Move an unparseable file aside so its contents can still be recovered by
 * hand, instead of leaving it to be silently overwritten by the next save.
 * Returns the path it was moved to.
 */
function quarantineCorrupt(filePath, stamp = Date.now()) {
    const target = `${filePath}.corrupt-${stamp}`;
    fs.renameSync(filePath, target);
    return target;
}

/**
 * Read a JSON file without throwing.
 * Returns { value, status } where status is 'ok' | 'missing' | 'corrupt'.
 * Callers decide what a corrupt file means for them -- for userConfigs it is
 * fatal, for the AFK caches it is recoverable.
 */
function loadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return { value: fallback, status: 'missing' };
    }
    try {
        return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), status: 'ok' };
    } catch (error) {
        return { value: fallback, status: 'corrupt', error };
    }
}

module.exports = { writeJsonAtomic, quarantineCorrupt, loadJson };
