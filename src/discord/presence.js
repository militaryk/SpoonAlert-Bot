'use strict';

const { ActivityType } = require('discord.js');

const ACTIVITY_ROTATE_MS = 5 * 60 * 1000;

// Types are the v14 enum directly. These used to be v13 strings ('WATCHING')
// remapped at call time by a three-branch if/else that silently fell back to
// Playing for anything it did not recognise.
const funnyActivities = [
    { type: ActivityType.Playing, name: 'hide and seek with creepers' },
    { type: ActivityType.Watching, name: 'Steve trip over blocks' },
    { type: ActivityType.Listening, name: 'pigstep on repeat' },
    { type: ActivityType.Playing, name: 'AFK Olympics' },
    { type: ActivityType.Watching, name: 'the grass grow' },
    { type: ActivityType.Playing, name: 'tag with Endermen' },
    { type: ActivityType.Watching, name: 'for disconnects...' }
];

function setRandomActivity(client) {
    const activity = funnyActivities[Math.floor(Math.random() * funnyActivities.length)];
    client.user.setActivity(activity.name, { type: activity.type });
}

/** Set an activity now, then rotate it every five minutes. */
function startPresenceRotation(client) {
    setRandomActivity(client);
    return setInterval(() => setRandomActivity(client), ACTIVITY_ROTATE_MS);
}

module.exports = { funnyActivities, setRandomActivity, startPresenceRotation };
