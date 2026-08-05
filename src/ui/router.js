'use strict';

const { MessageFlags } = require('discord.js');

const { servers, log } = require('../config');
const { store, getUserConfig, saveUserConfigs, saveAfkAlerts, saveAfkTracking } = require('../store');
const actions = require('../actions');
const { isAdmin } = require('../permissions');
const { TOGGLE, VIEW, ACTION, SELECT, MODAL } = require('./ids');
const {
    renderPanel,
    renderAfkTimer,
    renderAfkThreshold,
    renderServers,
    renderAdmin,
    buildPlayerModal
} = require('./panel');

/** The dashboard, always rebuilt from current state. */
function mainView(interaction, userCfg) {
    return renderPanel(userCfg, store.afkAlerts[interaction.user.id], {
        isAdmin: isAdmin(interaction)
    });
}

/**
 * Handle a button click or select-menu choice.
 *
 * Every branch ends in interaction.update(), which edits the panel in place.
 * Nothing is looked up from memory keyed by message -- the user id on the
 * interaction is enough -- so a panel rendered before a restart still works.
 */
async function handleComponent(interaction) {
    const userId = interaction.user.id;
    const userCfg = getUserConfig(userId);
    const id = interaction.customId;

    switch (id) {
        // --- toggles ---
        case TOGGLE.DETECTION: {
            const enabled = !userCfg.detection;
            actions.setDetection(userCfg, enabled);
            // Switching detection off also drops any timed alert, matching what
            // /alert-disable always did.
            if (!enabled && actions.clearAfkAlerts(store.afkAlerts, userId)) {
                saveAfkAlerts();
            }
            saveUserConfigs();
            log(`Panel: ${interaction.user.tag} set disconnect detection ${enabled ? 'on' : 'off'}.`);
            return interaction.update(mainView(interaction, userCfg));
        }

        case TOGGLE.JOIN: {
            actions.setJoinNotify(userCfg, !userCfg.joinNotify);
            saveUserConfigs();
            return interaction.update(mainView(interaction, userCfg));
        }

        case TOGGLE.AFK: {
            const enabled = !userCfg.afkDetection;
            actions.setAfkDetection(userCfg, enabled, userCfg.afkThresholdMinutes);
            // Position history is meaningless once detection is off.
            if (!enabled && actions.clearAfkTracking(store.afkTracking, userId)) {
                saveAfkTracking();
            }
            saveUserConfigs();
            return interaction.update(mainView(interaction, userCfg));
        }

        case TOGGLE.PERSIST: {
            actions.togglePersistent(userCfg);
            saveUserConfigs();
            return interaction.update(mainView(interaction, userCfg));
        }

        // --- navigation ---
        case VIEW.MAIN:
        case ACTION.REFRESH:
            return interaction.update(mainView(interaction, userCfg));

        case VIEW.AFK_TIMER:
            return interaction.update(renderAfkTimer(userCfg, store.afkAlerts[userId]));

        case VIEW.AFK_THRESHOLD:
            return interaction.update(renderAfkThreshold(userCfg));

        case VIEW.SERVERS:
            return interaction.update(renderServers());

        case VIEW.ADMIN:
            return interaction.update(renderAdmin());

        // --- player ---
        case ACTION.SET_PLAYER:
            // showModal IS the response, so it must not be preceded by update().
            return interaction.showModal(buildPlayerModal(userCfg.player && userCfg.player.name));

        case ACTION.STOP_PLAYER: {
            actions.clearPlayer(userCfg);
            // Leaving these behind would strand keys no poll can ever match
            // again, permanently pinning detection on.
            actions.clearAfkAlerts(store.afkAlerts, userId);
            actions.clearAfkTracking(store.afkTracking, userId);
            saveAfkAlerts();
            saveAfkTracking();
            saveUserConfigs();
            log(`Panel: ${interaction.user.tag} stopped monitoring their player.`);
            return interaction.update(mainView(interaction, userCfg));
        }

        // --- select menus ---
        case SELECT.AFK_HOURS: {
            const choice = interaction.values[0];
            if (choice === 'cancel') {
                if (actions.clearAfkAlerts(store.afkAlerts, userId)) saveAfkAlerts();
                log(`Panel: ${interaction.user.tag} cancelled their AFK timer.`);
                return interaction.update(mainView(interaction, userCfg));
            }
            if (!userCfg.player) {
                return interaction.update(mainView(interaction, userCfg));
            }

            const hours = actions.clampAlertHours(Number(choice));
            actions.setAfkAlert(
                store.afkAlerts,
                userId,
                userCfg.player.name,
                servers().map(s => s.name),
                hours
            );
            saveAfkAlerts();
            // An alert is pointless without detection running.
            actions.setDetection(userCfg, true);
            saveUserConfigs();
            log(`Panel: ${interaction.user.tag} set an AFK timer for ${hours}h.`);
            return interaction.update(mainView(interaction, userCfg));
        }

        case SELECT.AFK_THRESHOLD: {
            const minutes = Number(interaction.values[0]);
            if (!actions.isValidAfkThreshold(minutes)) {
                return interaction.update(mainView(interaction, userCfg));
            }
            actions.setAfkDetection(userCfg, true, minutes);
            saveUserConfigs();
            log(`Panel: ${interaction.user.tag} set the AFK threshold to ${minutes}m.`);
            return interaction.update(mainView(interaction, userCfg));
        }

        default:
            log(`Unrecognised panel component: ${id}`);
            return interaction.reply({
                content: 'That button is from an older version of the panel. Run `/spoon` again.',
                flags: MessageFlags.Ephemeral
            });
    }
}

/** Handle a submitted modal. */
async function handleModal(interaction) {
    if (interaction.customId !== MODAL.PLAYER) return;

    const userId = interaction.user.id;
    const userCfg = getUserConfig(userId);
    const name = interaction.fields.getTextInputValue(MODAL.PLAYER_INPUT).trim();

    if (!actions.isValidPlayerName(name)) {
        return interaction.reply({
            content:
                `**${name}** is not a valid Minecraft username. ` +
                'Use 3-16 characters, letters, numbers and underscores only.',
            flags: MessageFlags.Ephemeral
        });
    }

    const previous = userCfg.player && userCfg.player.name;
    if (previous && previous !== name) {
        // The old name is baked into every composite key, so its leftovers
        // would never be matched again.
        actions.clearAfkAlerts(store.afkAlerts, userId);
        actions.clearAfkTracking(store.afkTracking, userId);
        saveAfkAlerts();
        saveAfkTracking();
    }

    actions.setPlayer(userCfg, name);
    saveUserConfigs();
    log(`Panel: ${interaction.user.tag} is now monitoring "${name}".`);

    // A modal opened from a component can edit the panel it came from; one
    // opened any other way has no message to update.
    if (interaction.isFromMessage()) {
        return interaction.update(mainView(interaction, userCfg));
    }
    return interaction.reply({
        content: `Now monitoring **${name}**. Run \`/spoon\` to open your panel.`,
        flags: MessageFlags.Ephemeral
    });
}

module.exports = { handleComponent, handleModal, mainView };
