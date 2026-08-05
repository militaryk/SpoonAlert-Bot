'use strict';

const BOT_VERSION = require('../package.json').version;
const BOT_START_TIME = Date.now();

// Counted since the last restart. The increment used to sit after the whole
// if/else chain, so every command that returned early -- all five admin
// commands and every validation failure -- was never counted at all.
let usageCount = 0;

function recordUsage() {
    usageCount += 1;
}

function getUsageCount() {
    return usageCount;
}

module.exports = { BOT_VERSION, BOT_START_TIME, recordUsage, getUsageCount };
