'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
const hosting = config.hosting;

function headerRule(source) {
    return hosting.headers.find(rule => rule.source === source);
}

function cacheControl(source) {
    return headerRule(source)?.headers?.find(header => header.key === 'Cache-Control')?.value;
}

test('HTML is never stored by the browser, so a new version shows up right after deploy', () => {
    for (const source of ['/', 'index.html']) {
        assert.match(cacheControl(source) || '', /no-store/, `missing no-store for ${source}`);
        assert.match(cacheControl(source) || '', /must-revalidate/, `missing must-revalidate for ${source}`);
    }
});

test('JS and CSS are not stored either', () => {
    const source = '**/*.@(js|css)';
    assert.match(cacheControl(source) || '', /no-store/);
    assert.match(cacheControl(source) || '', /must-revalidate/);
});

test('local assets carry the game version in their URL so old copies cannot be reused', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const rules = fs.readFileSync(path.join(ROOT, 'js/rules.js'), 'utf8');
    const version = rules.match(/const VERSION = '([^']+)'/)[1];
    const localRefs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map(match => match[1]);

    assert.ok(localRefs.length >= 10, 'expected local JS/CSS references in index.html');
    for (const ref of localRefs) {
        assert.ok(ref.endsWith(`?v=${version}`), `asset without version stamp: ${ref}`);
    }
});

test('version marker is served uncached and matches the game version', () => {
    const marker = fs.readFileSync(path.join(ROOT, 'version.txt'), 'utf8').trim();
    const rules = fs.readFileSync(path.join(ROOT, 'js/rules.js'), 'utf8');
    const version = rules.match(/const VERSION = '([^']+)'/)[1];
    assert.equal(marker, version);
    assert.match(cacheControl('version.txt') || '', /no-store/);
});

test('long-open tabs get a new-version banner without an abrupt reload', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
    assert.match(html, /id="updateBanner"/);
    assert.match(html, /id="updateReloadBtn"/);
    assert.match(main, /function checkForUpdate/);
    assert.match(main, /setInterval\(checkForUpdate, 60000\)/);
    assert.match(main, /window\.location\.reload\(\)/);
});

test('security headers remain in place for all files', () => {
    const keys = headerRule('**').headers.map(header => header.key);
    for (const key of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
        assert.ok(keys.includes(key), `missing security header: ${key}`);
    }
});

test('private files are excluded from Hosting', () => {
    for (const pattern of ['.git/**', 'firebase.json', 'package.json', '**/.*']) {
        assert.ok(hosting.ignore.includes(pattern), `missing ignore pattern: ${pattern}`);
    }
});
