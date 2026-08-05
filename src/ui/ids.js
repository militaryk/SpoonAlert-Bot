'use strict';

/**
 * Every customId the panel uses, in one place so rendering and routing cannot
 * drift apart.
 *
 * The scheme is `sa:<kind>:<arg>` and carries no state of its own: everything
 * needed to handle a click is re-read from the store using interaction.user.id.
 * That is what lets a panel keep working after the bot restarts -- a collector
 * would have died with the process, and Discord's 100-character limit means
 * there is no room to smuggle state through here anyway.
 */
const PREFIX = 'sa';

const TOGGLE = {
    DETECTION: `${PREFIX}:t:detection`,
    JOIN: `${PREFIX}:t:join`,
    AFK: `${PREFIX}:t:afk`,
    PERSIST: `${PREFIX}:t:persist`
};

const VIEW = {
    MAIN: `${PREFIX}:v:main`,
    AFK_TIMER: `${PREFIX}:v:afktimer`,
    AFK_THRESHOLD: `${PREFIX}:v:afkthreshold`,
    SERVERS: `${PREFIX}:v:servers`,
    ADMIN: `${PREFIX}:v:admin`
};

const ACTION = {
    REFRESH: `${PREFIX}:a:refresh`,
    SET_PLAYER: `${PREFIX}:a:setplayer`,
    STOP_PLAYER: `${PREFIX}:a:stopplayer`
};

const SELECT = {
    AFK_HOURS: `${PREFIX}:s:hours`,
    AFK_THRESHOLD: `${PREFIX}:s:threshold`
};

const MODAL = {
    PLAYER: `${PREFIX}:mo:player`,
    PLAYER_INPUT: `${PREFIX}:mo:player:name`
};

/** Does this interaction belong to the panel at all? */
function isPanelId(customId) {
    return typeof customId === 'string' && customId.startsWith(`${PREFIX}:`);
}

module.exports = { PREFIX, TOGGLE, VIEW, ACTION, SELECT, MODAL, isPanelId };
