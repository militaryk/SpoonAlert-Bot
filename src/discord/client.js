'use strict';

const { Client, GatewayIntentBits } = require('discord.js');

const { log } = require('../config');

// Sending a DM needs neither the DirectMessages intent nor a Channel partial --
// those are for *receiving* them, which this bot never does. The old config
// also used `partials: ['CHANNEL']`, which is v13 string syntax that silently
// matched nothing on v14 anyway.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/**
 * Every DM goes through here.
 *
 * Each site used to do a bare, unawaited `user.send()`. That promise rejects
 * with 50007 whenever the recipient has DMs off or has blocked the bot, and an
 * unhandled rejection terminates Node 15+ -- taking down alerts for every
 * other user. This never throws, so a caller inside the poll loop cannot be
 * unwound by one undeliverable message.
 */
async function sendDm(userId, content) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(content);
        return true;
    } catch (err) {
        log(`Could not DM ${userId}:`, err.code || err.message || err);
        return false;
    }
}

module.exports = { client, sendDm };
