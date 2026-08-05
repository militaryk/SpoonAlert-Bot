'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadJson, writeJsonAtomic, quarantineCorrupt } = require('../src/lib/jsonStore');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'spoonalert-test-'));
}

test('loadJson reports a missing file without throwing', () => {
    const dir = tmpDir();
    const result = loadJson(path.join(dir, 'nope.json'), { fallback: true });
    assert.equal(result.status, 'missing');
    assert.deepEqual(result.value, { fallback: true });
});

test('loadJson reads valid JSON', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'ok.json');
    fs.writeFileSync(file, '{"a":1}');
    const result = loadJson(file, {});
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.value, { a: 1 });
});

test('loadJson reports corruption instead of throwing', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'bad.json');
    // Exactly what a kill partway through a non-atomic write leaves behind.
    fs.writeFileSync(file, '{"a":1,"b":');
    const result = loadJson(file, { safe: true });
    assert.equal(result.status, 'corrupt');
    assert.deepEqual(result.value, { safe: true }, 'caller-supplied fallback is returned');
    assert.ok(result.error instanceof Error);
});

test('loadJson treats an empty file as corrupt, not as {}', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'empty.json');
    fs.writeFileSync(file, '');
    assert.equal(loadJson(file, {}).status, 'corrupt');
});

test('writeJsonAtomic writes readable JSON and leaves no temp file', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'state.json');
    writeJsonAtomic(file, { hello: 'world' });

    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { hello: 'world' });
    assert.equal(fs.existsSync(`${file}.tmp`), false, 'temp file is renamed away, not left behind');
});

test('writeJsonAtomic replaces existing content in place', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'state.json');
    writeJsonAtomic(file, { version: 1 });
    writeJsonAtomic(file, { version: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 2 });
    assert.equal(fs.readdirSync(dir).length, 1, 'no leftovers in the directory');
});

test('quarantineCorrupt moves the file aside and preserves its bytes', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{"partial":');

    const moved = quarantineCorrupt(file, 12345);

    assert.equal(moved, `${file}.corrupt-12345`);
    assert.equal(fs.existsSync(file), false, 'original path is freed up');
    assert.equal(fs.readFileSync(moved, 'utf8'), '{"partial":', 'data is recoverable by hand');
});
