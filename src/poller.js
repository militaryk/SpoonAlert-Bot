'use strict';

const fetch = require('node-fetch');

const { servers, log, logError, POLL_ONLINE_MS, POLL_OFFLINE_MS } = require('./config');
const { store, saveUserConfigs, saveAfkAlerts, saveAfkTracking } = require('./store');
const { hasMoved, hasActiveAlert, pruneExpiredAlerts } = require('./lib/afk');
const { sendDm } = require('./discord/client');

const FETCH_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 512 * 1024;

// --- Dynamic polling interval state ---
let pollIntervalHandle = null;
let lastAnyPlayerOnline = null;
let currentPollIntervalMs = null;

// Guards against overlapping ticks. A server that accepts the connection and
// then stalls used to park an await forever while the interval kept starting
// fresh runs on top of it; when the host recovered they all completed at once,
// each reading the same pre-update wasOnline and each firing a duplicate DM.
let pollInProgress = false;

/** Expire timed AFK alerts and tell anyone whose last one just ran out. */
function cleanupAfkAlerts() {
    const { changed, emptiedUsers } = pruneExpiredAlerts(store.afkAlerts);

    for (const uid of emptiedUsers) {
        // Only disable detection if persistentDetection is false
        if (store.userConfigs[uid] && !store.userConfigs[uid].persistentDetection) {
            store.userConfigs[uid].detection = false;
            saveUserConfigs();
            sendDm(
                uid,
                'Your AFK alert period has expired. Player disconnect detection is now disabled. Use `/afk-alert` or `/alert-enable` to re-enable.'
            );
        }
    }

    if (changed) saveAfkAlerts();
}

/** Is this the ordinary "server is down" case, or something worth a stack trace? */
function isUnreachableError(err) {
    return (
        err.code === 'ECONNREFUSED' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ENOTFOUND' ||
        err.type === 'system' ||
        err.type === 'request-timeout' ||
        err.type === 'max-size' ||
        (err.message && err.message.includes('Failed to fetch'))
    );
}

/** Fetch one server's player list, or null if it could not be read. */
async function fetchPlayers(serverObj) {
    try {
        // node-fetch defaults are timeout: 0 (wait forever) and size: 0
        // (unbounded body) -- both are wrong for an unattended poller.
        const res = await fetch(serverObj.url, { timeout: FETCH_TIMEOUT_MS, size: MAX_BODY_BYTES });
        if (!res.ok) {
            log(`Server ${serverObj.url} is offline or unreachable (HTTP ${res.status}).`);
            return null;
        }
        const data = await res.json();
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.players)) return data.players;
        logError(`Unexpected players.json structure from ${serverObj.url}`);
        return null;
    } catch (err) {
        if (isUnreachableError(err)) {
            log(`Server ${serverObj.url} is offline or unreachable.`);
        } else {
            log(`Error fetching ${serverObj.url}:`, err);
        }
        return null;
    }
}

/** Track standing-still time for one player and alert once per idle streak. */
async function updateAfkTracking(discordUserId, userCfg, playerName, serverName, player) {
    if (!store.afkTracking[discordUserId]) store.afkTracking[discordUserId] = {};

    const afkKey = `${playerName}|${serverName}`;
    const currentPos = { x: player.x, y: player.y, z: player.z };
    const now = Date.now();
    const tracked = store.afkTracking[discordUserId][afkKey];

    if (!tracked) {
        // First time tracking this player - initialize position
        store.afkTracking[discordUserId][afkKey] = {
            x: currentPos.x,
            y: currentPos.y,
            z: currentPos.z,
            lastMoved: now,
            alerted: false
        };
        saveAfkTracking();
        return;
    }

    if (hasMoved(tracked, currentPos)) {
        // Player moved - update position, reset timer, and re-arm the alert so
        // the next idle streak notifies again.
        tracked.x = currentPos.x;
        tracked.y = currentPos.y;
        tracked.z = currentPos.z;
        tracked.lastMoved = now;
        tracked.alerted = false;
        saveAfkTracking();
        return;
    }

    // Threshold is read live so /afk-enable takes effect on a player who is
    // already standing still.
    const timeSinceLastMove = now - tracked.lastMoved;
    const afkThresholdMs = userCfg.afkThresholdMinutes * 60 * 1000;

    // `alerted` latches until the player actually moves. This used to reset
    // lastMoved instead, which left the position unchanged -- so it re-fired
    // every threshold forever (~96 DMs overnight at 5 minutes) and every
    // message after the first misreported the idle time as one threshold.
    if (timeSinceLastMove >= afkThresholdMs && !tracked.alerted) {
        const afkMinutes = Math.floor(timeSinceLastMove / 60000);
        log(
            `AFK detection: Player "${playerName}" has been AFK for ${afkMinutes} minutes on server "${serverName}" (user ${discordUserId}). Sending DM.`
        );
        await sendDm(
            discordUserId,
            `🚨 **AFK Alert**: Player **${playerName}** has been inactive for ${afkMinutes} minutes on ${serverName}.\nLast position: X:${Math.round(tracked.x)}, Y:${Math.round(tracked.y)}, Z:${Math.round(tracked.z)}`
        );
        tracked.alerted = true;
        saveAfkTracking();
    }
}

/** Forget position tracking for a player who has gone offline. */
function dropAfkTracking(discordUserId, playerName, serverName) {
    const userTracking = store.afkTracking[discordUserId];
    if (!userTracking) return;
    const afkKey = `${playerName}|${serverName}`;
    if (!userTracking[afkKey]) return;

    delete userTracking[afkKey];
    if (Object.keys(userTracking).length === 0) {
        delete store.afkTracking[discordUserId];
    }
    saveAfkTracking();
}

/** Which users are watching which player, grouped by server. */
function buildServerMap() {
    const serverMap = {};
    for (const [discordUserId, userCfg] of Object.entries(store.userConfigs)) {
        // Include users who have detection OR join notifications OR AFK detection enabled
        if ((!userCfg.detection && !userCfg.joinNotify && !userCfg.afkDetection) || !userCfg.player) {
            continue;
        }
        const playerName = userCfg.player.name;
        for (const server of servers()) {
            if (!serverMap[server.name]) serverMap[server.name] = [];
            serverMap[server.name].push({ discordUserId, playerName });
        }
    }
    return serverMap;
}

/**
 * Turn detection back off for users whose player is offline everywhere, unless
 * they asked for persistent detection or have a live AFK alert.
 */
function autoDisableDetection() {
    for (const [discordUserId, userCfg] of Object.entries(store.userConfigs)) {
        if (userCfg.persistentDetection || !userCfg.detection || !userCfg.player) continue;

        // Must check expiry, not just presence -- counting keys meant a single
        // stale entry pinned this user's detection on forever.
        if (hasActiveAlert(store.afkAlerts[discordUserId])) continue;

        const playerName = userCfg.player.name;
        const anyOnline = servers().some(
            server => userCfg.wasOnline && userCfg.wasOnline[`${playerName}|${server.name}`]
        );
        if (!anyOnline) {
            userCfg.detection = false;
            saveUserConfigs();
            // No notification sent to user
        }
    }
}

/** Poll faster while someone is online, slower when nobody is. */
function adjustPollInterval(anyPlayerOnline) {
    const desiredInterval = anyPlayerOnline ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
    if (lastAnyPlayerOnline === null || lastAnyPlayerOnline !== anyPlayerOnline) {
        if (currentPollIntervalMs !== desiredInterval) {
            startPolling(desiredInterval);
            log(
                `Polling interval set to ${desiredInterval / 1000} seconds (${anyPlayerOnline ? 'players online' : 'no players online'})`
            );
        }
        lastAnyPlayerOnline = anyPlayerOnline;
    }
}

async function checkPlayerStatus() {
    try {
        // This was a complete function with zero call sites, so alerts never
        // expired, the "your AFK alert expired" DM never fired, and one stale
        // entry pinned a user's detection on forever.
        cleanupAfkAlerts();

        let anyPlayerOnline = false;
        const serverMap = buildServerMap();

        // For each server, fetch players.json once
        for (const [serverName, tracked] of Object.entries(serverMap)) {
            const serverObj = servers().find(s => s.name === serverName);
            if (!serverObj) continue;

            const playersArr = await fetchPlayers(serverObj);
            if (!playersArr) continue;

            // For each tracked player on this server
            for (const { discordUserId, playerName } of tracked) {
                const userCfg = store.userConfigs[discordUserId];
                if (!userCfg) continue;

                const key = `${playerName}|${serverName}`;
                const player = playersArr.find(p => p.name === playerName);
                const online = Boolean(player);
                if (online) anyPlayerOnline = true;

                if (userCfg.afkDetection && online) {
                    await updateAfkTracking(discordUserId, userCfg, playerName, serverName, player);
                } else if (!online) {
                    dropAfkTracking(discordUserId, playerName, serverName);
                }

                // --- Player join alert logic ---
                if (userCfg.joinNotify && userCfg.wasOnline && !userCfg.wasOnline[key] && online) {
                    log(
                        `Join alert: Player "${playerName}" joined server "${serverName}" (user ${discordUserId}). Sending DM.`
                    );
                    await sendDm(
                        discordUserId,
                        `Player **${playerName}** has joined the server (${serverName}).`
                    );
                }

                // --- Disconnect alerts ---
                // One message per disconnect. The AFK-alert branch used to fetch
                // the user, log "Sending AFK DM" and then send nothing; users only
                // ever got a DM because the generic branch has a strictly weaker
                // condition and fired in the same iteration. These are now
                // mutually exclusive, and the AFK branch sends its own message.
                const disconnected =
                    userCfg.detection && userCfg.wasOnline && userCfg.wasOnline[key] && !online;
                const userAlerts = store.afkAlerts[discordUserId];
                const afkAlertActive =
                    userAlerts && userAlerts[key] && userAlerts[key].expiresAt > Date.now();

                if (disconnected && afkAlertActive) {
                    log(
                        `AFK alert: Player "${playerName}" disconnected from server "${serverName}" (user ${discordUserId}). Sending AFK DM.`
                    );
                    await sendDm(
                        discordUserId,
                        `⏰ **AFK Alert**: Player **${playerName}** has disconnected from ${serverName} during your AFK alert window.`
                    );
                    delete userAlerts[key];
                    if (Object.keys(userAlerts).length === 0) {
                        delete store.afkAlerts[discordUserId];
                    }
                    saveAfkAlerts();
                } else if (disconnected) {
                    log(
                        `Disconnect alert: Player "${playerName}" disconnected from server "${serverName}" (user ${discordUserId}). Sending DM.`
                    );
                    await sendDm(
                        discordUserId,
                        `Player **${playerName}** has disconnected from the server (${serverName}).`
                    );
                }

                if (!userCfg.lastState) userCfg.lastState = {};
                userCfg.lastState[key] = { online, dead: false };

                if (!userCfg.wasOnline) userCfg.wasOnline = {};
                userCfg.wasOnline[key] = online;
            }
        }

        autoDisableDetection();
        adjustPollInterval(anyPlayerOnline);
    } catch (err) {
        log('Uncaught error in checkPlayerStatus:', err);
    }
}

/** Start, or restart at a new interval, the polling loop. */
function startPolling(intervalMs) {
    if (pollIntervalHandle) clearInterval(pollIntervalHandle);
    currentPollIntervalMs = intervalMs;
    pollIntervalHandle = setInterval(async () => {
        if (pollInProgress) {
            log('Previous poll still running, skipping this tick.');
            return;
        }
        pollInProgress = true;
        try {
            await checkPlayerStatus();
        } catch (err) {
            log('Error in checkPlayerStatus interval:', err);
        } finally {
            pollInProgress = false;
        }
    }, intervalMs);
}

module.exports = { checkPlayerStatus, startPolling, cleanupAfkAlerts };
