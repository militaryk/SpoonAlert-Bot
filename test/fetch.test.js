'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SPOONALERT_CONFIG = path.join(__dirname, 'fixtures', 'config.json');
process.env.SPOONALERT_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'spoonalert-fetch-'));
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.ADMIN_USER_ID = '123456789012345678';

const { fetchPlayers, isUnreachableError } = require('../src/poller');

/** Spin up a throwaway players.json host. */
function startServer(handler) {
    return new Promise(resolve => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, url: `http://127.0.0.1:${port}/tiles/players.json` });
        });
    });
}

test('reads a bare players array', async () => {
    const { server, url } = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ name: 'Steve', x: 1, y: 2, z: 3 }]));
    });

    const players = await fetchPlayers({ url });
    server.close();

    assert.equal(players.length, 1);
    assert.equal(players[0].name, 'Steve');
});

test('reads the { players: [...] } wrapper shape', async () => {
    const { server, url } = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ players: [{ name: 'Alex', x: 0, y: 0, z: 0 }] }));
    });

    const players = await fetchPlayers({ url });
    server.close();

    assert.equal(players[0].name, 'Alex');
});

test('an unexpected JSON shape yields null rather than throwing', async () => {
    const { server, url } = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ unexpected: true }));
    });

    assert.equal(await fetchPlayers({ url }), null);
    server.close();
});

test('a non-200 response yields null', async () => {
    const { server, url } = await startServer((req, res) => {
        res.writeHead(503);
        res.end('down for maintenance');
    });

    assert.equal(await fetchPlayers({ url }), null);
    server.close();
});

test('malformed JSON yields null rather than throwing', async () => {
    const { server, url } = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"players": [');
    });

    assert.equal(await fetchPlayers({ url }), null);
    server.close();
});

test('an oversized body is rejected by the declared length', async () => {
    const { server, url } = await startServer((req, res) => {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': String(10 * 1024 * 1024)
        });
        res.end('[]');
    });

    assert.equal(await fetchPlayers({ url }), null);
    server.close();
});

test('a refused connection is classified as unreachable, not as a bug', async () => {
    // Port 1 on loopback: nothing is listening.
    const players = await fetchPlayers({ url: 'http://127.0.0.1:1/tiles/players.json' });
    assert.equal(players, null);
});

test('isUnreachableError reads undici error codes nested under cause', () => {
    // This is the trap in dropping node-fetch: undici nests the socket error
    // under err.cause, where node-fetch put it on the error itself. Miss it and
    // every offline-server poll dumps a stack trace instead of one tidy line.
    const undiciStyle = Object.assign(new Error('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    });
    assert.equal(isUnreachableError(undiciStyle), true);

    for (const code of ['ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET']) {
        assert.equal(
            isUnreachableError(Object.assign(new Error('fetch failed'), { cause: { code } })),
            true,
            code
        );
    }
});

test('isUnreachableError recognises an abort from the request timeout', () => {
    assert.equal(isUnreachableError(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
    assert.equal(isUnreachableError(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), true);
});

test('isUnreachableError does not swallow genuine programming errors', () => {
    assert.equal(isUnreachableError(new TypeError('x is not a function')), false);
    assert.equal(isUnreachableError(new SyntaxError('Unexpected token')), false);
});
