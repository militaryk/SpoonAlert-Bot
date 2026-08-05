'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.SPOONALERT_CONFIG = path.join(__dirname, 'fixtures', 'config.json');
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.ADMIN_USER_ID = '123456789012345678';

const panel = require('../src/ui/panel');
const { TOGGLE, VIEW, ACTION, SELECT, MODAL, isPanelId } = require('../src/ui/ids');

// discord.js button styles
const PRIMARY = 1;
const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;

function baseConfig(overrides = {}) {
    return {
        player: null,
        detection: true,
        joinNotify: false,
        afkDetection: false,
        afkThresholdMinutes: 10,
        persistentDetection: false,
        ...overrides
    };
}

/** Flatten a rendered view into { custom_id: buttonJson }. */
function buttonsById(view) {
    const out = {};
    for (const row of view.components) {
        for (const component of row.toJSON().components) {
            out[component.custom_id] = component;
        }
    }
    return out;
}

test('every panel custom id is namespaced and within Discord limits', () => {
    const all = [
        ...Object.values(TOGGLE),
        ...Object.values(VIEW),
        ...Object.values(ACTION),
        ...Object.values(SELECT),
        ...Object.values(MODAL)
    ];
    for (const id of all) {
        assert.ok(isPanelId(id), `${id} is recognised as a panel id`);
        assert.ok(id.length <= 100, `${id} is within the 100 character limit`);
    }
    assert.equal(new Set(all).size, all.length, 'no duplicate custom ids');
});

test('with no player set, the toggles are disabled and setup is highlighted', () => {
    const view = panel.renderPanel(baseConfig(), undefined);
    const buttons = buttonsById(view);

    for (const id of Object.values(TOGGLE)) {
        assert.equal(buttons[id].disabled, true, `${id} disabled without a player`);
    }
    assert.equal(buttons[ACTION.SET_PLAYER].label, 'Set player');
    assert.equal(buttons[ACTION.SET_PLAYER].style, PRIMARY, 'nudges the user to start here');
    assert.equal(buttons[ACTION.STOP_PLAYER].disabled, true);
    assert.equal(buttons[VIEW.AFK_TIMER].disabled, true);
    assert.equal(buttons[VIEW.AFK_THRESHOLD].disabled, true);
    assert.match(view.embeds[0].description, /Start by setting/);
});

test('with a player set, the toggles become usable', () => {
    const view = panel.renderPanel(baseConfig({ player: { name: 'Steve' } }), undefined);
    const buttons = buttonsById(view);

    for (const id of Object.values(TOGGLE)) {
        assert.equal(buttons[id].disabled, false, `${id} enabled with a player`);
    }
    assert.equal(buttons[ACTION.SET_PLAYER].label, 'Change player');
    assert.equal(buttons[ACTION.STOP_PLAYER].disabled, false);
    assert.equal(buttons[ACTION.STOP_PLAYER].style, DANGER);
});

test('toggle buttons show their state in both label and colour', () => {
    const view = panel.renderPanel(
        baseConfig({ player: { name: 'Steve' }, detection: true, joinNotify: false }),
        undefined
    );
    const buttons = buttonsById(view);

    assert.equal(buttons[TOGGLE.DETECTION].label, 'Disconnect: On');
    assert.equal(buttons[TOGGLE.DETECTION].style, SUCCESS, 'green when on');
    assert.equal(buttons[TOGGLE.JOIN].label, 'Join: Off');
    assert.equal(buttons[TOGGLE.JOIN].style, SECONDARY, 'grey when off');
});

test('the admin button only appears for admins', () => {
    const cfg = baseConfig({ player: { name: 'Steve' } });
    assert.equal(buttonsById(panel.renderPanel(cfg, undefined))[VIEW.ADMIN], undefined);
    assert.ok(buttonsById(panel.renderPanel(cfg, undefined, { isAdmin: true }))[VIEW.ADMIN]);
});

test('afkAlertSummary ignores expired alerts and counts servers', () => {
    const now = 10_000;
    assert.equal(panel.afkAlertSummary(undefined, now), null);
    assert.equal(panel.afkAlertSummary({}, now), null);
    assert.equal(panel.afkAlertSummary({ 'Steve|S1': { expiresAt: 5000 } }, now), null, 'expired');

    const oneServer = panel.afkAlertSummary({ 'Steve|S1': { expiresAt: now + 3600000 } }, now);
    assert.equal(oneServer, '1h left (1 server)');

    const twoServers = panel.afkAlertSummary(
        { 'Steve|S1': { expiresAt: now + 3600000 }, 'Steve|S2': { expiresAt: now + 7200000 } },
        now
    );
    assert.equal(twoServers, '1h left (2 servers)', 'reports the soonest expiry');
});

test('an active AFK timer is surfaced on the panel', () => {
    const cfg = baseConfig({ player: { name: 'Steve' } });
    const alerts = { 'Steve|TestServer': { expiresAt: Date.now() + 3600000 } };
    const view = panel.renderPanel(cfg, alerts);

    assert.ok(
        view.embeds[0].fields.some(f => f.name === 'AFK alert'),
        'an AFK alert field is shown'
    );
    assert.equal(buttonsById(view)[VIEW.AFK_TIMER].label, 'AFK timer (active)');
});

test('sub-views all offer a way back', () => {
    const cfg = baseConfig({ player: { name: 'Steve' } });
    for (const view of [
        panel.renderAfkTimer(cfg, undefined),
        panel.renderAfkThreshold(cfg),
        panel.renderServers(),
        panel.renderAdmin()
    ]) {
        assert.ok(buttonsById(view)[VIEW.MAIN], 'has a Back button');
    }
});

test('the AFK timer view offers a cancel option only when one is running', () => {
    const cfg = baseConfig({ player: { name: 'Steve' } });

    const idle = panel.renderAfkTimer(cfg, undefined).components[0].toJSON().components[0];
    assert.equal(idle.custom_id, SELECT.AFK_HOURS);
    assert.ok(!idle.options.some(o => o.value === 'cancel'), 'nothing to cancel');
    assert.deepEqual(
        idle.options.map(o => Number(o.value)),
        panel.AFK_HOUR_CHOICES
    );

    const active = panel
        .renderAfkTimer(cfg, { 'Steve|TestServer': { expiresAt: Date.now() + 3600000 } })
        .components[0].toJSON().components[0];
    assert.ok(
        active.options.some(o => o.value === 'cancel'),
        'can be cancelled'
    );
});

test('the threshold view offers only values the validator accepts', () => {
    const { isValidAfkThreshold } = require('../src/actions');
    const select = panel.renderAfkThreshold(baseConfig()).components[0].toJSON().components[0];

    assert.equal(select.custom_id, SELECT.AFK_THRESHOLD);
    for (const option of select.options) {
        assert.ok(
            isValidAfkThreshold(Number(option.value)),
            `${option.value} minutes is an accepted threshold`
        );
    }
});

test('the player modal enforces username length at the Discord layer', () => {
    const modal = panel.buildPlayerModal('Steve').toJSON();
    assert.equal(modal.custom_id, MODAL.PLAYER);

    const input = modal.components[0].components[0];
    assert.equal(input.custom_id, MODAL.PLAYER_INPUT);
    assert.equal(input.min_length, 3);
    assert.equal(input.max_length, 16);
    assert.equal(input.required, true);
    assert.equal(input.value, 'Steve', 'prefilled with the current player');
});
