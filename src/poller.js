'use strict';

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
// each reading the same pre-update presence and each firing a duplicate DM.
let pollInProgress = false;

/**
 * "player|server" -> was this player online at the previous poll?
 *
 * Deliberately in-memory. This used to live in userConfigs and was written on
 * every poll but only saved incidentally, which caused two bugs: a stale `true`
 * survived a restart or an /alert-disable and then looked exactly like a player
 * who had just disconnected, and a missing entry was falsy, so "never observed"
 * was indistinguishable from "was offline" and produced a fake join alert.
 *
 * An empty map at startup is correct: the first observation of any key only
 * seeds it, and alerts start from the second poll onwards.
 */
const lastSeenOnline = new Map();

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

/**
 * Is this the ordinary "server is down" case, or something worth a stack trace?
 *
 * Node's built-in fetch (undici) nests the socket error under err.cause, where
 * node-fetch put it on the error itself -- miss that and every offline-server
 * poll dumps a stack trace instead of one tidy line.
 */
function isUnreachableError(err) {
    const code = (err.cause && err.cause.code) || err.code;
    return (
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN' ||
        code === 'ECONNRESET' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'UND_ERR_HEADERS_TIMEOUT' ||
        err.name === 'AbortError' ||
        err.name === 'TimeoutError' ||
        (err.message && err.message.includes('fetch failed'))
    );
}

/** Fetch one server's player list, or null if it could not be read. */
async function fetchPlayers(serverObj) {
    // Global fetch has no timeout at all by default, which for an unattended
    // poller means a host that stalls after the handshake parks forever.
    const abort = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(serverObj.url, { signal: abort });
        if (!res.ok) {
            log(`Server ${serverObj.url} is offline or unreachable (HTTP ${res.status}).`);
            return null;
        }

        // undici has no size cap either, so cap it here rather than trusting a
        // remote host to send something sensible.
        const declared = Number(res.headers.get('content-length'));
        if (declared > MAX_BODY_BYTES) {
            logError(`players.json from ${serverObj.url} is too large (${declared} bytes); skipping.`);
            return null;
        }
        const body = await res.text();
        if (body.length > MAX_BODY_BYTES) {
            logError(`players.json from ${serverObj.url} is too large; skipping.`);
            return null;
        }

        const data = JSON.parse(body);
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.players)) return data.players;
        logError(`Unexpected players.json structure from ${serverObj.url}`);
        return null;
    } catch (err) {
        if (isUnreachableError(err)) {
            log(`Server ${serverObj.url} is offline or unreachable.`);
        } else {
            log(`Error fetching ${serverObj.url}:`, err.message || err);
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
        // Unobserved keys are `undefined`, which is correctly not "online" --
        // but a user whose player has never been observed at all is skipped
        // below so a restart cannot instantly disable their detection.
        const keys = servers().map(server => `${playerName}|${server.name}`);
        if (keys.every(key => !lastSeenOnline.has(key))) continue;

        const anyOnline = keys.some(key => lastSeenOnline.get(key));
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

                // undefined means we have never seen this key before, which is
                // neither a join nor a disconnect -- only a starting point.
                const previouslyOnline = lastSeenOnline.get(key);
                const firstObservation = previouslyOnline === undefined;
                lastSeenOnline.set(key, online);

                if (userCfg.afkDetection && online) {
                    await updateAfkTracking(discordUserId, userCfg, playerName, serverName, player);
                } else if (!online) {
                    dropAfkTracking(discordUserId, playerName, serverName);
                }

                if (firstObservation) {
                    // Seeded above; alerting starts from the next poll.
                    continue;
                }

                // --- Player join alert logic ---
                if (userCfg.joinNotify && !previouslyOnline && online) {
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
                const disconnected = userCfg.detection && previouslyOnline && !online;
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

module.exports = {
    checkPlayerStatus,
    startPolling,
    cleanupAfkAlerts,
    lastSeenOnline,
    // Exported for tests: the undici error shapes are the risky part of having
    // dropped node-fetch.
    fetchPlayers,
    isUnreachableError
};
