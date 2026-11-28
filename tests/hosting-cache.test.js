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

test('HTML is revalidated on every load so a new version shows up right after deploy', () => {
    for (const source of ['/', 'index.html']) {
        assert.match(cacheControl(source) || '', /no-cache/, `missing no-cache for ${source}`);
        assert.match(cacheControl(source) || '', /max-age=0/, `missing max-age=0 for ${source}`);
    }
});

test('JS and CSS are revalidated too (asset URLs have no version query string)', () => {
    const source = '**/*.@(js|css)';
    assert.match(cacheControl(source) || '', /no-cache/);
    assert.match(cacheControl(source) || '', /max-age=0/);
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
